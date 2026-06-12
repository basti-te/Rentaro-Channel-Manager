/**
 * Channel Manager — Database Schema
 *
 * Conventions:
 *   - All IDs are UUIDv4 (defaultRandom).
 *   - Every tenant-scoped table has `tenant_id` and an index on it.
 *   - All timestamps are TIMESTAMPTZ (UTC). Booking dates are DATE (no tz).
 *   - Money is `bigint` cents + ISO 4217 currency code.
 *   - Row-Level Security is enabled in `migrations/9999_rls_policies.sql`.
 *
 * After changing this file, run: pnpm db:generate
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  date,
  boolean,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const planEnum = pgEnum('plan', ['free', 'starter', 'pro', 'enterprise']);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
]);

export const membershipRoleEnum = pgEnum('membership_role', [
  'owner',
  'admin',
  'manager',
  'viewer',
]);

export const bookingSourceEnum = pgEnum('booking_source', [
  'internal',      // manually entered in our app
  'airbnb',
  'booking_com',
  'expedia',
  'other_ota',
  'block',         // pure availability block, no guest
]);

export const bookingStatusEnum = pgEnum('booking_status', [
  'draft',
  'confirmed',
  'pending_sync',
  'synced',
  'sync_failed',
  'cancelled',
  'blocked',
]);

export const syncJobTypeEnum = pgEnum('sync_job_type', [
  'push_availability',
  'push_rates',
  'push_restrictions',
  'pull_bookings',
  'pull_booking_revision',
  'create_channex_property',
  'update_channex_mapping',
  // Full Sync: 500-day availability + rates/restrictions for one property
  // in 2 Channex calls (going-live / recovery; PMS-certification step).
  'full_sync',
]);

export const syncJobStatusEnum = pgEnum('sync_job_status', [
  'queued',
  'running',
  'success',
  'failed',
  'cancelled',
]);

/**
 * ARI outbox change kinds.
 *   - 'availability' → recompute occupied days from bookings, push /availability
 *   - 'rates'        → resolve effective rate + restrictions, push /restrictions
 * Rates and restrictions travel together on Channex's /restrictions endpoint,
 * so a single 'rates' kind covers both.
 */
export const ariKindEnum = pgEnum('ari_kind', ['availability', 'rates']);

/**
 * Who owns nightly rates for a tenant.
 *   - 'pms'       → we push rates from rate_overrides / property defaults
 *   - 'pricelabs' → PriceLabs writes rates straight into Channex (ADR 0006);
 *                   the flusher then suppresses the `rate` field but still
 *                   pushes PMS-owned restrictions (min/max stay, stop-sell…).
 */
export const rateSourceEnum = pgEnum('rate_source', ['pms', 'pricelabs']);

/** Billing cadence for a tenant's SaaS subscription. Annual gives -10%. */
export const billingIntervalEnum = pgEnum('billing_interval', ['monthly', 'annual']);

export const messageChannelEnum = pgEnum('message_channel', [
  'sms',
  'airbnb',
  'booking_com',
  'email',
]);

export const messageDirectionEnum = pgEnum('message_direction', ['outbound', 'inbound']);

