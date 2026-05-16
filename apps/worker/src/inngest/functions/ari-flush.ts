/**
 * The global ARI flusher — the heart of the rate-limit / batching strategy.
 *
 * Every booking/block/rate change writes a dirty-range row to `ari_pending`
 * and emits `ari/changed`. This one function (NOT one per property) then:
 *
 *   1. claims every unflushed row across ALL tenants/properties
 *   2. merges them to one [min,max) window per (property, kind)
 *   3. resolves the current desired state and builds ONE batched
 *      POST /availability and ONE POST /restrictions
 *   4. marks the rows flushed + writes per-property sync_jobs audit rows
 *
 * Channex counts API *calls* against the 20/min limit, not day-changes, and
 * a single call may span any number of properties/rooms/dates (≤10 MB). So
 * batching globally keeps us at ~2 calls per flush no matter how many
 * apartments exist now or get onboarded later.
 *
 * Burst control:
 *   - debounce 8s   → a flurry of edits collapses into one flush
 *   - throttle 6/min → hard ceiling well under Channex's 20/min
 * Both keyed globally (no per-property key) = account-wide single stream.
 *
 * A 5-minute cron re-runs the same flush so anything a failed push left
 * behind (flushed_at still NULL) drains automatically. Delta-only — it never
 * does a full resync (satisfies certification "update logic").
 */
import { inArray, isNull } from 'drizzle-orm';
import type { GetStepTools } from 'inngest';
import { ariPending, createDb, syncJobs } from '@cm/db';
import { createChannexClient } from '@cm/channex';
import { env } from '../../env';
import { inngest } from '../client';
import {
  loadMappings,
  resolveAvailabilityValues,
  resolveRateValues,
  type DirtyRange,
} from './ari-resolve';

export interface FlushResult {
  flushed: number;
  availabilityEntries: number;
  rateEntries: number;
  properties: number;
}

/**
 * Only the fields the flush needs. Declared as a plain string-shaped type so
 * it survives Inngest's step.run JSON round-trip without Date typing noise.
 */
interface ClaimedRow {
  id: string;
  tenantId: string;
  propertyId: string;
  kind: 'availability' | 'rates';
  dateFrom: string;
  dateTo: string;
  reason: string | null;
}

type Step = GetStepTools<typeof inngest>;

