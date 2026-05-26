import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);

try {
  const rows = await sql`
    SELECT ro.date, ro.rate_cents, ro.min_stay, ro.stop_sell, p.currency AS property_currency, p.name
    FROM rate_overrides ro
    JOIN properties p ON p.id = ro.property_id
    WHERE ro.date = '2026-10-10'::date
    ORDER BY p.name
  `;
  for (const r of rows) {
    console.log(`${r.name}  ${r.date}`);
    console.log(`  rate_cents = ${r.rate_cents}  (${r.property_currency ?? '—'})`);
    console.log(`  min_stay   = ${r.min_stay}`);
    console.log(`  stop_sell  = ${r.stop_sell}`);
  }
} finally {
  await sql.end();
}
