/**
 * Diagnostic: print the full Channex mapping for any property whose name
 * matches "Test Property*". Shows what loadMappings() would see.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';
config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!);

try {
  const rows = await sql`
    SELECT
      p.id                                AS property_id,
      p.name,
      p.tenant_id,
      p.currency,
      p.active,
      p.channex_property_ref,
      cp.id                               AS cp_row_id,
      cp.channex_property_id,
      cp.channex_room_type_id,
      cp.channex_rate_plan_id
    FROM properties p
    LEFT JOIN channex_properties cp ON cp.id = p.channex_property_ref
    WHERE p.name ILIKE 'Test Property%'
    ORDER BY p.created_at DESC
  `;
  console.log(`Found ${rows.length} matching properties:\n`);
  for (const r of rows) {
    console.log(`▸ ${r.name}`);
    console.log(`  property.id          ${r.property_id}`);
    console.log(`  tenant_id            ${r.tenant_id}`);
    console.log(`  currency / active    ${r.currency ?? '(inherit)'} / ${r.active}`);
    console.log(`  channex_property_ref ${r.channex_property_ref ?? '— NOT CONNECTED'}`);
    if (r.channex_property_ref) {
      console.log(`  cp_row_id            ${r.cp_row_id ?? '(orphan ref! row missing)'}`);
      console.log(`  channex_property_id  ${r.channex_property_id ?? 'NULL'}`);
      console.log(`  channex_room_type_id ${r.channex_room_type_id ?? 'NULL'}`);
      console.log(`  channex_rate_plan_id ${r.channex_rate_plan_id ?? 'NULL'}`);
    }
    console.log('');
  }
} finally {
  await sql.end();
}