export const messageStatusEnum = pgEnum('message_status', [
  'scheduled',
  'queued',
  'sending',
  'sent',
  'delivered',
  'failed',
  'cancelled',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Tenant layer
// ─────────────────────────────────────────────────────────────────────────────

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: planEnum('plan').notNull().default('free'),
  status: text('status').notNull().default('active'), // active, suspended, deleted
  stripeCustomerId: text('stripe_customer_id').unique(),
  defaultTimezone: text('default_timezone').notNull().default('Europe/Berlin'),
  defaultCurrency: text('default_currency').notNull().default('EUR'),

  /** City / tourist tax rate in basis points (500 = 5.00%). Berlin = 500. */
  defaultCityTaxRateBp: integer('default_city_tax_rate_bp').notNull().default(500),
  /** Default check-in time, format HH:mm, applied to new bookings. */
  defaultCheckinTime: text('default_checkin_time').notNull().default('15:00'),
  /** Default check-out time, format HH:mm. */
  defaultCheckoutTime: text('default_checkout_time').notNull().default('11:00'),

  /**
   * Rate ownership. 'pms' (default) = we push rates; 'pricelabs' = PriceLabs
   * owns rates in Channex directly and we only push restrictions.
   */
  rateSource: rateSourceEnum('rate_source').notNull().default('pms'),

  /**
   * Per-tenant alphanumeric SMS sender id (Twilio `From`). NULL → fall back
   * to the account-wide `TWILIO_FROM` env default. Constraints: ≤11 chars,
   * ≥1 letter, only A–Z a–z 0–9 and spaces (validated in the API).
   */
  smsSenderId: text('sms_sender_id'),

  /**
   * SMS add-on opt-in. When false, ALL SMS (cleaning reminders + guest
   * messages) are skipped — SMS is billed by usage and is OFF by default for
   * new tenants. Existing tenants are backfilled to true in the migration.
   */
  smsEnabled: boolean('sms_enabled').notNull().default(false),

  /**
   * Watermark for usage-based SMS metering: the worker reports SMS segments
   * sent after this instant to Stripe, then advances it. NULL = not yet
   * baselined (the first reconcile sets it to now without billing history).
   */
  smsUsageReportedThrough: timestamp('sms_usage_reported_through', {
    withTimezone: true,
  }),

  /**
   * AI guest-reply add-on (opt-in, usage-billed like SMS). When false, no AI
   * drafts or replies are generated. `aiAutoSend` lets confident replies go out
   * without human approval (only meaningful when aiRepliesEnabled). The
   * watermark drives usage-based Stripe metering.
   */
  aiRepliesEnabled: boolean('ai_replies_enabled').notNull().default(false),
  aiAutoSend: boolean('ai_auto_send').notNull().default(false),
  aiUsageReportedThrough: timestamp('ai_usage_reported_through', {
    withTimezone: true,
  }),

  /**
   * Operator e-mail notifications (transactional, via Resend). NULL/empty
   * `notifyEmail` = notifications disabled entirely (nowhere to send). When
   * set, each `notify*` flag gates one event class. Sent immediately per
   * event from the worker; best-effort (a send failure never blocks the
   * underlying job). Defaults ON so a configured address starts receiving
   * everything until the operator opts out per class.
   */
  notifyEmail: text('notify_email'),
  notifyNewBooking: boolean('notify_new_booking').notNull().default(true),
  notifyCancellation: boolean('notify_cancellation').notNull().default(true),
  notifyModification: boolean('notify_modification').notNull().default(true),
  notifySyncError: boolean('notify_sync_error').notNull().default(true),

  /**
   * SaaS-billing bypass. `true` = exempt from the plan-gate / lockout
   * (used for the project owner's own workspace and any comped accounts).
   * `false` (default) = goes through the trial → Stripe Checkout flow.
   */
  billingExempt: boolean('billing_exempt').notNull().default(false),

  /**
   * First-time setup wizard completion marker. NULL = user just signed up,
   * routes redirect to /onboarding. Set on wizard finish (or on legacy
   * tenants via the migration) so they go straight to /calendar.
   */
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Mirror of Supabase auth.users. We never write here directly — a trigger in
 * `migrations/9999_rls_policies.sql` keeps it in sync.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // = auth.users.id
  email: text('email').notNull().unique(),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.userId] }),
    byUser: index('memberships_user_idx').on(t.userId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Billing
// ─────────────────────────────────────────────────────────────────────────────

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    stripeSubscriptionId: text('stripe_subscription_id').unique(),
    /** Stripe Price ID for the **base** subscription item. */
    stripePriceId: text('stripe_price_id'),
    plan: planEnum('plan').notNull(),
    status: subscriptionStatusEnum('status').notNull(),
    /** Per-property metered quantity (matches the property line item). */
    quantity: integer('quantity').notNull().default(1),
    /** monthly | annual (annual is -10%). NULL until first checkout. */
    billingInterval: billingIntervalEnum('billing_interval'),
    /** End of free trial (set on subscription create, NULL once paid). */
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    /** Latest Stripe invoice for this subscription (for portal deep-links). */
    latestInvoiceId: text('latest_invoice_id'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAt: timestamp('cancel_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('subscriptions_tenant_idx').on(t.tenantId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Channex mapping — the bridge between our world and Channex's world
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row per Channex property. Vacation-rental setups typically have
 * 1 Channex property per apartment (= per `properties` row), but the
 * schema allows N-to-1 in case Channex property aggregates units later.
 */
export const channexProperties = pgTable(
  'channex_properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    channexPropertyId: text('channex_property_id').notNull().unique(),
    channexRoomTypeId: text('channex_room_type_id').notNull(),
    channexRatePlanId: text('channex_rate_plan_id').notNull(),
    timezone: text('timezone').notNull().default('Europe/Berlin'),
    currency: text('currency').notNull().default('EUR'),
    metadata: jsonb('metadata'), // raw Channex property data, useful for debugging
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('channex_properties_tenant_idx').on(t.tenantId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Business layer
// ─────────────────────────────────────────────────────────────────────────────

export const propertyGroups = pgTable(
  'property_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#3b82f6'), // hex, used in calendar left rail
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('property_groups_tenant_idx').on(t.tenantId),
  }),
);

/**
 * Internal apartment. Logical entity in our app; maps to a Channex property
 * via `channex_property_ref` for sync. May exist without a Channex mapping
 * during onboarding (draft state).
 */
export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    channexPropertyRef: uuid('channex_property_ref').references(() => channexProperties.id, {
      onDelete: 'set null',
    }),
    groupId: uuid('group_id').references(() => propertyGroups.id, { onDelete: 'set null' }),
    name: text('name').notNull(), // e.g. "Whg 3"
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),

    /**
     * Per-apartment currency override (ISO 4217). NULL = inherit
     * `tenants.default_currency`. Set this when an apartment trades in a
     * different currency than the tenant default (e.g. a USD test property
     * for Channex certification, or a real US-market listing).
     */
    currency: text('currency'),
    /** Default nightly rate shown on empty calendar cells. Null = unset. */
    defaultRateCents: bigint('default_rate_cents', { mode: 'bigint' }),
    /** Default minimum stay (nights). Shown on empty calendar cells. */
    defaultMinStay: integer('default_min_stay').notNull().default(1),
    /** Default cleaning fee (per booking), incl. VAT. */
    defaultCleaningFeeCents: bigint('default_cleaning_fee_cents', { mode: 'bigint' }),

    /** Public OTA listing URLs (operator-entered) — surfaced on the
     *  "Listing-Links" page to copy & share (e.g. via WhatsApp). NULL = unset. */
    airbnbListingUrl: text('airbnb_listing_url'),
    bookingListingUrl: text('booking_listing_url'),

    /** Free-text apartment knowledge for the AI guest-reply assistant — WLAN,
     *  Türcode, Anfahrt, Hausregeln, Tipps. The bot answers only from this
     *  (+ custom vars + booking facts). NULL = unset. */
    aiKnowledge: text('ai_knowledge'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('properties_tenant_idx').on(t.tenantId),
    byGroup: index('properties_group_idx').on(t.groupId),
  }),
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    source: bookingSourceEnum('source').notNull(),
    status: bookingStatusEnum('status').notNull(),

    // Guest details (NULL for `source=block`)
    guestName: text('guest_name'),
    guestPhone: text('guest_phone'),
    guestEmail: text('guest_email'),
    guestCountry: text('guest_country'),

    // Dates (timezone-free — `2026-05-14` means that date in property's tz)
    checkin: date('checkin').notNull(),
    checkout: date('checkout').notNull(),
    /** Check-in time of day, HH:mm (snapshot at booking creation). */
    checkinTime: text('checkin_time').notNull().default('15:00'),
    /** Check-out time of day, HH:mm. */
    checkoutTime: text('checkout_time').notNull().default('11:00'),
    /** Number of guests. */
    guestCount: integer('guest_count').notNull().default(1),

    // Money — breakdown + total
    /** Nightly rate (incl. VAT), per night. */
    nightlyRateCents: bigint('nightly_rate_cents', { mode: 'bigint' }),
    /** One-off cleaning fee (incl. VAT). */
    cleaningFeeCents: bigint('cleaning_fee_cents', { mode: 'bigint' }),
    /** City / tourist tax rate snapshot, in basis points (e.g. 500 = 5%). */
    cityTaxRateBp: integer('city_tax_rate_bp'),
    /** Calculated city tax amount (= nightly_rate × nights × rate_bp / 10000). */
    cityTaxCents: bigint('city_tax_cents', { mode: 'bigint' }),
    /** Grand total = lodging + cleaning + city tax. Source of truth for Channex. */
    priceCents: bigint('price_cents', { mode: 'bigint' }),
    currency: text('currency').notNull().default('EUR'),
    /** OTA commission (Channex `ota_commission`), in cents. NULL for native
     *  bookings or channels that don't report it. Lets us show gross vs. payout
     *  and feed the guest-invoice resolver. */
    otaCommissionCents: bigint('ota_commission_cents', { mode: 'bigint' }),
    /** Operator overrides for the guest invoice (cents): the corrected paid
     *  gross total + the cleaning portion. NULL = use the auto-derived value.
     *  Persisted so a correction also drives the guest-portal invoice. */
    invoiceGrossOverrideCents: bigint('invoice_gross_override_cents', { mode: 'bigint' }),
    invoiceCleaningOverrideCents: bigint('invoice_cleaning_override_cents', { mode: 'bigint' }),

    /** If true, the review-automation job (Phase 11) sends a review request
     *  3 days after checkout. Per-booking opt-out for difficult guests. */
    autoReviewEnabled: boolean('auto_review_enabled').notNull().default(true),

    // OTA-specific
    channexBookingId: text('channex_booking_id').unique(),
    channexRevisionId: text('channex_revision_id'),
    channexAckedAt: timestamp('channex_acked_at', { withTimezone: true }),
    otaName: text('ota_name'), // raw value from Channex: "BookingCom", "Airbnb", etc.
    otaConfirmationCode: text('ota_confirmation_code'),

    // Sync tracking
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),

    notes: text('notes'),
    rawPayload: jsonb('raw_payload'), // full Channex booking blob, for debugging

    /** Stable foreign-system id for bulk-imports (e.g. "guesty:HM5BNF9K8D").
     *  Used as the idempotency key by the Guesty/Smoobu import scripts so
     *  re-running an import never duplicates rows. NULL for native bookings. */
    externalId: text('external_id'),
    importedAt: timestamp('imported_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('bookings_tenant_idx').on(t.tenantId),
    byProperty: index('bookings_property_idx').on(t.propertyId),
    byDateRange: index('bookings_property_dates_idx').on(t.propertyId, t.checkin, t.checkout),
    byStatus: index('bookings_status_idx').on(t.tenantId, t.status),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Sync jobs (durable record of every sync attempt)
// ─────────────────────────────────────────────────────────────────────────────

export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    type: syncJobTypeEnum('type').notNull(),
    status: syncJobStatusEnum('status').notNull().default('queued'),
    payload: jsonb('payload'),
    result: jsonb('result'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    inngestRunId: text('inngest_run_id'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    byTenant: index('sync_jobs_tenant_idx').on(t.tenantId),
    byProperty: index('sync_jobs_property_idx').on(t.propertyId),
    byStatus: index('sync_jobs_status_scheduled_idx').on(t.status, t.scheduledAt),
  }),
);

