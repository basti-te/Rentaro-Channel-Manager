/**
 * For each given Channex booking_id, list every revision (create / modify /
 * cancel) with its revision_id + status. Useful when Channex' cert form
 * asks for individual revision UUIDs.
 *
 * Run:  pnpm channex:revisions <booking_id> [<booking_id> ...]
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createChannexClient } from '../src';

config({ path: resolve(process.cwd(), '../../.env.local') });

const channex = createChannexClient({
  baseUrl: process.env.CHANNEX_API_URL!,
  apiKey: process.env.CHANNEX_API_KEY!,
});

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('Usage: pnpm channex:revisions <booking_id> [<booking_id> ...]');
  process.exit(1);
}

interface Rev {
  id: string;
  attributes?: {
    booking_id?: string;
    status?: string;
    is_cancellation?: boolean;
    is_modification?: boolean;
    inserted_at?: string;
    updated_at?: string;
    acknowledge_status?: string;
  };
}

for (const bookingId of ids) {
  console.log(`\n═══ booking_id ${bookingId} ═══`);
  const raw = await channex.http.request<{ data?: Rev[] }>({
    method: 'GET',
    path: '/booking_revisions',
    query: { 'filter[booking_id]': bookingId, 'pagination[limit]': 50 },
  });

  const revs = raw?.data ?? [];
  if (revs.length === 0) {
    console.log('  (no revisions found)');
    continue;
  }

  // Sort oldest-first so create → modify → cancel reads top to bottom
  revs.sort((a, b) =>
    (a.attributes?.inserted_at ?? '').localeCompare(b.attributes?.inserted_at ?? ''),
  );

  for (const r of revs) {
    const a = r.attributes ?? {};
    const kind = a.is_cancellation
      ? 'cancel'
      : a.is_modification
        ? 'modify'
        : 'create';
    console.log(`  ▸ ${kind.padEnd(7)}  ${r.id}`);
    console.log(`      status:       ${a.status ?? '—'}`);
    console.log(`      inserted_at:  ${a.inserted_at ?? '—'}`);
    console.log(`      acked:        ${a.acknowledge_status ?? '—'}`);
  }
}
