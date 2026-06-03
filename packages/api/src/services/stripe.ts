/**
 * Stripe SDK wrapper for SaaS billing.
 *
 * All exports degrade gracefully when Stripe env is unset (returns
 * null/empty/`not_configured`) so the rest of the app still works in
 * dev environments that haven't been pointed at a Stripe account.
 *
 * Pricing model: hybrid base + per-property, monthly or annual (-10%).
 * 4 Stripe Price IDs configured via env. Annual discount is encoded in
 * the Stripe Dashboard (no math in code).
 */
import Stripe from 'stripe';
import { and, desc, eq } from 'drizzle-orm';
import { properties, subscriptions, tenants, type Database } from '@cm/db';
import type { AppContextEnv } from '../context';

export const TRIAL_DAYS = 14;
const DAY_MS = 86_400_000;

export type BillingInterval = 'monthly' | 'annual';

export interface StripePriceIds {
  basePriceId: string;
  propertyPriceId: string;
}

let _client: Stripe | null = null;

/** Lazy-cached Stripe client, or null when STRIPE_SECRET_KEY is unset. */
export function getStripe(env: AppContextEnv): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  if (_client) return _client;
  _client = new Stripe(env.STRIPE_SECRET_KEY, { typescript: true });
  return _client;
}

/**
 * Verify a Stripe webhook against `stripe-signature` and return the parsed
 * Event. Throws if the secret/key is unset or the signature is invalid.
 * Idempotency at the table level is the caller's responsibility
 * (webhook_deliveries source='stripe', external_id=event.id).
 */
export function verifyStripeWebhook(
  env: AppContextEnv,
  rawBody: string,
  signature: string,
): Stripe.Event {
  const stripe = getStripe(env);
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('stripe_webhook_not_configured');
  }
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

export function isStripeConfigured(env: AppContextEnv): boolean {
  return !!(
    env.STRIPE_SECRET_KEY &&
    env.STRIPE_PRICE_BASE_MONTHLY &&
    env.STRIPE_PRICE_BASE_ANNUAL &&
    env.STRIPE_PRICE_PROPERTY_MONTHLY &&
    env.STRIPE_PRICE_PROPERTY_ANNUAL
  );
}

/** Resolve the (base, property) price IDs for a chosen interval. */
export function pricesFor(env: AppContextEnv, interval: BillingInterval): StripePriceIds | null {
  if (interval === 'monthly') {
    if (!env.STRIPE_PRICE_BASE_MONTHLY || !env.STRIPE_PRICE_PROPERTY_MONTHLY) return null;
    return {
      basePriceId: env.STRIPE_PRICE_BASE_MONTHLY,
      propertyPriceId: env.STRIPE_PRICE_PROPERTY_MONTHLY,
    };
  }
  if (!env.STRIPE_PRICE_BASE_ANNUAL || !env.STRIPE_PRICE_PROPERTY_ANNUAL) return null;
  return {
    basePriceId: env.STRIPE_PRICE_BASE_ANNUAL,
    propertyPriceId: env.STRIPE_PRICE_PROPERTY_ANNUAL,
  };
}

/** Count of active properties for the tenant — the metered "property" line-item quantity. */
async function activePropertyCount(db: Database, tenantId: string): Promise<number> {
  const rows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.tenantId, tenantId), eq(properties.active, true)));
  return Math.max(1, rows.length); // Stripe rejects 0; minimum 1 active property as a paying unit.
}

/** Latest subscription row for the tenant (created-desc). */
async function latestSubscription(db: Database, tenantId: string) {
  return (
    await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1)
  )[0];
}

/**
 * Days remaining on the LOCAL trial (the trial we track in our subscriptions
 * row before any Stripe Subscription exists), rounded up. Returns 0 once
 * expired or when no trial row exists.
 */
