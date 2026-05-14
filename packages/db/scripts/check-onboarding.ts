/**
 * Show which apartments are connected to Channex.
 *   pnpm --filter @cm/db check-onboarding
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';

config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

try {
  const rows = await sql<
    Array<{
      name: string;
      channex_property_id: string | null;
      channex_room_type_id: string | null;
      channex_rate_plan_id: string | null;
    }>
  >`
    SELECT
      p.name,
      cp.channex_property_id,
      cp.channex_room_type_id,
      cp.channex_rate_plan_id
    FROM properties p
    LEFT JOIN channex_properties cp ON cp.id = p.channex_property_ref
    ORDER BY p.sort_order, p.name
  `;

  const connected = rows.filter((r) => r.channex_property_id != null);
  const unconnected = rows.filter((r) => r.channex_property_id == null);
  console.log(`Connected to Channex: ${connected.length}`);
  for (const r of connected) {
    console.log(`  ${r.name}  →  prop=${r.channex_property_id?.slice(0, 8)}…  rt=${r.channex_room_type_id?.slice(0, 8)}…  rp=${r.channex_rate_plan_id?.slice(0, 8)}…`);
  }
  console.log(`\nNot connected: ${unconnected.length}`);
  for (const r of unconnected) console.log(`  ${r.name}`);
} finally {
  await sql.end();
}
