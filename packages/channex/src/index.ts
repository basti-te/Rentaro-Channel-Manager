/**
 * @cm/channex — Typed client for the Channex.io REST API (Whitelabel).
 *
 * Usage:
 *   const channex = createChannexClient({
 *     baseUrl: 'https://staging.channex.io/api/v1',
 *     apiKey: process.env.CHANNEX_API_KEY!,
 *   });
 *
 *   await channex.availability.push([{
 *     property_id, room_type_id, date_from: '2026-05-14', date_to: '2026-05-17',
 *     availability: 0,
 *   }]);
 */

import { ChannexHttpClient, type ChannexConfig } from './client';
import { PropertiesAPI } from './resources/properties';
import { RoomTypesAPI } from './resources/room-types';
import { RatePlansAPI } from './resources/rate-plans';
import { AvailabilityAPI } from './resources/availability';
import { RestrictionsAPI } from './resources/restrictions';
import { BookingsAPI } from './resources/bookings';
import { ReviewsAPI } from './resources/reviews';
import { WebhooksAPI } from './resources/webhooks';
import { AuthAPI } from './resources/auth';

export interface ChannexClient {
  http: ChannexHttpClient;
  properties: PropertiesAPI;
  roomTypes: RoomTypesAPI;
  ratePlans: RatePlansAPI;
  availability: AvailabilityAPI;
  restrictions: RestrictionsAPI;
  bookings: BookingsAPI;
  reviews: ReviewsAPI;
  webhooks: WebhooksAPI;
  auth: AuthAPI;
  /** Quick reachability check — calls GET /properties with limit=1. */
  ping(): Promise<{ ok: true; count: number }>;
}

export function createChannexClient(config: ChannexConfig): ChannexClient {
  const http = new ChannexHttpClient(config);
  const properties = new PropertiesAPI(http);
  return {
    http,
    properties,
    roomTypes: new RoomTypesAPI(http),
    ratePlans: new RatePlansAPI(http),
    availability: new AvailabilityAPI(http),
    restrictions: new RestrictionsAPI(http),
    bookings: new BookingsAPI(http),
    reviews: new ReviewsAPI(http),
    webhooks: new WebhooksAPI(http),
    auth: new AuthAPI(http),
    async ping() {
      const r = await properties.list({ limit: 1 });
      return { ok: true as const, count: r.meta?.total ?? r.data.length };
    },
  };
}

// Re-exports for callers who want types
export type { ChannexConfig } from './client';
export {
  ChannexError,
  ChannexNetworkError,
  ChannexClientError,
  ChannexServerError,
  isRetryable,
} from './errors';
export type { AvailabilityUpdate } from './schemas/availability';
export type { RestrictionUpdate } from './schemas/restriction';
export type { DayRate } from './resources/restrictions';
export type { Booking, BookingRevision, BookingCreate } from './schemas/booking';
export type {
  Review,
  ReviewAttributes,
  ReviewScore,
  GuestReviewInput,
  GuestReviewScores,
  PropertyScore,
  HostReviewScoreCategory,
} from './schemas/review';
export { reviewId, HOST_REVIEW_SCORE_CATEGORIES } from './schemas/review';
export type { Webhook, WebhookCreate, WebhookDelivery, WebhookEvent } from './schemas/webhook';
export { BOOKING_EVENTS } from './schemas/webhook';
export type { OneTimeTokenInput } from './resources/auth';
export type { Property, PropertyCreate } from './schemas/property';
export type { RoomType, RoomTypeCreate } from './schemas/room-type';
export type { RatePlan, RatePlanCreate } from './schemas/rate-plan';
