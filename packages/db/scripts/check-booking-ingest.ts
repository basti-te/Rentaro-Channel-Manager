/**
 * Diagnostic for "booking arrived in Channex but not in our calendar":
 *   1. Are there recent `pull_booking_revision` sync_jobs?
 *   2. Are there bookings whose channex_booking_id is set (= came from Channex)?
 *   3. Which property are they linked to?
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);

try {
  console.log('═══ Recent pull_booking_revision sync_jobs ═══\n');
  const jobs = await sql`
    SELECT s.scheduled_at, s.started_at, s.finished_at, s.status, s.error,
           s.payload, s.result, p.name AS property
    FROM sync_jobs s
    LEFT JOIN properties p ON p.id = s.property_id
    WHERE s.type IN ('pull_booking_revision','pull_bookings')
    ORDER BY s.scheduled_at DESC NULLS LAST
    LIMIT 10
  `;
  if (jobs.length === 0) {
    console.log('  (no pull_booking_revision jobs found — webhook may not have arrived)');
  } else {
    for (const j of jobs) {
      console.log(`  ${j.scheduled_at?.toISOString() ?? '—'}  ${j.status}  property=${j.property ?? '—'}`);
      if (j.payload) console.log(`    payload: ${JSON.stringify(j.payload)}`);
      if (j.result) console.log(`    result:  ${JSON.stringify(j.result)}`);
      if (j.error) console.log(`    error:   ${j.error}`);
    }
  }

  console.log('\n═══ Recent bookings from Channex (last 24h) ═══\n');
  const bookings = await sql`
    SELECT b.id, b.channex_booking_id, b.source, b.status, b.guest_name,
           b.checkin, b.checkout, b.price_cents, b.currency, b.created_at,
           p.name AS property
    FROM bookings b
    LEFT JOIN properties p ON p.id = b.property_id
    WHERE b.channex_booking_id IS NOT NULL
      AND b.created_at > NOW() - INTERVAL '24 hours'
    ORDER BY b.created_at DESC
    LIMIT 10
  `;
  if (bookings.length === 0) {
    console.log('  (no recent Channex bookings ingested in last 24h)');
  } else {
    for (const b of bookings) {
      console.log(`  ${b.created_at.toISOString()}  ${b.source}  ${b.status}`);
      console.log(`    property:           ${b.property ?? '—'}`);
      console.log(`    rentaro booking_id: ${b.id}`);
      console.log(`    channex_booking_id: ${b.channex_booking_id}`);
      console.log(`    guest:              ${b.guest_name}`);
      console.log(`    range:              ${b.checkin} → ${b.checkout}`);
      console.log(`    price:              ${b.price_cents} ${b.currency ?? ''}`);
    }
  }

  console.log('\n═══ All bookings for Test Property - Rentaro (any time) ═══\n');
  const allBookings = await sql`
    SELECT b.id, b.channex_booking_id, b.source, b.status, b.guest_name,
           b.checkin, b.checkout, b.created_at
    FROM bookings b
    JOIN properties p ON p.id = b.property_id
    WHERE p.name = 'Test Property - Rentaro'
    ORDER BY b.created_at DESC
    LIMIT 20
  `;
  if (allBookings.length === 0) {
    console.log('  (no bookings at all for Test Property - Rentaro)');
  } else {
    for (const b of allBookings) {
      console.log(`  ${b.created_at.toISOString()}  ${b.source}/${b.status}  ${b.guest_name}  ${b.checkin}→${b.checkout}  cbid=${b.channex_booking_id ?? 'NULL'}`);
    }
  }
} finally {
  await sql.end();
}
