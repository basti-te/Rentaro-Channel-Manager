import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { properties, syncJobs } from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';

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

      await ctx.inngest.send({
        name: 'apartment/availability.sync',
        data: {
          tenantId: ctx.tenantId!,
          propertyId: input.propertyId,
          from,
          to,
          reason: 'user.manual',
        },
      });

      return { ok: true, from, to };
    }),
});
