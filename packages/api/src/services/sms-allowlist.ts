import { eq } from 'drizzle-orm';
import { tenantSmsCountries, type Database } from '@cm/db';
import { resolveSmsCountry } from './twilio';

/** ISO-2 countries this tenant may send SMS to. Empty set = none allowed. */
export async function loadAllowedSmsCountries(
  db: Database,
  tenantId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ c: tenantSmsCountries.countryCode })
    .from(tenantSmsCountries)
    .where(eq(tenantSmsCountries.tenantId, tenantId));
  return new Set(rows.map((r) => r.c));
}

/**
 * Resolve a phone's country and check it against the tenant's allow-list.
 * `ok=false` with `country=null` means the number couldn't be parsed; with a
 * country it means that country isn't enabled for this tenant.
 */
export async function checkSmsCountry(
  db: Database,
  tenantId: string,
  phone: string | null | undefined,
): Promise<{ ok: boolean; country: string | null }> {
  const country = resolveSmsCountry(phone);
  if (!country) return { ok: false, country: null };
  const allowed = await loadAllowedSmsCountries(db, tenantId);
  return { ok: allowed.has(country), country };
}
