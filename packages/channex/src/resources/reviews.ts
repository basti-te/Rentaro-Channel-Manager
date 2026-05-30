import { z } from 'zod';
import type { ChannexHttpClient } from '../client';
import { envelope } from '../schemas/common';
import {
  GuestReviewInput,
  PropertyScore,
  Review,
} from '../schemas/review';

const ListResponse = envelope(z.array(Review));
const SingleResponse = envelope(Review);
const ScoreResponse = envelope(PropertyScore);

/**
 * Reviews resource. See schemas/review.ts for the host→guest vs guest→host
 * distinction and the Airbnb-only / Messages & Reviews app constraints.
 *
 * https://docs.channex.io/api-v.1-documentation/reviews-collection
 */
export class ReviewsAPI {
  constructor(private readonly http: ChannexHttpClient) {}

  /**
   * List reviews. The Phase B send-poller scans this for an Airbnb review
   * matching a reservation, then reads its id (see `reviewId`). There is no
   * documented per-reservation filter, so callers paginate and match
   * `ota_reservation_id` client-side; `propertyId` narrows the scan.
   */
  async list(opts?: { propertyId?: string; page?: number; limit?: number }) {
    const raw = await this.http.request({
      method: 'GET',
      path: '/reviews',
      query: {
        'filter[property_id]': opts?.propertyId,
        'pagination[page]': opts?.page,
        'pagination[limit]': opts?.limit,
      },
    });
    const parsed = ListResponse.parse(raw);
    return { data: parsed.data ?? [], meta: parsed.meta };
  }

  async get(id: string) {
    const raw = await this.http.request({
      method: 'GET',
      path: `/reviews/${id}`,
    });
    return SingleResponse.parse(raw).data!;
  }

  /**
   * Reply to a guest's review (all OTAs). This is the guest→host direction —
   * responding to what a guest wrote about us. Not idempotent; never replay.
   */
  async reply(id: string, text: string): Promise<void> {
    await this.http.request({
      method: 'POST',
      path: `/reviews/${id}/reply`,
      body: { reply: { reply: text } },
      retries: 0,
    });
  }

  /**
   * Submit a host→guest review (**Airbnb only**). A `review_id` must already
   * exist — you cannot push cold. Returns 200 with an empty body on success;
   * 403 if the Messages & Reviews app isn't installed on the property.
   * Not idempotent — never replay a posted review.
   */
  async sendGuestReview(id: string, input: GuestReviewInput): Promise<void> {
    const v = GuestReviewInput.parse(input);
    await this.http.request({
      method: 'POST',
      path: `/reviews/${id}/guest_review`,
      body: {
        review: {
          scores: [
            { category: 'respect_house_rules', rating: v.scores.respectHouseRules },
            { category: 'communication', rating: v.scores.communication },
            { category: 'cleanliness', rating: v.scores.cleanliness },
          ],
          public_review: v.publicReview,
          private_review: v.privateReview,
          is_reviewee_recommended: v.isRecommended,
          tags: v.tags,
        },
      },
      retries: 0,
    });
  }

  /** Aggregate property scores. Read-only freebie alongside the review feed. */
  readonly scores = {
    get: async (propertyId: string) => {
      const raw = await this.http.request({
        method: 'GET',
        path: `/scores/${propertyId}`,
      });
      return ScoreResponse.parse(raw).data ?? null;
    },

    detailed: async (propertyId: string) => {
      const raw = await this.http.request({
        method: 'GET',
        path: `/scores/${propertyId}/detailed`,
      });
      return ScoreResponse.parse(raw).data ?? null;
    },
  };
}