/**
 * ARI outbox (dirty-range). Every booking/block/rate change writes a row here
 * instead of pushing to Channex directly. A single global, debounced +
 * throttled flusher claims all unflushed rows across ALL tenants/properties,
 * resolves the current desired state, and emits ONE batched /availability and
 * ONE /restrictions call — respecting the 20 ARI/min limit regardless of how
 * many properties exist now or later.
 *
 * "Dirty-range" (not concrete values) means repeated edits to the same
 * property/range coalesce, the flush is idempotent, and freshly-onboarded
 * properties are picked up automatically.
 */
export const ariPending = pgTable(
  'ari_pending',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    kind: ariKindEnum('kind').notNull(),
    /** Inclusive YYYY-MM-DD. */
    dateFrom: date('date_from').notNull(),
    /** EXCLUSIVE YYYY-MM-DD (matches the Inngest event range contract). */
    dateTo: date('date_to').notNull(),
    reason: text('reason'),
    /** Inngest runId of the flush that claimed this row (ULID, not a UUID) — for tracing. */
    batchId: text('batch_id'),
    /** Set when the claiming flush successfully pushed to Channex. */
    flushedAt: timestamp('flushed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Hot path: "give me everything not yet flushed".
    unflushed: index('ari_pending_unflushed_idx').on(t.flushedAt, t.kind),
    byBatch: index('ari_pending_batch_idx').on(t.batchId),
    byProperty: index('ari_pending_property_idx').on(t.propertyId),
  }),
);

