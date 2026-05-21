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
  /**
   * Set when the subscription is scheduled to cancel at period end (the
   * tenant cancelled via the Customer Portal but still has access until
   * this date). `null` for an open-ended subscription.
   */
  cancelAt: Date | null;
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
      status: null, subscribed: false, cancelAt: null,
    };
  }
  if (t.billingExempt) {
    return {
      ok: true, reason: 'exempt', trialEndsAt: null,
      status: null, subscribed: false, cancelAt: null,
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
      status: null, subscribed: false, cancelAt: null,
    };
  }
  const trialEndsAt = s.trialEndsAt ?? null;
  const subscribed = !!s.stripeSubscriptionId;
  const cancelAt = s.cancelAt ?? null;

  if (s.status === 'active') {
    return { ok: true, reason: 'active', trialEndsAt, status: s.status, subscribed, cancelAt };
  }
  if (s.status === 'trialing') {
    if (!trialEndsAt || trialEndsAt > new Date()) {
      return { ok: true, reason: 'trialing', trialEndsAt, status: s.status, subscribed, cancelAt };
    }
    return { ok: false, reason: 'trial_expired', trialEndsAt, status: s.status, subscribed, cancelAt };
  }
  return {
    ok: false,
    reason: (s.status as AccessReason) ?? 'no_subscription',
    trialEndsAt,
    status: s.status,
    subscribed,
    cancelAt,
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
