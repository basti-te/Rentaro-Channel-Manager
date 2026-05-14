import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  bookings,
  channexProperties,
  createDb,
  properties,
  syncJobs,
} from '@cm/db';
import { createChannexClient, type AvailabilityUpdate } from '@cm/channex';
import { env } from '../../env';
import { inngest } from '../client';

/**
 * Reconcile a property's availability with Channex over [from, to).
 *
 * Algorithm:
 *   1. Look up the property's Channex mapping. No mapping → success-skipped.
 *   2. Fetch active bookings overlapping the range.
 *   3. Build an occupied-day Set for the range.
 *   4. Group consecutive same-state days into contiguous spans (compaction).
 *   5. Bulk-push spans via POST /availability.
 *   6. Persist outcome to sync_jobs.
 *
 * Idempotent: re-running with the same input yields the same Channex state.
 *
 * Durable: every external call (DB / Channex) is wrapped in `step.run`, so
 * Inngest can resume from the last successful step after a restart.
 */
export const syncAvailability = inngest.createFunction(
  {
    id: 'sync-apartment-availability',
    name: 'Push availability to Channex',
    retries: 3,
  },
  { event: 'apartment/availability.sync' },
  async ({ event, step, logger }) => {
    const { tenantId, propertyId, from, to, reason } = event.data;
    const db = createDb(env.DATABASE_URL);

    // 1. Insert sync_jobs row (status=running)
    const jobId = await step.run('create-job-row', async () => {
      const [row] = await db
        .insert(syncJobs)
        .values({
          tenantId,
          propertyId,
          type: 'push_availability',
          status: 'running',
          payload: { from, to, reason: reason ?? null },
          startedAt: new Date(),
        })
        .returning({ id: syncJobs.id });
      return row!.id;
    });

    try {
      // 2. Resolve Channex mapping
      const mapping = await step.run('resolve-mapping', async () => {
        const rows = await db
          .select({
            channexPropertyId: channexProperties.channexPropertyId,
            channexRoomTypeId: channexProperties.channexRoomTypeId,
            channexRatePlanId: channexProperties.channexRatePlanId,
          })
          .from(properties)
          .innerJoin(
            channexProperties,
            eq(channexProperties.id, properties.channexPropertyRef),
          )
          .where(and(eq(properties.id, propertyId), eq(properties.tenantId, tenantId)))
          .limit(1);
        return rows[0] ?? null;
      });

      if (!mapping) {
        logger.info({ propertyId }, 'No Channex mapping — skipping sync.');
        await step.run('mark-skipped', async () => {
          await db
            .update(syncJobs)
            .set({
              status: 'success',
              finishedAt: new Date(),
              result: { skipped: true, reason: 'no_mapping' },
            })
            .where(eq(syncJobs.id, jobId));
        });
        // Bookings on an unmapped property aren't waiting for anything —
        // they're local-only. Move them out of pending_sync so the detail
        // sheet does not say "Sync ausstehend" forever.
        await step.run('mark-bookings-confirmed', async () => {
          await db
            .update(bookings)
            .set({ status: 'confirmed', lastSyncError: null })
            .where(
              and(
                eq(bookings.tenantId, tenantId),
                eq(bookings.propertyId, propertyId),
                eq(bookings.status, 'pending_sync'),
                lt(bookings.checkin, to),
                gte(bookings.checkout, from),
              ),
            );
        });
        return { skipped: true, reason: 'no_mapping' };
      }

      // 3. Fetch overlapping bookings — exclude cancelled / draft
      const occupiedDays = await step.run('compute-occupied-days', async () => {
        const overlapping = await db
          .select({
            checkin: bookings.checkin,
            checkout: bookings.checkout,
          })
          .from(bookings)
          .where(
            and(
              eq(bookings.tenantId, tenantId),
              eq(bookings.propertyId, propertyId),
              inArray(bookings.status, [
                'confirmed',
                'synced',
                'pending_sync',
                'blocked',
              ]),
              lt(bookings.checkin, to),
              gte(bookings.checkout, from),
            ),
          );

        const occupied = new Set<string>();
        for (const b of overlapping) {
          // bookings.checkin / checkout are YYYY-MM-DD strings (Drizzle date)
          for (
            let d = b.checkin > from ? b.checkin : from;
            d < (b.checkout < to ? b.checkout : to);
            d = addDayStr(d)
          ) {
            occupied.add(d);
          }
        }
        return Array.from(occupied).sort();
      });

      // 4. Compact contiguous same-state spans
      const spans = compactSpans(from, to, new Set(occupiedDays));

      // 5. Push to Channex
      const updates: AvailabilityUpdate[] = spans.map((s) => ({
        property_id: mapping.channexPropertyId,
        room_type_id: mapping.channexRoomTypeId,
        date_from: s.from,
        date_to: s.toInclusive,
        availability: s.occupied ? 0 : 1,
      }));

      const channexResult = await step.run('push-to-channex', async () => {
        if (updates.length === 0) return { noop: true };
        const channex = createChannexClient({
          baseUrl: env.CHANNEX_API_URL,
          apiKey: env.CHANNEX_API_KEY,
        });
        return await channex.availability.push(updates);
      });

      // 6. Persist success
      await step.run('mark-success', async () => {
        await db
          .update(syncJobs)
          .set({
            status: 'success',
            finishedAt: new Date(),
            result: {
              spans: spans.length,
              occupiedDays: occupiedDays.length,
              channexResult,
            },
          })
          .where(eq(syncJobs.id, jobId));
      });

      // Bonus: mark this booking range as synced (best-effort; not authoritative).
      await step.run('mark-bookings-synced', async () => {
        await db
          .update(bookings)
          .set({ status: 'synced', lastSyncAt: new Date(), lastSyncError: null })
          .where(
            and(
              eq(bookings.tenantId, tenantId),
              eq(bookings.propertyId, propertyId),
              eq(bookings.status, 'pending_sync'),
              lt(bookings.checkin, to),
              gte(bookings.checkout, from),
            ),
          );
      });

      return { spans: spans.length, occupied: occupiedDays.length };
    } catch (err) {
      // Persist failure for visibility, then re-throw so Inngest retries / surfaces it.
      const message = err instanceof Error ? err.message : String(err);
      await step.run('mark-failed', async () => {
        await db
          .update(syncJobs)
          .set({
            status: 'failed',
            finishedAt: new Date(),
            error: message,
          })
          .where(eq(syncJobs.id, jobId));
      });
      throw err;
    }
  },
);