export type AriPending = typeof ariPending.$inferSelect;

/**
 * Per-day rate & restriction overrides. One row per (property, date) that
 * deviates from the property defaults. NULL columns inherit:
 *   - rate_cents  → properties.default_rate_cents
 *   - min_stay    → properties.default_min_stay
 *   - everything else → unset (Channex default)
 *
 * This is the PMS-side source of truth the flusher reads to build per-day
 * /restrictions values. When a tenant later switches rateSource to PriceLabs
 * (Phase 9c), the rate column is ignored for those properties but the
 * restriction columns can still be PMS-driven.
 */
export const rateOverrides = pgTable(
  'rate_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    /** The single calendar day this override applies to. */
    date: date('date').notNull(),
    /** Nightly rate incl. VAT, in cents. NULL = inherit property default. */
    rateCents: bigint('rate_cents', { mode: 'bigint' }),
    /** Min nights. NULL = inherit property default. */
    minStay: integer('min_stay'),
    /** Max nights. NULL = no max. */
    maxStay: integer('max_stay'),
    closedToArrival: boolean('closed_to_arrival'),
    closedToDeparture: boolean('closed_to_departure'),
    stopSell: boolean('stop_sell'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqDay: uniqueIndex('rate_overrides_property_date_uq').on(t.propertyId, t.date),
    byTenant: index('rate_overrides_tenant_idx').on(t.tenantId),
    byPropertyDate: index('rate_overrides_property_date_idx').on(t.propertyId, t.date),
  }),
);

export type RateOverride = typeof rateOverrides.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Messaging
// ─────────────────────────────────────────────────────────────────────────────

export const messageTemplates = pgTable(
  'message_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /**
     * Trigger DSL:
     *   "checkin:-1d@18:00"   = 1 day before checkin at 18:00 property-local
     *   "checkin:+0d@10:00"   = day of checkin at 10:00
     *   "checkout:+0d@10:00"  = day of checkout at 10:00
     *   "booking_created"     = immediately after booking sync
     */
    trigger: text('trigger').notNull(),
    channel: messageChannelEnum('channel').notNull(),
    language: text('language').notNull().default('de'),
    /** Body with {{placeholders}}: guestName, propertyName, checkinDate, etc. */
    body: text('body').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('message_templates_tenant_idx').on(t.tenantId),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id').references(() => messageTemplates.id, {
      onDelete: 'set null',
    }),
    channel: messageChannelEnum('channel').notNull(),
    direction: messageDirectionEnum('direction').notNull(),
    body: text('body').notNull(),
    toAddress: text('to_address'), // phone for SMS, channel-specific identifier for OTAs
    fromAddress: text('from_address'),
    status: messageStatusEnum('status').notNull().default('scheduled'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    externalId: text('external_id'), // Twilio Message SID, Channex message ID
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBooking: index('messages_booking_idx').on(t.bookingId),
    byScheduled: index('messages_scheduled_idx').on(t.status, t.scheduledAt),
    byTenant: index('messages_tenant_idx').on(t.tenantId),
    byExternal: index('messages_external_idx').on(t.externalId),
    /**
     * One automated message per (booking, template). Postgres treats NULLs
     * as distinct, so inbound/manual rows (template_id NULL and/or
     * booking_id NULL) are unconstrained — only template-driven sends
     * dedupe. The dispatch cron relies on this via ON CONFLICT DO NOTHING.
     */
    dedupeTemplate: uniqueIndex('messages_booking_template_uq').on(
      t.bookingId,
      t.templateId,
    ),
  }),
);

/**
 * Apartment scope for a template (explicit allow-list). A template only
 * dispatches for bookings whose property is listed here — no rows = the
 * template is inactive for everyone until apartments are assigned.
 */
export const messageTemplateListings = pgTable(
  'message_template_listings',
  {
    templateId: uuid('template_id')
      .notNull()
      .references(() => messageTemplates.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.templateId, t.propertyId] }),
    byProperty: index('mtl_property_idx').on(t.propertyId),
  }),
);
export type MessageTemplateListing = typeof messageTemplateListings.$inferSelect;

/**
 * Per-booking override of a template's apartment scope. `enabled=true`
 * forces the template on for this booking even if its property isn't in
 * the listing scope; `enabled=false` forces it off even if it is.
 * Absence → fall back to the apartment scope.
 */
export const messageBookingOverrides = pgTable(
  'message_booking_overrides',
  {
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => messageTemplates.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bookingId, t.templateId] }),
    byBooking: index('mbo_booking_idx').on(t.bookingId),
  }),
);
export type MessageBookingOverride = typeof messageBookingOverrides.$inferSelect;

/**
 * Tenant-defined custom message variables (e.g. wifiCode, doorCode). The
 * `key` is the {{placeholder}} token; values are filled per apartment in
 * message_variable_values. No per-apartment value → the {{key}} stays
 * literal in the rendered message (chosen fallback).
 */
