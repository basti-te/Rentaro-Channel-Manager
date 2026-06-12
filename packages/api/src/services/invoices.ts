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

/**
 * Decompose a PAID GROSS TOTAL (+ its cleaning portion) into the invoice line
 * amounts. The total is the anchor — the breakdown ALWAYS reconciles to it
 * exactly. City tax is extracted from the non-cleaning portion (= 5% of the net
 * lodging), VAT from lodging + cleaning. Reproduces the operator's invoice:
 * total 676,93, cleaning 39,98 → city tax 30,33, net 634,62, VAT 42,31.
 */
export function computeInvoiceBreakdown(
  grossTotalCents: number,
  cleaningGrossCents: number,
  cfg: InvoiceConfig,
): InvoiceBreakdown {
  const vat = cfg.vatMode === 'kleinunternehmer' ? 0 : cfg.vatRateBp / 10_000;
  const cityRate = cfg.cityTaxRateBp / 10_000;
  const grossTotal = Math.max(0, Math.round(grossTotalCents));
  const cleaningGross = Math.min(grossTotal, Math.max(0, Math.round(cleaningGrossCents)));

  // The lodging portion (everything except cleaning) INCLUDES the city tax.
  // Extract it: cityTax = portion × r/(1+r) = 5% of the net lodging.
  const lodgingPortion = grossTotal - cleaningGross;
  const cityTax = Math.round((lodgingPortion * cityRate) / (1 + cityRate));
  const lodgingGross = lodgingPortion - cityTax;

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
    totalGrossCents: lodgingGross + cityTax + cleaningGross, // == grossTotal
    vatRateBp: cfg.vatMode === 'kleinunternehmer' ? 0 : cfg.vatRateBp,
    cityTaxRateBp: cfg.cityTaxRateBp,
  };
}

export interface InvoiceBasis {
  /** The paid gross total to invoice (operator override wins, else auto). */
  grossTotalCents: number;
  /** The cleaning portion of that total (operator override wins, else auto). */
  cleaningGrossCents: number;
  /** False when we have no reliable amount to invoice (→ suppress). */
  confident: boolean;
}

const toNum = (x: bigint | number | null | undefined): number | null =>
  x == null ? null : Number(x);

/** Parse `attributes.ota_commission` (major units) from a raw Channex payload. */
function otaCommissionFromPayload(rawPayload: unknown): number | null {
  const c = (rawPayload as { attributes?: { ota_commission?: unknown } } | null)?.attributes
    ?.ota_commission;
  const n = typeof c === 'string' ? parseFloat(c) : typeof c === 'number' ? c : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Derive the (gross total, cleaning) to invoice for a booking. The total is the
 * anchor; the breakdown reconciles to it exactly. Per source:
 *   - native: price_cents is the gross total; cleaning = stored fee.
 *   - Booking.com/Expedia: `amount` is the guest-paid gross; cleaning = amount
 *     minus the per-night lodging portion (incl. its city tax).
 *   - Airbnb: `amount` is the payout, not the gross → best-effort lodging + city
 *     tax, cleaning unknown (operator corrects via the override).
 * Operator overrides (persisted on the booking) always win — so a corrected
 * amount also drives the guest-portal invoice.
 */
export function invoiceBasisForBooking(
  b: {
    source: string;
    priceCents: bigint | number | null;
    otaCommissionCents?: bigint | number | null;
    nightlyRateCents: bigint | number | null;
    cleaningFeeCents: bigint | number | null;
    invoiceGrossOverrideCents?: bigint | number | null;
    invoiceCleaningOverrideCents?: bigint | number | null;
    rawPayload?: unknown;
  },
  nights: number,
  cityTaxRateBp: number,
  airbnbAmountIsGross = false,
  defaultCleaningCents: number | null = null,
): InvoiceBasis {
  const cityRate = cityTaxRateBp / 10_000;
  const amount = toNum(b.priceCents);
  const days = daysSumCents(b.rawPayload);

  let grossTotal: number | null;
  let cleaning = 0;

  if (!OTA_SOURCES.has(b.source)) {
    cleaning = toNum(b.cleaningFeeCents) ?? 0;
    grossTotal = amount;
    if (grossTotal == null) {
      const lodging = (toNum(b.nightlyRateCents) ?? 0) * Math.max(1, nights);
      grossTotal = lodging + Math.round(lodging * cityRate) + cleaning;
    }
  } else if (b.source === 'airbnb') {
    if (airbnbAmountIsGross) {
      // Channex "Total Amount": `amount` is already the guest-paid gross (BDC-like).
      grossTotal = amount;
      if (amount != null && days != null && days > 0) {
        cleaning = Math.max(0, amount - days - Math.round(days * cityRate));
      }
    } else {
      // Channex "Payout Amount": gross = payout + Airbnb commission.
      const commission =
        toNum(b.otaCommissionCents) ?? otaCommissionFromPayload(b.rawPayload) ?? 0;
      grossTotal =
        amount != null
          ? amount + commission
          : days != null && days > 0
            ? days + Math.round(days * cityRate)
            : null;
      // Cleaning at payout level (amount − per-night lodging); the lodging line
      // absorbs the commission so the total reconciles to the gross.
      if (amount != null && days != null && days > 0) cleaning = Math.max(0, amount - days);
    }
  } else {
    grossTotal = amount;
    if (amount != null && days != null && days > 0) {
      cleaning = Math.max(0, amount - days - Math.round(days * cityRate));
    }
  }

  // Fall back to the tenant default cleaning when none could be derived.
  if (cleaning <= 0 && defaultCleaningCents != null && defaultCleaningCents > 0) {
    cleaning = defaultCleaningCents;
  }

  // Operator overrides win (persisted → the portal uses them too).
  const grossOverride = toNum(b.invoiceGrossOverrideCents);
  const cleaningOverride = toNum(b.invoiceCleaningOverrideCents);
  if (grossOverride != null) grossTotal = grossOverride;
  if (cleaningOverride != null) cleaning = cleaningOverride;

  if (grossTotal == null || grossTotal <= 0) {
    return { grossTotalCents: 0, cleaningGrossCents: 0, confident: false };
  }
  return {
    grossTotalCents: grossTotal,
    cleaningGrossCents: Math.min(Math.max(0, cleaning), grossTotal),
    confident: true,
  };
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
