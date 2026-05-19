import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  bookings,
  channexProperties,
  messages,
  messageBookingOverrides,
  messageTemplateListings,
  messageTemplates,
  properties,
  tenants,
} from '@cm/db';
import { createChannexClient, ChannexError } from '@cm/channex';
import { router, tenantProcedure, editorProcedure } from '../trpc';
import { computeDueAt } from '../services/triggers';
import { buildBookingVars, renderTemplate } from '../services/templates';
import { isTemplateEnabledForBooking } from '../services/scope';

/**
 * Channex iframe path for the guest-messaging screen. The mapping iframe
 * uses `/channels`; messaging is `/messages`. Kept as a constant so it's
 * easy to adjust once verified against the sandbox (requires the Channex
 * "Messages app" installed on the property).
 */
const CHANNEX_MESSAGES_PATH = '/messages';

/** One row in a booking's message timeline (sent rows + projected sends). */
export interface MessageTimelineItem {
  key: string;
  /** Active template this row maps to (null for manual / deleted-template). */
  templateId: string | null;
  title: string;
  channel: string;
  trigger: string | null;
  status:
    | 'off'
    | 'planned'
    | 'pending'
    | 'queued'
    | 'sending'
    | 'sent'
    | 'delivered'
    | 'failed';
  /** Effective on/off for THIS booking (override ?? apartment scope). */
  enabled: boolean;
  /** A per-booking override row exists (vs. inheriting the apartment scope). */
  overridden: boolean;
  /** ISO — sent time, or the projected due time for not-yet-sent items. */
  at: string | null;
  body: string;
  error: string | null;
}

