/**
 * Guest-invoice money engine.
 *
 * Decomposes a stay into the exact line amounts the operator's existing
 * invoices use (verified against a real Leopards GmbH / CITY APARTMENTS ESSEN
 * invoice):
 *
 *   1. Übernachtung      — GROSS lodging, incl. `vatRateBp` (700 = 7%)
 *   2. Übernachtungssteuer — `cityTaxRateBp` (500 = 5%) × GROSS lodging, 0% VAT
 *   3. Endreinigung      — GROSS cleaning, incl. VAT (only if > 0)
 *
 *   Gesamtbetrag netto  = lodgingNet + cleaningNet + cityTax (city tax has no VAT)
 *   Umsatzsteuer 7%     = lodgingVat + cleaningVat
 *   Gesamtbetrag brutto = lodgingGross + cityTax + cleaningGross
 *
 * Sample reconciliation (lodging 606,62 + cleaning 39,98, 7% VAT, 5% city tax):
 *   city tax 30,33 · net 634,62 · VAT 42,31 · gross 676,93  ✓
 */
import { daysSumCents } from './booking-amounts';

const OTA_SOURCES = new Set(['airbnb', 'booking_com', 'expedia', 'other_ota']);

export interface InvoiceConfig {
  vatMode: 'regular' | 'kleinunternehmer';
  vatRateBp: number;
  cityTaxRateBp: number;
}

export interface InvoiceBreakdown {
  lodgingGrossCents: number;
  lodgingNetCents: number;
  lodgingVatCents: number;
  cleaningGrossCents: number;
  cleaningNetCents: number;
  cleaningVatCents: number;
  cityTaxCents: number;
  totalNetCents: number;
  totalVatCents: number;
  totalGrossCents: number;
  /** Effective VAT rate applied (0 for Kleinunternehmer). */
  vatRateBp: number;
  cityTaxRateBp: number;
}

/** Decompose lodging + cleaning gross into the invoice line amounts. */
export function computeInvoiceBreakdown(
  lodgingGrossCents: number,
  cleaningGrossCents: number,
  cfg: InvoiceConfig,
): InvoiceBreakdown {
  const vat = cfg.vatMode === 'kleinunternehmer' ? 0 : cfg.vatRateBp / 10_000;
  const lodgingGross = Math.round(lodgingGrossCents);
  const cleaningGross = Math.round(cleaningGrossCents);

  // City tax: 5% of GROSS lodging (matches the operator's invoices), no VAT.
  const cityTax = Math.round(lodgingGross * (cfg.cityTaxRateBp / 10_000));

  const netOf = (gross: number) => Math.round(gross / (1 + vat));
  const lodgingNet = netOf(lodgingGross);
  const lodgingVat = lodgingGross - lodgingNet;
  const cleaningNet = netOf(cleaningGross);
  const cleaningVat = cleaningGross - cleaningNet;

  return {
    lodgingGrossCents: lodgingGross,
    lodgingNetCents: lodgingNet,
    lodgingVatCents: lodgingVat,
    cleaningGrossCents: cleaningGross,
    cleaningNetCents: cleaningNet,
    cleaningVatCents: cleaningVat,
    cityTaxCents: cityTax,
    totalNetCents: lodgingNet + cleaningNet + cityTax,
    totalVatCents: lodgingVat + cleaningVat,
    totalGrossCents: lodgingGross + cityTax + cleaningGross,
    vatRateBp: cfg.vatMode === 'kleinunternehmer' ? 0 : cfg.vatRateBp,
    cityTaxRateBp: cfg.cityTaxRateBp,
  };
}

export interface InvoiceBasis {
  lodgingGrossCents: number;
  cleaningGrossCents: number;
  /** False when we can't reliably determine the lodging price (→ suppress). */
  confident: boolean;
}

const toNum = (x: bigint | number | null | undefined): number | null =>
  x == null ? null : Number(x);

/**
 * Derive the lodging + cleaning gross to invoice for a booking.
 *   - native: nightly × nights (+ stored cleaning fee).
 *   - OTA: lodging = Σ per-night prices (rooms[].days); cleaning unknown → 0.
 * `nights` is checkout − checkin.
 */
export function invoiceBasisForBooking(
  b: {
    source: string;
    priceCents: bigint | number | null;
    nightlyRateCents: bigint | number | null;
    cleaningFeeCents: bigint | number | null;
    rawPayload?: unknown;
  },
  nights: number,
  cityTaxRateBp: number,
): InvoiceBasis {
  const cityRate = cityTaxRateBp / 10_000;

  // Native bookings: we stored the line items ourselves.
  if (!OTA_SOURCES.has(b.source)) {
    const nightly = toNum(b.nightlyRateCents) ?? 0;
    const lodging = nightly * Math.max(1, nights);
    return {
      lodgingGrossCents: lodging,
      cleaningGrossCents: toNum(b.cleaningFeeCents) ?? 0,
      confident: lodging > 0,
    };
  }

  const amount = toNum(b.priceCents);
  const days = daysSumCents(b.rawPayload);

  // Airbnb: `amount` is the PAYOUT (not the guest-paid gross) and the cleaning
  // fee isn't separable — invoice the per-night lodging only (best effort).
  if (b.source === 'airbnb') {
    const lodging = days ?? 0;
    return { lodgingGrossCents: lodging, cleaningGrossCents: 0, confident: lodging > 0 };
  }

  // Booking.com / Expedia / other: `amount` IS the guest-paid GROSS. Reconstruct
  // so the invoice TOTAL equals it exactly: lodging = Σ per-night prices, city
  // tax = rate × lodging, cleaning = the remainder (amount − lodging − cityTax).
  // This is what fixes "Brutto too low" — the cleaning fee Channex bundles into
  // `amount` but doesn't break out for us.
  if (amount != null && amount > 0) {
    let lodging = days != null && days > 0 ? days : Math.round(amount / (1 + cityRate));
    const cityTax = Math.round(lodging * cityRate);
    let cleaning = amount - lodging - cityTax;
    if (cleaning < 0) {
      // Lodging + city tax already ≥ the paid amount → nothing separable as
      // cleaning; fold everything into lodging so the total still reconciles.
      lodging = Math.round(amount / (1 + cityRate));
      cleaning = 0;
    }
    return { lodgingGrossCents: lodging, cleaningGrossCents: cleaning, confident: true };
  }

  // No reliable amount → fall back to per-night lodging only.
  const lodging = days ?? 0;
  return { lodgingGrossCents: lodging, cleaningGrossCents: 0, confident: lodging > 0 };
}

/** "606,62 EUR" — matches the operator's invoice number/currency format. */
export function formatInvoiceMoney(cents: number, currency = 'EUR'): string {
  const v = cents / 100;
  return `${v.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

/** "09.06.2026" from a YYYY-MM-DD string (no tz math — it's a plain date). */
export function formatInvoiceDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}