export const messageVariables = pgTable(
  'message_variables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Placeholder token: ^[a-z][a-zA-Z0-9_]*$, unique per tenant. */
    key: text('key').notNull(),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('message_variables_tenant_idx').on(t.tenantId),
    uniqKey: uniqueIndex('message_variables_tenant_key_uq').on(t.tenantId, t.key),
  }),
);
export type MessageVariable = typeof messageVariables.$inferSelect;

/** Per-apartment value for a custom message variable. */
export const messageVariableValues = pgTable(
  'message_variable_values',
  {
    variableId: uuid('variable_id')
      .notNull()
      .references(() => messageVariables.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.variableId, t.propertyId] }),
    byProperty: index('mvv_property_idx').on(t.propertyId),
  }),
);
export type MessageVariableValue = typeof messageVariableValues.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Reinigung (cleaning) — automated reminders to internal teammates
// ─────────────────────────────────────────────────────────────────────────────
//
// Mirrors the messaging automation, but the recipient is an internal
// Teammate (cleaner) instead of the guest. A cleaning_rule has a trigger
// (same DSL as message_templates: reservation/checkin/checkout:±Nd@HH:MM),
// an explicit apartment allow-list, one or more teammates, and an optional
// reusable checklist rendered into the body via {{checklist}}.
//
// cleaning_messages reuses `messageStatusEnum` (identical queued→sent→
// delivered/failed lifecycle) — no separate enum needed.

/** Internal teammate (cleaner) — SMS recipient for cleaning rules. */
export const teammates = pgTable(
  'teammates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** E.164 phone for SMS (loose-validated in the API, Twilio is authoritative). */
    phone: text('phone').notNull(),
    active: boolean('active').notNull().default(true),
    notes: text('notes'),
    /** Role for AI dispatch + filtering: 'cleaner' | 'handyman' | 'other'. */
    role: text('role').notNull().default('cleaner'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('teammates_tenant_idx').on(t.tenantId),
  }),
);
export type Teammate = typeof teammates.$inferSelect;

/**
 * AI-initiated background notification to a teammate (cleaner / handyman) when a
 * guest conversation surfaces an operational task (the AI calls a notify tool).
 * Audit trail + future operator view.
 */
export const teammateDispatches = pgTable(
  'teammate_dispatches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    teammateId: uuid('teammate_id').references(() => teammates.id, {
      onDelete: 'set null',
    }),
    role: text('role').notNull(),
    summary: text('summary').notNull(),
    urgency: text('urgency'),
    channel: text('channel').notNull().default('sms'),
    status: text('status').notNull().default('sent'), // sent | failed | no_recipient
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBooking: index('teammate_dispatches_booking_idx').on(t.bookingId),
    byTenant: index('teammate_dispatches_tenant_idx').on(t.tenantId),
  }),
);
export type TeammateDispatch = typeof teammateDispatches.$inferSelect;

/** A reusable named checklist a cleaning rule can attach (rendered via {{checklist}}). */
export const cleaningChecklists = pgTable(
  'cleaning_checklists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('cleaning_checklists_tenant_idx').on(t.tenantId),
  }),
);
export type CleaningChecklist = typeof cleaningChecklists.$inferSelect;

/** Ordered items of a checklist. */
export const cleaningChecklistItems = pgTable(
  'cleaning_checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    checklistId: uuid('checklist_id')
      .notNull()
      .references(() => cleaningChecklists.id, { onDelete: 'cascade' }),
    /** Display order within the checklist (0-based). */
    position: integer('position').notNull().default(0),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byChecklist: index('cleaning_checklist_items_checklist_idx').on(t.checklistId),
    byTenant: index('cleaning_checklist_items_tenant_idx').on(t.tenantId),
  }),
);
export type CleaningChecklistItem = typeof cleaningChecklistItems.$inferSelect;

/**
 * A cleaning reminder rule. Trigger DSL is shared with message_templates
 * (see services/triggers.ts). Reaches nobody until apartments are assigned
 * (cleaning_rule_listings) AND at least one teammate is attached
 * (cleaning_rule_teammates) — same explicit-allow-list model as messaging.
 */
export const cleaningRules = pgTable(
  'cleaning_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Trigger DSL: reservation|checkin|checkout:±Nd@HH:MM (property-local). */
    trigger: text('trigger').notNull(),
    /** SMS body with {{placeholders}} incl. cleaning-specific + {{checklist}}. */
    body: text('body').notNull(),
    /** Optional attached checklist (rendered into the body via {{checklist}}). */
    checklistId: uuid('checklist_id').references(() => cleaningChecklists.id, {
      onDelete: 'set null',
    }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('cleaning_rules_tenant_idx').on(t.tenantId),
  }),
);
export type CleaningRule = typeof cleaningRules.$inferSelect;

/** Apartment scope for a cleaning rule (explicit allow-list). */
export const cleaningRuleListings = pgTable(
  'cleaning_rule_listings',
  {
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => cleaningRules.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ruleId, t.propertyId] }),
    byProperty: index('crl_property_idx').on(t.propertyId),
  }),
);
export type CleaningRuleListing = typeof cleaningRuleListings.$inferSelect;

/** Teammates a cleaning rule notifies (fan-out: one rule → N teammates). */
export const cleaningRuleTeammates = pgTable(
  'cleaning_rule_teammates',
  {
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => cleaningRules.id, { onDelete: 'cascade' }),
    teammateId: uuid('teammate_id')
      .notNull()
      .references(() => teammates.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ruleId, t.teammateId] }),
    byTeammate: index('crt_teammate_idx').on(t.teammateId),
  }),
);
export type CleaningRuleTeammate = typeof cleaningRuleTeammates.$inferSelect;