/** Merge many dirty rows into one [min(from), max(to)) window per (property,kind). */
function mergeRanges(rows: ClaimedRow[]): {
  availability: DirtyRange[];
  rates: DirtyRange[];
} {
  const byKey = new Map<string, DirtyRange & { kind: 'availability' | 'rates' }>();
  for (const r of rows) {
    const key = `${r.kind}:${r.propertyId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        kind: r.kind,
        tenantId: r.tenantId,
        propertyId: r.propertyId,
        from: r.dateFrom,
        to: r.dateTo,
      });
    } else {
      if (r.dateFrom < existing.from) existing.from = r.dateFrom;
      if (r.dateTo > existing.to) existing.to = r.dateTo;
    }
  }
  const availability: DirtyRange[] = [];
  const rates: DirtyRange[] = [];
  for (const v of byKey.values()) {
    (v.kind === 'availability' ? availability : rates).push({
      tenantId: v.tenantId,
      propertyId: v.propertyId,
      from: v.from,
      to: v.to,
    });
  }
  return { availability, rates };
}

/**
 * Shared flush body. Called by both the event-driven (debounced/throttled)
 * function and the safety cron. `runId` is stamped on claimed rows for
 * observability.
 */
async function runFlush(runId: string, step: Step): Promise<FlushResult> {
  const db = createDb(env.DATABASE_URL);

  // 1. Claim every unflushed row. Channex pushes are declarative/idempotent,
  //    so even if two flushes overlap and both send, the result is identical;
  //    flushed_at gates the *next* cycle.
  const claimed: ClaimedRow[] = await step.run('claim-pending', async () => {
    const rows = await db
      .update(ariPending)
      .set({ batchId: runId })
      .where(isNull(ariPending.flushedAt))
      .returning();
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      propertyId: r.propertyId,
      kind: r.kind,
      dateFrom: r.dateFrom,
      dateTo: r.dateTo,
      reason: r.reason,
    }));
  });

  if (claimed.length === 0) {
    return { flushed: 0, availabilityEntries: 0, rateEntries: 0, properties: 0 };
  }

  const { availability, rates } = mergeRanges(claimed);
  const propertyIds = Array.from(
    new Set([...availability, ...rates].map((r) => r.propertyId)),
  );
  const mappings = await step.run('load-mappings', async () =>
    Object.fromEntries(await loadMappings(db, propertyIds)),
  );
  const mapEntries = new Map(Object.entries(mappings));

  // 2. ONE batched /availability across all properties.
  const availabilityEntries = await step.run('push-availability', async () => {
    const values = await resolveAvailabilityValues(db, availability, mapEntries);
    if (values.length === 0) return 0;
    const channex = createChannexClient({
      baseUrl: env.CHANNEX_API_URL,
      apiKey: env.CHANNEX_API_KEY,
    });
    await channex.availability.push(values);
    return values.length;
  });

  // 3. ONE batched /restrictions (rate + min-stay) across all properties.
  const rateEntries = await step.run('push-rates', async () => {
    const values = await resolveRateValues(db, rates, mapEntries);
    if (values.length === 0) return 0;
    const channex = createChannexClient({
      baseUrl: env.CHANNEX_API_URL,
      apiKey: env.CHANNEX_API_KEY,
    });
    await channex.restrictions.push(values);
    return values.length;
  });

  // 4. Mark flushed + per-property audit rows (keeps sync.statusByProperty UI).
  await step.run('finalize', async () => {
    const ids = claimed.map((r) => r.id);
    await db
      .update(ariPending)
      .set({ flushedAt: new Date() })
      .where(inArray(ariPending.id, ids));

    const jobRows = claimed
      .filter((r) => mapEntries.has(r.propertyId))
      .map((r) => ({
        tenantId: r.tenantId,
        propertyId: r.propertyId,
        type:
          r.kind === 'availability'
            ? ('push_availability' as const)
            : ('push_rates' as const),
        status: 'success' as const,
        payload: { from: r.dateFrom, to: r.dateTo, reason: r.reason ?? null },
        result: { batchId: runId },
        startedAt: new Date(),
        finishedAt: new Date(),
      }));
    if (jobRows.length > 0) await db.insert(syncJobs).values(jobRows);
  });

  return {
    flushed: claimed.length,
    availabilityEntries,
    rateEntries,
    properties: propertyIds.length,
  };
}

/**
 * Event-driven flush. Debounced + throttled GLOBALLY (no key) so the whole
 * PMS shares one outbound ARI stream.
 */
export const ariFlush = inngest.createFunction(
  {
    id: 'ari-flush',
    name: 'Flush ARI outbox to Channex (batched)',
    // Collapse a burst of edits into a single flush ~8s after it goes quiet.
    debounce: { period: '8s' },
    // Hard ceiling: ≤6 flush runs per minute, account-wide. Channex allows 20.
    throttle: { limit: 6, period: '1m' },
    retries: 3,
  },
  { event: 'ari/changed' },
  async ({ runId, step, logger }) => {
    const res = await runFlush(runId, step);
    logger.info({ ...res, trigger: 'event' }, 'ARI flush complete');
    return res;
  },
);

/**
 * Safety net: every 5 minutes, drain anything still unflushed (e.g. a push
 * that failed all its retries). Delta-only — never a full resync.
 */
export const ariFlushCron = inngest.createFunction(
  { id: 'ari-flush-cron', name: 'ARI outbox drain (safety net)', retries: 2 },
  { cron: '*/5 * * * *' },
  async ({ runId, step, logger }) => {
    const res = await runFlush(runId, step);
    if (res.flushed > 0) {
      logger.info({ ...res, trigger: 'cron' }, 'ARI flush (cron) drained stragglers');
    }
    return res;
  },
);

