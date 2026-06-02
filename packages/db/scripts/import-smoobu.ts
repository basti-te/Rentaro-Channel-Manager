/**
 * Bulk-import bookings from a Smoobu "BookingList" CSV export into Rentaro.
 *
 *   pnpm db:import-smoobu <path/to/BookingList.csv> --tenant="<name|uuid>" [options]
 *
 * Options:
 *   --commit                 actually write (default is a read-only dry-run)
 *   --tenant=<name|uuid>      REQUIRED — target tenant (by exact name or id)
 *   --apartment=<name>        map ALL rows to this one Rentaro apartment.
 *                             If omitted and the tenant has exactly one
 *                             apartment, that one is used; otherwise each row's
 *                             "Accommodation" is matched to an apartment by name
 *                             (case-insensitive) and unmatched rows are skipped.
 *   --currency=<ISO>          override booking currency (default: tenant default)
 *
 * Idempotent — uses `bookings.external_id = 'smoobu:<Position>'` as the unique
 * key per tenant, so re-running the same (or an updated) file only adds new
 * rows. Does NOT touch the ARI outbox: run a Full Sync from the UI when you
 * are ready for Channex/OTAs to receive the imported availability (only after
 * the old PMS is disconnected from the OTAs — see docs/migration-from-pms.md).
 *
 * Smoobu "Simple" export columns (`;`-separated):
 *   Position, Arrival, Departure, Accommodation, Guest, Portal, Created, Email,
 *   Phone, Address, Adults, Children, Check-in, Check-out, Notes, Price,
 *   Price details, Commission included, City tax, Paid, Prepayment,
 *   Prepayment paid, Number of nights, Status, Assistant Instructions
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

config({ path: resolve(process.cwd(), '../../.env.local') });

// ── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const COMMIT = argv.includes('--commit');
const CSV_PATH = argv.find((a) => a.toLowerCase().endsWith('.csv'));
const TENANT = flag('tenant');
const APARTMENT = flag('apartment');
const CURRENCY_OVERRIDE = flag('currency');

if (!CSV_PATH || !TENANT) {
  console.error(
    'Usage: pnpm db:import-smoobu <file.csv> --tenant="<name|uuid>" [--apartment="<name>"] [--currency=AUD] [--commit]',
  );
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quote-aware CSV parser: ';' delimiter, '"' quotes ("" escape), newlines in quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ';') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const ymd = (s: string): string | null => {
  const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec((s || '').trim());
  return m ? `20${m[3]}-${m[2]}-${m[1]}` : null;
};
const tstamp = (s: string): Date | null => {
  const m = /^(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec((s || '').trim());
  return m ? new Date(Date.UTC(2000 + +m[3]!, +m[2]! - 1, +m[1]!, +m[4]!, +m[5]!)) : null;
};
const cents = (s: string): number | null => {
  const v = parseFloat((s || '').replace(',', '.'));
  return Number.isFinite(v) ? Math.round(v * 100) : null;
};

type Source = 'airbnb' | 'booking_com' | 'internal' | 'block';

interface Mapped {
  externalId: string;
  accommodation: string;
  source: Source;
  status: 'synced' | 'blocked';
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  guestCount: number;
  checkin: string;
  checkout: string;
  checkinTime: string;
  checkoutTime: string;
  priceCents: number | null;
  otaName: string;
  otaConfirmationCode: string | null;
  createdAt: Date | null;
  raw: Record<string, string>;
}

async function main(): Promise<void> {
  // ── Resolve tenant (by id or exact name) ─────────────────────────────────
  const tenantRows = UUID_RE.test(TENANT!)
    ? await sql<{ id: string; default_currency: string }[]>`
        SELECT id, default_currency FROM tenants WHERE id = ${TENANT!}`
    : await sql<{ id: string; default_currency: string }[]>`
        SELECT id, default_currency FROM tenants WHERE name = ${TENANT!}`;
  if (tenantRows.length !== 1) {
    throw new Error(`Expected exactly 1 tenant for "${TENANT}", got ${tenantRows.length}`);
  }
  const tenantId = tenantRows[0]!.id;
  const currency = (CURRENCY_OVERRIDE || tenantRows[0]!.default_currency || 'EUR').toUpperCase();

  // ── Resolve apartment mapping ────────────────────────────────────────────
  const props = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM properties WHERE tenant_id = ${tenantId}`;
  if (props.length === 0) throw new Error('Tenant has no apartments — create one first.');

  let forcedPropertyId: string | null = null;
  if (APARTMENT) {
    const hit = props.find((p) => p.name.toLowerCase() === APARTMENT.toLowerCase());
    if (!hit) throw new Error(`Apartment "${APARTMENT}" not found for this tenant.`);
    forcedPropertyId = hit.id;
  } else if (props.length === 1) {
    forcedPropertyId = props[0]!.id;
  }
  const byName = new Map(props.map((p) => [p.name.toLowerCase(), p.id]));

  console.log(
    `tenant=${tenantId}  currency=${currency}  ` +
      `apartment=${forcedPropertyId ? (APARTMENT ?? props[0]!.name) : 'per-row match'}`,
  );

  // ── Parse + map ──────────────────────────────────────────────────────────
  const rows = parseCsv(readFileSync(CSV_PATH!, 'utf8'));
  const header = rows[0] ?? [];
  const mapped: Mapped[] = [];
  const skipped: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.length < 24 || !r[0]?.trim()) continue;
    const obj: Record<string, string> = {};
    header.forEach((h, j) => (obj[h] = r[j] ?? ''));

    const position = r[0]!.trim();
    const arrival = ymd(r[1]!);
    const departure = ymd(r[2]!);
    if (!arrival || !departure) {
      skipped.push(`${position}: bad dates`);
      continue;
    }
    const accommodation = (r[3] ?? '').trim();
    const guest = (r[4] ?? '').trim();
    const portal = (r[5] ?? '').trim();
    const pl = portal.toLowerCase();
    const isBlock = guest.toLowerCase() === 'blockiert';
    // "Direct booking" contains "booking" — match Booking.com on the PREFIX so
    // a direct booking isn't misread as an OTA booking.
    const source: Source = pl === 'airbnb' ? 'airbnb'
      : pl.startsWith('booking') ? 'booking_com'
      : isBlock ? 'block' : 'internal';
    const adults = parseInt(r[10] ?? '', 10) || 0;
    const children = parseInt(r[11] ?? '', 10) || 0;
    const bn = /Booking Number:\s*(\S+)/i.exec(r[14] ?? '');

    mapped.push({
      externalId: `smoobu:${position}`,
      accommodation,
      source,
      status: source === 'block' ? 'blocked' : 'synced',
      guestName: source === 'block' ? null : guest || null,
      guestEmail: source === 'block' ? null : (r[7] ?? '').trim() || null,
      guestPhone: source === 'block' ? null : (r[8] ?? '').trim() || null,
      guestCount: Math.max(1, adults + children),
      checkin: arrival,
      checkout: departure,
      checkinTime: (r[12] ?? '').trim() || '15:00',
      checkoutTime: (r[13] ?? '').trim() || '10:00',
      priceCents: source === 'block' ? null : cents(r[15] ?? ''),
      otaName: portal,
      otaConfirmationCode: bn ? bn[1]! : null,
      createdAt: tstamp(r[6] ?? ''),
      raw: obj,
    });
  }

  // Resolve each row's target property.
  const targets = new Map<string, string>(); // externalId -> propertyId
  for (const m of mapped) {
    const pid = forcedPropertyId ?? byName.get(m.accommodation.toLowerCase()) ?? null;
    if (!pid) {
      skipped.push(`${m.externalId}: no apartment match for "${m.accommodation}"`);
      continue;
    }
    targets.set(m.externalId, pid);
  }
  const importable = mapped.filter((m) => targets.has(m.externalId));

  // ── Summary ──────────────────────────────────────────────────────────────
  const by = (s: Source) => importable.filter((m) => m.source === s).length;
  const sum = importable.reduce((a, m) => a + (m.priceCents ?? 0), 0) / 100;
  const checkins = importable.map((m) => m.checkin).sort();
  const checkouts = importable.map((m) => m.checkout).sort();
  console.log(`\n── ${importable.length} importable (of ${mapped.length} parsed) ──`);
  console.log(`  airbnb=${by('airbnb')} booking_com=${by('booking_com')} internal=${by('internal')} block=${by('block')}`);
  console.log(`  with OTA code: ${importable.filter((m) => m.otaConfirmationCode).length}`);
  console.log(`  date range: ${checkins[0]} … ${checkouts[checkouts.length - 1]}`);
  console.log(`  total price: ${currency} ${sum.toLocaleString('en-US')}`);
  if (skipped.length) console.log(`  SKIPPED (${skipped.length}): ${skipped.slice(0, 10).join(' | ')}${skipped.length > 10 ? ' …' : ''}`);

  if (!COMMIT) {
    console.log('\nDRY-RUN — nothing written. Re-run with --commit to import.');
    return;
  }

  // ── Commit (transaction, idempotent, verify) ─────────────────────────────
  await sql.begin(async (tx) => {
    const beforeRows = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM bookings WHERE tenant_id = ${tenantId}`;
    const before = beforeRows[0]!.n;
    const existing = await tx<{ external_id: string }[]>`
      SELECT external_id FROM bookings WHERE tenant_id = ${tenantId} AND external_id IS NOT NULL`;
    const have = new Set(existing.map((e) => e.external_id));

    let inserted = 0;
    let dup = 0;
    for (const m of importable) {
      if (have.has(m.externalId)) {
        dup++;
        continue;
      }
      await tx`INSERT INTO bookings
        (tenant_id, property_id, source, status, guest_name, guest_email, guest_phone,
         guest_count, checkin, checkout, checkin_time, checkout_time, price_cents,
         currency, ota_name, ota_confirmation_code, external_id, imported_at,
         created_at, auto_review_enabled, raw_payload)
        VALUES (${tenantId}, ${targets.get(m.externalId)!}, ${m.source}, ${m.status},
         ${m.guestName}, ${m.guestEmail}, ${m.guestPhone}, ${m.guestCount},
         ${m.checkin}, ${m.checkout}, ${m.checkinTime}, ${m.checkoutTime}, ${m.priceCents},
         ${currency}, ${m.otaName}, ${m.otaConfirmationCode}, ${m.externalId}, now(),
         ${m.createdAt ?? new Date()}, ${false}, ${sql.json(m.raw)})`;
      inserted++;
    }
    const afterRows = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM bookings WHERE tenant_id = ${tenantId}`;
    const after = afterRows[0]!.n;
    console.log(`\n✓ inserted=${inserted}  duplicate-skipped=${dup}  bookings: ${before} → ${after}`);
    if (after !== before + inserted) throw new Error(`verify failed: ${before}+${inserted} != ${after}`);
  });
  console.log('✓ committed.');
}

try {
  await main();
} finally {
  await sql.end();
}
