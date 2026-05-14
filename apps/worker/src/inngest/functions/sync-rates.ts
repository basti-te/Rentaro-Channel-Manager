import { and, eq } from 'drizzle-orm';
import {
  channexProperties,
  createDb,
  properties,
  syncJobs,
} from '@cm/db';
import { createChannexClient, type RestrictionUpdate } from '@cm/channex';
import { env } from '../../env';
import { inngest } from '../client';

/**
 * Push the apartment's nightly rate + min-stay to Channex over [from, to).
 *
 * For Phase 5b.1 we only push the property-level defaults (one update entry
 * spanning the full range). Per-day rate overrides come in a later phase via
 * a dedicated `rate_overrides` table.
 *
 * Channex date ranges are inclusive on both ends, so the Inngest event's
 * EXCLUSIVE `to` is converted to an inclusive `date_to` via prevDayStr.
 */
export const syncRates = inngest.createFunction(
  { id: 'sync-apartment-rates', name: 'Push rates to Channex', retries: 3 },
  { event: 'apartment/rates.sync' },
  async ({ event, step, logger }) => {
    const { tenantId, propertyId, from, to, reason } = event.data;
    const db = createDb(env.DATABASE_URL);

    const jobId = await step.run('create-job-row', async () => {
      const [row] = await db
        .insert(syncJobs)
        .values({
          tenantId,
          propertyId,
          type: 'push_rates',
          status: 'running',
          payload: { from, to, reason: reason ?? null },
          startedAt: new Date(),
        })
        .returning({ id: syncJobs.id });
      return row!.id;
    });

    try {
      // Resolve mapping + current property defaults in one query.
      // BigInt does not survive Inngest's step-result serialization cleanly,
      // so convert to a plain number before returning.
      const propData = await step.run('resolve-property', async () => {
        const rows = await db
          .select({
            channexPropertyId: channexProperties.channexPropertyId,
            channexRatePlanId: channexProperties.channexRatePlanId,
            defaultRateCents: properties.defaultRateCents,
            defaultMinStay: properties.defaultMinStay,
          })
          .from(properties)
          .innerJoin(
            channexProperties,
            eq(channexProperties.id, properties.channexPropertyRef),
          )
          .where(and(eq(properties.id, propertyId), eq(properties.tenantId, tenantId)))
          .limit(1);
        const r = rows[0];
        if (!r) return null;
        return {
          channexPropertyId: r.channexPropertyId,
          channexRatePlanId: r.channexRatePlanId,
          defaultRateCents: r.defaultRateCents != null ? Number(r.defaultRateCents) : null,
          defaultMinStay: r.defaultMinStay,
        };
      });

      if (!propData) {
        await markSkipped(db, jobId, 'no_mapping');
        return { skipped: true, reason: 'no_mapping' };
      }
      if (propData.defaultRateCents == null) {
        await markSkipped(db, jobId, 'no_rate_set');
        return { skipped: true, reason: 'no_rate_set' };
      }

      const dateToInclusive = prevDayStr(to);
      const rateCents = propData.defaultRateCents;

      // Channex rejects the generic `min_stay` on per-room rate plans —
      // use min_stay_arrival (and optionally min_stay_through) instead.
      const update: RestrictionUpdate = {
        property_id: propData.channexPropertyId,
        rate_plan_id: propData.channexRatePlanId,
        date_from: from,
        date_to: dateToInclusive,
        rate: rateCents,
        min_stay_arrival: propData.defaultMinStay,
        min_stay_through: propData.defaultMinStay,
      };
      // Defensive: rate_plan_id must be a valid uuid; channex returns 422 otherwise
      if (!propData.channexRatePlanId) {
        await markSkipped(db, jobId, 'no_rate_set');
        return { skipped: true, reason: 'no_rate_plan_mapped' };
      }

      const channexResult = await step.run('push-to-channex', async () => {
        const channex = createChannexClient({
          baseUrl: env.CHANNEX_API_URL,
          apiKey: env.CHANNEX_API_KEY,
        });
        return await channex.restrictions.push([update]);
      });

      await step.run('mark-success', async () => {
        await db
          .update(syncJobs)
          .set({
            status: 'success',
            finishedAt: new Date(),
            result: {
              rateCents,
              minStay: propData.defaultMinStay,
              channexResult,
            },
          })
          .where(eq(syncJobs.id, jobId));
      });

      logger.info(
        { propertyId, rateCents, minStay: propData.defaultMinStay },
        'Rates pushed to Channex.',
      );
      return { rateCents, minStay: propData.defaultMinStay };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await step.run('mark-failed', async () => {
        await db
          .update(syncJobs)
          .set({ status: 'failed', finishedAt: new Date(), error: message })
          .where(eq(syncJobs.id, jobId));
      });
      throw err;
    }
  },
);

// ─── helpers ────────────────────────────────────────────────────────────────

async function markSkipped(
  db: ReturnType<typeof createDb>,
  jobId: string,
  reason: 'no_mapping' | 'no_rate_set',
) {
  await db
    .update(syncJobs)
    .set({
      status: 'success',
      finishedAt: new Date(),
      result: { skipped: true, reason },
    })
    .where(eq(syncJobs.id, jobId));
}

function prevDayStr(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}
