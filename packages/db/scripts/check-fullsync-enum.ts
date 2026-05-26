/**
 * Diagnostic: does the production `sync_job_type` enum include `full_sync`?
 * If not, migration 0014 hasn't run on this DB and the channex-full-sync
 * worker function dies at the final INSERT with `invalid input value for enum`.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);

try {
  const rows = await sql<{ enumlabel: string }[]>`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'sync_job_type'
    ORDER BY e.enumsortorder
  `;
  console.log('Enum values on sync_job_type:');
  for (const r of rows) console.log('  -', r.enumlabel);
  const has = rows.some((r) => r.enumlabel === 'full_sync');
  console.log(has ? '\n✓ full_sync IS present' : '\n✗ full_sync MISSING — migration 0014 not applied');
} finally {
  await sql.end();
}
