import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { channexProperties, properties, tenants } from '@cm/db';
import { router, tenantProcedure, adminProcedure } from '../trpc';
import { enqueueAri, type AriKind } from '../services/ari';

/**
 * Tenant-level settings. Currently the rate-ownership switch:
 *
 *   'pms'       → we push nightly rates (rate_overrides / property defaults)
 *   'pricelabs' → PriceLabs owns rates directly in Channex (ADR 0006); we
 *                 stop sending the rate field but keep pushing PMS-owned
 *                 restrictions (min/max stay, stop-sell, CTA/CTD).
 *
 * Flipping the switch is plug-and-play: it just changes a column and
 * re-asserts state to Channex over a forward window so the new ownership
 * takes effect immediately (delta, not a global full resync).
 */
export const settingsRouter = router({
  tenant: tenantProcedure.query(async ({ ctx }) => {
    const row = (
      await ctx.db
        .select({
          id: tenants.id,
          name: tenants.name,
          rateSource: tenants.rateSource,
          defaultCurrency: tenants.defaultCurrency,
          defaultTimezone: tenants.defaultTimezone,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId!))
        .limit(1)
    )[0];
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    return row;
  }),

  setRateSource: adminProcedure
    .input(z.object({ rateSource: z.enum(['pms', 'pricelabs']) }))
    .mutation(async ({ ctx, input }) => {
      const current = (
        await ctx.db
          .select({ rateSource: tenants.rateSource })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId!))
          .limit(1)
      )[0];
      if (!current) throw new TRPCError({ code: 'NOT_FOUND' });

      if (current.rateSource === input.rateSource) {
        return { rateSource: input.rateSource, changed: false };
      }

      await ctx.db
        .update(tenants)
        .set({ rateSource: input.rateSource, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId!));

      // Re-assert rates/restrictions for every connected property over the
      // next ~6 months so Channex reflects the new ownership right away.
      const connected = await ctx.db
        .select({ propertyId: properties.id })
        .from(properties)
        .innerJoin(
          channexProperties,
          eq(channexProperties.id, properties.channexPropertyRef),
        )
        .where(
          and(
            eq(properties.tenantId, ctx.tenantId!),
            eq(properties.active, true),
          ),
        );

      if (connected.length > 0) {
        const today = new Date();
        const from = today.toISOString().slice(0, 10);
        const toDate = new Date(today);
        toDate.setUTCDate(toDate.getUTCDate() + 180);
        const to = toDate.toISOString().slice(0, 10);

        await enqueueAri(
          ctx,
          connected.map((c) => ({
            tenantId: ctx.tenantId!,
            propertyId: c.propertyId,
            kinds: ['rates'] as AriKind[],
            from,
            to,
            reason: `rateSource.switch.${input.rateSource}`,
          })),
        );
      }

      return { rateSource: input.rateSource, changed: true, properties: connected.length };
    }),
});
