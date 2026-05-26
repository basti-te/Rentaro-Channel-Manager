/**
 * Bulk-import bookings from a Guesty For Hosts "Check-in List" export.
 *
 *   pnpm db:import-guesty <path/to/export.xls> [--dry-run] [--tenant=<uuid>]
 *
 * Idempotent — uses `bookings.external_id = 'guesty:<reservation_code>'` as
 * the unique key per tenant. Re-running the same file is a no-op.
 *
 * Does NOT touch the ARI outbox. After a successful import, run a Full Sync
 * from the UI when you want Channex to receive the new state.
 *
 * Tested against the Guesty "Simple" export sheet, columns:
 *   Listing Name, Guest Name, Guest Location, Check-in, C-in Time,
 *   Check-Out, C-out Time, # of Adults, # of Children, # of Nights,
 *   # of Infants, Email, Phone, Currency, Payout, Cleaning Fee,
 *   Accommodation Fee, Other Fees, Platform Fee, Reservation Code,
 *   Source, Confirmation Date, Status
 */
import { config } from 'dotenv';
import { resolve as pathResolve } from 'node:path';
import postgres from 'postgres';
// @ts-ignore — types missing in some environments
import XLSX from 'xlsx';

config({ path: pathResolve(process.cwd(), '../../.env.local') });

// ─── CLI argument parsing ───────────────────────────────────────────────────
const args = process.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const tenantArg = args.find((a) => a.startsWith('--tenant='))?.split('=')[1];

if (!fileArg) {
  console.error(
    'Usage: pnpm db:import-guesty <path/to/export.xls> [--dry-run] [--tenant=<uuid>]',
  );
  process.exit(1);
}

const TENANT_ID =
  tenantArg ?? 'ca769cf3-e22e-4148-9fb7-8b9a65c200ef'; // CITY APARTMENTS ESSEN
const sql = postgres(process.env.DATABASE_URL!);

// ─── Source / status mapping ────────────────────────────────────────────────
const SOURCE_MAP: Record<string, 'airbnb' | 'booking_com' | 'internal'> = {
  Airbnb: 'airbnb',
  'Booking.com': 'booking_com',
  Direct: 'internal',
  Website: 'internal',
};

interface GuestyRow {
  'Listing Name': string;
  'Guest Name': string;
  'Guest Location'?: string | null;
  'Check-in': string;
  'C-in Time'?: string | null;
  'Check-Out': string;
  'C-out Time'?: string | null;
  '# of Adults'?: string | null;
  '# of Children'?: string | null;
  '# of Nights'?: string | null;
  '# of Infants'?: string | null;
  Email?: string | null;
  Phone?: string | null;
  Currency: string;
  Payout?: string | null;
  'Cleaning Fee'?: string | null;
  'Accommodation Fee'?: string | null;
  'Other Fees'?: string | null;
  'Platform Fee'?: string | null;
  'Reservation Code': string;
  Source: string;
  'Confirmation Date'?: string | null;
  Status: 'Confirmed' | 'Canceled' | string;
}

