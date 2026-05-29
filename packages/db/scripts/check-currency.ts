import postgres from 'postgres';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);
const T = 'ca769cf3-e22e-4148-9fb7-8b9a65c200ef';

try {
  const t = await sql`SELECT name, default_currency FROM tenants WHERE id = ${T}`;
  console.log(`Tenant default currency: ${t[0]!.default_currency}\n`);

  const props = await sql`
    SELECT name, currency
    FROM properties
    WHERE tenant_id = ${T}
    ORDER BY name
  `;
  console.log(`Per-property currency overrides:`);
  for (const p of props) {
    console.log(`  ${p.name.padEnd(28)} ${p.currency ?? '(inherits tenant)'}`);
  }
} finally {
  await sql.end();
}
