/**
 * Resolve a booking's real money figures from the data Channex gives us.
 *
 * The crux: `bookings.price_cents` is Channex `amount`, which means different
 * things per OTA —
 *   - Booking.com / Expedia: `amount` = the GROSS the guest pays; the host
 *     owes `ota_commission` on top, so payout = amount − commission.
 *   - Airbnb: `amount` = the PAYOUT to the host (Airbnb already deducted its
 *     fee and the guest service fee never reaches us). The real accommodation
 *     gross is the sum of the per-night prices (`rooms[].days`), when present.
 *   - Native (internal) bookings: we computed `price_cents` ourselves
 *     (lodging + cleaning + city tax), so it IS the gross and the payout.
 *
 * This is the single source of truth for "what did the guest actually pay" —
 * used by the booking detail sheet and (Phase 1+) the guest-invoice engine.
 */

export interface ResolvedAmounts {
  /** What the guest paid for the accommodation — the invoice basis. */
  grossCents: number | null;
  /** OTA commission, when known. */
  commissionCents: number | null;
  /** What the host receives. */
  payoutCents: number | null;
  /** How `grossCents` was derived. */
  basis: 'native' | 'ota_amount' | 'ota_days' | 'unknown';
  /** True when `grossCents` is a reliable guest-paid figure (invoice-safe). */
  confident: boolean;
  /** Human note when the gross is uncertain (e.g. Airbnb payout-only). */
  note?: string;
}

export interface BookingAmountInput {
  source: string;
  priceCents: bigint | number | null;
  otaCommissionCents: bigint | number | null;
  rawPayload?: unknown;
}

const OTA_SOURCES = new Set(['airbnb', 'booking_com', 'expedia', 'other_ota']);

function toNum(x: bigint | number | null | undefined): number | null {
  if (x == null) return null;
  const n = typeof x === 'bigint' ? Number(x) : x;
  return Number.isFinite(n) ? n : null;
}

/**
 * Sum the per-night prices across all rooms in the raw Channex payload.
 * `rooms[].days` is a date→price map in MAJOR currency units. Returns cents,
 * or null when no usable day prices are present.
 */
export function daysSumCents(rawPayload: unknown): number | null {
  const rooms = (rawPayload as { attributes?: { rooms?: unknown } } | null)?.attributes?.rooms;
  if (!Array.isArray(rooms)) return null;
  let total = 0;
  let found = false;
  for (const room of rooms) {
    const days = (room as { days?: unknown } | null)?.days;
    if (days && typeof days === 'object') {
      for (const v of Object.values(days as Record<string, unknown>)) {
        const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
        if (Number.isFinite(n)) {
          total += n;
          found = true;
        }
      }
    }
  }
  return found ? Math.round(total * 100) : null;
}

export function resolveBookingAmounts(input: BookingAmountInput): ResolvedAmounts {
  const amount = toNum(input.priceCents);
  const commission = toNum(input.otaCommissionCents);

  // Native / block — price_cents is our own computed gross.
  if (!OTA_SOURCES.has(input.source)) {
    return {
      grossCents: amount,
      commissionCents: amount != null ? 0 : null,
      payoutCents: amount,
      basis: amount != null ? 'native' : 'unknown',
      confident: amount != null && amount > 0,
    };
  }

  // Airbnb — `amount` is the payout; reconstruct gross from nightly prices.
  if (input.source === 'airbnb') {
    const days = daysSumCents(input.rawPayload);
    const payout = amount;
    const gross = days != null && days > 0 ? days : amount;
    const derivedComm =
      commission != null
        ? commission
        : gross != null && payout != null && gross > payout
          ? gross - payout
          : null;
    return {
      grossCents: gross,
      commissionCents: derivedComm,
      payoutCents: payout,
      basis: days != null ? 'ota_days' : 'ota_amount',
      confident: gross != null && gross > 0,
      note:
        days == null
          ? 'Airbnb übermittelt nur den Auszahlungsbetrag — der Bruttopreis konnte nicht aus Tagespreisen rekonstruiert werden.'
          : undefined,
    };
  }

  // Booking.com / Expedia / other — `amount` is the guest-paid gross.
  const gross = amount;
  const payout = amount != null && commission != null ? amount - commission : amount;
  return {
    grossCents: gross,
    commissionCents: commission,
    payoutCents: payout,
    basis: amount != null ? 'ota_amount' : 'unknown',
    confident: amount != null && amount > 0,
  };
}
