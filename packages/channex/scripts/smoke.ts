/**
 * Smoke test for the Channex client — reads CHANNEX_API_URL and CHANNEX_API_KEY
 * from the monorepo-root .env.local and hits the sandbox.
 *
 * Run:  pnpm --filter @cm/channex smoke
 *
 * What it does:
 *   1. ping (GET /properties with limit=1) → confirms auth + connectivity
 *   2. lists properties and prints their IDs (so you can copy IDs for testing)
 *   3. lists room types + rate plans for the first property if one exists
 *   4. lists webhooks
 *
 * It does NOT push availability, create bookings, or create webhooks —
 * those run in Phase 5/6 once we know exact target IDs.
 */

import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createChannexClient, ChannexError } from '../src';

config({ path: resolve(process.cwd(), '../../.env.local') });

const url = process.env.CHANNEX_API_URL;
const apiKey = process.env.CHANNEX_API_KEY;

if (!url || !apiKey) {
  console.error('✗ CHANNEX_API_URL and CHANNEX_API_KEY must be set in .env.local');
  process.exit(1);
}

console.log(`→ Channex base: ${url}`);
console.log(`→ Auth key:     ${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`);

const channex = createChannexClient({ baseUrl: url, apiKey });

async function main() {
  // 1. Ping
  process.stdout.write('1. Ping (GET /properties)... ');
  try {
    const ping = await channex.ping();
    console.log(`✓ ${ping.count} total`);
  } catch (err) {
    fail(err);
  }

  // 2. List properties
  process.stdout.write('2. List properties... ');
  const props = await channex.properties.list({ limit: 25 });
  console.log(`✓ ${props.data.length} returned`);
  for (const p of props.data) {
    console.log(`     - ${p.id}  ${p.attributes?.title ?? '(untitled)'}`);
  }

  if (props.data.length === 0) {
    console.log(
      '\nℹ️  No properties yet. Create one in the Channex sandbox UI\n' +
        '   (https://staging.channex.io) then re-run this script.',
    );
    return;
  }

  // 3. Room types + rate plans for the first property
  const firstProp = props.data[0]!;
  console.log(`\n3. Room types for property ${firstProp.id}...`);
  const rooms = await channex.roomTypes.list({ propertyId: firstProp.id });
  for (const r of rooms.data) {
    console.log(`     - ${r.id}  ${r.attributes?.title ?? '(untitled)'}`);
  }

  console.log(`\n4. Rate plans for property ${firstProp.id}...`);
  const plans = await channex.ratePlans.list({ propertyId: firstProp.id });
  for (const rp of plans.data) {
    console.log(
      `     - ${rp.id}  ${rp.attributes?.title ?? '(untitled)'}` +
        `  (${rp.attributes?.currency ?? '?'} · ${rp.attributes?.sell_mode ?? '?'} · ${rp.attributes?.rate_mode ?? '?'})`,
    );
  }

  // 5. Webhooks
  console.log('\n5. Webhooks...');
  const hooks = await channex.webhooks.list();
  if (hooks.length === 0) {
    console.log('     (none configured)');
  } else {
    for (const w of hooks) {
      console.log(
        `     - ${w.id}  ${w.attributes?.callback_url}  ` +
          `events=${w.attributes?.event_mask}  active=${w.attributes?.is_active}`,
      );
    }
  }

  console.log('\n✓ All checks passed.');
}

function fail(err: unknown) {
  console.log('✗');
  if (err instanceof ChannexError) {
    console.error(`\n${err.name}: ${err.message}`);
    if (err.status) console.error(`  status: ${err.status}`);
    if (err.code) console.error(`  code:   ${err.code}`);
    if (err.path) console.error(`  path:   ${err.path}`);
    if (err.payload) {
      console.error(`  payload: ${JSON.stringify(err.payload).slice(0, 400)}`);
    }
  } else {
    console.error('\n', err);
  }
  process.exit(1);
}

main().catch(fail);
