import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, gte, lt } from 'drizzle-orm';
import { properties, rateOverrides, type Database } from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';
import { enqueueAri } from '../services/ari';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** Adds one day to a YYYY-MM-DD string (UTC-safe). */
function addDay(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/** Enumerate [from, toExclusive) as YYYY-MM-DD. */
function eachDay(from: string, toExclusive: string): string[] {
  const out: string[] = [];
  for (let d = from; d < toExclusive; d = addDay(d)) out.push(d);
  return out;
}

/** The per-day fields a caller may override. All optional; null clears one. */
const overrideValues = z.object({
  rateCents: z.number().int().nonnegative().nullable().optional(),
  minStay: z.number().int().min(1).nullable().optional(),
  maxStay: z.number().int().min(1).nullable().optional(),
  closedToArrival: z.boolean().nullable().optional(),
  closedToDeparture: z.boolean().nullable().optional(),
  stopSell: z.boolean().nullable().optional(),
});

async function assertPropertyInTenant(
  db: Database,
  propertyId: string,
  tenantId: string,
) {
  const row = (
    await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.tenantId, tenantId)))
      .limit(1)
  )[0];
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Property not in tenant' });
}

export const ratesRouter = router({
  /**
   * Per-day overrides overlapping [from, to) for one property.
   */
  listByRange: tenantProcedure
    .input(z.object({ propertyId: z.string().uuid(), from: dateStr, to: dateStr }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(rateOverrides)
        .where(
          and(
            eq(rateOverrides.tenantId, ctx.tenantId!),
            eq(rateOverrides.propertyId, input.propertyId),
            gte(rateOverrides.date, input.from),
            lt(rateOverrides.date, input.to),
          ),
        );
    }),

  /**
   * Tenant-wide per-day overrides in [from, to). One query powers the whole
   * calendar grid (every property) so each free cell can show its effective
   * rate / restriction state.
   */
  listByRangeAll: tenantProcedure
    .input(z.object({ from: dateStr, to: dateStr }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          propertyId: rateOverrides.propertyId,
          date: rateOverrides.date,
          rateCents: rateOverrides.rateCents,
          minStay: rateOverrides.minStay,
          maxStay: rateOverrides.maxStay,
          closedToArrival: rateOverrides.closedToArrival,
          closedToDeparture: rateOverrides.closedToDeparture,
          stopSell: rateOverrides.stopSell,
        })
        .from(rateOverrides)
        .where(
          and(
            eq(rateOverrides.tenantId, ctx.tenantId!),
            gte(rateOverrides.date, input.from),
            lt(rateOverrides.date, input.to),
          ),
        );
    }),

  /**
   * Upsert overrides for every day in [from, to) (to EXCLUSIVE). Only the
   * provided fields are touched; the rest of an existing row is preserved.
   * Passing a field as null clears it (→ inherit property default again).
   *
   * Enqueues a single 'rates' dirty range; the global flusher batches the
   * push within the debounce window.
   */
  setOverrides: editorProcedure
    .input(
      z
        .object({
          propertyId: z.string().uuid(),
          from: dateStr,
          to: dateStr,
          values: overrideValues,
        })
        .refine((v) => v.from < v.to, {
          message: 'to must be after from',
          path: ['to'],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPropertyInTenant(ctx.db, input.propertyId, ctx.tenantId!);

      const v = input.values;
      const days = eachDay(input.from, input.to);

      // Build the patch of explicitly-provided fields only.
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (v.rateCents !== undefined)
        patch.rateCents = v.rateCents === null ? null : BigInt(v.rateCents);
      if (v.minStay !== undefined) patch.minStay = v.minStay;
      if (v.maxStay !== undefined) patch.maxStay = v.maxStay;
      if (v.closedToArrival !== undefined) patch.closedToArrival = v.closedToArrival;
      if (v.closedToDeparture !== undefined) patch.closedToDeparture = v.closedToDeparture;
      if (v.stopSell !== undefined) patch.stopSell = v.stopSell;

      for (const date of days) {
        await ctx.db
          .insert(rateOverrides)
          .values({
            tenantId: ctx.tenantId!,
            propertyId: input.propertyId,
            date,
            rateCents:
              v.rateCents != null ? BigInt(v.rateCents) : null,
            minStay: v.minStay ?? null,
            maxStay: v.maxStay ?? null,
            closedToArrival: v.closedToArrival ?? null,
            closedToDeparture: v.closedToDeparture ?? null,
            stopSell: v.stopSell ?? null,
          })
          .onConflictDoUpdate({
            target: [rateOverrides.propertyId, rateOverrides.date],
            set: patch,
          });
      }

      await enqueueAri(ctx, {
        tenantId: ctx.tenantId!,
        propertyId: input.propertyId,
        kinds: ['rates'],
        from: input.from,
        to: input.to,
        reason: 'rate.override.set',
      });

      return { days: days.length };
    }),

  /** Delete overrides in [from, to); affected days fall back to property defaults. */
  clearOverrides: editorProcedure
    .input(
      z
        .object({ propertyId: z.string().uuid(), from: dateStr, to: dateStr })
        .refine((v) => v.from < v.to, { message: 'to must be after from', path: ['to'] }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPropertyInTenant(ctx.db, input.propertyId, ctx.tenantId!);

      await ctx.db
        .delete(rateOverrides)
        .where(
          and(
            eq(rateOverrides.tenantId, ctx.tenantId!),
            eq(rateOverrides.propertyId, input.propertyId),
            gte(rateOverrides.date, input.from),
            lt(rateOverrides.date, input.to),
          ),
        );

      await enqueueAri(ctx, {
        tenantId: ctx.tenantId!,
        propertyId: input.propertyId,
        kinds: ['rates'],
        from: input.from,
        to: input.to,
        reason: 'rate.override.clear',
      });

      return { ok: true };
    }),
});
