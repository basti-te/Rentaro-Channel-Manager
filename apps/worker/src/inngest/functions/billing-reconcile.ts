/**
 * Daily defensive billing reconciliation.
 *
 * Per CLAUDE.md rule #8 ("side-effects through Inngest"), this is the
 * self-healing companion to the webhook-driven sync — if a Stripe webhook
 * is ever missed or arrives out of order, this cron pulls us back into
 * line. For every tenant with a non-terminal subscription, ensure the
 * per-property line item's quantity equals the active property count.
 *
 * Mirrors the messages-dispatch / ari-flush-cron pattern (event-driven
 * with a periodic safety net).
 */
import { and, eq, inArray } from 'drizzle-orm';
import { createDb, subscriptions, tenants } from '@cm/db';
import { getStripe, reconcileQuantity } from '@cm/api';
import { env } from '../../env';
import { inngest } from '../client';

export interface ReconcileResult {
  scanned: number;
  updated: number;
  errors: number;
}

async function reconcile(): Promise<ReconcileResult> {
  const stripe = getStripe(env);
  if (!stripe) return { scanned: 0, updated: 0, errors: 0 };
  const db = createDb(env.DATABASE_URL);

  const rows = await db
    .select({ tenantId: subscriptions.tenantId })
    .from(subscriptions)
    .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
    .where(
      and(
        inArray(subscriptions.status, ['trialing', 'active', 'past_due']),
        eq(tenants.billingExempt, false),
      ),
    );

  let updated = 0;
  let errors = 0;
  for (const r of rows) {
    try {
      const out = await reconcileQuantity(stripe, db, r.tenantId);
      if (out.updated) updated++;
    } catch {
      errors++;
    }
  }

  return { scanned: rows.length, updated, errors };
}

export const billingReconcile = inngest.createFunction(
  { id: 'billing-reconcile', name: 'Reconcile Stripe quantities daily', retries: 1 },
  [{ cron: '15 3 * * *' }, { event: 'billing/reconcile.now' }],
  async ({ step, logger }) => {
    const res = await step.run('reconcile', reconcile);
    if (res.updated > 0 || res.errors > 0) {
      logger.info(res, 'billing reconcile run');
    }
    return res;
  },
);
