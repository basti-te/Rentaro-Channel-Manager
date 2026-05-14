import { z } from 'zod';
import { ISODate } from './common';

/**
 * Channex booking object. The shape is large; we model the fields we actually
 * persist or display, and let everything else pass through.
 *
 * Key identifiers:
 *   - `id` — Channex booking UUID
 *   - `unique_id` — channel-prefixed reservation code:
 *       BDC-12345 (Booking.com), ABB-... (Airbnb), EXP-... (Expedia)
 *   - `ota_name` — "BookingCom", "Airbnb", "A-Expedia"
 *
 * https://docs.channex.io/api-v.1-documentation/bookings-collection
 */
export const BookingRoom = z
  .object({
    room_type_id: z.string().uuid().nullish(),
    rate_plan_id: z.string().uuid().nullish(),
    checkin_date: ISODate.nullish(),
    checkout_date: ISODate.nullish(),
    occupancy: z
      .object({
        adults: z.number().int().nullish(),
        children: z.number().int().nullish(),
        infants: z.number().int().nullish(),
      })
      .partial()
      .passthrough()
      .nullish(),
    /** Per-day prices in minor currency units. */
    days: z.record(z.union([z.string(), z.number()])).nullish(),
    /** Aggregate price for this room (sometimes string, sometimes number). */
    amount: z.union([z.string(), z.number()]).nullish(),
    currency: z.string().nullish(),
  })
  .passthrough();

export const Booking = z
  .object({
    id: z.string().uuid(),
    type: z.literal('booking').nullish(),
    attributes: z
      .object({
        // Identifiers
        unique_id: z.string().nullish(),
        ota_name: z.string().nullish(),
        ota_reservation_code: z.string().nullish(),
        status: z.enum(['new', 'modified', 'cancelled']).nullish(),
        property_id: z.string().uuid().nullish(),

        // Guest
        customer: z
          .object({
            name: z.string().nullish(),
            surname: z.string().nullish(),
            mail: z.string().nullish(),
            phone: z.string().nullish(),
            country: z.string().nullish(),
          })
          .partial()
          .passthrough()
          .nullish(),

        // Stay
        arrival_date: ISODate.nullish(),
        departure_date: ISODate.nullish(),

        // Occupancy summary
        occupancy: z
          .object({
            adults: z.number().int().nullish(),
            children: z.number().int().nullish(),
            infants: z.number().int().nullish(),
          })
          .partial()
          .passthrough()
          .nullish(),

        // Money
        amount: z.union([z.string(), z.number()]).nullish(),
        currency: z.string().nullish(),
        ota_commission: z.union([z.string(), z.number()]).nullish(),

        // Per-room breakdown (one entry per room booked)
        rooms: z.array(BookingRoom).nullish(),

        // Payment
        payment_collect: z.enum(['property', 'ota']).nullish(),
        payment_type: z.string().nullish(),

        // Misc
        notes: z.string().nullable().nullish(),
        revision_id: z.string().nullish(),

        inserted_at: z.string().nullish(),
        updated_at: z.string().nullish(),
      })
      .passthrough(),
    relationships: z.record(z.unknown()).nullish(),
  })
  .passthrough();

export type Booking = z.infer<typeof Booking>;

/**
 * Booking Revisions Feed entry. The recommended way to ingest bookings:
 *   1. GET /booking_revisions/feed?limit=N → returns unacknowledged revisions
 *   2. For each entry: persist it locally
 *   3. POST /booking_revisions/{id}/ack to mark processed
 *
 * The feed guarantees at-least-once delivery, so the ack must be idempotent
 * on our side (we already use UNIQUE on channex_booking_id).
 */
export const BookingRevision = z
  .object({
    id: z.string().uuid(),
    booking_id: z.string().uuid().nullish(),
    booking_unique_id: z.string().nullish(),
    event: z.string().nullish(),
    booking: Booking.nullish(),
  })
  .passthrough();
export type BookingRevision = z.infer<typeof BookingRevision>;