// ─── helpers ────────────────────────────────────────────────────────────────

/** Adds one day to a YYYY-MM-DD string. UTC-safe. */
function addDayStr(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

interface Span {
  from: string; // YYYY-MM-DD inclusive
  toInclusive: string;
  occupied: boolean;
}

/**
 * Walks [from, to) and groups consecutive same-state (occupied vs free) days
 * into spans. Channex's POST /availability supports a date_from / date_to
 * range per entry, so this materially reduces payload size for typical
 * apartments where many days share a state.
 */
function compactSpans(from: string, toExclusive: string, occupied: Set<string>): Span[] {
  const spans: Span[] = [];
  let cursor = from;
  if (cursor >= toExclusive) return spans;

  let runStart = cursor;
  let runState = occupied.has(cursor);

  while (cursor < toExclusive) {
    const state = occupied.has(cursor);
    if (state !== runState) {
      // flush previous run
      spans.push({
        from: runStart,
        toInclusive: prevDayStr(cursor),
        occupied: runState,
      });
      runStart = cursor;
      runState = state;
    }
    cursor = addDayStr(cursor);
  }
  // flush final run
  spans.push({
    from: runStart,
    toInclusive: prevDayStr(toExclusive),
    occupied: runState,
  });
  return spans;
}

function prevDayStr(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}
