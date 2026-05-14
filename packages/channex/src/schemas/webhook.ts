import { z } from 'zod';

/**
 * All Channex webhook event types. We don't subscribe to every one — see
 * BOOKING_EVENTS / ARI_EVENTS for the ones we actually wire up in Phase 6.
 *
 * https://docs.channex.io/api-v.1-documentation/webhook-collection
 */
export const WebhookEvent = z.enum([
  // Bookings
  'booking',
  'booking_new',
  'booking_modification',
  'booking_cancellation',
  'booking_unmapped_room',
  'booking_unmapped_rate',
  'non_acked_booking',
  // ARI (availability/rates/restrictions)
  'ari',
  // Messaging
  'message',
  'reservation_request',
  'alteration_request',
  'accepted_reservation',
  'declined_reservation',
  'inquiry',
  // Reviews
  'review',
  'updated_review',
  // Channels
  'new_channel',
  'updated_channel',
  'disconnected_channel',
  'activate_channel',
  'deactivate_channel',
  'disconnect_listing',
  // Errors
  'sync_error',
  'sync_warning',
  'rate_error',
]);
export type WebhookEvent = z.infer<typeof WebhookEvent>;

/** The subset we wire up for inbound booking ingestion (Phase 6). */
export const BOOKING_EVENTS: WebhookEvent[] = [
  'booking_new',
  'booking_modification',
  'booking_cancellation',
];

export const Webhook = z
  .object({
    id: z.string().uuid(),
    type: z.literal('webhook').optional(),
    attributes: z
      .object({
        property_id: z.string().uuid().nullish(),
        callback_url: z.string().url().nullish(),
        event_mask: z.string().nullish(),
        is_global: z.boolean().nullish(),
        is_active: z.boolean().nullish(),
        send_data: z.boolean().nullish(),
        headers: z.record(z.string()).nullish(),
        request_params: z.record(z.unknown()).nullish(),
      })
      .passthrough(),
  })
  .passthrough();

export type Webhook = z.infer<typeof Webhook>;

export const WebhookCreate = z.object({
  callback_url: z.string().url(),
  /** "*" subscribes to everything; comma-separated event names for a subset. */
  event_mask: z.string().default('*'),
  /** Null + is_global=true for an account-wide webhook. */
  property_id: z.string().uuid().nullable().default(null),
  is_global: z.boolean().default(true),
  is_active: z.boolean().default(true),
  /** If false, Channex strips payloads and just signals an event happened. */
  send_data: z.boolean().default(true),
  /** Optional custom headers (e.g. shared-secret) Channex sends with each call. */
  headers: z.record(z.string()).optional(),
  request_params: z.record(z.unknown()).optional(),
});
export type WebhookCreate = z.infer<typeof WebhookCreate>;

/**
 * Body Channex sends to our /api/webhooks/channex/:secret endpoint.
 * Per docs: "Sequence of incoming webhook calls can be different from
 * sequence of events" — treat the payload as a hint and re-fetch from the
 * API for source-of-truth state.
 */
export const WebhookDelivery = z
  .object({
    event: z.string(),
    property_id: z.string().nullable().optional(),
    user_id: z.string().nullable().optional(),
    timestamp: z.string().optional(),
    payload: z.unknown().optional(),
  })
  .passthrough();
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;
