/**
 * Diagnostic: peek at unacknowledged bookings sitting in Channex's
 * /booking_revisions/feed waiting for our worker to claim them.
 *
 * Run:  pnpm channex:check-feed
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createChannexClient } from '../src';

config({ path: resolve(process.cwd(), '../../.env.local') });

const channex = createChannexClient({
  baseUrl: process.env.CHANNEX_API_URL!,
  apiKey: process.env.CHANNEX_API_KEY!,
});

const feed = await channex.bookings.feed.fetch({ limit: 20 });

console.log(`Unacknowledged revisions in feed: ${feed.length}\n`);
for (const rev of feed) {
  const a = rev.attributes ?? {};
  console.log(`▸ revision_id   ${rev.id}`);
  console.log(`  booking_id    ${a.booking_id ?? a.id ?? '—'}`);
  console.log(`  ota_name      ${a.ota_name ?? '—'}`);
  console.log(`  ota_resv_id   ${a.ota_reservation_code ?? '—'}`);
  console.log(`  status        ${a.status ?? '—'}`);
  console.log(`  guest         ${a.customer?.name ?? a.customer?.surname ?? '—'}`);
  console.log(`  checkin       ${a.arrival_date ?? '—'} → ${a.departure_date ?? '—'}`);
  console.log(`  property_id   ${a.property_id ?? '—'}`);
  console.log(`  acked_status  ${a.acknowledge_status ?? '—'}`);
  console.log('');
}
