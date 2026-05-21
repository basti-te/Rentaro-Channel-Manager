/**
 * Channex Full Sync.
 *
 * Pushes the COMPLETE desired state — 500 days of availability + rates &
 * restrictions — for one property, in exactly TWO Channex calls:
 *
 *   1 x POST /availability   (all room types, 500 days)
 *   1 x POST /restrictions   (all rate plans, 500 days)
 *
 * This is what Channex's PMS certification calls a "full sync": it
 * simulates a hotel going live, and is also the recovery tool after
 * downtime/errors. Unlike `ari-flush` it is NOT delta-based — it does not
 * touch the `ari_pending` outbox; it resolves the whole window fresh.
 *
 * The Channex task id(s) from both responses are stored on the `full_sync`
 * sync_jobs row (`result`) so the UI can surface them for the certification
 * submission.
 *
 * Rate limit: throttled to 4 runs/min (= 8 API calls/min). Combined with
 * `ari-flush` (≤12/min) that stays at/under Channex's 20 ARI/min; the
 * client's 429 backoff is the final backstop. A "sync all" therefore paces
 * itself automatically — N properties drain at 4/min.
 */
import { createChannexClient } from '@cm/channex';
import { createDb, syncJobs } from '@cm/db';
import { env } from '../../env';
import { inngest } from '../client';
import {
  loadMappings,
  resolveAvailabilityValues,
  resolveRateValues,
  type PropertyMapping,
} from './ari-resolve';

const DEFAULT_DAYS = 500;

export interface FullSyncResult {
  propertyId: string;
  ok: boolean;
  reason?: string;
  availabilityTaskIds: string[];
  restrictionTaskIds: string[];
  availabilityEntries: number;
  restrictionEntries: number;
}

/** Add `days` to a YYYY-MM-DD string (UTC-safe). */
function addDays(ymd: string, days: number): string {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export const channexFullSync = inngest.createFunction(
  {
    id: 'channex-full-sync',
    name: 'Channex Full Sync (500-day push, one property)',
    // 4 runs/min → 8 API calls/min. Paces a "sync all" automatically and
    // stays under Channex's 20 ARI/min even alongside ari-flush.
    throttle: { limit: 4, period: '1m' },
    retries: 3,
  },
  { event: 'channex/full-sync' },
  async ({ event, step, logger }): Promise<FullSyncResult> => {
    const propertyId = event.data.propertyId;
    const days = Math.min(Math.max(event.data.days ?? DEFAULT_DAYS, 1), 730);
    const db = createDb(env.DATABASE_URL);

    // 1. Resolve the Channex mapping + the [today, today+days) window.
    const plan = await step.run('plan', async () => {
      const mapping = (await loadMappings(db, [propertyId])).get(propertyId);
      if (!mapping) return { ok: false as const };
      const from = new Date().toISOString().slice(0, 10);
      return { ok: true as const, mapping, from, to: addDays(from, days) };
    });

    if (!plan.ok) {
      logger.warn({ propertyId }, 'Full sync skipped — property not connected to Channex');
      return {
        propertyId, ok: false, reason: 'not_connected',
        availabilityTaskIds: [], restrictionTaskIds: [],
        availabilityEntries: 0, restrictionEntries: 0,
      };
    }

    const mapping: PropertyMapping = plan.mapping;
    const range = {
      tenantId: mapping.tenantId,
      propertyId,
      from: plan.from,
      to: plan.to,
    };
    const mappings = new Map([[propertyId, mapping]]);

    // 2. ONE POST /availability — 500 days, all room types.
    const availability = await step.run('push-availability', async () => {
      const values = await resolveAvailabilityValues(db, [range], mappings);
      const channex = createChannexClient({
        baseUrl: env.CHANNEX_API_URL,
        apiKey: env.CHANNEX_API_KEY,
      });
      const taskIds = await channex.availability.push(values);
      return { taskIds, entries: values.length };
    });

    // 3. ONE POST /restrictions — 500 days, all rate plans.
    const restrictions = await step.run('push-restrictions', async () => {
      const values = await resolveRateValues(db, [range], mappings);
      const channex = createChannexClient({
        baseUrl: env.CHANNEX_API_URL,
        apiKey: env.CHANNEX_API_KEY,
      });
      const taskIds = await channex.restrictions.push(values);
      return { taskIds, entries: values.length };
    });

    // 4. Audit row — the UI reads the Channex task ids from result.
    await step.run('record', async () => {
      await db.insert(syncJobs).values({
        tenantId: mapping.tenantId,
        propertyId,
        type: 'full_sync',
        status: 'success',
        payload: { from: plan.from, to: plan.to, days },
        result: {
          availabilityTaskIds: availability.taskIds,
          restrictionTaskIds: restrictions.taskIds,
          availabilityEntries: availability.entries,
          restrictionEntries: restrictions.entries,
        },
        startedAt: new Date(),
        finishedAt: new Date(),
      });
    });

    const res: FullSyncResult = {
      propertyId,
      ok: true,
      availabilityTaskIds: availability.taskIds,
      restrictionTaskIds: restrictions.taskIds,
      availabilityEntries: availability.entries,
      restrictionEntries: restrictions.entries,
    };
    logger.info(res, 'Channex full sync complete');
    return res;
  },
);