export const messagesRouter = router({
  /** Automated/sent messages for a booking (status timeline for the UI). */
  listByBooking: tenantProcedure
    .input(z.object({ bookingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: messages.id,
          channel: messages.channel,
          direction: messages.direction,
          body: messages.body,
          status: messages.status,
          scheduledAt: messages.scheduledAt,
          sentAt: messages.sentAt,
          deliveredAt: messages.deliveredAt,
          error: messages.error,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, ctx.tenantId!),
            eq(messages.bookingId, input.bookingId),
          ),
        )
        .orderBy(desc(messages.createdAt));
    }),

  /**
   * Per-booking message timeline: merges the projected schedule of every
   * active template (computed from its trigger) with the rows that already
   * exist in `messages`. Lets the booking detail show, at a glance, what
   * was sent and what is still planned.
   *
   * Items:
   *   - active template with no row yet → status `planned` (future) or
   *     `pending` (due, next cron will send), preview rendered from booking
   *   - active template with a row     → the row's real status/timestamps
   *   - row without a matching active template (manual / deleted template)
   *     → standalone history item
   */
  timelineForBooking: tenantProcedure
    .input(z.object({ bookingId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const bk = (
        await ctx.db
          .select({
            id: bookings.id,
            tenantId: bookings.tenantId,
            propertyId: bookings.propertyId,
            guestName: bookings.guestName,
            checkin: bookings.checkin,
            checkout: bookings.checkout,
            checkinTime: bookings.checkinTime,
            checkoutTime: bookings.checkoutTime,
            guestCount: bookings.guestCount,
            otaConfirmationCode: bookings.otaConfirmationCode,
            createdAt: bookings.createdAt,
            propertyName: properties.name,
          })
          .from(bookings)
          .innerJoin(properties, eq(properties.id, bookings.propertyId))
          .where(
            and(
              eq(bookings.id, input.bookingId),
              eq(bookings.tenantId, ctx.tenantId!),
            ),
          )
          .limit(1)
      )[0];
      if (!bk) throw new TRPCError({ code: 'NOT_FOUND' });

      const tz =
        (
          await ctx.db
            .select({ tz: tenants.defaultTimezone })
            .from(tenants)
            .where(eq(tenants.id, ctx.tenantId!))
            .limit(1)
        )[0]?.tz ?? 'Europe/Berlin';

      const tpls = await ctx.db
        .select({
          id: messageTemplates.id,
          name: messageTemplates.name,
          channel: messageTemplates.channel,
          trigger: messageTemplates.trigger,
          body: messageTemplates.body,
        })
        .from(messageTemplates)
        .where(
          and(
            eq(messageTemplates.tenantId, ctx.tenantId!),
            eq(messageTemplates.active, true),
          ),
        );

      const rows = await ctx.db
        .select({
          id: messages.id,
          templateId: messages.templateId,
          channel: messages.channel,
          body: messages.body,
          status: messages.status,
          scheduledAt: messages.scheduledAt,
          sentAt: messages.sentAt,
          deliveredAt: messages.deliveredAt,
          error: messages.error,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, ctx.tenantId!),
            eq(messages.bookingId, input.bookingId),
          ),
        );

      const vars = buildBookingVars({
        guestName: bk.guestName,
        checkin: bk.checkin,
        checkout: bk.checkout,
        checkinTime: bk.checkinTime,
        checkoutTime: bk.checkoutTime,
        guestCount: bk.guestCount,
        otaConfirmationCode: bk.otaConfirmationCode,
        propertyName: bk.propertyName,
      });
      const now = Date.now();
      const rowByTpl = new Map(
        rows.filter((r) => r.templateId).map((r) => [r.templateId!, r]),
      );

      // Effective scope for THIS booking: which templates include this
      // property, plus any per-booking overrides.
      const tplIds = tpls.map((t) => t.id);
      const inScope = new Set(
        tplIds.length === 0
          ? []
          : (
              await ctx.db
                .select({ templateId: messageTemplateListings.templateId })
                .from(messageTemplateListings)
                .where(
                  and(
                    eq(messageTemplateListings.propertyId, bk.propertyId),
                    inArray(messageTemplateListings.templateId, tplIds),
                  ),
                )
            ).map((r) => r.templateId),
      );
      const overrideByTpl = new Map(
        (
          await ctx.db
            .select({
              templateId: messageBookingOverrides.templateId,
              enabled: messageBookingOverrides.enabled,
            })
            .from(messageBookingOverrides)
            .where(eq(messageBookingOverrides.bookingId, input.bookingId))
        ).map((r) => [r.templateId, r.enabled]),
      );

      const items: MessageTimelineItem[] = [];

      // Every active template is listed (so the booking detail can toggle
      // it on/off for this booking); status reflects scope/override/rows.
      for (const t of tpls) {
        const overrideVal = overrideByTpl.get(t.id);
        const enabled = isTemplateEnabledForBooking({
          propertyId: bk.propertyId,
          scopedPropertyIds: inScope.has(t.id)
            ? new Set([bk.propertyId])
            : new Set(),
          override: overrideVal,
        });
        const overridden = overrideVal !== undefined;
        const row = rowByTpl.get(t.id);
        const due = computeDueAt(t.trigger, {
          checkin: bk.checkin,
          checkout: bk.checkout,
          createdAt: bk.createdAt,
          timeZone: tz,
        });
        if (row) {
          items.push({
            key: `tpl-${t.id}`,
            templateId: t.id,
            title: t.name,
            channel: row.channel,
            trigger: t.trigger,
            status: row.status as MessageTimelineItem['status'],
            enabled,
            overridden,
            at: (row.sentAt ?? row.scheduledAt ?? null)?.toISOString() ?? null,
            body: row.body,
            error: row.error,
          });
        } else {
          items.push({
            key: `tpl-${t.id}`,
            templateId: t.id,
            title: t.name,
            channel: t.channel,
            trigger: t.trigger,
            status: !enabled
              ? 'off'
              : due && due.getTime() > now
                ? 'planned'
                : 'pending',
            enabled,
            overridden,
            at: due ? due.toISOString() : null,
            body: renderTemplate(t.body, vars),
            error: null,
          });
        }
      }

      // Rows with no active template (manual or deleted-template history).
      for (const r of rows) {
        if (r.templateId && tpls.some((t) => t.id === r.templateId)) continue;
        items.push({
          key: `msg-${r.id}`,
          templateId: null,
          title: r.templateId ? 'Vorlage (entfernt)' : 'Manuell',
          channel: r.channel,
          trigger: null,
          status: r.status as MessageTimelineItem['status'],
          enabled: true,
          overridden: false,
          at: (r.sentAt ?? r.scheduledAt ?? r.createdAt)?.toISOString() ?? null,
          body: r.body,
          error: r.error,
        });
      }

      items.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
      return items;
    }),

  /**
   * Per-booking override of a template's apartment scope.
   *   enabled=true  → force on for this booking
   *   enabled=false → force off for this booking
   *   enabled=null  → clear the override (inherit apartment scope)
   */
  setBookingOverride: editorProcedure
    .input(
      z.object({
        bookingId: z.string().uuid(),
        templateId: z.string().uuid(),
        enabled: z.boolean().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Ownership: booking + template must belong to the tenant.
      const ok = (
        await ctx.db
          .select({ id: bookings.id })
          .from(bookings)
          .where(
            and(
              eq(bookings.id, input.bookingId),
              eq(bookings.tenantId, ctx.tenantId!),
            ),
          )
          .limit(1)
      )[0];
      if (!ok) throw new TRPCError({ code: 'NOT_FOUND' });
      const tpl = (
        await ctx.db
          .select({ id: messageTemplates.id })
          .from(messageTemplates)
          .where(
            and(
              eq(messageTemplates.id, input.templateId),
              eq(messageTemplates.tenantId, ctx.tenantId!),
            ),
          )
          .limit(1)
      )[0];
      if (!tpl) throw new TRPCError({ code: 'NOT_FOUND' });

      if (input.enabled === null) {
        await ctx.db
          .delete(messageBookingOverrides)
          .where(
            and(
              eq(messageBookingOverrides.bookingId, input.bookingId),
              eq(messageBookingOverrides.templateId, input.templateId),
            ),
          );
        return { cleared: true };
      }

      await ctx.db
        .insert(messageBookingOverrides)
        .values({
          bookingId: input.bookingId,
          templateId: input.templateId,
          enabled: input.enabled,
        })
        .onConflictDoUpdate({
          target: [
            messageBookingOverrides.bookingId,
            messageBookingOverrides.templateId,
          ],
          set: { enabled: input.enabled, updatedAt: new Date() },
        });
      return { enabled: input.enabled };
    }),

  /**
   * Mint a short-lived Channex one-time token server-side and return the
   * ready-to-embed iframe URL for a property's guest inbox.
   *
   * The API key never reaches the browser — only the single-use OTT does,
   * inside the iframe `oauth_session_key`. Token TTL 15 min; once the iframe
   * loads Channex exchanges it for a session with no further expiry.
   */
  iframeSession: editorProcedure
    .input(z.object({ propertyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Resolve the Channex property UUID for this internal property,
      // scoped to the caller's tenant.
      const mapping = (
        await ctx.db
          .select({ channexPropertyId: channexProperties.channexPropertyId })
          .from(properties)
          .innerJoin(
            channexProperties,
            eq(properties.channexPropertyRef, channexProperties.id),
          )
          .where(
            and(
              eq(properties.id, input.propertyId),
              eq(properties.tenantId, ctx.tenantId!),
            ),
          )
          .limit(1)
      )[0];

      if (!mapping) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Property is not connected to Channex',
        });
      }

      const channex = createChannexClient({
        baseUrl: ctx.env.CHANNEX_API_URL,
        apiKey: ctx.env.CHANNEX_API_KEY,
      });

      let token: string;
      try {
        token = await channex.auth.createOneTimeToken({
          propertyId: mapping.channexPropertyId,
          username: ctx.userEmail ?? `tenant:${ctx.tenantId}`,
        });
      } catch (err) {
        if (err instanceof ChannexError) {
          throw new TRPCError({
            code: 'BAD_GATEWAY',
            message:
              `Channex one_time_token failed (${err.status ?? '?'}): ${err.message}. ` +
              'Ist die Channex "Messages app" auf dieser Property installiert?',
          });
        }
        throw err;
      }

      // The iframe lives on the Channex app origin, NOT the /api/v1 base.
      const appOrigin = new URL(ctx.env.CHANNEX_API_URL).origin;
      const url =
        `${appOrigin}/auth/exchange` +
        `?oauth_session_key=${encodeURIComponent(token)}` +
        `&app_mode=headless` +
        `&redirect_to=${encodeURIComponent(CHANNEX_MESSAGES_PATH)}` +
        `&property_id=${encodeURIComponent(mapping.channexPropertyId)}`;

      return { url };
    }),
});
