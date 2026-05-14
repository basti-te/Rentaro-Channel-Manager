import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, eq, gte, inArray, lte, lt, gt, ne } from 'drizzle-orm';
import { bookings, properties, tenants, syncJobs } from '@cm/db';
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

interface PriceBreakdown {
  nightlyRateCents: bigint | null;
  cleaningFeeCents: bigint | null;
  cityTaxRateBp: number | null;
  cityTaxCents: bigint | null;
  priceCents: bigint | null;
}

/** Computes the price breakdown for a guest booking. Returns all-null for blocks. */
function computeBreakdown(input: {
  isBlock: boolean;
  checkin: string;
  checkout: string;
  nightlyRateCents: number | null;
  cleaningFeeCents: number | null;
  cityTaxRateBp: number;
}): PriceBreakdown {
  if (input.isBlock || input.nightlyRateCents == null) {
    return {
      nightlyRateCents: input.nightlyRateCents != null ? BigInt(input.nightlyRateCents) : null,
      cleaningFeeCents: input.cleaningFeeCents != null ? BigInt(input.cleaningFeeCents) : null,
      cityTaxRateBp: input.isBlock ? null : input.cityTaxRateBp,
      cityTaxCents: null,
      priceCents: null,
    };
  }
  const nights = nightsBetween(input.checkin, input.checkout);
  const lodgingCents = BigInt(input.nightlyRateCents) * BigInt(nights);
  const cleaningCents = BigInt(input.cleaningFeeCents ?? 0);
  const cityTaxCents =
    (lodgingCents * BigInt(input.cityTaxRateBp) + 5000n) / 10000n;
  return {
    nightlyRateCents: BigInt(input.nightlyRateCents),
    cleaningFeeCents: input.cleaningFeeCents != null ? BigInt(input.cleaningFeeCents) : null,
    cityTaxRateBp: input.cityTaxRateBp,
    cityTaxCents,
    priceCents: lodgingCents + cleaningCents + cityTaxCents,
  };
}

