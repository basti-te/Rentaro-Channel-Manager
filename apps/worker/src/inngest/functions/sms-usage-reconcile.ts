/**
 * Daily usage-based SMS metering.
 *
 * SMS is an opt-in add-on (tenants.sms_enabled) billed per segment. Once a day
 * this sums the SMS segments a tenant sent since its watermark
 * (sms_usage_reported_through), reports them to the Stripe Billing Meter, and
 * advances the watermark. Decoupled from the send path (a Stripe outage never
 * blocks an SMS) — mirrors billing-reconcile.
 *
 * No-op unless STRIPE_SMS_METER_EVENT_NAME + STRIPE_PRICE_SMS_METERED are set
 * (the operator must create the Meter + metered Price in Stripe first — see
 * docs/stripe-setup.md). On a tenant's first run the watermark is NULL → we
 * baseline it to `now` WITHOUT billing pre-existing history.
 */
import { and, eq, gt, inArray, isNotNull, lte } from 'drizzle-orm';
import {
  cleaningMessages,
  createDb,
  messages,
  subscriptions,
  tenants,
} from '@cm/db';
import {
  ensureSmsMeteredItem,
  getStripe,
  reportSmsMeterEvent,
  resolveSmsCountry,
  smsCustomerPriceMinor,
  smsSegments,
} from '@cm/api';
import { env } from '../../env';
import { inngest } from '../client';

export interface SmsUsageResult {
  scanned: number;
  reported: number;
  chargeMinor: number;
  errors: number;
}

async function reconcile(): Promise<SmsUsageResult> {
  const stripe = getStripe(env);
  // Gate: needs a configured Stripe Meter + metered Price to bill anything.
  if (
    !stripe ||
    !env.STRIPE_SMS_METER_EVENT_NAME ||
    !env.STRIPE_PRICE_SMS_METERED
  ) {
    return { scanned: 0, reported: 0, chargeMinor: 0, errors: 0 };
  }
  const db = createDb(env.DATABASE_URL);
  const now = new Date();

  // SMS-on tenants with a billable Stripe subscription and a customer.
  const rows = await db
    .select({
      tenantId: tenants.id,
      customerId: tenants.stripeCustomerId,
      watermark: tenants.smsUsageReportedThrough,
      subscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(tenants)
    .innerJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .where(
      and(
        eq(tenants.smsEnabled, true),
        eq(tenants.billingExempt, false),
        isNotNull(tenants.stripeCustomerId),
        isNotNull(subscriptions.stripeSubscriptionId),
        inArray(subscriptions.status, ['trialing', 'active', 'past_due']),
      ),
    );

  let reported = 0;
  let totalChargeMinor = 0;
  let errors = 0;

  for (const r of rows) {
    try {
      // First time: baseline the watermark to now; never bill history.
      if (!r.watermark) {
        await db
          .update(tenants)
          .set({ smsUsageReportedThrough: now, updatedAt: new Date() })
          .where(eq(tenants.id, r.tenantId));
        continue;
      }

      // Sum segments of every SMS sent in (watermark, now] across both
      // guest messages and cleaning reminders.
      const guest = await db
        .select({ body: messages.body, toAddress: messages.toAddress })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, r.tenantId),
            eq(messages.channel, 'sms'),
            eq(messages.status, 'sent'),
            gt(messages.sentAt, r.watermark),
            lte(messages.sentAt, now),
          ),
        );
      const cleaning = await db
        .select({ body: cleaningMessages.body, toAddress: cleaningMessages.toAddress })
        .from(cleaningMessages)
        .where(
          and(
            eq(cleaningMessages.tenantId, r.tenantId),
            eq(cleaningMessages.status, 'sent'),
            gt(cleaningMessages.sentAt, r.watermark),
            lte(cleaningMessages.sentAt, now),
          ),
        );

      // Charge = Σ segments × per-country customer price (EUR cents). The meter
      // value is that cent amount; the Stripe metered price is €0.01 per unit.
      const priceMinor = (addr: string | null) => {
        const c = resolveSmsCountry(addr);
        return c ? smsCustomerPriceMinor(c) ?? 0 : 0;
      };
      let chargeMinor = 0;
      for (const m of guest) chargeMinor += smsSegments(m.body) * priceMinor(m.toAddress);
      for (const m of cleaning) {
        chargeMinor += smsSegments(m.body) * priceMinor(m.toAddress);
      }

      if (chargeMinor > 0 && r.customerId && r.subscriptionId) {
        // Attach the metered price (idempotent) so usage actually invoices.
        await ensureSmsMeteredItem(stripe, env, r.subscriptionId);
        // Identifier keyed by the window START → a retry of the same window
        // dedups in Stripe instead of double-billing.
        await reportSmsMeterEvent(
          stripe,
          env,
          r.customerId,
          chargeMinor,
          `sms-${r.tenantId}-${r.watermark.toISOString()}`,
        );
        reported++;
        totalChargeMinor += chargeMinor;
      }

      await db
        .update(tenants)
        .set({ smsUsageReportedThrough: now, updatedAt: new Date() })
        .where(eq(tenants.id, r.tenantId));
    } catch {
      errors++;
    }
  }

  return { scanned: rows.length, reported, chargeMinor: totalChargeMinor, errors };
}

export const smsUsageReconcile = inngest.createFunction(
  { id: 'sms-usage-reconcile', name: 'Report SMS usage to Stripe daily', retries: 1 },
  [{ cron: '30 3 * * *' }, { event: 'sms-usage/reconcile.now' }],
  async ({ step, logger }) => {
    const res = await step.run('reconcile', reconcile);
    if (res.reported > 0 || res.errors > 0) {
      logger.info(res, 'sms usage reconcile run');
    }
    return res;
  },
);
