/**
 * Outbound (host→guest) review SEND — Phase B.
 *
 * Companion to outbound-reviews-dispatch (Phase A, which QUEUES a row 3 days
 * after checkout). This function takes the due `queued` rows and submits the
 * host→guest review to Channex.
 *
 * Constraints baked in (see docs/SESSION_HANDOFF.md, Open features #1, and
 * the operator decisions made 2026-05-29):
 *   - Airbnb ONLY. Booking.com / Expedia / Vrbo cannot receive a host→guest
 *     review via the API → marked `skipped` (error = unsupported_ota:<source>).
 *   - A Channex `review_id` must already exist; you can't push cold. We list
 *     GET /reviews and match the booking. If the review exchange isn't open
 *     yet the row stays `queued` and we retry on the next run.
 *   - Airbnb's review window is ~14 days from checkout. Rows past that are
 *     `expired` WITHOUT any API call — this also safely neutralises the large
 *     backlog of historical Guesty imports (all long past 14 days), so a run
 *     never hammers Channex for ancient checkouts.
 *   - Requires the "Messages & Reviews" app installed per property, else
 *     Channex returns 403. We detect that on the list call and leave rows
 *     queued (operator setup step) rather than failing them.
 *
 * Rating: operator decision is "always 5★ unless the per-booking auto-review
 * toggle is off" (the toggle gates Phase A queuing, default ON). We derive the
 * structured Airbnb payload from the row's starRating — all three categories =
 * starRating, recommended = starRating >= 4 — and use the rendered template
 * text as the public review.
 *
 * Status lifecycle handled here: queued → sent | failed | skipped | expired.
 *
 * Deliberately NOT on a cron yet — exposed via the `reviews/send.now` event so
 * it can be validated (with `pnpm channex:reviews`) once the Messages &
 * Reviews app is installed. Add a `{ cron: '...' }` trigger after that.
 */
import { and, eq, lte, sql } from 'drizzle-orm';
import { bookings, createDb, outboundReviews } from '@cm/db';
import {
  ChannexError,
  createChannexClient,
  reviewId,
  type Review,
} from '@cm/channex';
import { env } from '../../env';
import { inngest } from '../client';

/** Airbnb's host→guest review window, in days from checkout. */
const AIRBNB_WINDOW_DAYS = 14;
/** Cap rows processed per run so a backlog can't blow up a single execution. */
const MAX_PER_RUN = 100;
/** Review-list pagination when building the lookup index. */
const REVIEW_PAGE_LIMIT = 100;
const MAX_REVIEW_PAGES = 10;

export interface SendResult {
  sent: number;
  failed: number;
  skipped: number;
  expired: number;
  /** Airbnb rows whose review exchange isn't open yet — left queued. */
  waiting: number;
  /** Set when GET /reviews itself failed (e.g. 403: app not installed). */
  blocked?: string;
}

/** Safely read relationships.<rel>.data.id without trusting the shape. */
function relId(r: Review, rel: string): string | undefined {
  const node = (r.relationships as Record<string, unknown> | null | undefined)?.[rel];
  const data = (node as { data?: { id?: string } } | undefined)?.data;
  return data?.id;
}

/**
 * List Airbnb reviews once and index the resolvable review_ids by the two
 * join keys we can match a booking on: the Channex booking id (from the
 * review's `booking` relationship) and the OTA reservation code.
 */
async function loadAirbnbReviewIndex(
  channex: ReturnType<typeof createChannexClient>,
) {
  const byChannexBooking = new Map<string, string>();
  const byOtaReservation = new Map<string, string>();

  for (let page = 1; page <= MAX_REVIEW_PAGES; page++) {
    const { data } = await channex.reviews.list({ page, limit: REVIEW_PAGE_LIMIT });
    for (const r of data) {
      if (!/airbnb/i.test(r.attributes.ota ?? '')) continue;
      const rid = reviewId(r);
      if (!rid) continue; // exchange not open yet — nothing to post against
      const bid = relId(r, 'booking');
      if (bid) byChannexBooking.set(bid, rid);
      const resv = r.attributes.ota_reservation_id;
      if (resv) byOtaReservation.set(resv, rid);
    }
    if (data.length < REVIEW_PAGE_LIMIT) break;
  }

  return { byChannexBooking, byOtaReservation };
}

