import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, between, desc, eq, inArray } from 'drizzle-orm';
import {
  bookings,
  cleaningCalendars,
  properties,
  propertyGroups,
} from '@cm/db';
import { router, tenantProcedure, editorProcedure, publicProcedure } from '../trpc';

/**
 * Cleaning calendars — operator-managed public, shareable read-only links
 * for cleaning staff. Lives at `rentaro.cloud/cal/<slug>`. No login required.
 *
 * The router has two layers:
 *
 *   1. tenant/editor procedures — list, create, update, delete, regenerate
 *      Operator UI under /cleaning/calendars manages calendar links here.
 *
 *   2. publicProcedure `getPublic(slug)` — read-only fetch for the public
 *      page. Returns the calendar config + bookings already filtered to
 *      respect the show_* flags. Hidden fields are never serialised.
 */

const fieldFlags = z.object({
  showGuestName: z.boolean(),
  showGuestCount: z.boolean(),
  showGuestPhone: z.boolean(),
  showGuestEmail: z.boolean(),
  showNotes: z.boolean(),
  showHostNotes: z.boolean(),
  showPrice: z.boolean(),
  showBookingCode: z.boolean(),
});

const createInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    propertyIds: z.array(z.string().uuid()).default([]),
    isActive: z.boolean().default(true),
  })
  .merge(fieldFlags.partial());

const updateInput = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80).optional(),
    propertyIds: z.array(z.string().uuid()).optional(),
    isActive: z.boolean().optional(),
  })
  .merge(fieldFlags.partial());

/** 24 bytes ≈ 32-char base64url token. ~190 bits of entropy. */
function generateSlug(): string {
  return randomBytes(24).toString('base64url');
}