function remainingTrialDays(trialEndsAt: Date | null | undefined): number {
  if (!trialEndsAt) return 0;
  const ms = trialEndsAt.getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

/**
 * Get an existing Stripe Customer for the tenant, or create one and persist
 * the id. Idempotent — safe to call multiple times.
 */
export async function getOrCreateStripeCustomer(
  stripe: Stripe,
  db: Database,
  tenantId: string,
  ownerEmail: string,
): Promise<string> {
  const t = (
    await db
      .select({ id: tenants.id, name: tenants.name, stripeCustomerId: tenants.stripeCustomerId })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
  )[0];
  if (!t) throw new Error('tenant_not_found');
  if (t.stripeCustomerId) return t.stripeCustomerId;

  const cust = await stripe.customers.create({
    email: ownerEmail,
    name: t.name,
    metadata: { tenant_id: tenantId },
  });
  await db
    .update(tenants)
    .set({ stripeCustomerId: cust.id, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));
  return cust.id;
}

/**
 * Create a Stripe Checkout Session in 'subscription' mode for the chosen
 * interval. Base price × 1 + per-property price × active-property count.
 * Passes the remaining local-trial days to Stripe so the trial UX continues
 * seamlessly across the checkout boundary.
 */
export async function createCheckoutSession(opts: {
  stripe: Stripe;
  db: Database;
  env: AppContextEnv;
  tenantId: string;
  ownerEmail: string;
  interval: BillingInterval;
}): Promise<{ url: string }> {
  const prices = pricesFor(opts.env, opts.interval);
  if (!prices) throw new Error('stripe_prices_not_configured');

  const customerId = await getOrCreateStripeCustomer(
    opts.stripe,
    opts.db,
    opts.tenantId,
    opts.ownerEmail,
  );

  const propertyQty = await activePropertyCount(opts.db, opts.tenantId);
  const sub = await latestSubscription(opts.db, opts.tenantId);
  const trialDays = remainingTrialDays(sub?.trialEndsAt ?? null);

  const appUrl = opts.env.APP_URL ?? 'http://localhost:5173';

  const session = await opts.stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [
      { price: prices.basePriceId, quantity: 1 },
      { price: prices.propertyPriceId, quantity: propertyQty },
    ],
    subscription_data: {
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
      metadata: { tenant_id: opts.tenantId },
    },
    metadata: { tenant_id: opts.tenantId },
    automatic_tax: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
    billing_address_collection: 'auto',
    tax_id_collection: { enabled: true },
    allow_promotion_codes: true,
    success_url: `${appUrl}/settings?billing=success`,
    cancel_url: `${appUrl}/settings?billing=cancel`,
  });

  if (!session.url) throw new Error('stripe_checkout_no_url');
  return { url: session.url };
}

/** Create a Stripe Customer Portal session. Requires an existing Stripe customer. */
export async function createPortalSession(opts: {
  stripe: Stripe;
  db: Database;
  env: AppContextEnv;
  tenantId: string;
}): Promise<{ url: string }> {
  const t = (
    await opts.db
      .select({ stripeCustomerId: tenants.stripeCustomerId })
      .from(tenants)
      .where(eq(tenants.id, opts.tenantId))
      .limit(1)
  )[0];
  if (!t?.stripeCustomerId) throw new Error('no_stripe_customer');

  const appUrl = opts.env.APP_URL ?? 'http://localhost:5173';
  const session = await opts.stripe.billingPortal.sessions.create({
    customer: t.stripeCustomerId,
    return_url: `${appUrl}/settings`,
  });
  return { url: session.url };
}

/**
 * Map a Stripe Subscription onto our subscriptions row. Idempotent — uses
 * `stripeSubscriptionId` (unique) as the key. Called by the webhook handler
 * for every customer.subscription.* event.
 */
