import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';

config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);

try {
  const t = await sql`SELECT count(*)::int AS c FROM tenants`;
  const g = await sql`SELECT name, color FROM property_groups ORDER BY sort_order`;
  const p = await sql`
    SELECT p.name, pg.name AS grp
    FROM properties p
    LEFT JOIN property_groups pg ON p.group_id = pg.id
    ORDER BY pg.sort_order, p.sort_order
  `;
  console.log(`Tenants: ${t[0]!.c}`);
  console.log(`Groups: ${g.map((r) => `${r.name} (${r.color})`).join(', ')}`);
  console.log(`Apartments (${p.length}):`);
  for (const r of p) console.log(`  ${r.grp} → ${r.name}`);
} finally {
  await sql.end();
}
