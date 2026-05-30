/**
 * Diagnostic (READ-ONLY): list reviews from the Channex account that
 * `.env.local` currently targets. Used to verify the one unproven Phase B
 * assumption — that a `review_id` actually surfaces in GET /reviews after a
 * checkout — BEFORE we lock the outbound_reviews schema.
 *
 * What to look for: Airbnb reviews that carry a resolvable review_id. Those
 * are the rows POST /reviews/:id/guest_review can act on. The trailing
 * summary counts them.
 *
 * Run:  pnpm channex:reviews
 *
 * This makes only GET requests. It never posts, replies, or mutates.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createChannexClient, ChannexError, reviewId, type Review } from '../src';

config({ path: resolve(process.cwd(), '../../.env.local') });

const url = process.env.CHANNEX_API_URL;
const apiKey = process.env.CHANNEX_API_KEY;

if (!url || !apiKey) {
  console.error('✗ CHANNEX_API_URL and CHANNEX_API_KEY must be set in .env.local');
  process.exit(1);
}

/** Best-effort environment label from the base URL. */
function envLabel(u: string): string {
  if (/staging\.channex\.io/i.test(u)) return 'STAGING';
  if (/app\.channex\.io|(^|[/.])channex\.io/i.test(u)) return 'PRODUCTION';
  return 'UNKNOWN';
}

/** Safely read relationships.<rel>.data.id without trusting the shape. */
function relId(r: Review, rel: string): string | undefined {
  const node = (r.relationships as Record<string, unknown> | null | undefined)?.[rel];
  const data = (node as { data?: { id?: string } } | undefined)?.data;
  return data?.id;
}

function scoreSummary(r: Review): string {
  const s = r.attributes.scores;
  if (!s || s.length === 0) return '—';
  return s.map((x) => `${x.category}=${x.score ?? '?'}`).join(', ');
}

const channex = createChannexClient({ baseUrl: url, apiKey });

async function main() {
  const label = envLabel(url!);
  console.log(`→ Channex base: ${url}`);
  console.log(`→ Auth key:     ${apiKey!.slice(0, 6)}…${apiKey!.slice(-4)}`);
  console.log(`→ Environment:  ${label}`);
  if (label === 'PRODUCTION') {
    console.log('⚠️  This is the PRODUCTION account. (Read-only listing — safe, but be aware.)');
  } else if (label !== 'STAGING') {
    console.log('⚠️  Could not classify this base URL as staging or production.');
  }
  console.log('');

  const { data, meta } = await channex.reviews.list({ limit: 100 });

  if (data.length === 0) {
    console.log('ℹ️  No reviews on this account.');
    console.log(
      '   Assumption #2 (a review_id appears after checkout) cannot be confirmed yet.\n' +
        '   To produce one on staging you need: an Airbnb channel mapped, a\n' +
        '   reservation that has checked out, and the "Messages & Reviews" app\n' +
        '   installed on the property (else GET /reviews itself 403s).',
    );
    return;
  }

  let withId = 0;
  let airbnb = 0;
  let airbnbWithId = 0;
  let hidden = 0;
  let replied = 0;
  const byOta = new Map<string, number>();

  for (const r of data) {
    const a = r.attributes;
    const id = reviewId(r);
    const ota = a.ota ?? '—';
    const isAirbnb = /airbnb/i.test(ota);
    if (id) withId += 1;
    if (isAirbnb) airbnb += 1;
    if (isAirbnb && id) airbnbWithId += 1;
    if (a.is_hidden) hidden += 1;
    if (a.is_replied) replied += 1;
    byOta.set(ota, (byOta.get(ota) ?? 0) + 1);

    console.log(`▸ review_id     ${id ?? '— (none — cannot guest_review)'}`);
    console.log(`  ota           ${ota}`);
    console.log(`  ota_resv_id   ${a.ota_reservation_id ?? '—'}`);
    console.log(`  guest         ${a.guest_name || '—'}`);
    console.log(`  overall_score ${a.overall_score ?? '—'}`);
    console.log(`  scores        ${scoreSummary(r)}`);
    console.log(`  is_hidden     ${a.is_hidden ?? '—'}    is_replied  ${a.is_replied ?? '—'}`);
    console.log(`  received_at   ${a.received_at ?? '—'}`);
    console.log(`  booking_id    ${relId(r, 'booking') ?? '—'}`);
    console.log(`  property_id   ${relId(r, 'property') ?? '—'}`);
    console.log('');
  }

  const total = meta?.total ?? data.length;
  console.log('───────────── SUMMARY ─────────────');
  console.log(`fetched          ${data.length}${total > data.length ? ` of ${total} (more pages exist)` : ''}`);
  console.log(`with review_id   ${withId}`);
  console.log(`by ota           ${[...byOta].map(([k, v]) => `${k}:${v}`).join('  ') || '—'}`);
  console.log(`airbnb           ${airbnb}  (with review_id: ${airbnbWithId} ← Phase B targets)`);
  console.log(`is_hidden        ${hidden}`);
  console.log(`is_replied       ${replied}`);
  console.log('────────────────────────────────────');
  if (airbnbWithId > 0) {
    console.log('✓ Assumption #2 holds: at least one Airbnb review exposes a review_id.');
  } else if (airbnb > 0) {
    console.log('△ Airbnb reviews exist but none expose a review_id yet (likely still hidden / window not open).');
  } else {
    console.log('△ No Airbnb reviews on this account — cannot confirm assumption #2 from Airbnb data.');
  }
}

function fail(err: unknown) {
  if (err instanceof ChannexError) {
    console.error(`\n${err.name}: ${err.message}`);
    if (err.status) console.error(`  status: ${err.status}`);
    if (err.code) console.error(`  code:   ${err.code}`);
    if (err.path) console.error(`  path:   ${err.path}`);
    if (err.status === 403) {
      console.error(
        '  hint:   403 usually means the "Messages & Reviews" app is not installed\n' +
          '          on the property in app.channex.io.',
      );
    }
    if (err.payload) {
      console.error(`  payload: ${JSON.stringify(err.payload).slice(0, 400)}`);
    }
  } else {
    console.error('\n', err);
  }
  process.exit(1);
}

main().catch(fail);
