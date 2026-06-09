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
});
