import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  messageTemplateListings,
  messageTemplates,
  messageVariables,
  properties,
  tenants,
} from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';
import { renderTemplate, SAMPLE_VARS, TEMPLATE_VARS } from '../services/templates';
import { resolveCustomVars } from '../services/custom-vars';
import { sendSms } from '../services/twilio';
import { parseTrigger } from '../services/triggers';
import type { Database } from '@cm/db';

const channel = z.enum(['sms', 'airbnb', 'booking_com', 'email']);

/** Reject trigger strings the dispatcher can't parse. */
const triggerStr = z
  .string()
  .min(1)
  .max(60)
  .refine((v) => parseTrigger(v) !== null, 'Ungültiger Trigger');

const listingIds = z.array(z.string().uuid()).max(500);

/** Keep only propertyIds that belong to the tenant. */
async function tenantPropertyIds(
  db: Database,
  tenantId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.tenantId, tenantId), inArray(properties.id, ids)));
  return rows.map((r) => r.id);
}

/** Replace a template's apartment allow-list. */
async function replaceListings(
  db: Database,
  tenantId: string,
  templateId: string,
  ids: string[],
): Promise<void> {
  const valid = await tenantPropertyIds(db, tenantId, ids);
  await db
    .delete(messageTemplateListings)
    .where(eq(messageTemplateListings.templateId, templateId));
  if (valid.length > 0) {
    await db
      .insert(messageTemplateListings)
      .values(valid.map((pid) => ({ templateId, propertyId: pid })));
  }
}

/** Loose E.164 check — Twilio does the authoritative validation. */
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Erwartet wird eine Nummer im Format +49170…');

export const messageTemplatesRouter = router({
  /** Placeholder catalog (built-in + tenant custom) for editor chips. */
  vars: tenantProcedure.query(async ({ ctx }) => {
    const custom = await ctx.db
      .select({
        key: messageVariables.key,
        label: messageVariables.label,
      })
      .from(messageVariables)
      .where(eq(messageVariables.tenantId, ctx.tenantId!))
      .orderBy(asc(messageVariables.key));
    return [
      ...TEMPLATE_VARS.map((v) => ({ ...v, custom: false })),
      ...custom.map((v) => ({ ...v, custom: true })),
    ];
  }),

  list: tenantProcedure.query(async ({ ctx }) => {
    const tpls = await ctx.db
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.tenantId, ctx.tenantId!))
      .orderBy(desc(messageTemplates.createdAt));
    if (tpls.length === 0) return [];
    const links = await ctx.db
      .select({
        templateId: messageTemplateListings.templateId,
        propertyId: messageTemplateListings.propertyId,
      })
      .from(messageTemplateListings)
      .where(
        inArray(
          messageTemplateListings.templateId,
          tpls.map((t) => t.id),
        ),
      );
    const byTpl = new Map<string, string[]>();
    for (const l of links) {
      const arr = byTpl.get(l.templateId) ?? [];
      arr.push(l.propertyId);
      byTpl.set(l.templateId, arr);
    }
    return tpls.map((t) => ({ ...t, listingIds: byTpl.get(t.id) ?? [] }));
  }),

  create: editorProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        channel,
        trigger: triggerStr,
        language: z.string().min(2).max(8).default('de'),
        body: z.string().min(1).max(2000),
        active: z.boolean().default(true),
        /** Apartment allow-list (explicit). Empty = reaches nobody yet. */
        listingIds: listingIds.default([]),
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
      await replaceListings(ctx.db, ctx.tenantId!, row!.id, input.listingIds);
      return { ...row, listingIds: await tenantPropertyIds(ctx.db, ctx.tenantId!, input.listingIds) };
    }),

  update: editorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        channel: channel.optional(),
        trigger: triggerStr.optional(),
        language: z.string().min(2).max(8).optional(),
        body: z.string().min(1).max(2000).optional(),
        active: z.boolean().optional(),
        /** When provided, replaces the apartment allow-list wholesale. */
        listingIds: listingIds.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, listingIds: newListings, ...patch } = input;
      if (Object.keys(patch).length === 0 && newListings === undefined) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nichts zu ändern' });
      }
      let row;
      if (Object.keys(patch).length > 0) {
        [row] = await ctx.db
          .update(messageTemplates)
          .set({ ...patch, updatedAt: new Date() })
          .where(
            and(
              eq(messageTemplates.id, id),
              eq(messageTemplates.tenantId, ctx.tenantId!),
            ),
          )
          .returning();
      } else {
        [row] = await ctx.db
          .select()
          .from(messageTemplates)
          .where(
            and(
              eq(messageTemplates.id, id),
              eq(messageTemplates.tenantId, ctx.tenantId!),
            ),
          )
          .limit(1);
      }
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      if (newListings !== undefined) {
        await replaceListings(ctx.db, ctx.tenantId!, id, newListings);
      }
      return row;
    }),

  /** Replace a template's apartment allow-list (granular use, e.g. from the
   *  booking detail's apartment-level toggle). */
  setListings: editorProcedure
    .input(z.object({ id: z.string().uuid(), listingIds }))
    .mutation(async ({ ctx, input }) => {
      const owned = (
        await ctx.db
          .select({ id: messageTemplates.id })
          .from(messageTemplates)
          .where(
            and(
              eq(messageTemplates.id, input.id),
              eq(messageTemplates.tenantId, ctx.tenantId!),
            ),
          )
          .limit(1)
      )[0];
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND' });
      await replaceListings(ctx.db, ctx.tenantId!, input.id, input.listingIds);
      return { id: input.id, count: input.listingIds.length };
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
        /** Resolve custom per-apartment vars for this apartment in the preview. */
        propertyId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Built-in vars use realistic sample values (no real booking in a test).
      // Custom per-apartment vars ({{wifiCode}}, {{wohnungSafeCode}}, …) are
      // resolved for the chosen apartment so the preview/test matches what a
      // guest would actually receive. Without a chosen apartment we can only
      // fill the built-ins; custom keys then stay visible (as before).
      let vars = { ...SAMPLE_VARS };
      if (input.propertyId) {
        // Verify the apartment belongs to this tenant, and use its real name.
        const prop = (
          await ctx.db
            .select({ id: properties.id, name: properties.name })
            .from(properties)
            .where(
              and(
                eq(properties.id, input.propertyId),
                eq(properties.tenantId, ctx.tenantId!),
              ),
            )
            .limit(1)
        )[0];
        if (!prop) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Apartment not in tenant' });
        }
        const custom = await resolveCustomVars(ctx.db, ctx.tenantId!, input.propertyId);
        vars = { ...vars, propertyName: prop.name, ...custom };
      }
      const preview = renderTemplate(input.body, vars);

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
          .select({ smsSenderId: tenants.smsSenderId, smsEnabled: tenants.smsEnabled })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId!))
          .limit(1)
      )[0];
      if (!tenantRow?.smsEnabled) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'SMS-Versand ist für diesen Workspace nicht aktiviert.',
        });
      }
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