async function send(): Promise<SendResult> {
  const db = createDb(env.DATABASE_URL);
  const now = new Date();
  const result: SendResult = { sent: 0, failed: 0, skipped: 0, expired: 0, waiting: 0 };

  // 1. Bulk-expire any queued row whose booking checked out more than
  //    AIRBNB_WINDOW_DAYS ago — no API call. This is the guard that keeps the
  //    historical-import backlog from ever reaching Channex.
  const windowFloor = new Date(now.getTime() - AIRBNB_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const expired = await db
    .update(outboundReviews)
    .set({ status: 'expired', error: 'airbnb_window_closed', updatedAt: now })
    .where(
      and(
        eq(outboundReviews.status, 'queued'),
        sql`EXISTS (
          SELECT 1 FROM ${bookings}
          WHERE ${bookings.id} = ${outboundReviews.bookingId}
            AND ${bookings.checkout} < ${windowFloor}
        )`,
      ),
    )
    .returning({ id: outboundReviews.id });
  result.expired = expired.length;

  // 2. Due, still-queued rows within the window, with booking context.
  const due = await db
    .select({
      id: outboundReviews.id,
      renderedText: outboundReviews.renderedText,
      starRating: outboundReviews.starRating,
      source: bookings.source,
      otaName: bookings.otaName,
      channexBookingId: bookings.channexBookingId,
      otaConfirmationCode: bookings.otaConfirmationCode,
    })
    .from(outboundReviews)
    .innerJoin(bookings, eq(bookings.id, outboundReviews.bookingId))
    .where(
      and(
        eq(outboundReviews.status, 'queued'),
        lte(outboundReviews.scheduledAt, now),
      ),
    )
    .limit(MAX_PER_RUN);

  if (due.length === 0) return result;

  const channex = createChannexClient({
    baseUrl: env.CHANNEX_API_URL,
    apiKey: env.CHANNEX_API_KEY,
  });

  // Resolve review_ids in one pass. If the reviews feed is unavailable
  // (typically 403 — Messages & Reviews app not installed) we can't resolve
  // anything; leave the rows queued and report why, rather than failing them.
  let index: Awaited<ReturnType<typeof loadAirbnbReviewIndex>>;
  try {
    index = await loadAirbnbReviewIndex(channex);
  } catch (err) {
    result.waiting = due.length;
    result.blocked =
      err instanceof ChannexError
        ? `reviews_list_${err.status ?? '?'}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    return result;
  }

  for (const row of due) {
    const isAirbnb =
      row.source === 'airbnb' || /airbnb/i.test(row.otaName ?? '');
    if (!isAirbnb) {
      await db
        .update(outboundReviews)
        .set({ status: 'skipped', error: `unsupported_ota:${row.source}`, updatedAt: new Date() })
        .where(eq(outboundReviews.id, row.id));
      result.skipped += 1;
      continue;
    }

    const rid =
      (row.channexBookingId && index.byChannexBooking.get(row.channexBookingId)) ||
      (row.otaConfirmationCode && index.byOtaReservation.get(row.otaConfirmationCode)) ||
      undefined;
    if (!rid) {
      // Airbnb hasn't opened the review exchange yet — retry next run.
      result.waiting += 1;
      continue;
    }

    const text = row.renderedText?.trim();
    if (!text) {
      await db
        .update(outboundReviews)
        .set({ status: 'failed', error: 'empty_review_text', updatedAt: new Date() })
        .where(eq(outboundReviews.id, row.id));
      result.failed += 1;
      continue;
    }

    const rating = Math.min(5, Math.max(1, row.starRating));
    try {
      await channex.reviews.sendGuestReview(rid, {
        publicReview: text,
        isRecommended: rating >= 4,
        scores: {
          respectHouseRules: rating,
          communication: rating,
          cleanliness: rating,
        },
      });
      await db
        .update(outboundReviews)
        .set({
          status: 'sent',
          sentAt: new Date(),
          channexReviewId: rid,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(outboundReviews.id, row.id));
      result.sent += 1;
    } catch (err) {
      const msg =
        err instanceof ChannexError
          ? `channex_${err.status ?? '?'}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      await db
        .update(outboundReviews)
        .set({ status: 'failed', error: msg, updatedAt: new Date() })
        .where(eq(outboundReviews.id, row.id));
      result.failed += 1;
    }
  }

  return result;
}

export const outboundReviewsSend = inngest.createFunction(
  {
    id: 'outbound-reviews-send',
    name: 'Send queued host→guest reviews (Airbnb)',
    retries: 2,
  },
  [{ event: 'reviews/send.now' }],
  async ({ step, logger }) => {
    const res = await step.run('send', send);
    logger.info(res, 'Outbound review send run');
    return res;
  },
);
