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
]);

export const syncJobStatusEnum = pgEnum('sync_job_status', [
  'queued',
  'running',
  'success',
  'failed',
  'cancelled',
]);

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
    stripePriceId: text('stripe_price_id'),
    plan: planEnum('plan').notNull(),
    status: subscriptionStatusEnum('status').notNull(),
    quantity: integer('quantity').notNull().default(1), // for per-property metering
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

    // Money
    priceCents: bigint('price_cents', { mode: 'bigint' }),
    currency: text('currency').notNull().default('EUR'),

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
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Reviews (Phase 11)
// ─────────────────────────────────────────────────────────────────────────────

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
    minRating: integer('min_rating'), // only suggest if guest rated >= this
    autoSend: boolean('auto_send').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('review_templates_tenant_idx').on(t.tenantId),
  }),
);

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