/**
 * Per-tenant SMS country allow-list. A row = "this tenant may send SMS to this
 * ISO-3166 alpha-2 country". Empty set = no SMS allowed anywhere. Must stay a
 * subset of the Twilio account's Geo Permissions (the operator's hard ceiling).
 */
export const tenantSmsCountries = pgTable(
  'tenant_sms_countries',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    countryCode: text('country_code').notNull(), // ISO-3166 alpha-2, e.g. 'DE'
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.countryCode] }),
  }),
);
export type TenantSmsCountry = typeof tenantSmsCountries.$inferSelect;

/**
 * Guest conversation messages (Airbnb / Booking.com OTA threads), ingested from
 * Channex for the in-app inbox + AI assistant. Inbound guest messages are
 * upserted (dedup by channex_message_id). Outbound rows model AI drafts
 * (status='draft', sender='ai') awaiting approval, and sent host/AI replies.
 *   direction: 'inbound' | 'outbound'
 *   sender:    'guest' | 'host' | 'ai'
 *   status:    'received' | 'draft' | 'sent' | 'failed' | 'dismissed'
 */
export const guestMessages = pgTable(
  'guest_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    /** Channex message id — set for ingested OTA messages (dedup). NULL for our
     *  own drafts/sends until reconciled. */
    channexMessageId: text('channex_message_id'),
    direction: text('direction').notNull(),
    sender: text('sender').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull().default('received'),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    error: text('error'),
    /** Channex `inserted_at` for ingested messages (OTA-side timestamp). */
    otaCreatedAt: timestamp('ota_created_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBooking: index('guest_messages_booking_idx').on(t.bookingId),
    byTenant: index('guest_messages_tenant_idx').on(t.tenantId),
    uniqChannex: uniqueIndex('guest_messages_channex_uq').on(t.channexMessageId),
  }),
);
export type GuestMessage = typeof guestMessages.$inferSelect;

/**
 * A dispatched (or due) cleaning SMS. Dedupe is the unique index on
 * (rule_id, booking_id, teammate_id) — each rule fires at most once per
 * booking per teammate, regardless of cron overlap. The dispatch cron
 * relies on this via ON CONFLICT DO NOTHING.
 */
export const cleaningMessages = pgTable(
  'cleaning_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ruleId: uuid('rule_id').references(() => cleaningRules.id, {
      onDelete: 'set null',
    }),
    bookingId: uuid('booking_id').references(() => bookings.id, {
      onDelete: 'cascade',
    }),
    teammateId: uuid('teammate_id').references(() => teammates.id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    toAddress: text('to_address'), // teammate phone snapshot
    fromAddress: text('from_address'),
    status: messageStatusEnum('status').notNull().default('scheduled'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    externalId: text('external_id'), // Twilio Message SID
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBooking: index('cleaning_messages_booking_idx').on(t.bookingId),
    byScheduled: index('cleaning_messages_scheduled_idx').on(
      t.status,
      t.scheduledAt,
    ),
    byTenant: index('cleaning_messages_tenant_idx').on(t.tenantId),
    byExternal: index('cleaning_messages_external_idx').on(t.externalId),
    dedupe: uniqueIndex('cleaning_messages_rule_booking_teammate_uq').on(
      t.ruleId,
      t.bookingId,
      t.teammateId,
    ),
  }),
);
export type CleaningMessage = typeof cleaningMessages.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Reviews (Phase 11)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Templates the operator pre-writes for outbound guest reviews
 * (the host-to-guest direction — what WE say about the guest after they
 * leave). The auto-dispatch picks the row where `is_default=true` for the
 * matching language; additional non-default rows can be picked manually
 * per booking in the UI.
 */
export const reviewTemplates = pgTable(
  'review_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    language: text('language').notNull().default('de'),
    body: text('body').notNull(),
    /** Overall star rating 1-5 the dispatch should use. */
    starRating: integer('star_rating').notNull().default(5),
    /** If true, this is the auto-pick for the language. Only one per
     *  (tenant, language) should hold true; enforced by partial unique idx. */
    isDefault: boolean('is_default').notNull().default(false),
    /** Legacy fields kept for backward-compat with the older schema. */
    minRating: integer('min_rating'),
    autoSend: boolean('auto_send').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('review_templates_tenant_idx').on(t.tenantId),
    oneDefaultPerLanguage: uniqueIndex('review_templates_one_default_idx')
      .on(t.tenantId, t.language)
      .where(sql`${t.isDefault} = true`),
  }),
);

/**
 * Outbound (host-to-guest) review queue. One row per booking that
 * `outbound-reviews-dispatch` has decided to act on. Lifecycle:
 *
 *   queued     — created by the dispatch cron, scheduled_at = checkout+3d
 *   sent       — successfully submitted to Channex (channex_review_id set)
 *   failed     — Channex rejected; `error` carries the message; retry-able
 *   skipped    — operator clicked "Überspringen" in the UI
 *
 * A booking is never queued twice (unique on booking_id). If the operator
 * disables auto-review on the booking after we queued, the dispatch will
 * cancel the queued row on the next pass.
 */
