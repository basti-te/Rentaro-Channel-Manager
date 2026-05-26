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
          smsSenderId: tenants.smsSenderId,
          defaultCurrency: tenants.defaultCurrency,
          defaultTimezone: tenants.defaultTimezone,
          defaultCityTaxRateBp: tenants.defaultCityTaxRateBp,
          defaultCheckinTime: tenants.defaultCheckinTime,
          defaultCheckoutTime: tenants.defaultCheckoutTime,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId!))
        .limit(1)
    )[0];
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    return row;
  }),

  /** Edit workspace defaults (admin). City tax is stored in basis points. */
  updateTenant: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        defaultTimezone: z.string().trim().min(1).max(64),
        defaultCurrency: z
          .string()
          .trim()
          .regex(/^[A-Z]{3}$/, 'ISO-4217-Code, z. B. EUR'),
        defaultCityTaxRateBp: z.number().int().min(0).max(10_000),
        defaultCheckinTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:MM'),
        defaultCheckoutTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:MM'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(tenants)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId!))
        .returning({ id: tenants.id });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),

  /**
   * Mark the first-time onboarding wizard as completed. Idempotent — calling
   * it again does nothing. The dashboard checks `me.current.tenant.onboardedAt`
   * and routes new tenants to `/onboarding` until this fires.
   */
  completeOnboarding: adminProcedure.mutation(async ({ ctx }) => {
    const [row] = await ctx.db
      .update(tenants)
      .set({ onboardedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tenants.id, ctx.tenantId!)))
      .returning({ id: tenants.id, onboardedAt: tenants.onboardedAt });
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    return { ok: true, onboardedAt: row.onboardedAt };
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

  /**
   * Set (or clear) this tenant's alphanumeric SMS sender id. Empty string
   * clears it → the account-wide TWILIO_FROM default is used again.
   * Twilio rule: ≤11 chars, ≥1 letter, only A–Z a–z 0–9 and spaces.
   */
  setSmsSenderId: adminProcedure
    .input(
      z.object({
        smsSenderId: z
          .string()
          .trim()
          .max(11, 'Maximal 11 Zeichen')
          .regex(
            /^(?=.*[A-Za-z])[A-Za-z0-9 ]+$/,
            'Nur Buchstaben, Ziffern und Leerzeichen; mindestens ein Buchstabe.',
          )
          .or(z.literal('')),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const value = input.smsSenderId === '' ? null : input.smsSenderId;
      const [row] = await ctx.db
        .update(tenants)
        .set({ smsSenderId: value, updatedAt: new Date() })
        .where(eq(tenants.id, ctx.tenantId!))
        .returning({ smsSenderId: tenants.smsSenderId });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return { smsSenderId: row.smsSenderId };
    }),
});
