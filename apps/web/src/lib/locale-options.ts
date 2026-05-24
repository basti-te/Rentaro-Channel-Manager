/**
 * Tiny helpers for currency / timezone option lists in <select>s.
 * Used by Settings (tenant defaults) and Apartments (per-property
 * currency override).
 */

/** Full Intl list with a small fallback if the runtime lacks `supportedValuesOf`. */
export function intlSupported(
  kind: 'timeZone' | 'currency',
  fallback: string[],
): string[] {
  const fn = (Intl as unknown as {
    supportedValuesOf?: (k: string) => string[];
  }).supportedValuesOf;
  try {
    const v = fn?.(kind);
    return v && v.length > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Pin a preferred default to the top, keep the currently-saved value next,
 * then the full alphabetical list — deduplicated. Returns a clean dropdown
 * order where users land on the obvious choice without losing access to
 * the long tail.
 */
export function withPreferred(
  list: string[],
  preferred: string,
  current: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [preferred, current, ...list]) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/** Format a currency code as "EUR — Euro". Falls back to just the code. */
export const currencyName: (code: string) => string = (() => {
  try {
    const dn = new Intl.DisplayNames(['de'], { type: 'currency' });
    return (code: string) => {
      try {
        const n = dn.of(code);
        return n && n !== code ? `${code} — ${n}` : code;
      } catch {
        return code;
      }
    };
  } catch {
    return (code: string) => code;
  }
})();

export const CURRENCY_FALLBACK = ['EUR', 'USD', 'GBP', 'CHF'];
export const TIMEZONE_FALLBACK = [
  'Europe/Berlin',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/London',
  'Europe/Madrid',
  'UTC',
];
