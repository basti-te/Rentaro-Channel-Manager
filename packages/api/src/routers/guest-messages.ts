import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { bookings, guestMessages, teammateDispatches } from '@cm/db';
import { createChannexClient, ChannexError } from '@cm/channex';
import { router, tenantProcedure, editorProcedure } from '../trpc';

/**
 * Guest conversation (Airbnb / Booking.com) ingested from Channex + the AI
 * assistant's drafts. The Channex iframe still handles free-form reading;
 * this powers the in-app thread view, AI-draft review, and the dispatch log.
 */
export const guestMessagesRouter = router({
  /** Full thread (real messages + AI drafts) + teammate dispatches for a booking. */
  thread: tenantProcedure
    .input(z.object({ bookingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const messages = await ctx.db
        .select({
          id: guestMessages.id,
          direction: guestMessages.direction,
          sender: guestMessages.sender,
          body: guestMessages.body,
          status: guestMessages.status,
          aiGenerated: guestMessages.aiGenerated,
          error: guestMessages.error,
          otaCreatedAt: guestMessages.otaCreatedAt,
          createdAt: guestMessages.createdAt,
        })
        .from(guestMessages)
        .where(
          and(
            eq(guestMessages.tenantId, ctx.tenantId!),
            eq(guestMessages.bookingId, input.bookingId),
          ),
        )
        .orderBy(asc(sql`coalesce(${guestMessages.otaCreatedAt}, ${guestMessages.createdAt})`));

      const dispatches = await ctx.db
        .select({
          id: teammateDispatches.id,
          role: teammateDispatches.role,
          summary: teammateDispatches.summary,
          urgency: teammateDispatches.urgency,
          status: teammateDispatches.status,
          createdAt: teammateDispatches.createdAt,
        })
        .from(teammateDispatches)
        .where(
          and(
            eq(teammateDispatches.tenantId, ctx.tenantId!),
            eq(teammateDispatches.bookingId, input.bookingId),
          ),
        )
        .orderBy(desc(teammateDispatches.createdAt));

      return { messages, dispatches };
    }),

  /** Universal inbox — one row per conversation across ALL apartments, with
   *  unread count + pending-draft flag, sorted with "needs attention" first. */
  inbox: tenantProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.execute<{
      booking_id: string;
      guest_name: string | null;
      source: string;
      checkin: string;
      checkout: string;
      apartment_name: string;
      last_body: string;
      last_direction: string;
      last_at: string;
      unread: number;
      has_draft: boolean;
    }>(sql`
      SELECT b.id AS booking_id, b.guest_name, b.source, b.checkin, b.checkout,
             p.name AS apartment_name,
             lm.body AS last_body, lm.direction AS last_direction, lm.ts AS last_at,
             COALESCE(u.unread, 0) AS unread,
             COALESCE(d.has_draft, false) AS has_draft
      FROM bookings b
      JOIN properties p ON p.id = b.property_id
      JOIN LATERAL (
        SELECT gm.body, gm.direction, COALESCE(gm.ota_created_at, gm.created_at) AS ts
        FROM guest_messages gm
        WHERE gm.booking_id = b.id AND gm.status IN ('received', 'sent')
        ORDER BY COALESCE(gm.ota_created_at, gm.created_at) DESC
        LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS unread FROM guest_messages gm
        WHERE gm.booking_id = b.id AND gm.direction = 'inbound'
          AND COALESCE(gm.ota_created_at, gm.created_at) > COALESCE(b.guest_messages_read_at, to_timestamp(0))
      ) u ON true
      LEFT JOIN LATERAL (
        SELECT true AS has_draft FROM guest_messages gm
        WHERE gm.booking_id = b.id AND gm.status = 'draft' LIMIT 1
      ) d ON true
      WHERE b.tenant_id = ${ctx.tenantId!}
      ORDER BY (COALESCE(d.has_draft, false) OR COALESCE(u.unread, 0) > 0) DESC, lm.ts DESC
      LIMIT 200
    `);
    return rows.map((r) => ({
      bookingId: r.booking_id,
      guestName: r.guest_name,
      apartmentName: r.apartment_name,
      source: r.source,
      checkin: r.checkin,
      checkout: r.checkout,
      lastBody: r.last_body,
      lastDirection: r.last_direction,
      lastAt: r.last_at,
      unread: Number(r.unread),
      hasDraft: !!r.has_draft,
      needsReply: r.last_direction === 'inbound',
    }));
  }),

  /** Mark a booking's thread as read (now). */
  markRead: editorProcedure
    .input(z.object({ bookingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(bookings)
        .set({ guestMessagesReadAt: new Date() })
        .where(and(eq(bookings.id, input.bookingId), eq(bookings.tenantId, ctx.tenantId!)));
      return { ok: true };
    }),

  /** Approve (optionally edited) an AI draft → send to the OTA thread. */
  approveDraft: editorProcedure
    .input(z.object({ id: z.string().uuid(), body: z.string().trim().min(1).max(4000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const draft = (
        await ctx.db
          .select({
            id: guestMessages.id,
            bookingId: guestMessages.bookingId,
            body: guestMessages.body,
            status: guestMessages.status,
          })
          .from(guestMessages)
          .where(and(eq(guestMessages.id, input.id), eq(guestMessages.tenantId, ctx.tenantId!)))
          .limit(1)
      )[0];
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND' });
      if (draft.status !== 'draft') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Kein offener Entwurf.' });
      }

      const bk = (
        await ctx.db
          .select({ channexBookingId: bookings.channexBookingId })
          .from(bookings)
          .where(eq(bookings.id, draft.bookingId))
          .limit(1)
      )[0];
      if (!bk?.channexBookingId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Keine Channex-Buchung — Nachricht kann nicht gesendet werden.',
        });
      }

      const text = input.body?.trim() || draft.body;
      const channex = createChannexClient({
        baseUrl: ctx.env.CHANNEX_API_URL,
        apiKey: ctx.env.CHANNEX_API_KEY,
      });
      try {
        await channex.bookings.sendMessage(bk.channexBookingId, text);
      } catch (e) {
        await ctx.db
          .update(guestMessages)
          .set({
            body: text,
            status: 'failed',
            error: e instanceof ChannexError ? e.message : String(e),
            updatedAt: new Date(),
          })
          .where(eq(guestMessages.id, draft.id));
        throw new TRPCError({ code: 'BAD_GATEWAY', message: 'Senden an den Kanal fehlgeschlagen.' });
      }

      await ctx.db
        .update(guestMessages)
        .set({ body: text, status: 'sent', error: null, updatedAt: new Date() })
        .where(eq(guestMessages.id, draft.id));
      return { ok: true };
    }),

  /** Discard an AI draft without sending. */
  dismissDraft: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(guestMessages)
        .set({ status: 'dismissed', updatedAt: new Date() })
        .where(
          and(
            eq(guestMessages.id, input.id),
            eq(guestMessages.tenantId, ctx.tenantId!),
            eq(guestMessages.status, 'draft'),
          ),
        )
        .returning({ id: guestMessages.id });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),

  /** Send a free-text host reply into the OTA thread (manual, not an AI draft). */
  sendReply: editorProcedure
    .input(z.object({ bookingId: z.string().uuid(), body: z.string().trim().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const bk = (
        await ctx.db
          .select({ channexBookingId: bookings.channexBookingId })
          .from(bookings)
          .where(and(eq(bookings.id, input.bookingId), eq(bookings.tenantId, ctx.tenantId!)))
          .limit(1)
      )[0];
      if (!bk?.channexBookingId) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Keine Channex-Buchung.' });
      }
      const channex = createChannexClient({
        baseUrl: ctx.env.CHANNEX_API_URL,
        apiKey: ctx.env.CHANNEX_API_KEY,
      });
      try {
        await channex.bookings.sendMessage(bk.channexBookingId, input.body);
      } catch (e) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: e instanceof ChannexError ? e.message : 'Senden fehlgeschlagen.',
        });
      }
      // Echo immediately + clear any open AI draft (we replied ourselves).
      await ctx.db.insert(guestMessages).values({
        tenantId: ctx.tenantId!,
        bookingId: input.bookingId,
        direction: 'outbound',
        sender: 'host',
        body: input.body,
        status: 'sent',
        aiGenerated: false,
      });
      await ctx.db
        .update(guestMessages)
        .set({ status: 'dismissed', updatedAt: new Date() })
        .where(
          and(eq(guestMessages.bookingId, input.bookingId), eq(guestMessages.status, 'draft')),
        );
      return { ok: true };
    }),
});
