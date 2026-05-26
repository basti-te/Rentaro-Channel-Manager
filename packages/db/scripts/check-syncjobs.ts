import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);

try {
  const total = await sql`SELECT COUNT(*)::int AS n FROM sync_jobs`;
  console.log(`Total sync_jobs rows: ${total[0]!.n}`);

  const byType = await sql`
    SELECT type, COUNT(*)::int AS n
    FROM sync_jobs
    GROUP BY type
    ORDER BY n DESC
  `;
  console.log('\nBy type:');
  for (const r of byType) console.log(`  ${r.type}  ${r.n}`);

  const recent = await sql`
    SELECT id, type, status, property_id, started_at, result
    FROM sync_jobs
    ORDER BY scheduled_at DESC NULLS LAST
    LIMIT 5
  `;
  console.log('\nMost recent 5:');
  for (const r of recent) {
    console.log(`  ${r.started_at?.toISOString() ?? '—'}  ${r.type}  ${r.status}  property=${r.property_id ?? 'NULL'}`);
    if (r.result) console.log(`    result: ${JSON.stringify(r.result)}`);
  }
} finally {
  await sql.end();
}
