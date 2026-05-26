/**
 * Wipe all non-imported bookings from a tenant. Used before a clean
 * Guesty bulk-import to remove dev-time test bookings.
 *
 *   pnpm db:delete-test-bookings [--apply] [--tenant=<uuid>]
 *
 * Default mode is dry-run — shows what would be deleted but writes nothing.
 * Pass --apply to actually delete. Safe: scopes only to bookings with
 * external_id IS NULL within the given tenant, so already-imported rows
 * (external_id = 'guesty:…') are untouched.
 *
 * Schema cascade rules clean up child tables (cleaning_jobs, messages …)
 * automatically. The Channex outbox (ari_pending) is also wiped clean
 * because keeping outbox entries that reference deleted bookings would
 * pile errors into the next ari-flush.
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
  console.log(`Mode:   ${apply ? 'APPLY (will delete)' : 'DRY-RUN (no writes)'}`);
  console.log(`Tenant: ${tenants[0]!.name} (${TENANT_ID})\n`);

  const counts = await sql`
    SELECT source, status, COUNT(*)::int AS n
    FROM bookings
    WHERE tenant_id = ${TENANT_ID}
      AND external_id IS NULL
    GROUP BY source, status
    ORDER BY source, status
  `;
  if (counts.length === 0) {
    console.log('Nothing to delete — no bookings without external_id in this tenant.');
    process.exit(0);
  }

  let total = 0;
  console.log('Bookings that will be deleted:');
  for (const c of counts) {
    console.log(`  ${c.source.padEnd(15)} ${c.status.padEnd(15)} ${c.n}`);
    total += c.n;
  }
  console.log(`  ${'─'.repeat(31)}`);
  console.log(`  Total                          ${total}\n`);

  // Pending outbox entries that reference these bookings (or any of them)
  // need to be cleaned out so the next ari-flush doesn't choke on missing
  // booking_ids referenced from their resolve step.
  const pending = await sql<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM ari_pending
    WHERE tenant_id = ${TENANT_ID}
      AND flushed_at IS NULL
  `;
  console.log(`ARI outbox unflushed entries to wipe: ${pending[0]!.n}\n`);

  if (!apply) {
    console.log('[DRY-RUN] No changes written. Re-run with --apply to delete.');
    process.exit(0);
  }

  // Real run — single transaction
  const result = await sql.begin(async (tx) => {
    await tx`
      DELETE FROM ari_pending
      WHERE tenant_id = ${TENANT_ID}
        AND flushed_at IS NULL
    `;
    const deleted = await tx`
      DELETE FROM bookings
      WHERE tenant_id = ${TENANT_ID}
        AND external_id IS NULL
      RETURNING id
    `;
    return deleted.length;
  });
  console.log(`✓ Deleted ${result} bookings.`);
  console.log(`✓ Wiped pending ARI outbox.`);
  console.log(`\nReady for Guesty bulk-import — run:`);
  console.log(`  pnpm db:import-guesty "<path/to/export.xls>"`);
} finally {
  await sql.end();
}