export const outboundReviews = pgTable(
  'outbound_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' })
      .unique(),
    propertyId: uuid('property_id').references(() => properties.id, {
      onDelete: 'set null',
    }),
    templateId: uuid('template_id').references(() => reviewTemplates.id, {
      onDelete: 'set null',
    }),
    /** The rendered text (template + booking vars substituted). */
    renderedText: text('rendered_text').notNull(),
    /** Overall rating 1-5 we'll submit alongside the text. */
    starRating: integer('star_rating').notNull(),
    /** queued | sent | failed | skipped */
    status: text('status').notNull().default('queued'),
    /** When this row becomes eligible for actual submission. */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** Channex' review id if the submission succeeded. */
    channexReviewId: text('channex_review_id'),
    /** Last error message if status='failed'. */
    error: text('error'),
    /** Operator who skipped this row (if status='skipped'). */
    skippedBy: uuid('skipped_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('outbound_reviews_tenant_idx').on(t.tenantId),
    byBooking: index('outbound_reviews_booking_idx').on(t.bookingId),
    byStatusSchedule: index('outbound_reviews_due_idx').on(t.status, t.scheduledAt),
  }),
);

export type ReviewTemplate = typeof reviewTemplates.$inferSelect;
export type NewReviewTemplate = typeof reviewTemplates.$inferInsert;
export type OutboundReview = typeof outboundReviews.$inferSelect;
export type NewOutboundReview = typeof outboundReviews.$inferInsert;

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
    channexReviewId: text('channex_review_id').unique(),
    otaName: text('ota_name'),
    rating: integer('rating'),
    text: text('text'),
    response: text('response'),
    responseStatus: text('response_status').notNull().default('pending'), // pending, approved, sent, skipped
    receivedAt: timestamp('received_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('reviews_tenant_idx').on(t.tenantId),
    byBooking: index('reviews_booking_idx').on(t.bookingId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Audit log
// ─────────────────────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(), // e.g. "booking.create", "sync.trigger"
    targetType: text('target_type'), // "booking", "property", "channex_property"
    targetId: text('target_id'),
    payload: jsonb('payload'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenantTime: index('audit_log_tenant_time_idx').on(t.tenantId, t.at),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Webhook idempotency (avoid double-processing duplicate Channex webhooks)
// ─────────────────────────────────────────────────────────────────────────────

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(), // "channex", "stripe", "twilio"
    externalId: text('external_id'), // event ID from source, if provided
    event: text('event').notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    payload: jsonb('payload').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueExternal: uniqueIndex('webhook_deliveries_source_external_idx').on(
      t.source,
      t.externalId,
    ),
    byTenant: index('webhook_deliveries_tenant_idx').on(t.tenantId),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Cleaning calendars — public, shareable read-only views
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A tenant configures one or more "cleaning calendar" links here. Each link
 * gets an unguessable slug; the operator hands that URL to their cleaning
 * staff and the page lives at `rentaro.cloud/cal/<slug>`. No login required.
 *
 * The is_active flag lets the operator revoke a link without losing the
 * configuration (handy for seasonal teams). Slug regeneration creates a
 * fresh URL while keeping the same row.
 *
 * The boolean show_* flags control which booking fields the public view
 * exposes. Defaults are privacy-conservative — guest contact info stays
 * hidden unless the operator explicitly opts in.
 */
export const cleaningCalendars = pgTable(
  'cleaning_calendars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Operator-facing label. Not exposed publicly. */
    name: text('name').notNull(),
    /** 32+ char unguessable token. Forms the public URL path. */
    slug: text('slug').notNull().unique(),
    /** When false, the public URL returns 404 without deleting the row. */
    isActive: boolean('is_active').notNull().default(true),

    /** Array of property IDs the calendar shows. Empty = all in tenant. */
    propertyIds: jsonb('property_ids').notNull().$type<string[]>().default([]),

    // Field visibility toggles — what's exposed in the public view.
    showGuestName: boolean('show_guest_name').notNull().default(true),
    showGuestCount: boolean('show_guest_count').notNull().default(false),
    showGuestPhone: boolean('show_guest_phone').notNull().default(false),
    showGuestEmail: boolean('show_guest_email').notNull().default(false),
    showNotes: boolean('show_notes').notNull().default(false),
    showHostNotes: boolean('show_host_notes').notNull().default(false),
    showPrice: boolean('show_price').notNull().default(false),
    showBookingCode: boolean('show_booking_code').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('cleaning_calendars_tenant_idx').on(t.tenantId),
    bySlug: uniqueIndex('cleaning_calendars_slug_idx').on(t.slug),
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Guest invoices (self-service Rechnungs-Portal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-tenant invoice configuration — issuer identity, tax treatment, numbering,
 * and the public-portal slug. 1:1 with `tenants`. Backend-only (RLS deny).
 *
 * Tax model (verified against a real Leopards GmbH invoice):
 *   - Lodging + cleaning are GROSS incl. `vat_rate_bp` (700 = 7%).
 *   - City tax (`city_tax_rate_bp`, 500 = 5%) is charged on GROSS lodging only
 *     (NOT cleaning) and carries 0% VAT (a pass-through line).
 */
export const tenantInvoiceSettings = pgTable('tenant_invoice_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** Master switch for the invoice feature + public portal. */
  enabled: boolean('enabled').notNull().default(false),

  // Issuer identity (§14 UStG)
  issuerName: text('issuer_name'),
  issuerAddress: text('issuer_address'),
  senderLine: text('sender_line'),
  logoText: text('logo_text'),
  /** Optional uploaded logo (base64 data URL, PNG/JPEG) rendered on the PDF;
   *  falls back to the logoText wordmark when empty. */
  logoImageData: text('logo_image_data'),
  contactPerson: text('contact_person'),
  taxId: text('tax_id'),
  taxNumber: text('tax_number'),

  // Tax treatment
  vatMode: text('vat_mode').notNull().default('regular'), // 'regular' | 'kleinunternehmer'
  vatRateBp: integer('vat_rate_bp').notNull().default(700),
  cityTaxRateBp: integer('city_tax_rate_bp').notNull().default(500),
  /** Airbnb interpretation, matching the Channex channel "Booking Total Type":
   *  false (default, "Payout Amount") → `amount` is the payout, gross =
   *  amount + ota_commission. true ("Total Amount") → `amount` is already the
   *  guest-paid gross. Set this to match the channel config at onboarding. */
  airbnbAmountIsGross: boolean('airbnb_amount_is_gross').notNull().default(false),

  // Line-item labels
  lodgingLabel: text('lodging_label').notNull().default('Übernachtung'),
  cityTaxLabel: text('city_tax_label').notNull().default('Übernachtungssteuer'),
  cleaningLabel: text('cleaning_label').notNull().default('Endreinigung'),
  /** Default cleaning fee (cents), used when a booking's cleaning can't be
   *  derived from Channex data. Also pre-fills the per-booking "Reinigung"
   *  field. NULL = no default. */
  defaultCleaningCents: bigint('default_cleaning_cents', { mode: 'bigint' }),

  // Numbering
  numberPrefix: text('number_prefix').notNull().default('RE-'),
  nextSeq: integer('next_seq').notNull().default(1),

  // Footer (issuer name/address forms column 1)
  footerContact: text('footer_contact'),
  footerRegistry: text('footer_registry'),
  footerBank: text('footer_bank'),
  closingNote: text('closing_note')
    .notNull()
    .default('Der Rechnungsbetrag wurde bereits bezahlt.\nVielen Dank.'),

  // Public portal
  publicSlug: text('public_slug').unique(),
  /** Optional security boost: also require the OTA confirmation code at lookup. */
  lookupRequireCode: boolean('lookup_require_code').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * An issued guest invoice. One per booking (UNIQUE), with a frozen snapshot of
 * every amount + the issuer config at issue time, so later config/price changes
 * never alter an issued document. `token` is the capability for the (public)
 * PDF download URL. Backend-only (RLS deny).
 */
export const guestInvoices = pgTable(
  'guest_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    /** Sequential, human-facing number (e.g. "RE-1042"). Unique per tenant. */
    number: text('number').notNull(),
    status: text('status').notNull().default('issued'), // 'issued' | 'void'
    /** Opaque capability token for the PDF download URL. */
    token: text('token').notNull().unique(),

    // Dates
    issueDate: date('issue_date').notNull(),
    serviceDate: date('service_date').notNull(),
    stayFrom: date('stay_from').notNull(),
    stayTo: date('stay_to').notNull(),
    nights: integer('nights').notNull(),

    currency: text('currency').notNull().default('EUR'),

    // Amount snapshot (cents)
    apartmentName: text('apartment_name').notNull(),
    lodgingGrossCents: bigint('lodging_gross_cents', { mode: 'bigint' }).notNull(),
    lodgingNetCents: bigint('lodging_net_cents', { mode: 'bigint' }).notNull(),
    lodgingVatCents: bigint('lodging_vat_cents', { mode: 'bigint' }).notNull(),
    cleaningGrossCents: bigint('cleaning_gross_cents', { mode: 'bigint' }).notNull(),
    cleaningNetCents: bigint('cleaning_net_cents', { mode: 'bigint' }).notNull(),
    cleaningVatCents: bigint('cleaning_vat_cents', { mode: 'bigint' }).notNull(),
    cityTaxCents: bigint('city_tax_cents', { mode: 'bigint' }).notNull(),
    totalNetCents: bigint('total_net_cents', { mode: 'bigint' }).notNull(),
    totalVatCents: bigint('total_vat_cents', { mode: 'bigint' }).notNull(),
    totalGrossCents: bigint('total_gross_cents', { mode: 'bigint' }).notNull(),
    vatRateBp: integer('vat_rate_bp').notNull(),
    cityTaxRateBp: integer('city_tax_rate_bp').notNull(),

    // Recipient (entered by the guest in the portal)
    recipientCompany: text('recipient_company'),
    recipientName: text('recipient_name').notNull(),
    recipientStreet: text('recipient_street').notNull(),
    recipientZip: text('recipient_zip').notNull(),
    recipientCity: text('recipient_city').notNull(),
    recipientCountry: text('recipient_country').notNull().default('Deutschland'),
    recipientVatId: text('recipient_vat_id'),
    recipientEmail: text('recipient_email'),

    /** Frozen copy of tenant_invoice_settings at issue time. */
    issuerSnapshot: jsonb('issuer_snapshot').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('guest_invoices_tenant_idx').on(t.tenantId),
    byNumber: uniqueIndex('guest_invoices_number_idx').on(t.tenantId, t.number),
    // At most one ISSUED invoice per booking. Voided ones remain on record and
    // free the booking for a corrected re-issue.
    activeBooking: uniqueIndex('guest_invoices_active_booking_idx')
      .on(t.bookingId)
      .where(sql`status = 'issued'`),
  }),
);

export type CleaningCalendar = typeof cleaningCalendars.$inferSelect;
export type NewCleaningCalendar = typeof cleaningCalendars.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Type exports (inferred from schema)
// ─────────────────────────────────────────────────────────────────────────────

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;
export type PropertyGroup = typeof propertyGroups.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type ChannexProperty = typeof channexProperties.$inferSelect;
export type SyncJob = typeof syncJobs.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
