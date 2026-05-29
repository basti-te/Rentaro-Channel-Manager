/**
 * Outbound (host-to-guest) review dispatch — Phase A.
 *
 * Cron every hour.
 *   1. Find candidate bookings: confirmed / synced, auto_review_enabled,
 *      checkout >= 3 days ago, no existing outbound_review row yet.
 *   2. For each tenant, pick the default review_templates row in the
 *      booking's expected language (we default to 'de' until we surface
 *      a language signal on the booking — Airbnb's guest language is
 *      present on the Channex payload but not yet on our column).
 *   3. Render the template body with the booking's variables and INSERT
 *      a queued row into outbound_reviews. Uniqueness on (booking_id)
 *      means duplicates simply ON CONFLICT do nothing.
 *
 * The actual submission to Channex (PUT /reviews/{id}/post or similar)
 * is Phase B and lives in a separate function. For now queued rows just
 * sit in the table so the operator can review what would be sent in the
 * UI (BookingDetailSheet + a future Settings → Bewertungen overview).
 *
 * The 3-day window matches Airbnb's "post-stay" review etiquette without
 * pushing too close to their 14-day deadline; configurable per template
 * in a later iteration if needed.
 */
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  bookings,
  createDb,
  outboundReviews,
  properties,
  reviewTemplates,
} from '@cm/db';
import { buildBookingVars, renderTemplate } from '@cm/api';
import { env } from '../../env';
import { inngest } from '../client';

/** Review etiquette window — 3 days after checkout. */
const REVIEW_DELAY_DAYS = 3;

/** Cap so a long backlog can't blow up a single run. */
const MAX_PER_RUN = 100;

export interface DispatchResult {
  queued: number;
  skippedNoTemplate: number;
}

async function dispatch(): Promise<DispatchResult> {
  const db = createDb(env.DATABASE_URL);
  const now = new Date();
  const dueBy = new Date(now.getTime() - REVIEW_DELAY_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Candidate bookings: passed the 3-day window, opted-in via the
  // per-booking flag, and don't already have a queue row.
  const candidates = await db
    .select({
      bookingId: bookings.id,
      tenantId: bookings.tenantId,
      propertyId: bookings.propertyId,
      propertyName: properties.name,
      guestName: bookings.guestName,
      guestCount: bookings.guestCount,
      checkin: bookings.checkin,
      checkout: bookings.checkout,
      checkinTime: bookings.checkinTime,
      checkoutTime: bookings.checkoutTime,
      otaConfirmationCode: bookings.otaConfirmationCode,
    })
    .from(bookings)
    .innerJoin(properties, eq(properties.id, bookings.propertyId))
    .where(
      and(
        eq(bookings.autoReviewEnabled, true),
        inArray(bookings.status, ['confirmed', 'synced']),
        lte(bookings.checkout, dueBy),
        // No outbound review exists for this booking yet. Using a NOT EXISTS
        // sub-select keeps it cheap regardless of how many queued rows
        // accumulate over time.
        sql`NOT EXISTS (
          SELECT 1 FROM ${outboundReviews}
          WHERE ${outboundReviews.bookingId} = ${bookings.id}
        )`,
      ),
    )
    .limit(MAX_PER_RUN);

  if (candidates.length === 0) {
    return { queued: 0, skippedNoTemplate: 0 };
  }

  // Default templates per tenant (one per language). For v1 we only pick
  // the 'de' default — language detection on the booking is a future
  // refinement.
  const tenantIds = [...new Set(candidates.map((c) => c.tenantId))];
  const defaults = await db
    .select({
      tenantId: reviewTemplates.tenantId,
      id: reviewTemplates.id,
      body: reviewTemplates.body,
      starRating: reviewTemplates.starRating,
    })
    .from(reviewTemplates)
    .where(
      and(
        inArray(reviewTemplates.tenantId, tenantIds),
        eq(reviewTemplates.language, 'de'),
        eq(reviewTemplates.isDefault, true),
      ),
    );
  const defaultByTenant = new Map(defaults.map((d) => [d.tenantId, d]));

  let queued = 0;
  let skippedNoTemplate = 0;

  for (const c of candidates) {
    const tpl = defaultByTenant.get(c.tenantId);
    if (!tpl) {
      skippedNoTemplate += 1;
      continue;
    }
    const vars = buildBookingVars({
      guestName: c.guestName,
      checkin: c.checkin,
      checkout: c.checkout,
      checkinTime: c.checkinTime,
      checkoutTime: c.checkoutTime,
      guestCount: c.guestCount,
      otaConfirmationCode: c.otaConfirmationCode,
      propertyName: c.propertyName,
    });
    const renderedText = renderTemplate(tpl.body, vars);

    try {
      await db
        .insert(outboundReviews)
        .values({
          tenantId: c.tenantId,
          bookingId: c.bookingId,
          propertyId: c.propertyId,
          templateId: tpl.id,
          renderedText,
          starRating: tpl.starRating,
          status: 'queued',
          scheduledAt: now,
        })
        .onConflictDoNothing({ target: outboundReviews.bookingId });
      queued += 1;
    } catch {
      // Race-safe: someone else queued the same booking. Silently move on.
    }
  }

  return { queued, skippedNoTemplate };
}

export const outboundReviewsDispatch = inngest.createFunction(
  {
    id: 'outbound-reviews-dispatch',
    name: 'Queue outbound guest reviews (3 days after checkout)',
    retries: 2,
  },
  { cron: '0 * * * *' }, // top of every hour
  async ({ step, logger }) => {
    const result = await step.run('dispatch', () => dispatch());
    logger.info(result, 'Outbound review queue complete');
    return result;
  },
);
