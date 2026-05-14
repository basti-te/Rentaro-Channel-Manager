import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, gte, inArray, lte, lt, gt } from 'drizzle-orm';
import { bookings, properties, tenants } from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';

/** YYYY-MM-DD validator. */
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
/** HH:mm validator (24-hour). */
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');

/** Days between two YYYY-MM-DD dates (UTC-safe, no DST drift since both are dates). */
function nightsBetween(checkin: string, checkout: string): number {
  const a = Date.UTC(
    Number(checkin.slice(0, 4)),
    Number(checkin.slice(5, 7)) - 1,
    Number(checkin.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(checkout.slice(0, 4)),
    Number(checkout.slice(5, 7)) - 1,
    Number(checkout.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

export const bookingsRouter = router({
  /**
   * List bookings that overlap with the given date range.
   * A booking [checkin, checkout) overlaps [from, to) iff
   *   checkin < to AND checkout > from.
   * Date columns are compared as strings — PG handles YYYY-MM-DD ordering correctly.
   */
  listByRange: tenantProcedure
    .input(
      z.object({
        from: dateStr,
        to: dateStr,
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.tenantId, ctx.tenantId!),
            lte(bookings.checkin, input.to),
            gte(bookings.checkout, input.from),
          ),
        );
      return rows;
    }),

  /** Get a single booking by id. */
  byId: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = (
        await ctx.db
          .select()
          .from(bookings)
          .where(and(eq(bookings.id, input.id), eq(bookings.tenantId, ctx.tenantId!)))
          .limit(1)
      )[0];
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  /**
   * Create an internal booking or a pure block. No Channex push yet — that
   * comes in Phase 5 via an Inngest job triggered from this mutation.
   */
  createInternal: editorProcedure
    .input(
      z
        .object({
          propertyId: z.string().uuid(),
          checkin: dateStr,
          checkout: dateStr,
          checkinTime: timeStr.optional(),
          checkoutTime: timeStr.optional(),
          guestCount: z.number().int().min(1).max(50).optional(),
          isBlock: z.boolean().default(false),
          guestName: z.string().max(120).optional(),
          guestPhone: z.string().max(40).optional(),
          guestEmail: z.string().email().max(180).optional(),
          /** Per-night rate (incl. VAT), in cents. */
          nightlyRateCents: z.number().int().nonnegative().optional(),
          /** One-off cleaning fee (incl. VAT), in cents. */
          cleaningFeeCents: z.number().int().nonnegative().optional(),
          /** Override the tenant's default city-tax rate (basis points). */
          cityTaxRateBp: z.number().int().min(0).max(10_000).optional(),
          currency: z.string().length(3).default('EUR'),
          notes: z.string().max(2000).optional(),
          /** If true, review automation sends a review request 3 days after checkout. */
          autoReviewEnabled: z.boolean().optional(),
        })
        .refine((v) => v.checkin < v.checkout, {
          message: 'checkout must be after checkin',
          path: ['checkout'],
        }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the property belongs to this tenant
      const prop = (
        await ctx.db
          .select({ id: properties.id })
          .from(properties)
          .where(
            and(eq(properties.id, input.propertyId), eq(properties.tenantId, ctx.tenantId!)),
          )
          .limit(1)
      )[0];
      if (!prop) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Property not in tenant' });
      }

      // Overlap guard. Back-to-back bookings (existing.checkout === new.checkin
      // or vice versa) are allowed, hence the strict `<` / `>`.
      const conflicting = await ctx.db
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.tenantId, ctx.tenantId!),
            eq(bookings.propertyId, input.propertyId),
            lt(bookings.checkin, input.checkout),
            gt(bookings.checkout, input.checkin),
            inArray(bookings.status, ['confirmed', 'synced', 'pending_sync', 'blocked']),
          ),
        )
        .limit(1);
      if (conflicting.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Dates overlap an existing booking or block',
        });
      }

      // ── Resolve defaults from tenant/property ────────────────────────────
      const tenant = (
        await ctx.db
          .select({
            defaultCityTaxRateBp: tenants.defaultCityTaxRateBp,
            defaultCheckinTime: tenants.defaultCheckinTime,
            defaultCheckoutTime: tenants.defaultCheckoutTime,
          })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId!))
          .limit(1)
      )[0]!;

      const checkinTime = input.checkinTime ?? tenant.defaultCheckinTime;
      const checkoutTime = input.checkoutTime ?? tenant.defaultCheckoutTime;
      const guestCount = input.guestCount ?? 1;
      const cityTaxRateBp = input.cityTaxRateBp ?? tenant.defaultCityTaxRateBp;

      // ── Compute the breakdown ───────────────────────────────────────────
      let priceCents: bigint | null = null;
      let cityTaxCents: bigint | null = null;

      if (!input.isBlock && input.nightlyRateCents != null) {
        const nights = nightsBetween(input.checkin, input.checkout);
        const lodgingCents = BigInt(input.nightlyRateCents) * BigInt(nights);
        const cleaningCents = BigInt(input.cleaningFeeCents ?? 0);
        // city tax = lodging * (rate_bp / 10000), rounded to nearest cent
        cityTaxCents =
          (lodgingCents * BigInt(cityTaxRateBp) + 5000n) / 10000n;
        priceCents = lodgingCents + cleaningCents + cityTaxCents;
      }

      const [row] = await ctx.db
        .insert(bookings)
        .values({
          tenantId: ctx.tenantId!,
          propertyId: input.propertyId,
          source: input.isBlock ? 'block' : 'internal',
          status: input.isBlock ? 'blocked' : 'pending_sync',
          guestName: input.isBlock ? null : input.guestName,
          guestPhone: input.isBlock ? null : input.guestPhone,
          guestEmail: input.isBlock ? null : input.guestEmail,
          checkin: input.checkin,
          checkout: input.checkout,
          checkinTime,
          checkoutTime,
          guestCount,
          nightlyRateCents:
            !input.isBlock && input.nightlyRateCents != null
              ? BigInt(input.nightlyRateCents)
              : null,
          cleaningFeeCents:
            !input.isBlock && input.cleaningFeeCents != null
              ? BigInt(input.cleaningFeeCents)
              : null,
          cityTaxRateBp: !input.isBlock ? cityTaxRateBp : null,
          cityTaxCents,
          priceCents,
          currency: input.currency,
          notes: input.notes,
          autoReviewEnabled: input.isBlock ? false : (input.autoReviewEnabled ?? true),
        })
        .returning();
      return row;
    }),

  delete: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(bookings)
        .where(and(eq(bookings.id, input.id), eq(bookings.tenantId, ctx.tenantId!)))
        .returning({ id: bookings.id });
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),
});
