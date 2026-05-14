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
    room_type_id: z.string().uuid().optional(),
    rate_plan_id: z.string().uuid().optional(),
    checkin_date: ISODate.optional(),
    checkout_date: ISODate.optional(),
    occupancy: z
      .object({
        adults: z.number().int().optional(),
        children: z.number().int().optional(),
        infants: z.number().int().optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    /** Per-day prices in minor currency units. */
    days: z.record(z.union([z.string(), z.number()])).optional(),
    /** Aggregate price for this room (sometimes string, sometimes number). */
    amount: z.union([z.string(), z.number()]).optional(),
    currency: z.string().optional(),
  })
  .passthrough();

export const Booking = z
  .object({
    id: z.string().uuid(),
    type: z.literal('booking').optional(),
    attributes: z
      .object({
        // Identifiers
        unique_id: z.string().optional(),
        ota_name: z.string().optional(),
        ota_reservation_code: z.string().optional(),
        status: z.enum(['new', 'modified', 'cancelled']).optional(),
        property_id: z.string().uuid().optional(),

        // Guest
        customer: z
          .object({
            name: z.string().optional(),
            surname: z.string().optional(),
            mail: z.string().optional(),
            phone: z.string().optional(),
            country: z.string().optional(),
          })
          .partial()
          .passthrough()
          .optional(),

        // Stay
        arrival_date: ISODate.optional(),
        departure_date: ISODate.optional(),

        // Occupancy summary
        occupancy: z
          .object({
            adults: z.number().int().optional(),
            children: z.number().int().optional(),
            infants: z.number().int().optional(),
          })
          .partial()
          .passthrough()
          .optional(),

        // Money
        amount: z.union([z.string(), z.number()]).optional(),
        currency: z.string().optional(),
        ota_commission: z.union([z.string(), z.number()]).optional(),

        // Per-room breakdown (one entry per room booked)
        rooms: z.array(BookingRoom).optional(),

        // Payment
        payment_collect: z.enum(['property', 'ota']).optional(),
        payment_type: z.string().optional(),

        // Misc
        notes: z.string().nullable().optional(),
        revision_id: z.string().optional(),

        inserted_at: z.string().optional(),
        updated_at: z.string().optional(),
      })
      .passthrough(),
    relationships: z.record(z.unknown()).optional(),
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
    booking_id: z.string().uuid().optional(),
    booking_unique_id: z.string().optional(),
    event: z.string().optional(),
    booking: Booking.optional(),
  })
  .passthrough();
export type BookingRevision = z.infer<typeof BookingRevision>;
