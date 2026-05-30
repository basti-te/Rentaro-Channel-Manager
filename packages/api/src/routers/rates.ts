import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, gte, lt } from 'drizzle-orm';
import {
  channexProperties,
  properties,
  rateOverrides,
  tenants,
  type Database,
} from '@cm/db';
import { createChannexClient, ChannexError, type DayRate } from '@cm/channex';
import { router, tenantProcedure, editorProcedure } from '../trpc';
import { enqueueAri } from '../services/ari';

/**
 * Tiny in-process cache for Channex rate read-backs. Channex limits rate
 * reads to 10/min PER PROPERTY, and the calendar would otherwise re-read on
 * every navigation. Keyed by property+range; 5-min TTL is plenty fresh for a
 * display label (PriceLabs recomputes ~daily). Best-effort — a server restart
 * just means a cold read.
 */
const RATE_CACHE = new Map<string, { at: number; rates: DayRate[] }>();
const RATE_CACHE_TTL_MS = 5 * 60_000;

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

  /**
   * Read the EFFECTIVE nightly rates Channex currently holds, per connected
   * property, over [from, to). Only meaningful when the tenant uses PriceLabs
   * (rateSource='pricelabs') — then these ARE the PriceLabs prices, since
   * Channex is the hub PriceLabs writes into. Returns [] for PMS-mode tenants
   * (the calendar already shows our own rate there) so we never burn Channex
   * read-quota needlessly.
   *
   * Read-only. Cached + paced for the 10-reads/min/property Channex limit.
   * Properties that error (or aren't mapped) are simply omitted.
   */
  channexEffectiveRates: tenantProcedure
    .input(z.object({ from: dateStr, to: dateStr }))
    .query(async ({ ctx, input }) => {
      // Gate strictly on PriceLabs mode.
      const tenant = (
        await ctx.db
          .select({ rateSource: tenants.rateSource })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId!))
          .limit(1)
      )[0];
      if (!tenant || tenant.rateSource !== 'pricelabs') {
        return [] as Array<{ propertyId: string; date: string; rateCents: number }>;
      }

      // Connected properties for this tenant + their Channex ids.
      const mapped = await ctx.db
        .select({
          propertyId: properties.id,
          channexPropertyId: channexProperties.channexPropertyId,
          ratePlanId: channexProperties.channexRatePlanId,
        })
        .from(properties)
        .innerJoin(
          channexProperties,
          eq(channexProperties.id, properties.channexPropertyRef),
        )
        .where(eq(properties.tenantId, ctx.tenantId!));
      if (mapped.length === 0) return [];

      const channex = createChannexClient({
        baseUrl: ctx.env.CHANNEX_API_URL,
        apiKey: ctx.env.CHANNEX_API_KEY,
      });
      // GET /restrictions date filter is inclusive; our `to` is exclusive.
      const dateTo = (() => {
        const t = new Date(`${input.to}T00:00:00Z`);
        t.setUTCDate(t.getUTCDate() - 1);
        return t.toISOString().slice(0, 10);
      })();

      const now = Date.now();
      const out: Array<{ propertyId: string; date: string; rateCents: number }> = [];

      await Promise.all(
        mapped.map(async (m) => {
          const cacheKey = `${m.channexPropertyId}:${input.from}:${dateTo}`;
          const hit = RATE_CACHE.get(cacheKey);
          let rates: DayRate[];
          if (hit && now - hit.at < RATE_CACHE_TTL_MS) {
            rates = hit.rates;
          } else {
            try {
              rates = await channex.restrictions.readRates({
                propertyId: m.channexPropertyId,
                ratePlanId: m.ratePlanId,
                dateFrom: input.from,
                dateTo,
              });
              RATE_CACHE.set(cacheKey, { at: now, rates });
            } catch (err) {
              // Rate-limited or transient — skip this property this round.
              if (!(err instanceof ChannexError)) throw err;
              return;
            }
          }
          for (const r of rates) {
            if (r.rateCents != null) {
              out.push({ propertyId: m.propertyId, date: r.date, rateCents: r.rateCents });
            }
          }
        }),
      );

      return out;
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
