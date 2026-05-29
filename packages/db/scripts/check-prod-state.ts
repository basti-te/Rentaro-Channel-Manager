import postgres from 'postgres';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);
const T = 'ca769cf3-e22e-4148-9fb7-8b9a65c200ef';

try {
  const r = await sql`
    SELECT p.name, p.active, p.channex_property_ref IS NOT NULL AS connected,
           cp.channex_property_id
    FROM properties p
    LEFT JOIN channex_properties cp ON cp.id = p.channex_property_ref
    WHERE p.tenant_id = ${T}
    ORDER BY p.name
  `;
  console.log(`${r.length} apartments in CITY APARTMENTS ESSEN tenant:\n`);
  for (const row of r) {
    const status = row.connected
      ? `CONNECTED → channex=${row.channex_property_id ?? 'orphan'}`
      : '— not connected';
    const active = row.active ? '' : ' (inactive)';
    console.log(`  ${row.name.padEnd(28)} ${status}${active}`);
  }
} finally {
  await sql.end();
}
