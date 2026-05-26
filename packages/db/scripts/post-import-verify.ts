import postgres from 'postgres';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);
const T = 'ca769cf3-e22e-4148-9fb7-8b9a65c200ef';

try {
  const total = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM bookings WHERE tenant_id = ${T}
  `;
  console.log(`Total bookings in CITY APARTMENTS ESSEN: ${total[0]!.n}\n`);

  const byStatus = await sql`
    SELECT source, status, COUNT(*)::int AS n
    FROM bookings
    WHERE tenant_id = ${T}
    GROUP BY source, status
    ORDER BY source, status
  `;
  console.log('By source/status:');
  for (const r of byStatus) {
    console.log(`  ${r.source.padEnd(15)} ${r.status.padEnd(15)} ${String(r.n).padStart(5)}`);
  }

  const byProperty = await sql`
    SELECT p.name, COUNT(b.id)::int AS n
    FROM properties p
    LEFT JOIN bookings b ON b.property_id = p.id
    WHERE p.tenant_id = ${T}
    GROUP BY p.name
    ORDER BY p.name
  `;
  console.log('\nPer apartment:');
  for (const r of byProperty) {
    console.log(`  ${r.name.padEnd(28)} ${String(r.n).padStart(5)}`);
  }

  const dateRange = await sql<{ min: string; max: string; future: number }[]>`
    SELECT
      MIN(checkin)::text AS min,
      MAX(checkin)::text AS max,
      COUNT(*) FILTER (WHERE checkin >= CURRENT_DATE)::int AS future
    FROM bookings WHERE tenant_id = ${T}
  `;
  const d = dateRange[0]!;
  console.log(`\nDate range:`);
  console.log(`  earliest check-in: ${d.min}`);
  console.log(`  latest check-in:   ${d.max}`);
  console.log(`  bookings ab heute: ${d.future}`);

  const ariPending = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM ari_pending
    WHERE tenant_id = ${T} AND flushed_at IS NULL
  `;
  console.log(`\nARI Outbox unflushed: ${ariPending[0]!.n}  (expected: 0)`);
} finally {
  await sql.end();
}
