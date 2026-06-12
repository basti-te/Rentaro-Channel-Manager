/**
 * Ingest OTA guest-message threads (Airbnb / Booking.com) from Channex into
 * `guest_messages`, so the in-app inbox + AI assistant can read them.
 *
 * Triggers:
 *   - `guest-messages/sync` event (from the Channex `message` webhook, with a
 *     booking hint) → sync that one booking's thread.
 *   - cron safety net → re-sync the current active window (guests staying now or
 *     arriving within a week, where chat actually happens).
 *
 * Per the architecture rule, the webhook is only a trigger: we always re-fetch
 * the thread via the API. Dedup is the unique index on channex_message_id.
 * Each newly-ingested INBOUND message emits `guest-messages/incoming` for the
 * AI step (Phase 3).
 */
import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { bookings, createDb, guestMessages, type Database } from '@cm/db';
import { createChannexClient, type ChannexMessage } from '@cm/channex';
import { env } from '../../env';
import { inngest } from '../client';

const ACTIVE_STATUSES = ['confirmed', 'pending_sync', 'synced', 'sync_failed'] as const;
const MAX_BOOKINGS_PER_RUN = 300;

export interface GuestMsgSyncResult {
  bookings: number;
  inserted: number;
  errors: number;
}

type Target = { id: string; tenantId: string; channexBookingId: string };

/** Channex `sender` → our (direction, sender). 'property'/'host' = us. */
function classify(sender: string | null | undefined): {
  direction: 'inbound' | 'outbound';
  sender: 'guest' | 'host';
} {
  const s = (sender ?? '').toLowerCase();
  const isHost = s === 'property' || s === 'host' || s === 'manager' || s === 'hotel';
  return { direction: isHost ? 'outbound' : 'inbound', sender: isHost ? 'host' : 'guest' };
}

/** Channex `inserted_at` is tz-naive → treat as UTC. */
function parseTs(s: string | null | undefined): Date | null {
  if (!s) return null;
  const iso = s.includes('T') && !/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? `${s}Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function syncBooking(
  db: Database,
  channex: ReturnType<typeof createChannexClient>,
  b: Target,
): Promise<number> {
  let msgs: ChannexMessage[];
  try {
    msgs = await channex.bookings.listMessages(b.channexBookingId);
  } catch {
    return 0; // thread not available (app not installed, channel w/o messaging) — skip
  }
  let inserted = 0;
  for (const m of msgs) {
    const body = m.attributes?.message;
    if (!body) continue;
    const { direction, sender } = classify(m.attributes?.sender);
    const rows = await db
      .insert(guestMessages)
      .values({
        tenantId: b.tenantId,
        bookingId: b.id,
        channexMessageId: m.id,
        direction,
        sender,
        body,
        status: direction === 'inbound' ? 'received' : 'sent',
        otaCreatedAt: parseTs(m.attributes?.inserted_at),
      })
      .onConflictDoNothing({ target: guestMessages.channexMessageId })
      .returning({ id: guestMessages.id });
    if (rows.length === 0) continue; // already ingested
    inserted++;
    if (direction === 'inbound') {
      await inngest.send({
        name: 'guest-messages/incoming',
        data: { guestMessageId: rows[0]!.id, bookingId: b.id, tenantId: b.tenantId },
      });
    }
  }
  return inserted;
}

async function sync(hintChannexBookingId?: string): Promise<GuestMsgSyncResult> {
  const db = createDb(env.DATABASE_URL);
  const channex = createChannexClient({
    baseUrl: env.CHANNEX_API_URL,
    apiKey: env.CHANNEX_API_KEY,
  });

  const cols = {
    id: bookings.id,
    tenantId: bookings.tenantId,
    channexBookingId: bookings.channexBookingId,
  };

  let rows: { id: string; tenantId: string; channexBookingId: string | null }[];
  if (hintChannexBookingId) {
    rows = await db
      .select(cols)
      .from(bookings)
      .where(eq(bookings.channexBookingId, hintChannexBookingId))
      .limit(1);
  } else {
    // Active window: guests staying now or arriving within a week.
    // Inbox safety net: recently-departed (post-stay messages) through the next
    // fortnight. Far-future + real-time threads come via the `message` webhook.
    const floor = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    rows = await db
      .select(cols)
      .from(bookings)
      .where(
        and(
          isNotNull(bookings.channexBookingId),
          inArray(bookings.status, [...ACTIVE_STATUSES]),
          gte(bookings.checkout, floor),
          lte(bookings.checkin, horizon),
        ),
      )
      .limit(MAX_BOOKINGS_PER_RUN);
  }

  let inserted = 0;
  let errors = 0;
  for (const r of rows) {
    if (!r.channexBookingId) continue;
    try {
      inserted += await syncBooking(db, channex, {
        id: r.id,
        tenantId: r.tenantId,
        channexBookingId: r.channexBookingId,
      });
    } catch {
      errors++;
    }
  }
  return { bookings: rows.length, inserted, errors };
}

export const guestMessagesSync = inngest.createFunction(
  {
    id: 'guest-messages-sync',
    name: 'Sync OTA guest messages into the inbox',
    retries: 2,
    concurrency: { limit: 1 },
  },
  [{ event: 'guest-messages/sync' }, { cron: '*/15 * * * *' }],
  async ({ event, step, logger }) => {
    const hint = (event?.data as { channexBookingId?: string } | undefined)
      ?.channexBookingId;
    const res = await step.run('sync', () => sync(hint));
    if (res.inserted > 0 || res.errors > 0) {
      logger.info(res, 'guest messages sync run');
    }
    return res;
  },
);
