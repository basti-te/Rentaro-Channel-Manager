import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { messageTemplates, tenants } from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';
import { renderTemplate, SAMPLE_VARS, TEMPLATE_VARS } from '../services/templates';
import { sendSms } from '../services/twilio';

const channel = z.enum(['sms', 'airbnb', 'booking_com', 'email']);

/** Loose E.164 check — Twilio does the authoritative validation. */
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Erwartet wird eine Nummer im Format +49170…');

export const messageTemplatesRouter = router({
  /** Placeholder catalog for the editor's insert hints. */
  vars: tenantProcedure.query(() => TEMPLATE_VARS),

  list: tenantProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.tenantId, ctx.tenantId!))
      .orderBy(desc(messageTemplates.createdAt));
  }),

  create: editorProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        channel,
        /** Trigger DSL (e.g. "checkin:-1d@18:00"). Stored now, evaluated in M3. */
        trigger: z.string().min(1).max(60),
        language: z.string().min(2).max(8).default('de'),
        body: z.string().min(1).max(2000),
        active: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(messageTemplates)
        .values({
          tenantId: ctx.tenantId!,
          name: input.name,
          channel: input.channel,
          trigger: input.trigger,
          language: input.language,
          body: input.body,
          active: input.active,
        })
        .returning();
      return row;
    }),

  update: editorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        channel: channel.optional(),
        trigger: z.string().min(1).max(60).optional(),
        language: z.string().min(2).max(8).optional(),
        body: z.string().min(1).max(2000).optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      if (Object.keys(patch).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nichts zu ändern' });
      }
      const [row] = await ctx.db
        .update(messageTemplates)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(messageTemplates.id, id),
            eq(messageTemplates.tenantId, ctx.tenantId!),
          ),
        )
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  delete: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db
        .delete(messageTemplates)
        .where(
          and(
            eq(messageTemplates.id, input.id),
            eq(messageTemplates.tenantId, ctx.tenantId!),
          ),
        )
        .returning({ id: messageTemplates.id });
      if (res.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),

  /**
   * Render a body with sample data and (for SMS) actually send it via Twilio
   * to a test number. OTA channels can't be test-sent without a real guest
   * thread, so those return the preview only. Always returns the rendered
   * preview so the editor can show it.
   */
  sendTest: editorProcedure
    .input(
      z.object({
        body: z.string().min(1).max(2000),
        channel,
        toPhone: phone.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const preview = renderTemplate(input.body, SAMPLE_VARS);

      if (input.channel !== 'sms') {
        return {
          sent: false,
          preview,
          info: `Test-Versand ist nur für SMS möglich. Kanal "${input.channel}" zeigt nur die Vorschau (Versand erfolgt später automatisch im Buchungs-Thread).`,
        };
      }

      if (!input.toPhone) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Test-Telefonnummer fehlt (Format +49170…).',
        });
      }

      // Per-tenant sender wins; fall back to the account-wide env default.
      const tenantRow = (
        await ctx.db
          .select({ smsSenderId: tenants.smsSenderId })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId!))
          .limit(1)
      )[0];
      const from = tenantRow?.smsSenderId || ctx.env.TWILIO_FROM;

      const result = await sendSms(
        {
          accountSid: ctx.env.TWILIO_ACCOUNT_SID,
          authToken: ctx.env.TWILIO_AUTH_TOKEN,
          from,
        },
        input.toPhone,
        preview,
      );

      if (result.ok) {
        return { sent: true, preview, info: `SMS gesendet (Twilio-Status: ${result.status}).` };
      }
      if (result.reason === 'not_configured') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'Twilio ist nicht konfiguriert. TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM in .env.local setzen.',
        });
      }
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `SMS-Versand fehlgeschlagen: ${result.message}`,
      });
    }),
});
