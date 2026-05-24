/**
 * Fetch and print Channex IDs (Property / Room Type / Rate Plan) for cert
 * submission. Channex requires that you use *their* API to look up the IDs
 * (rather than reading them out of our DB), so this script hits the live
 * Channex REST API and prints a copy-friendly UUID block per property.
 *
 * Run:  pnpm channex:ids
 *
 * Output shape (per property):
 *
 *   ┌─ Test Property - Rentaro  [USD]
 *   │  Property ID    7d3f…uuid
 *   │  Room Type ID   8a1b…uuid   "Standard Apartment"
 *   │  Rate Plan ID   c2e9…uuid   "Standard"  (USD · manual · per_room)
 *   └─
 *
 * Special handling:
 *   - Properties whose title contains "Test Property" are pulled to the top
 *     and tagged ★ — that's the cert property Channex wants the IDs for.
 *   - Pagination is followed transparently (50/page).
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

const channex = createChannexClient({ baseUrl: url, apiKey });

async function listAllProperties() {
  const out: Array<{ id: string; title: string; currency: string | null }> = [];
  let page = 1;
  while (true) {
    const r = await channex.properties.list({ page, limit: 50 });
    for (const p of r.data) {
      out.push({
        id: p.id,
        title: p.attributes?.title ?? '(untitled)',
        currency: p.attributes?.currency ?? null,
      });
    }
    if (r.data.length < 50) break;
    page += 1;
  }
  return out;
}

async function main() {
  console.log(`→ Channex base: ${url}`);
  console.log(`→ Auth key:     ${apiKey!.slice(0, 6)}…${apiKey!.slice(-4)}\n`);

  const properties = await listAllProperties();

  if (properties.length === 0) {
    console.log('ℹ️  No properties on this Channex account yet.');
    return;
  }

  // Pull "Test Property*" to the top — that's the cert one.
  const certFirst = [...properties].sort((a, b) => {
    const aT = /test property/i.test(a.title) ? 0 : 1;
    const bT = /test property/i.test(b.title) ? 0 : 1;
    return aT - bT || a.title.localeCompare(b.title);
  });

  for (const p of certFirst) {
    const isCert = /test property/i.test(p.title);
    const marker = isCert ? '★ ' : '  ';
    const cur = p.currency ? ` [${p.currency}]` : '';
    console.log(`┌─ ${marker}${p.title}${cur}`);
    console.log(`│  Property ID   ${p.id}`);

    const rooms = await channex.roomTypes.list({ propertyId: p.id, limit: 100 });
    if (rooms.data.length === 0) {
      console.log('│  (no room types)');
    } else {
      for (const r of rooms.data) {
        const title = r.attributes?.title ?? '(untitled)';
        console.log(`│  Room Type ID  ${r.id}   "${title}"`);
      }
    }

    const plans = await channex.ratePlans.list({ propertyId: p.id, limit: 100 });
    if (plans.data.length === 0) {
      console.log('│  (no rate plans)');
    } else {
      for (const rp of plans.data) {
        const title = rp.attributes?.title ?? '(untitled)';
        const cur = rp.attributes?.currency ?? '?';
        const sell = rp.attributes?.sell_mode ?? '?';
        const rate = rp.attributes?.rate_mode ?? '?';
        console.log(
          `│  Rate Plan ID  ${rp.id}   "${title}"  (${cur} · ${sell} · ${rate})`,
        );
      }
    }
    console.log('└─\n');
  }

  // Copy-paste block specifically for the cert form.
  const cert = certFirst.find((p) => /test property/i.test(p.title));
  if (cert) {
    const rooms = await channex.roomTypes.list({ propertyId: cert.id, limit: 100 });
    const plans = await channex.ratePlans.list({ propertyId: cert.id, limit: 100 });
    console.log('───────────── CERT SUBMISSION ─────────────');
    console.log(`Property:   ${cert.title}`);
    console.log(`Currency:   ${cert.currency ?? '(unset)'}`);
    console.log(`Property ID: ${cert.id}`);
    for (const r of rooms.data) {
      console.log(`Room Type ID: ${r.id}  (${r.attributes?.title ?? ''})`);
    }
    for (const rp of plans.data) {
      console.log(`Rate Plan ID: ${rp.id}  (${rp.attributes?.title ?? ''})`);
    }
    console.log('───────────────────────────────────────────');
  } else {
    console.log(
      'ℹ️  No property matching "Test Property*" found — create one with the ' +
        'cert template name to highlight it here.',
    );
  }
}

function fail(err: unknown) {
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
