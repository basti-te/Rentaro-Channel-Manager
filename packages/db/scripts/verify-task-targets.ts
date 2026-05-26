/**
 * Diagnostic: for a list of task IDs from sync_jobs.result, show which
 * Channex Property the job actually targeted. Helps explain why a cert
 * reviewer might not "see" a task in their dashboard — most likely the
 * task fired against an old/orphan Channex property that was later
 * superseded by a fresh re-onboarded one.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);

const taskIds = [
  // Case 9 single-day block
  'f363a297-c382-4b27-aa1c-6eb2f88740c9',
  // Case 10 multi-day block
  '69cbbbc1-00b8-4373-92c1-82f1c0957d2a',
  // Full Sync availability (worked, reviewer sees it)
  'f2dc5f8e-9bb5-4099-a94d-fb68cdc639a8',
];

try {
  for (const t of taskIds) {
    const rows = await sql`
      SELECT s.id, s.type, s.status, s.scheduled_at, s.property_id,
             p.name AS property_name, cp.channex_property_id
      FROM sync_jobs s
      LEFT JOIN properties p ON p.id = s.property_id
      LEFT JOIN channex_properties cp ON cp.id = p.channex_property_ref
      WHERE s.result::text LIKE ${'%' + t + '%'}
      LIMIT 1
    `;
    if (rows.length === 0) {
      console.log(`task ${t}\n  → no matching sync_job found\n`);
      continue;
    }
    const r = rows[0]!;
    console.log(`task ${t}`);
    console.log(`  type:                ${r.type}  (${r.status})`);
    console.log(`  scheduled_at:        ${r.scheduled_at?.toISOString()}`);
    console.log(`  our property_id:     ${r.property_id ?? '— (NULL: property was deleted)'}`);
    console.log(`  property name:       ${r.property_name ?? '—'}`);
    console.log(`  channex_property_id: ${r.channex_property_id ?? '— (orphan/deleted)'}`);
    console.log('');
  }
} finally {
  await sql.end();
}
