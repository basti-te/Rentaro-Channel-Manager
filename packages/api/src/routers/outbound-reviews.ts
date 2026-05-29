import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { outboundReviews, bookings, properties } from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';

/**
 * The outbound (host-to-guest) review queue. Created by the
 * `outbound-reviews-dispatch` cron 3 days after checkout for any booking
 * with `autoReviewEnabled=true` whose tenant has a default template
 * for the matching language. UI surfaces these per booking so the
 * operator can spot-check / skip before they're actually pushed to
 * Channex (which is wired separately, in Phase B).
 *
 * Status lifecycle:  queued → sent | failed | skipped
 */

export const outboundReviewsRouter = router({
  /** Paginated list with optional status filter. Mostly used in the
   *  Reviews overview screen. Property + booking metadata joined for
   *  the row card. */
  list: tenantProcedure
    .input(
      z
        .object({
          status: z
            .enum(['queued', 'sent', 'failed', 'skipped'])
            .optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const where = input?.status
        ? and(
            eq(outboundReviews.tenantId, ctx.tenantId!),
            eq(outboundReviews.status, input.status),
          )
        : eq(outboundReviews.tenantId, ctx.tenantId!);

      return ctx.db
        .select({
          id: outboundReviews.id,
          status: outboundReviews.status,
          renderedText: outboundReviews.renderedText,
          starRating: outboundReviews.starRating,
          scheduledAt: outboundReviews.scheduledAt,
          sentAt: outboundReviews.sentAt,
          channexReviewId: outboundReviews.channexReviewId,
          error: outboundReviews.error,
          createdAt: outboundReviews.createdAt,
          bookingId: outboundReviews.bookingId,
          guestName: bookings.guestName,
          checkin: bookings.checkin,
          checkout: bookings.checkout,
          source: bookings.source,
          propertyName: properties.name,
        })
        .from(outboundReviews)
        .leftJoin(bookings, eq(bookings.id, outboundReviews.bookingId))
        .leftJoin(properties, eq(properties.id, outboundReviews.propertyId))
        .where(where)
        .orderBy(desc(outboundReviews.scheduledAt))
        .limit(input?.limit ?? 50);
    }),

  /** Single lookup by booking — used inside BookingDetailSheet. */
  byBooking: tenantProcedure
    .input(z.object({ bookingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(outboundReviews)
        .where(
          and(
            eq(outboundReviews.tenantId, ctx.tenantId!),
            eq(outboundReviews.bookingId, input.bookingId),
          ),
        )
        .limit(1);
      return row ?? null;
    }),

  /** Operator opts out of the queued review for a single booking.
   *  Idempotent — calling on an already-sent or skipped row is a no-op. */
  skip: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(outboundReviews)
        .set({
          status: 'skipped',
          skippedBy: ctx.userId!,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(outboundReviews.id, input.id),
            eq(outboundReviews.tenantId, ctx.tenantId!),
            eq(outboundReviews.status, 'queued'),
          ),
        )
        .returning({ id: outboundReviews.id });
      if (!row) {
        // Not necessarily an error — could be already sent / skipped.
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Review nicht mehr in der Warteschlange.',
        });
      }
      return { ok: true };
    }),

  /** Re-enable a previously-skipped review — operator changed their mind
   *  and wants it to fire on the next dispatch tick. */
  requeue: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(outboundReviews)
        .set({ status: 'queued', skippedBy: null, error: null, updatedAt: new Date() })
        .where(
          and(
            eq(outboundReviews.id, input.id),
            eq(outboundReviews.tenantId, ctx.tenantId!),
            inArray(outboundReviews.status, ['skipped', 'failed']),
          ),
        )
        .returning({ id: outboundReviews.id });
      if (!row) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Nur übersprungene oder fehlgeschlagene Reviews können erneut aktiviert werden.',
        });
      }
      return { ok: true };
    }),
});