const EXTERNAL_SOURCES = ['airbnb', 'booking_com', 'expedia', 'other_ota'] as const;
type ExternalSource = (typeof EXTERNAL_SOURCES)[number];
const isExternalSource = (s: string): s is ExternalSource =>
  (EXTERNAL_SOURCES as readonly string[]).includes(s);

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
            // Hide cancelled bookings; they live on for the audit trail
            ne(bookings.status, 'cancelled'),
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

      const breakdown = computeBreakdown({
        isBlock: input.isBlock,
        checkin: input.checkin,
        checkout: input.checkout,
        nightlyRateCents: input.nightlyRateCents ?? null,
        cleaningFeeCents: input.cleaningFeeCents ?? null,
        cityTaxRateBp,
      });

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
          ...breakdown,
          currency: input.currency,
          notes: input.notes,
          autoReviewEnabled: input.isBlock ? false : (input.autoReviewEnabled ?? true),
        })
        .returning();
      return row;
    }),

  /**
   * Edit an existing booking.
   *
   * For internal/block bookings: all fields editable.
   * For external (OTA) bookings: only notes + autoReviewEnabled — the dates,
   * guest, price, etc. are owned by the OTA via Channex.
   *
   * Recomputes the price breakdown if the price-affecting fields change.
   */
  update: editorProcedure
    .input(
      z
        .object({
          id: z.string().uuid(),
          // Editable for internal/block:
          propertyId: z.string().uuid().optional(),
          checkin: dateStr.optional(),
          checkout: dateStr.optional(),
          checkinTime: timeStr.optional(),
          checkoutTime: timeStr.optional(),
          guestCount: z.number().int().min(1).max(50).optional(),
          guestName: z.string().max(120).nullable().optional(),
          guestPhone: z.string().max(40).nullable().optional(),
          guestEmail: z.string().email().max(180).nullable().optional(),
          nightlyRateCents: z.number().int().nonnegative().nullable().optional(),
          cleaningFeeCents: z.number().int().nonnegative().nullable().optional(),
          cityTaxRateBp: z.number().int().min(0).max(10_000).optional(),
          // Always editable:
          notes: z.string().max(2000).nullable().optional(),
          autoReviewEnabled: z.boolean().optional(),
        })
        .refine(
          (v) => !v.checkin || !v.checkout || v.checkin < v.checkout,
          { message: 'checkout must be after checkin', path: ['checkout'] },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      // ── Load current row (need source + current values for partial update) ──
      const current = (
        await ctx.db
          .select()
          .from(bookings)
          .where(and(eq(bookings.id, input.id), eq(bookings.tenantId, ctx.tenantId!)))
          .limit(1)
      )[0];
      if (!current) throw new TRPCError({ code: 'NOT_FOUND' });

      const isExternal = isExternalSource(current.source);

      // External bookings: only notes + autoReviewEnabled editable
      if (isExternal) {
        const patch: Partial<typeof bookings.$inferInsert> = {};
        if (input.notes !== undefined) patch.notes = input.notes;
        if (input.autoReviewEnabled !== undefined) patch.autoReviewEnabled = input.autoReviewEnabled;
        if (Object.keys(patch).length === 0) return current;
        const [row] = await ctx.db
          .update(bookings)
          .set(patch)
          .where(and(eq(bookings.id, input.id), eq(bookings.tenantId, ctx.tenantId!)))
          .returning();
        return row;
      }

      // ── Internal/block: build the merged values ────────────────────────
      const next = {
        propertyId: input.propertyId ?? current.propertyId,
        checkin: input.checkin ?? current.checkin,
        checkout: input.checkout ?? current.checkout,
        checkinTime: input.checkinTime ?? current.checkinTime,
        checkoutTime: input.checkoutTime ?? current.checkoutTime,
        guestCount: input.guestCount ?? current.guestCount,
        guestName: input.guestName !== undefined ? input.guestName : current.guestName,
        guestPhone: input.guestPhone !== undefined ? input.guestPhone : current.guestPhone,
        guestEmail: input.guestEmail !== undefined ? input.guestEmail : current.guestEmail,
        nightlyRateCents:
          input.nightlyRateCents !== undefined
            ? input.nightlyRateCents
            : current.nightlyRateCents != null
              ? Number(current.nightlyRateCents)
              : null,
        cleaningFeeCents:
          input.cleaningFeeCents !== undefined
            ? input.cleaningFeeCents
            : current.cleaningFeeCents != null
              ? Number(current.cleaningFeeCents)
              : null,
        cityTaxRateBp:
          input.cityTaxRateBp ??
          (current.cityTaxRateBp ?? 500),
        notes: input.notes !== undefined ? input.notes : current.notes,
        autoReviewEnabled: input.autoReviewEnabled ?? current.autoReviewEnabled,
      };

      // Overlap check — exclude this row
      const conflicting = await ctx.db
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.tenantId, ctx.tenantId!),
            eq(bookings.propertyId, next.propertyId),
            ne(bookings.id, current.id),
            lt(bookings.checkin, next.checkout),
            gt(bookings.checkout, next.checkin),
            inArray(bookings.status, ['confirmed', 'synced', 'pending_sync', 'blocked']),
          ),
        )
        .limit(1);
      if (conflicting.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Geänderter Zeitraum überlappt eine andere Buchung',
        });
      }

      const isBlock = current.source === 'block';
      const breakdown = computeBreakdown({
        isBlock,
        checkin: next.checkin,
        checkout: next.checkout,
        nightlyRateCents: next.nightlyRateCents,
        cleaningFeeCents: next.cleaningFeeCents,
        cityTaxRateBp: next.cityTaxRateBp,
      });

      const [row] = await ctx.db
        .update(bookings)
        .set({
          propertyId: next.propertyId,
          checkin: next.checkin,
          checkout: next.checkout,
          checkinTime: next.checkinTime,
          checkoutTime: next.checkoutTime,
          guestCount: next.guestCount,
          guestName: isBlock ? null : next.guestName,
          guestPhone: isBlock ? null : next.guestPhone,
          guestEmail: isBlock ? null : next.guestEmail,
          ...breakdown,
          notes: next.notes,
          autoReviewEnabled: isBlock ? false : next.autoReviewEnabled,
          status: current.status === 'sync_failed' ? 'pending_sync' : current.status,
        })
        .where(and(eq(bookings.id, input.id), eq(bookings.tenantId, ctx.tenantId!)))
        .returning();
      return row;
    }),

  /**
   * Delete or cancel a booking.
   *
   * Internal/block: hard-delete from the database.
   * External (OTA): soft-cancel — flip status to 'cancelled' so the audit
   * trail stays intact. Enqueue a sync job to push availability back to 1
   * for the released dates (Phase 5 worker actually executes it).
   */
  delete: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const current = (
        await ctx.db
          .select()
          .from(bookings)
          .where(and(eq(bookings.id, input.id), eq(bookings.tenantId, ctx.tenantId!)))
          .limit(1)
      )[0];
      if (!current) throw new TRPCError({ code: 'NOT_FOUND' });

      const releaseDates = {
        from: current.checkin,
        to: current.checkout,
        propertyId: current.propertyId,
      };

      if (isExternalSource(current.source)) {
        // Soft cancel + queue an availability push
        await ctx.db
          .update(bookings)
          .set({ status: 'cancelled' })
          .where(and(eq(bookings.id, input.id), eq(bookings.tenantId, ctx.tenantId!)));
      } else {
        // Internal or block — hard delete
        await ctx.db
          .delete(bookings)
          .where(and(eq(bookings.id, input.id), eq(bookings.tenantId, ctx.tenantId!)));
      }

      // Enqueue a sync job for the released availability. Phase 5's worker
      // picks this up and pushes availability=1 for the date range to Channex.
      await ctx.db.insert(syncJobs).values({
        tenantId: ctx.tenantId!,
        propertyId: current.propertyId,
        bookingId: null, // booking may have been deleted
        type: 'push_availability',
        status: 'queued',
        payload: {
          action: 'release',
          ...releaseDates,
          reason: isExternalSource(current.source) ? 'external_cancel' : 'internal_delete',
        },
      });

      return {
        id: input.id,
        cancelled: isExternalSource(current.source),
      };
    }),
});
