/**
 * Diagnostic: list all bookings that look like test data (= not from the
 * Guesty bulk-import). Helps decide what to clean up before the real import.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);
const TENANT_ID = 'ca769cf3-e22e-4148-9fb7-8b9a65c200ef'; // CITY APARTMENTS ESSEN

try {
  // 1. Anything that's not from the Guesty import = candidate for cleanup
  const candidates = await sql`
    SELECT b.id, b.source, b.status, b.guest_name, b.checkin, b.checkout,
           b.created_at, b.channex_booking_id, p.name AS property
    FROM bookings b
    LEFT JOIN properties p ON p.id = b.property_id
    WHERE b.tenant_id = ${TENANT_ID}
      AND b.external_id IS NULL
    ORDER BY b.created_at DESC
  `;

  console.log(`Total non-imported bookings in CITY APARTMENTS ESSEN: ${candidates.length}\n`);

  // Categorize
  const channexLive: typeof candidates = [];
  const internal: typeof candidates = [];
  const blocks: typeof candidates = [];
  for (const b of candidates) {
    if (b.channex_booking_id) channexLive.push(b);
    else if (b.source === 'block') blocks.push(b);
    else internal.push(b);
  }

  if (channexLive.length > 0) {
    console.log(`── Channex-live bookings (have channex_booking_id) — ${channexLive.length}`);
    console.log('   These came from real Channex webhooks. Keep them.');
    for (const b of channexLive) {
      console.log(`   ${b.created_at.toISOString().slice(0,10)}  ${b.source.padEnd(12)} ${b.status.padEnd(10)} ${b.property?.padEnd(28)} ${b.guest_name}`);
    }
  }

  if (internal.length > 0) {
    console.log(`\n── Internal bookings (manually created in UI) — ${internal.length}`);
    console.log('   Likely dev/test entries.');
    for (const b of internal) {
      console.log(`   ${b.created_at.toISOString().slice(0,10)}  ${b.source.padEnd(12)} ${b.status.padEnd(15)} ${b.property?.padEnd(28)} ${b.guest_name ?? '—'}  ${b.checkin}→${b.checkout}`);
    }
  }

  if (blocks.length > 0) {
    console.log(`\n── Blocks (manually created sperren) — ${blocks.length}`);
    for (const b of blocks) {
      console.log(`   ${b.created_at.toISOString().slice(0,10)}  ${b.property?.padEnd(28)} ${b.checkin}→${b.checkout}`);
    }
  }

  console.log('\n────────────────────────────────────────────────');
  console.log(`Summary:`);
  console.log(`  Channex-live (KEEP):    ${channexLive.length}`);
  console.log(`  Internal/test:          ${internal.length}`);
  console.log(`  Blocks/test:            ${blocks.length}`);
  console.log(`────────────────────────────────────────────────`);
} finally {
  await sql.end();
}
