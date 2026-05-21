/**
 * Plan / subscription enforcement.
 *
 * Total-lockout policy (per ADR 0010): a tenant whose subscription is not in
 * {trialing (and not expired) | active} is blocked from mutating endpoints.
 * The front-end additionally redirects them to /settings/billing; this is
 * the back-end defence-in-depth.
 *
 * Exemption: `tenants.billingExempt = true` bypasses the gate entirely
 * (project-owner workspace + comped accounts).
 */
import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { subscriptions, tenants } from '@cm/db';
import type { Database } from '@cm/db';

export type AccessReason =
  | 'exempt'
  | 'trialing'
  | 'active'
  | 'trial_expired'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'unpaid'
  | 'no_subscription';

export interface AccessState {
  ok: boolean;
  reason: AccessReason;
  trialEndsAt: Date | null;
  status: string | null;
  /**
   * True once the tenant has a real Stripe subscription attached (i.e. they
   * completed checkout). Distinguishes "trial, not yet subscribed" from
   * "subscribed, still inside the trial window" — the UI needs this since
   * both have reason 'trialing'.
   */
  subscribed: boolean;
}

/**
 * Pure check — returns whether the tenant currently has access AND why.
 * Used both by the procedure middleware and by the billing.currentPlan
 * query so the UI can render the right lockout messaging.
 */
export async function resolveAccess(
  db: Database,
  tenantId: string,
): Promise<AccessState> {
  const t = (
    await db
      .select({ billingExempt: tenants.billingExempt })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
  )[0];
  if (!t) {
    return {
      ok: false, reason: 'no_subscription', trialEndsAt: null,
      status: null, subscribed: false,
    };
  }
  if (t.billingExempt) {
    return {
      ok: true, reason: 'exempt', trialEndsAt: null,
      status: null, subscribed: false,
    };
  }

  const s = (
    await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1)
  )[0];

  if (!s) {
    return {
      ok: false, reason: 'no_subscription', trialEndsAt: null,
      status: null, subscribed: false,
    };
  }
  const trialEndsAt = s.trialEndsAt ?? null;
  const subscribed = !!s.stripeSubscriptionId;

  if (s.status === 'active') {
    return { ok: true, reason: 'active', trialEndsAt, status: s.status, subscribed };
  }
  if (s.status === 'trialing') {
    if (!trialEndsAt || trialEndsAt > new Date()) {
      return { ok: true, reason: 'trialing', trialEndsAt, status: s.status, subscribed };
    }
    return { ok: false, reason: 'trial_expired', trialEndsAt, status: s.status, subscribed };
  }
  return {
    ok: false,
    reason: (s.status as AccessReason) ?? 'no_subscription',
    trialEndsAt,
    status: s.status,
    subscribed,
  };
}

/** Throw a structured 402-equivalent if the tenant doesn't have access. */
export async function assertActiveSubscription(
  db: Database,
  tenantId: string,
): Promise<void> {
  const a = await resolveAccess(db, tenantId);
  if (a.ok) return;
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: `SUBSCRIPTION_REQUIRED:${a.reason}`,
  });
}