export async function syncSubscriptionFromStripe(
  stripe: Stripe,
  db: Database,
  stripeSubscriptionId: string,
): Promise<void> {
  const s = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ['latest_invoice'],
  });
  const tenantId = (s.metadata?.tenant_id ?? null) as string | null;
  if (!tenantId) return; // not one of ours

  // Checkout sends line_items as [base, property] in that order; Stripe
  // preserves order in items.data, so items[0]=base and items[1]=property.
  const baseItem = s.items.data[0];
  const propertyItem = s.items.data[1] ?? baseItem;
  const interval =
    baseItem?.price.recurring?.interval === 'year' ? ('annual' as const) : ('monthly' as const);
  const quantity = propertyItem?.quantity ?? 1;
  // One product tier today — all subscribers map to 'starter'.
  const planLabel = 'starter' as const;

  // Find the row to update: prefer the one already linked to this Stripe
  // subscription; otherwise adopt the tenant's existing (onboarding-trial)
  // row — keeps exactly ONE subscriptions row per tenant instead of
  // accumulating a fresh row on every first checkout.
  let existing = (
    await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, s.id))
      .limit(1)
  )[0];
  if (!existing) {
    existing = (
      await db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, tenantId))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1)
    )[0];
  }

  const trialEnd = s.trial_end ? new Date(s.trial_end * 1000) : null;
  // In Stripe API 2025+, current_period_{start,end} live on each item.
  const periodStart = baseItem?.current_period_start
    ? new Date(baseItem.current_period_start * 1000)
    : null;
  const periodEnd = baseItem?.current_period_end
    ? new Date(baseItem.current_period_end * 1000)
    : null;
  const cancelAt = s.cancel_at ? new Date(s.cancel_at * 1000) : null;
  const latestInvoice =
    typeof s.latest_invoice === 'string'
      ? s.latest_invoice
      : s.latest_invoice?.id ?? null;

  const patch = {
    plan: planLabel as 'starter',
    status: s.status as
      | 'trialing'
      | 'active'
      | 'past_due'
      | 'canceled'
      | 'unpaid'
      | 'incomplete',
    stripeSubscriptionId: s.id,
    stripePriceId: baseItem?.price.id ?? null,
    quantity,
    billingInterval: interval,
    trialEndsAt: trialEnd,
    latestInvoiceId: latestInvoice,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAt,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(subscriptions).set(patch).where(eq(subscriptions.id, existing.id));
  } else {
    await db.insert(subscriptions).values({ tenantId, ...patch });
  }

  // Mirror the effective plan/status onto the tenant row for fast reads.
  await db
    .update(tenants)
    .set({ plan: patch.plan, status: patch.status, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));
}

/** Reconcile the per-property quantity for a tenant's active Stripe Subscription. */
export async function reconcileQuantity(
  stripe: Stripe,
  db: Database,
  tenantId: string,
): Promise<{ updated: boolean; quantity: number }> {
  const sub = await latestSubscription(db, tenantId);
  if (!sub?.stripeSubscriptionId) return { updated: false, quantity: 0 };
  if (sub.status === 'canceled' || sub.status === 'unpaid') {
    return { updated: false, quantity: sub.quantity };
  }

  const target = await activePropertyCount(db, tenantId);
  if (target === sub.quantity) return { updated: false, quantity: target };

  const s = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  // items.data[0]=base, items.data[1]=property (preserved from Checkout).
  const propertyItem = s.items.data[1];
  if (!propertyItem) return { updated: false, quantity: target };

  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    items: [{ id: propertyItem.id, quantity: target }],
    proration_behavior: 'create_prorations',
  });
  return { updated: true, quantity: target };
}

/**
 * Ensure the tenant's active Stripe Subscription carries the usage-based SMS
 * metered Price as a line item (so meter events actually invoice). Idempotent —
 * adds the item only if missing. No-op when STRIPE_PRICE_SMS_METERED is unset.
 */
export async function ensureSmsMeteredItem(
  stripe: Stripe,
  env: AppContextEnv,
  subscriptionId: string,
): Promise<boolean> {
  const priceId = env.STRIPE_PRICE_SMS_METERED;
  if (!priceId) return false;
  const s = await stripe.subscriptions.retrieve(subscriptionId);
  if (s.items.data.some((it) => it.price.id === priceId)) return true;
  await stripe.subscriptions.update(subscriptionId, {
    items: [{ price: priceId }],
    proration_behavior: 'none',
  });
  return true;
}

/**
 * Report SMS usage to the Stripe Billing Meter. `value` = SMS segments to add
 * for this customer's current period. `identifier` makes the event idempotent
 * (Stripe drops duplicates). No-op when STRIPE_SMS_METER_EVENT_NAME is unset or
 * value ≤ 0.
 */
export async function reportSmsMeterEvent(
  stripe: Stripe,
  env: AppContextEnv,
  customerId: string,
  value: number,
  identifier: string,
): Promise<void> {
  const eventName = env.STRIPE_SMS_METER_EVENT_NAME;
  if (!eventName || value <= 0) return;
  await stripe.billing.meterEvents.create({
    event_name: eventName,
    identifier,
    payload: { stripe_customer_id: customerId, value: String(value) },
  });
}
