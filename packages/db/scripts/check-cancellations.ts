import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);

try {
  const rows = await sql`
    SELECT b.id, b.channex_booking_id, b.source, b.status, b.guest_name,
           b.checkin, b.checkout, b.updated_at, b.created_at, p.name AS property
    FROM bookings b
    LEFT JOIN properties p ON p.id = b.property_id
    WHERE b.channex_booking_id IS NOT NULL
    ORDER BY b.updated_at DESC NULLS LAST, b.created_at DESC
    LIMIT 10
  `;
  console.log('Channex-sourced bookings, most recently updated first:\n');
  for (const r of rows) {
    console.log(`  ${(r.updated_at ?? r.created_at).toISOString()}  ${r.source}/${r.status}  ${r.guest_name}`);
    console.log(`    range:              ${r.checkin} → ${r.checkout}`);
    console.log(`    rentaro booking_id: ${r.id}`);
    console.log(`    channex_booking_id: ${r.channex_booking_id}`);
    console.log('');
  }
} finally {
  await sql.end();
}
