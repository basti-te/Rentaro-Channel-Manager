/**
 * One-shot fix: bookings on an apartment without a Channex mapping should
 * not sit in `pending_sync` (the detail sheet shows "Sync ausstehend" then).
 * Bumps them to `confirmed`.
 *
 * Safe to re-run — only matches truly stuck rows.
 *
 *   pnpm --filter @cm/db fix-stuck-pending-sync
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import postgres from 'postgres';

config({ path: resolve(process.cwd(), '../../.env.local') });

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

try {
  const updated = await sql<Array<{ id: string }>>`
    UPDATE bookings AS b
       SET status = 'confirmed',
           last_sync_error = NULL,
           updated_at = NOW()
      FROM properties AS p
     WHERE b.property_id = p.id
       AND b.status = 'pending_sync'
       AND p.channex_property_ref IS NULL
     RETURNING b.id
  `;
  console.log(`✓ Backfilled ${updated.length} pending_sync booking(s) → confirmed`);
} finally {
  await sql.end();
}