export const cleaningCalendarsRouter = router({
  // ── Operator-side (auth required) ──────────────────────────────────────

  list: tenantProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(cleaningCalendars)
      .where(eq(cleaningCalendars.tenantId, ctx.tenantId!))
      .orderBy(desc(cleaningCalendars.createdAt));
    return rows;
  }),

  create: editorProcedure
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      // Verify all referenced properties belong to this tenant.
      if (input.propertyIds.length > 0) {
        const owned = await ctx.db
          .select({ id: properties.id })
          .from(properties)
          .where(
            and(
              eq(properties.tenantId, ctx.tenantId!),
              inArray(properties.id, input.propertyIds),
            ),
          );
        if (owned.length !== input.propertyIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Eine oder mehrere Apartments gehören nicht zu deinem Workspace.',
          });
        }
      }

      const [row] = await ctx.db
        .insert(cleaningCalendars)
        .values({
          tenantId: ctx.tenantId!,
          name: input.name,
          slug: generateSlug(),
          isActive: input.isActive,
          propertyIds: input.propertyIds,
          showGuestName: input.showGuestName ?? true,
          showGuestCount: input.showGuestCount ?? false,
          showGuestPhone: input.showGuestPhone ?? false,
          showGuestEmail: input.showGuestEmail ?? false,
          showNotes: input.showNotes ?? false,
          showHostNotes: input.showHostNotes ?? false,
          showPrice: input.showPrice ?? false,
          showBookingCode: input.showBookingCode ?? false,
        })
        .returning();
      return row!;
    }),

  update: editorProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, propertyIds, ...patch } = input;

      // Same tenant ownership check for any newly-referenced properties.
      if (propertyIds && propertyIds.length > 0) {
        const owned = await ctx.db
          .select({ id: properties.id })
          .from(properties)
          .where(
            and(
              eq(properties.tenantId, ctx.tenantId!),
              inArray(properties.id, propertyIds),
            ),
          );
        if (owned.length !== propertyIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Eine oder mehrere Apartments gehören nicht zu deinem Workspace.',
          });
        }
      }

      const [row] = await ctx.db
        .update(cleaningCalendars)
        .set({
          ...patch,
          ...(propertyIds !== undefined && { propertyIds }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(cleaningCalendars.id, id),
            eq(cleaningCalendars.tenantId, ctx.tenantId!),
          ),
        )
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  delete: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(cleaningCalendars)
        .where(
          and(
            eq(cleaningCalendars.id, input.id),
            eq(cleaningCalendars.tenantId, ctx.tenantId!),
          ),
        )
        .returning({ id: cleaningCalendars.id });
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),

  /** Rotate the slug to revoke an in-the-wild URL without losing settings. */
  regenerateSlug: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(cleaningCalendars)
        .set({ slug: generateSlug(), updatedAt: new Date() })
        .where(
          and(
            eq(cleaningCalendars.id, input.id),
            eq(cleaningCalendars.tenantId, ctx.tenantId!),
          ),
        )
        .returning({ id: cleaningCalendars.id, slug: cleaningCalendars.slug });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  // ── Public read-only side (no auth) ────────────────────────────────────

  /**
   * Public lookup. Returns the calendar config + bookings inside a fixed
   * forward window. The result respects the show_* flags — hidden fields
   * are scrubbed server-side, so the API response itself can't leak
   * anything the operator chose to keep private.
   */
  getPublic: publicProcedure
    .input(
      z.object({
        slug: z.string().min(8).max(64),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ ctx, input }) => {
      const [cal] = await ctx.db
        .select()
        .from(cleaningCalendars)
        .where(
          and(
            eq(cleaningCalendars.slug, input.slug),
            eq(cleaningCalendars.isActive, true),
          ),
        )
        .limit(1);
      if (!cal) throw new TRPCError({ code: 'NOT_FOUND' });

      // Which apartments? An empty propertyIds means "all in tenant".
      let propertyIdFilter: string[];
      if (cal.propertyIds.length === 0) {
        const props = await ctx.db
          .select({ id: properties.id })
          .from(properties)
          .where(
            and(
              eq(properties.tenantId, cal.tenantId),
              eq(properties.active, true),
            ),
          );
        propertyIdFilter = props.map((p) => p.id);
      } else {
        propertyIdFilter = cal.propertyIds;
      }

      const props = await ctx.db
        .select({
          id: properties.id,
          name: properties.name,
          groupId: properties.groupId,
          sortOrder: properties.sortOrder,
        })
        .from(properties)
        .where(inArray(properties.id, propertyIdFilter))
        .orderBy(asc(properties.sortOrder), asc(properties.name));

      const groups = await ctx.db
        .select({
          id: propertyGroups.id,
          name: propertyGroups.name,
          color: propertyGroups.color,
          sortOrder: propertyGroups.sortOrder,
        })
        .from(propertyGroups)
        .where(eq(propertyGroups.tenantId, cal.tenantId))
        .orderBy(asc(propertyGroups.sortOrder), asc(propertyGroups.name));

      const rawBookings =
        propertyIdFilter.length === 0
          ? []
          : await ctx.db
              .select()
              .from(bookings)
              .where(
                and(
                  inArray(bookings.propertyId, propertyIdFilter),
                  between(bookings.checkin, input.from, input.to),
                ),
              )
              .orderBy(asc(bookings.checkin));

      // Server-side scrubbing — hidden fields are nulled before the
      // payload ever leaves this process. Cancelled bookings drop out.
      const sanitised = rawBookings
        .filter((b) => b.status !== 'cancelled')
        .map((b) => ({
          id: b.id,
          propertyId: b.propertyId,
          source: b.source,
          status: b.status,
          checkin: b.checkin,
          checkout: b.checkout,
          checkinTime: b.checkinTime,
          checkoutTime: b.checkoutTime,
          guestName: cal.showGuestName ? b.guestName : null,
          guestCount: cal.showGuestCount ? b.guestCount : null,
          guestPhone: cal.showGuestPhone ? b.guestPhone : null,
          guestEmail: cal.showGuestEmail ? b.guestEmail : null,
          notes: cal.showNotes ? b.notes : null,
          hostNotes: cal.showHostNotes ? b.notes : null,
          priceCents: cal.showPrice ? b.priceCents : null,
          currency: cal.showPrice ? b.currency : null,
          bookingCode: cal.showBookingCode ? b.otaConfirmationCode : null,
        }));

      return {
        calendar: {
          name: cal.name,
          showGuestName: cal.showGuestName,
          showGuestCount: cal.showGuestCount,
          showGuestPhone: cal.showGuestPhone,
          showGuestEmail: cal.showGuestEmail,
          showNotes: cal.showNotes,
          showHostNotes: cal.showHostNotes,
          showPrice: cal.showPrice,
          showBookingCode: cal.showBookingCode,
        },
        groups,
        properties: props,
        bookings: sanitised,
      };
    }),
});
