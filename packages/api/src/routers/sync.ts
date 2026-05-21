import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { properties, syncJobs } from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';
import { enqueueAri } from '../services/ari';

/**
 * Window — manual triggers sync this many days forward from today.
 * 180 days is generous for vacation rentals (most bookings sit inside it)
 * while keeping payload sizes reasonable.
 */
const TRIGGER_FORWARD_DAYS = 180;

export const syncRouter = router({
  /**
   * Latest sync_jobs entry per property for the current tenant.
   * Returns a map keyed on properties.id with the most recent run's summary.
   *
   * The DB job rows have type='push_availability' for now (Phase 5a); when
   * Phase 5b.1 lands the rate sync, we'll surface both as separate badges.
   */
  statusByProperty: tenantProcedure.query(async ({ ctx }) => {
    // DISTINCT ON requires the same column to lead the ORDER BY. Use the
    // raw SQL builder so Drizzle emits `DISTINCT ON (property_id)`.
    const rows = await ctx.db
      .selectDistinctOn([syncJobs.propertyId], {
        propertyId: syncJobs.propertyId,
        type: syncJobs.type,
        status: syncJobs.status,
        scheduledAt: syncJobs.scheduledAt,
        startedAt: syncJobs.startedAt,
        finishedAt: syncJobs.finishedAt,
        error: syncJobs.error,
      })
      .from(syncJobs)
      .where(and(eq(syncJobs.tenantId, ctx.tenantId!), isNotNull(syncJobs.propertyId)))
      .orderBy(syncJobs.propertyId, desc(syncJobs.scheduledAt));

    return rows;
  }),

  /**
   * Manually re-sync availability for one apartment over the next ~6 months.
   * Useful as a "force sync" button when something looks off in Channex.
   */
  triggerProperty: editorProcedure
    .input(z.object({ propertyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify the property is in this tenant
      const exists = await ctx.db
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            eq(properties.id, input.propertyId),
            eq(properties.tenantId, ctx.tenantId!),
          ),
        )
        .limit(1);
      if (exists.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Property not in tenant' });
      }

      const today = new Date();
      const from = today.toISOString().slice(0, 10);
      const toDate = new Date(today);
      toDate.setUTCDate(toDate.getUTCDate() + TRIGGER_FORWARD_DAYS);
      const to = toDate.toISOString().slice(0, 10);

      await enqueueAri(ctx, {
        tenantId: ctx.tenantId!,
        propertyId: input.propertyId,
        kinds: ['availability', 'rates'],
        from,
        to,
        reason: 'user.manual',
      });

      return { ok: true, from, to };
    }),

  /**
   * Full Sync — push the COMPLETE 500-day state (availability +
   * rates/restrictions) for one property to Channex in exactly 2 calls.
   * Used for go-live, recovery, and PMS certification. The worker
   * (`channex-full-sync`) does the push and records the Channex task ids.
   */
  fullSync: editorProcedure
    .input(z.object({ propertyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const prop = (
        await ctx.db
          .select({ id: properties.id, ref: properties.channexPropertyRef })
          .from(properties)
          .where(
            and(
              eq(properties.id, input.propertyId),
              eq(properties.tenantId, ctx.tenantId!),
            ),
          )
          .limit(1)
      )[0];
      if (!prop) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Property not in tenant' });
      }
      if (!prop.ref) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Apartment ist nicht mit Channex verbunden.',
        });
      }
      await ctx.inngest.send({
        name: 'channex/full-sync',
        data: { propertyId: input.propertyId, reason: 'user.fullSync' },
      });
      return { ok: true };
    }),

  /**
   * Full Sync for every connected apartment. Emits one event per property;
   * the worker's throttle (4/min) paces them under Channex's rate limit.
   */
  fullSyncAll: editorProcedure.mutation(async ({ ctx }) => {
    const connected = await ctx.db
      .select({ id: properties.id })
      .from(properties)
      .where(
        and(
          eq(properties.tenantId, ctx.tenantId!),
          eq(properties.active, true),
          isNotNull(properties.channexPropertyRef),
        ),
      );
    for (const p of connected) {
      await ctx.inngest.send({
        name: 'channex/full-sync',
        data: { propertyId: p.id, reason: 'user.fullSyncAll' },
      });
    }
    return { ok: true, count: connected.length };
  }),

  /**
   * Latest `full_sync` job per property — surfaces the Channex task ids
   * (in `result`) for the certification submission.
   */
  fullSyncStatus: tenantProcedure.query(async ({ ctx }) => {
    return ctx.db
      .selectDistinctOn([syncJobs.propertyId], {
        propertyId: syncJobs.propertyId,
        status: syncJobs.status,
        finishedAt: syncJobs.finishedAt,
        result: syncJobs.result,
      })
      .from(syncJobs)
      .where(
        and(
          eq(syncJobs.tenantId, ctx.tenantId!),
          eq(syncJobs.type, 'full_sync'),
          isNotNull(syncJobs.propertyId),
        ),
      )
      .orderBy(syncJobs.propertyId, desc(syncJobs.scheduledAt));
  }),
});
