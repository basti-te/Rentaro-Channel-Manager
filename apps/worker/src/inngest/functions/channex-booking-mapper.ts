import type { Booking as ChannexBooking } from '@cm/channex';

export type BookingSource = 'internal' | 'airbnb' | 'booking_com' | 'expedia' | 'other_ota' | 'block';

/**
 * Translate Channex's `ota_name` or `unique_id` prefix to our enum.
 *
 *   "Airbnb"      → airbnb
 *   "BookingCom"  → booking_com
 *   "A-Expedia"   → expedia
 *
 *   "ABB-123"     → airbnb       (fallback via unique_id prefix)
 *   "BDC-456"     → booking_com
 *   "EXP-789"     → expedia
 *
 * https://docs.channex.io/api-v.1-documentation/bookings-collection
 */
export function resolveSource(otaName?: string | null, uniqueId?: string | null): BookingSource {
  const name = otaName?.toLowerCase() ?? '';
  if (name === 'airbnb' || name.includes('airbnb')) return 'airbnb';
  if (name === 'bookingcom' || name.includes('booking')) return 'booking_com';
  if (name.includes('expedia')) return 'expedia';

  const id = uniqueId ?? '';
  if (id.startsWith('ABB-')) return 'airbnb';
  if (id.startsWith('BDC-')) return 'booking_com';
  if (id.startsWith('EXP-')) return 'expedia';

  if (otaName) return 'other_ota';
  // Truly unknown — treat as other_ota so calendar still renders something.
  return 'other_ota';
}

/** Channex amount comes as string ("120.50") or number — to BIGINT cents. */
export function amountToCents(raw: string | number | null | undefined): bigint | null {
  if (raw == null) return null;
  const v = typeof raw === 'string' ? parseFloat(raw) : raw;
  if (!Number.isFinite(v)) return null;
  return BigInt(Math.round(v * 100));
}

interface MappedBookingRow {
  channexBookingId: string;
  channexRevisionId: string | null;
  source: BookingSource;
  status: 'synced' | 'cancelled';
  guestName: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
  guestCountry: string | null;
  guestCount: number;
  checkin: string;
  checkout: string;
  priceCents: bigint | null;
  otaCommissionCents: bigint | null;
  currency: string;
  otaName: string | null;
  otaConfirmationCode: string | null;
  channexPropertyId: string | null;
  /** Full raw payload for debugging — we keep this in bookings.raw_payload. */
  rawPayload: unknown;
}

/**
 * Map a Channex Booking object (the `data.attributes` shape) plus its
 * surrounding revision id into the columns we store in `bookings`.
 *
 * Caller is responsible for resolving tenant_id + property_id from
 * channex_properties.channex_property_id and providing them on insert.
 */
export function mapChannexBooking(
  booking: ChannexBooking,
  revisionId?: string,
): MappedBookingRow {
  const a = booking.attributes;
  if (!a.arrival_date || !a.departure_date) {
    throw new Error(`Channex booking ${booking.id} missing arrival/departure date`);
  }

  const fullName = [a.customer?.name, a.customer?.surname].filter(Boolean).join(' ') || null;
  const occupancy = a.occupancy ?? {};
  const guestCount = (occupancy.adults ?? 0) + (occupancy.children ?? 0) + (occupancy.infants ?? 0);

  return {
    channexBookingId: booking.id,
    channexRevisionId: revisionId ?? a.revision_id ?? null,
    source: resolveSource(a.ota_name, a.unique_id),
    status: a.status === 'cancelled' ? 'cancelled' : 'synced',
    guestName: fullName,
    guestPhone: a.customer?.phone ?? null,
    guestEmail: a.customer?.mail ?? null,
    guestCountry: a.customer?.country ?? null,
    guestCount: Math.max(1, guestCount),
    checkin: a.arrival_date,
    checkout: a.departure_date,
    priceCents: amountToCents(a.amount),
    otaCommissionCents: amountToCents(a.ota_commission),
    currency: a.currency ?? 'EUR',
    otaName: a.ota_name ?? null,
    otaConfirmationCode: a.ota_reservation_code ?? a.unique_id ?? null,
    channexPropertyId: a.property_id ?? null,
    rawPayload: booking,
  };
}
