/**
 * Disconnect every apartment of a tenant from its Channex mapping.
 * Used when switching environments (Staging → Production) so the
 * "Verbinden" button reappears for each apartment and a fresh onboard
 * creates Production-side Channex Property/Room Type/Rate Plan objects.
 *
 *   pnpm db:disconnect-channex [--apply] [--tenant=<uuid>]
 *
 * Default mode is dry-run. The operation is safe:
 *   1. UPDATE properties SET channex_property_ref = NULL  (no cascade risk)
 *   2. DELETE FROM channex_properties WHERE tenant = X    (now-orphan rows)
 *
 * Bookings, rate overrides, blocks, calendar history — all preserved.
 * Only the abstract Channex-side mapping is removed.
 *
 * After running:
 *   - Apartments page shows "Verbinden" for every row again
 *   - Click "Verbinden" per apartment → creates fresh Channex Production
 *     Property/Room Type/Rate Plan via API
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';
config({ path: resolve(process.cwd(), '../../.env.local') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const tenantArg = args.find((a) => a.startsWith('--tenant='))?.split('=')[1];
const TENANT_ID = tenantArg ?? 'ca769cf3-e22e-4148-9fb7-8b9a65c200ef';

const sql = postgres(process.env.DATABASE_URL!);

try {
  const tenants = await sql`SELECT name FROM tenants WHERE id = ${TENANT_ID}`;
  if (tenants.length === 0) {
    console.error(`Tenant ${TENANT_ID} not found.`);
    process.exit(1);
  }
  console.log(`Mode:   ${apply ? 'APPLY (will disconnect)' : 'DRY-RUN (no writes)'}`);
  console.log(`Tenant: ${tenants[0]!.name}\n`);

  const props = await sql`
    SELECT p.name, cp.channex_property_id
    FROM properties p
    LEFT JOIN channex_properties cp ON cp.id = p.channex_property_ref
    WHERE p.tenant_id = ${TENANT_ID}
      AND p.channex_property_ref IS NOT NULL
    ORDER BY p.name
  `;

  if (props.length === 0) {
    console.log('Nothing to disconnect — no apartments currently have a Channex ref.');
    process.exit(0);
  }

  console.log(`Apartments that will be disconnected (${props.length}):`);
  for (const p of props) {
    console.log(`  ${p.name.padEnd(28)} channex=${p.channex_property_id ?? '—'}`);
  }
  console.log('');

  if (!apply) {
    console.log('[DRY-RUN] No changes written. Re-run with --apply to disconnect.');
    process.exit(0);
  }

  const result = await sql.begin(async (tx) => {
    // 1. Null out the parent's reference (no FK cascade risk)
    const nulledRows = await tx`
      UPDATE properties
      SET channex_property_ref = NULL, updated_at = NOW()
      WHERE tenant_id = ${TENANT_ID}
        AND channex_property_ref IS NOT NULL
      RETURNING id
    `;
    // 2. Delete the now-orphan channex_properties rows
    const deletedRows = await tx`
      DELETE FROM channex_properties
      WHERE tenant_id = ${TENANT_ID}
      RETURNING id
    `;
    return { nulled: nulledRows.length, deleted: deletedRows.length };
  });

  console.log(`✓ Disconnected ${result.nulled} apartments.`);
  console.log(`✓ Removed ${result.deleted} stale channex_properties rows.`);
  console.log(`\nNext: open the Apartments page in Rentaro → click "Verbinden"`);
  console.log(`for each apartment. That creates fresh Production-side Channex`);
  console.log(`Property / Room Type / Rate Plan objects.`);
} finally {
  await sql.end();
}
