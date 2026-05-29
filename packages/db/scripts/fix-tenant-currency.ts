import postgres from 'postgres';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);
const T = 'ca769cf3-e22e-4148-9fb7-8b9a65c200ef';
const TARGET = process.argv[2] ?? 'EUR';

try {
  const [before] = await sql<{ default_currency: string }[]>`
    SELECT default_currency FROM tenants WHERE id = ${T}
  `;
  console.log(`Current tenant default_currency: ${before!.default_currency}`);
  if (before!.default_currency === TARGET) {
    console.log(`Already ${TARGET} — nothing to do.`);
    process.exit(0);
  }
  await sql`
    UPDATE tenants
    SET default_currency = ${TARGET}, updated_at = NOW()
    WHERE id = ${T}
  `;
  console.log(`✓ Updated to ${TARGET}`);
} finally {
  await sql.end();
}
