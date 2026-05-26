/**
 * One-off setup: register the global booking-events webhook in Channex
 * pointing at our Railway worker. After this runs once per Channex account,
 * Channex sends every booking_new / booking_modification / booking_cancellation
 * to `/api/webhooks/channex/<secret>` → the worker triggers `ingest-bookings`.
 *
 * Run:  pnpm channex:register-webhook
 *
 * Env vars consumed:
 *   - CHANNEX_API_URL, CHANNEX_API_KEY  (sandbox creds)
 *   - CHANNEX_WEBHOOK_SECRET            (path segment the worker validates)
 *   - WORKER_PUBLIC_BASE_URL            (override; defaults to Railway URL)
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createChannexClient, BOOKING_EVENTS } from '../src';

config({ path: resolve(process.cwd(), '../../.env.local') });

const url = process.env.CHANNEX_API_URL!;
const apiKey = process.env.CHANNEX_API_KEY!;
const secret = process.env.CHANNEX_WEBHOOK_SECRET!;
const workerBase =
  process.env.WORKER_PUBLIC_BASE_URL ?? 'https://cmworker-production.up.railway.app';

if (!url || !apiKey || !secret) {
  console.error('Missing CHANNEX_API_URL / CHANNEX_API_KEY / CHANNEX_WEBHOOK_SECRET.');
  process.exit(1);
}

const callbackUrl = `${workerBase}/api/webhooks/channex/${secret}`;
const eventMask = BOOKING_EVENTS.join(',');

const channex = createChannexClient({ baseUrl: url, apiKey });

const existing = await channex.webhooks.list();
console.log(`Existing webhooks: ${existing.length}`);
for (const w of existing) {
  console.log(`  - ${w.id}  ${w.attributes?.callback_url}  events=${w.attributes?.event_mask}  active=${w.attributes?.is_active}`);
}

// Idempotency: if a webhook already points to the same callback URL, skip create.
const dup = existing.find((w) => w.attributes?.callback_url === callbackUrl);
if (dup) {
  console.log(`\n✓ Webhook already registered → ${dup.id}`);
  console.log(`  callback: ${callbackUrl}`);
  console.log(`  events:   ${dup.attributes?.event_mask}`);
  console.log(`  active:   ${dup.attributes?.is_active}`);
  process.exit(0);
}

console.log(`\nCreating webhook → ${callbackUrl}\n  events: ${eventMask}\n`);
const created = await channex.webhooks.create({
  callback_url: callbackUrl,
  event_mask: eventMask,
  property_id: null,
  is_global: true,
  is_active: true,
  send_data: true,
});

console.log(`✓ Webhook created`);
console.log(`  id:       ${created.id}`);
console.log(`  callback: ${created.attributes?.callback_url}`);
console.log(`  events:   ${created.attributes?.event_mask}`);
console.log(`  active:   ${created.attributes?.is_active}`);
