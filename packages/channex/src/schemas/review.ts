import { z } from 'zod';

/**
 * Channex Reviews collection.
 *
 * Two directions share the /reviews resource:
 *   - guest→host: the review a guest leaves about the stay (GET /reviews;
 *     POST /reviews/:id/reply to respond). Works for all OTAs.
 *   - host→guest: the review the HOST leaves about the guest
 *     (POST /reviews/:id/guest_review). **Airbnb only** — and only once a
 *     `review_id` already exists (i.e. Airbnb has opened the review exchange
 *     for the reservation). `is_hidden` is Airbnb's double-blind marker.
 *
 * Either direction needs the "Messages & Reviews" app installed on the
 * property, otherwise Channex returns 403 Forbidden.
 *
 * https://docs.channex.io/api-v.1-documentation/reviews-collection
 */

/** Per-category score as returned in GET /reviews (`score` is a float). */
export const ReviewScore = z
  .object({
    category: z.string(),
    score: z.union([z.number(), z.string()]).nullish(),
  })
  .passthrough();
export type ReviewScore = z.infer<typeof ReviewScore>;

export const ReviewAttributes = z
  .object({
    // Channex nests the review id here; it is also the top-level JSON:API id.
    id: z.string().nullish(),
    content: z.string().nullish(),
    guest_name: z.string().nullish(),
    /** "AirBNB" | "BookingCom" | "Expedia" (channel-dependent). */
    ota: z.string().nullish(),
    /** OTA-side reservation code — the join key back to our booking. */
    ota_reservation_id: z.string().nullish(),
    overall_score: z.union([z.number(), z.string()]).nullish(),
    /** Airbnb double-blind marker: stays hidden until both sides post. */
    is_hidden: z.boolean().nullish(),
    is_replied: z.boolean().nullish(),
    reply: z.string().nullish(),
    scores: z.array(ReviewScore).nullish(),
    /** Airbnb-only descriptive tags. */
    tags: z.array(z.string()).nullish(),
    received_at: z.string().nullish(),
    inserted_at: z.string().nullish(),
    updated_at: z.string().nullish(),
  })
  .passthrough();
export type ReviewAttributes = z.infer<typeof ReviewAttributes>;

export const Review = z
  .object({
    /** Top-level review id (JSON:API). Channex also mirrors it in attributes.id. */
    id: z.string().nullish(),
    type: z.literal('review').nullish(),
    attributes: ReviewAttributes,
    relationships: z.record(z.unknown()).nullish(),
  })
  .passthrough();
export type Review = z.infer<typeof Review>;

/** Resolve the review id from either the top-level field or attributes. */
export function reviewId(r: Review): string | undefined {
  return r.id ?? r.attributes?.id ?? undefined;
}

/** Host→guest score categories Airbnb accepts (rating 1–5 each). */
export const HOST_REVIEW_SCORE_CATEGORIES = [
  'respect_house_rules',
  'communication',
  'cleanliness',
] as const;
export type HostReviewScoreCategory = (typeof HOST_REVIEW_SCORE_CATEGORIES)[number];

const Rating = z.number().int().min(1).max(5);

export const GuestReviewScores = z.object({
  respectHouseRules: Rating,
  communication: Rating,
  cleanliness: Rating,
});
export type GuestReviewScores = z.infer<typeof GuestReviewScores>;

/**
 * High-level input for POST /reviews/:id/guest_review. Mapped to the wire
 * shape ({ review: { scores: [{ category, rating }], public_review, … } })
 * inside ReviewsAPI.sendGuestReview.
 */
export const GuestReviewInput = z.object({
  /** Public, guest-visible review text (Phase A template renders into this). */
  publicReview: z.string().min(1),
  /** Private feedback to Airbnb (not shown to the guest). */
  privateReview: z.string().optional(),
  isRecommended: z.boolean(),
  scores: GuestReviewScores,
  /** Optional host_review_guest_positive_* / _negative_* tags. */
  tags: z.array(z.string()).optional(),
});
export type GuestReviewInput = z.input<typeof GuestReviewInput>;

/**
 * Aggregate property score (GET /scores/:property_id). The per-category
 * breakdown varies by OTA, so `scores` is modeled loosely.
 */
export const PropertyScore = z
  .object({
    id: z.string().nullish(),
    type: z.string().nullish(),
    attributes: z
      .object({
        count: z.number().nullish(),
        overall_score: z.union([z.number(), z.string()]).nullish(),
        scores: z.record(z.unknown()).nullish(),
      })
      .passthrough(),
  })
  .passthrough();
export type PropertyScore = z.infer<typeof PropertyScore>;
