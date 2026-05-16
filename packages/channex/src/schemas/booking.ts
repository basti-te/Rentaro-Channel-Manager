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

/**
 * Shared attributes block. The Booking Revisions Feed returns the same
 * `attributes` shape as GET /bookings/:id but with extra fields:
 *   - `booking_id` — the actual booking UUID (top-level `id` is the revision id)
 *   - `acknowledge_status` — "pending" | "acked"
 *   - `is_crs_revision` — true for bookings created via POST /bookings
 */
export const BookingAttributes = z
  .object({
    // Identifiers
    id: z.string().uuid().nullish(),
    booking_id: z.string().uuid().nullish(),
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
    notes: z.string().nullish(),
    revision_id: z.string().nullish(),
    inserted_at: z.string().nullish(),
    updated_at: z.string().nullish(),

    // Feed-only fields
    acknowledge_status: z.string().nullish(),
    is_crs_revision: z.boolean().nullish(),
  })
  .passthrough();

export type BookingAttributes = z.infer<typeof BookingAttributes>;

export const Booking = z
  .object({
    id: z.string().uuid(),
    type: z.literal('booking').nullish(),
    attributes: BookingAttributes,
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
 * The feed returns full booking data inside `attributes` (same shape as
 * GET /bookings/:id), so we don't need to re-fetch. The top-level `id` is
 * the revision id; the actual booking id lives at `attributes.booking_id`.
 *
 * The feed guarantees at-least-once delivery, so the ack must be idempotent
 * on our side (we already use UNIQUE on channex_booking_id).
 */
export const BookingRevision = z
  .object({
    id: z.string().uuid(),
    type: z.literal('booking_revision').nullish(),
    attributes: BookingAttributes,
    relationships: z.record(z.unknown()).nullish(),
  })
  .passthrough();
export type BookingRevision = z.infer<typeof BookingRevision>;

/**
 * Input for POST /bookings (Channex Booking CRS API).
 *
 * High-level shape that hides the day-by-day pricing breakdown: the caller
 * passes a single nightly rate and we expand it into the `days` map Channex
 * expects. Used by the sandbox simulator to mint OTA-like bookings for E2E
 * testing without real channel accounts.
 */
export const BookingCreate = z.object({
  propertyId: z.string().uuid(),
  roomTypeId: z.string().uuid(),
  ratePlanId: z.string().uuid(),
  /** "Offline" is the safe default in sandbox. Use "Airbnb" / "BookingCom" / "Expedia" to simulate OTAs. */
  otaName: z.string().default('Offline'),
  /** Channel-side reservation code. If omitted, a timestamped one is generated. */
  otaReservationCode: z.string().optional(),
  arrivalDate: ISODate,
  departureDate: ISODate,
  /** Nightly rate as decimal string ("80.00"). Applied to every night in the stay. */
  nightlyRate: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Use a decimal like "80.00"'),
  currency: z.string().default('EUR'),
  guest: z.object({
    name: z.string().min(1),
    surname: z.string().min(1),
    mail: z.string().email().optional(),
    phone: z.string().optional(),
    country: z.string().length(2).optional(),
  }),
  adults: z.number().int().min(1).default(2),
  children: z.number().int().min(0).default(0),
  infants: z.number().int().min(0).default(0),
  notes: z.string().optional(),
});
export type BookingCreate = z.input<typeof BookingCreate>;
