import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);

try {
  const tenants = await sql`
    SELECT id, name, billing_exempt
    FROM tenants
    WHERE name ILIKE '%essen%' OR name ILIKE '%city%'
  `;
  console.log('Candidate tenants:');
  for (const t of tenants) console.log(`  ${t.id}  ${t.name}  exempt=${t.billing_exempt}`);

  if (tenants.length > 0) {
    const tid = tenants[0]!.id;
    const props = await sql`
      SELECT id, name, active FROM properties
      WHERE tenant_id = ${tid}
      ORDER BY name
    `;
    console.log(`\nProperties in tenant ${tenants[0]!.name} (${props.length}):`);
    for (const p of props) console.log(`  ${p.id}  ${p.name}  active=${p.active}`);

    const counts = await sql`
      SELECT source, status, COUNT(*)::int AS n
      FROM bookings
      WHERE tenant_id = ${tid}
      GROUP BY source, status
      ORDER BY source, status
    `;
    console.log(`\nExisting bookings in this tenant:`);
    for (const c of counts) console.log(`  ${c.source.padEnd(15)} ${c.status.padEnd(20)} ${c.n}`);
  }
} finally {
  await sql.end();
}
