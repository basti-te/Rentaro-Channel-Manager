/**
 * Quick sanity check after migration:
 *   - List all tables in public schema
 *   - Show RLS status for each
 *   - Count policies per table
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';

config({ path: resolve(process.cwd(), '../../.env.local') });

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const sql = postgres(url);

try {
  const rows = await sql<
    Array<{ table_name: string; rls_enabled: boolean; policy_count: bigint }>
  >`
    SELECT
      c.relname AS table_name,
      c.relrowsecurity AS rls_enabled,
      COUNT(p.polname) AS policy_count
    FROM pg_class c
    LEFT JOIN pg_policy p ON p.polrelid = c.oid
    WHERE c.relkind = 'r'
      AND c.relnamespace = 'public'::regnamespace
    GROUP BY c.relname, c.relrowsecurity
    ORDER BY c.relname;
  `;

  console.log(`\n${rows.length} tables in public schema:\n`);
  console.log('Table'.padEnd(30) + 'RLS'.padEnd(8) + 'Policies');
  console.log('─'.repeat(50));
  for (const r of rows) {
    const rls = r.rls_enabled ? '✓' : '✗';
    console.log(
      r.table_name.padEnd(30) + rls.padEnd(8) + String(r.policy_count),
    );
  }

  // Sanity: the auth trigger + updated_at triggers
  const triggers = await sql<Array<{ trigger_name: string; event_object_table: string }>>`
    SELECT trigger_name, event_object_table
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
       OR (trigger_schema = 'auth' AND trigger_name = 'on_auth_user_created')
    ORDER BY event_object_table, trigger_name;
  `;
  console.log(`\n${triggers.length} triggers:`);
  for (const t of triggers) {
    console.log(`  ${t.event_object_table} → ${t.trigger_name}`);
  }
} finally {
  await sql.end();
}
