/**
 * Daily usage-based AI metering.
 *
 * The AI guest-reply assistant is an opt-in add-on (tenants.ai_replies_enabled)
 * billed per reply the AI actually sends. Once a day this counts the AI replies
 * a tenant sent since its watermark (ai_usage_reported_through), reports that
 * count to the Stripe Billing Meter, and advances the watermark. Decoupled from
 * the draft/send path (a Stripe outage never blocks a reply) — mirrors
 * sms-usage-reconcile.
 *
 * A reply is billable once it leaves the building: a guest_messages row with
 * ai_generated = true AND status = 'sent'. We window on updated_at, which is the
 * moment the row became 'sent' (insert time for an auto-send, approval time for
 * a human-approved draft). Drafts that are never approved (status 'draft') or
 * dismissed are never billed.
 *
 * No-op unless STRIPE_AI_METER_EVENT_NAME + STRIPE_PRICE_AI_METERED are set (the
 * operator must create the Meter + metered Price in Stripe first — see
 * docs/stripe-setup.md). On a tenant's first run the watermark is NULL → we
 * baseline it to `now` WITHOUT billing pre-existing history.
 */
import { and, count, eq, gt, inArray, isNotNull, lte } from 'drizzle-orm';
import { createDb, guestMessages, subscriptions, tenants } from '@cm/db';
import { ensureAiMeteredItem, getStripe, reportAiMeterEvent } from '@cm/api';
import { env } from '../../env';
import { inngest } from '../client';

export interface AiUsageResult {
  scanned: number;
  reported: number;
  replies: number;
  errors: number;
}

async function reconcile(): Promise<AiUsageResult> {
  const stripe = getStripe(env);
  // Gate: needs a configured Stripe Meter + metered Price to bill anything.
  if (
    !stripe ||
    !env.STRIPE_AI_METER_EVENT_NAME ||
    !env.STRIPE_PRICE_AI_METERED
  ) {
    return { scanned: 0, reported: 0, replies: 0, errors: 0 };
  }
  const db = createDb(env.DATABASE_URL);
  const now = new Date();

  // AI-on tenants with a billable Stripe subscription and a customer.
  const rows = await db
    .select({
      tenantId: tenants.id,
      customerId: tenants.stripeCustomerId,
      watermark: tenants.aiUsageReportedThrough,
      subscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(tenants)
    .innerJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .where(
      and(
        eq(tenants.aiRepliesEnabled, true),
        eq(tenants.billingExempt, false),
        isNotNull(tenants.stripeCustomerId),
        isNotNull(subscriptions.stripeSubscriptionId),
        inArray(subscriptions.status, ['trialing', 'active', 'past_due']),
      ),
    );

  let reported = 0;
  let totalReplies = 0;
  let errors = 0;

  for (const r of rows) {
    try {
      // First time: baseline the watermark to now; never bill history.
      if (!r.watermark) {
        await db
          .update(tenants)
          .set({ aiUsageReportedThrough: now, updatedAt: new Date() })
          .where(eq(tenants.id, r.tenantId));
        continue;
      }

      // Count AI replies that became 'sent' in (watermark, now].
      const [agg] = await db
        .select({ n: count() })
        .from(guestMessages)
        .where(
          and(
            eq(guestMessages.tenantId, r.tenantId),
            eq(guestMessages.aiGenerated, true),
            eq(guestMessages.status, 'sent'),
            gt(guestMessages.updatedAt, r.watermark),
            lte(guestMessages.updatedAt, now),
          ),
        );
      const replies = Number(agg?.n ?? 0);

      if (replies > 0 && r.customerId && r.subscriptionId) {
        // Attach the metered price (idempotent) so usage actually invoices.
        await ensureAiMeteredItem(stripe, env, r.subscriptionId);
        // Identifier keyed by the window START → a retry of the same window
        // dedups in Stripe instead of double-billing.
        await reportAiMeterEvent(
          stripe,
          env,
          r.customerId,
          replies,
          `ai-${r.tenantId}-${r.watermark.toISOString()}`,
        );
        reported++;
        totalReplies += replies;
      }

      await db
        .update(tenants)
        .set({ aiUsageReportedThrough: now, updatedAt: new Date() })
        .where(eq(tenants.id, r.tenantId));
    } catch {
      errors++;
    }
  }

  return { scanned: rows.length, reported, replies: totalReplies, errors };
}

export const aiUsageReconcile = inngest.createFunction(
  { id: 'ai-usage-reconcile', name: 'Report AI usage to Stripe daily', retries: 1 },
  [{ cron: '45 3 * * *' }, { event: 'ai-usage/reconcile.now' }],
  async ({ step, logger }) => {
    const res = await step.run('reconcile', reconcile);
    if (res.reported > 0 || res.errors > 0) {
      logger.info(res, 'ai usage reconcile run');
    }
    return res;
  },
);
