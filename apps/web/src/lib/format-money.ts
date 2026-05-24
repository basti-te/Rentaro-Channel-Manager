/**
 * Money formatters — shared by the calendar, rate editor, booking dialogs,
 * and the booking detail sheet so we don't end up with three independent
 * "what does '€' look like for USD" jokes scattered across files.
 *
 * Cents in, formatted string out. Currency is ISO 4217; falls back to EUR
 * when missing. Locale defaults to de-DE since that's the app's UX
 * locale, but can be overridden.
 */

const FALLBACK_CURRENCY = 'EUR';
const DEFAULT_LOCALE = 'de-DE';

/**
 * The bare symbol for a currency ("€", "$", "CHF") via Intl. Useful as
 * a prefix on input fields where a full money format would be too noisy.
 */
export function currencySymbol(
  currency: string | null | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  const c = currency || FALLBACK_CURRENCY;
  try {
    const parts = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: c,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    const sym = parts.find((p) => p.type === 'currency')?.value;
    return sym ?? c;
  } catch {
    return c;
  }
}

export interface FormatMoneyOptions {
  /** "Tight" form: "€80", "$1.2k" — for compact spots like calendar cells. */
  tight?: boolean;
  locale?: string;
}

/**
 * Format an amount in cents as a currency string.
 *
 *   formatMoney(8500, 'EUR')                       → "85,00 €"
 *   formatMoney(8500, 'USD')                       → "85,00 $"   (de-DE locale)
 *   formatMoney(8500, 'EUR', { tight: true })      → "€85"
 *   formatMoney(150000, 'USD', { tight: true })    → "$1.5k"
 */
export function formatMoney(
  cents: number | bigint | null | undefined,
  currency: string | null | undefined,
  opts: FormatMoneyOptions = {},
): string {
  if (cents == null) return '';
  const n = typeof cents === 'bigint' ? Number(cents) : cents;
  const value = n / 100;
  const c = currency || FALLBACK_CURRENCY;
  const locale = opts.locale ?? DEFAULT_LOCALE;

  if (opts.tight) {
    const sym = currencySymbol(c, locale);
    if (Math.abs(value) >= 1000) return `${sym}${(value / 1000).toFixed(1)}k`;
    if (Number.isInteger(value)) return `${sym}${value}`;
    return `${sym}${value.toLocaleString(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}`;
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: c,
    }).format(value);
  } catch {
    return `${currencySymbol(c, locale)}${value.toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}