interface ImportRow {
  external_id: string;
  property_id: string;
  source: 'airbnb' | 'booking_com' | 'internal';
  status: 'synced' | 'cancelled';
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  guest_count: number;
  checkin: string;
  checkout: string;
  nightly_rate_cents: number | null;
  cleaning_fee_cents: number | null;
  price_cents: number | null;
  currency: string;
  ota_name: string | null;
  ota_confirmation_code: string;
  created_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function parseInt0(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}
function parseMoney(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function isoOrPassthrough(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').slice(0, 10);
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Guesty Import → tenant ${TENANT_ID} ===`);
  console.log(`File: ${fileArg}`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'WRITE'}\n`);

  // Look up properties to build name→id map
  const props = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM properties WHERE tenant_id = ${TENANT_ID}
  `;
  const propByName = new Map(props.map((p) => [p.name, p.id]));
  console.log(`Loaded ${props.length} properties from tenant.`);

  // Parse Excel
  const wb = XLSX.readFile(fileArg!, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json<GuestyRow>(sheet, { defval: null, raw: false });
  console.log(`Parsed ${rows.length} rows from XLS.\n`);

  // Transform & validate
  const ok: ImportRow[] = [];
  const errors: { row: number; reason: string; raw: GuestyRow }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const listingName = r['Listing Name'];
    const resCode = r['Reservation Code'];
    const checkin = isoOrPassthrough(r['Check-in']);
    const checkout = isoOrPassthrough(r['Check-Out']);
    const sourceRaw = r['Source'];
    const statusRaw = r['Status'];

    if (!listingName || !propByName.has(listingName)) {
      errors.push({ row: i + 2, reason: `unknown apartment: ${listingName}`, raw: r });
      continue;
    }
    if (!resCode) {
      errors.push({ row: i + 2, reason: 'missing Reservation Code', raw: r });
      continue;
    }
    const source = SOURCE_MAP[sourceRaw];
    if (!source) {
      errors.push({ row: i + 2, reason: `unknown source: ${sourceRaw}`, raw: r });
      continue;
    }
    if (statusRaw !== 'Confirmed' && statusRaw !== 'Canceled') {
      errors.push({ row: i + 2, reason: `unknown status: ${statusRaw}`, raw: r });
      continue;
    }
    if (!checkin || !checkout || checkin >= checkout) {
      errors.push({ row: i + 2, reason: `invalid date range: ${checkin} → ${checkout}`, raw: r });
      continue;
    }

    const adults = parseInt0(r['# of Adults']);
    const children = parseInt0(r['# of Children']);
    const infants = parseInt0(r['# of Infants']);
    const guestCount = Math.max(1, adults + children + infants);

    const nights = parseInt0(r['# of Nights']) ||
      Math.round((new Date(checkout).getTime() - new Date(checkin).getTime()) / 86400000);
    const accommodation = parseMoney(r['Accommodation Fee']);
    const cleaning = parseMoney(r['Cleaning Fee']);
    const nightlyCents = accommodation != null && nights > 0
      ? Math.round(accommodation / nights)
      : null;
    const totalCents = (accommodation ?? 0) + (cleaning ?? 0) || null;

    ok.push({
      external_id: `guesty:${resCode}`,
      property_id: propByName.get(listingName)!,
      source,
      status: statusRaw === 'Canceled' ? 'cancelled' : 'synced',
      guest_name: r['Guest Name'] || '(unknown)',
      guest_email: r['Email'] || null,
      guest_phone: r['Phone'] || null,
      guest_count: guestCount,
      checkin,
      checkout,
      nightly_rate_cents: nightlyCents,
      cleaning_fee_cents: cleaning,
      price_cents: totalCents,
      currency: r['Currency'] || 'EUR',
      ota_name: source === 'internal' ? null : sourceRaw,
      ota_confirmation_code: resCode,
      created_at: isoOrPassthrough(r['Confirmation Date']) || checkin,
    });
  }

  // Guesty exports often contain multiple rows for the same reservation
  // (e.g. when a booking was modified or repeatedly re-confirmed). Collapse
  // duplicates by external_id, preferring the cancelled state when present
  // (cancellation supersedes confirmation).
  const dedupMap = new Map<string, ImportRow>();
  for (const row of ok) {
    const existing = dedupMap.get(row.external_id);
    if (!existing) {
      dedupMap.set(row.external_id, row);
      continue;
    }
    if (row.status === 'cancelled' && existing.status !== 'cancelled') {
      dedupMap.set(row.external_id, row);
    }
    // Otherwise keep existing.
  }
  const dedupCount = ok.length - dedupMap.size;
  const dedupedRows = [...dedupMap.values()];

  // Summary
  console.log(`Valid rows:        ${ok.length}`);
  console.log(`Duplicates merged: ${dedupCount}  (same Reservation Code, kept latest/cancelled)`);
  console.log(`Unique to insert:  ${dedupedRows.length}`);
  console.log(`Errored rows:      ${errors.length}`);
  if (errors.length > 0) {
    console.log('\nFirst 10 errors:');
    for (const e of errors.slice(0, 10)) {
      console.log(`  row ${e.row}: ${e.reason}`);
    }
  }

  // Breakdown
  const sourceBreakdown: Record<string, number> = {};
  const statusBreakdown: Record<string, number> = {};
  for (const r of dedupedRows) {
    const key = `${r.source}/${r.status}`;
    sourceBreakdown[key] = (sourceBreakdown[key] ?? 0) + 1;
    statusBreakdown[r.status] = (statusBreakdown[r.status] ?? 0) + 1;
  }
  console.log('\nBy source/status:');
  for (const [k, v] of Object.entries(sourceBreakdown).sort()) {
    console.log(`  ${k.padEnd(25)} ${v}`);
  }

  if (dryRun) {
    console.log('\n[DRY-RUN] No rows written. Re-run without --dry-run to apply.');
    return;
  }

  // Already imported?
  const existing = await sql<{ external_id: string }[]>`
    SELECT external_id FROM bookings
    WHERE tenant_id = ${TENANT_ID}
      AND external_id LIKE 'guesty:%'
  `;
  const existingSet = new Set(existing.map((e) => e.external_id));
  const toInsert = dedupedRows.filter((r) => !existingSet.has(r.external_id));
  console.log(`\nAlready imported: ${existingSet.size}`);
  console.log(`To insert now:    ${toInsert.length}`);
  if (toInsert.length === 0) {
    console.log('Nothing new to import.');
    return;
  }

  // Transactional batched insert. Batches keep the parameter count under
  // Postgres' 65k-binding limit (each row binds ~16 parameters, so 1000 is
  // comfortably safe).
  const BATCH = 500;
  let inserted = 0;
  await sql.begin(async (tx) => {
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const slice = toInsert.slice(i, i + BATCH);
      const values = slice.map((r) => ({
        tenant_id: TENANT_ID,
        property_id: r.property_id,
        source: r.source,
        status: r.status,
        external_id: r.external_id,
        imported_at: new Date(),
        guest_name: r.guest_name,
        guest_email: r.guest_email,
        guest_phone: r.guest_phone,
        guest_count: r.guest_count,
        checkin: r.checkin,
        checkout: r.checkout,
        nightly_rate_cents: r.nightly_rate_cents,
        cleaning_fee_cents: r.cleaning_fee_cents,
        price_cents: r.price_cents,
        currency: r.currency,
        ota_name: r.ota_name,
        ota_confirmation_code: r.ota_confirmation_code,
        created_at: new Date(r.created_at),
        updated_at: new Date(),
      }));
      await tx`INSERT INTO bookings ${tx(values)}`;
      inserted += slice.length;
      console.log(`  inserted ${inserted}/${toInsert.length}`);
    }
  });

  console.log(`\n✓ Import complete. ${inserted} new bookings written.`);
  console.log(`  Channex outbox is untouched — run a Full Sync from the UI`);
  console.log(`  when you want Channex to learn about these bookings.`);
}

main()
  .catch((err) => {
    console.error('\n✗ Import failed:', err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
