import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  cleaningRules,
  cleaningRuleListings,
  cleaningRuleTeammates,
  cleaningChecklists,
  properties,
  teammates,
  tenants,
} from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';
import { parseTrigger } from '../services/triggers';
import {
  CLEANING_VARS,
  CLEANING_SAMPLE_VARS,
  renderTemplate,
} from '../services/cleaning';
import { sendSms } from '../services/twilio';
import { checkSmsCountry } from '../services/sms-allowlist';
import type { Database } from '@cm/db';

/** Reject trigger strings the dispatcher can't parse. */
const triggerStr = z
  .string()
  .min(1)
  .max(60)
  .refine((v) => parseTrigger(v) !== null, 'Ungültiger Trigger');

const idArr = z.array(z.string().uuid()).max(500);

const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Erwartet wird eine Nummer im Format +49170…');

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

/** Keep only teammateIds that belong to the tenant. */
async function tenantTeammateIds(
  db: Database,
  tenantId: string,
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: teammates.id })
    .from(teammates)
    .where(and(eq(teammates.tenantId, tenantId), inArray(teammates.id, ids)));
  return rows.map((r) => r.id);
}

async function replaceListings(
  db: Database,
  tenantId: string,
  ruleId: string,
  ids: string[],
): Promise<void> {
  const valid = await tenantPropertyIds(db, tenantId, ids);
  await db
    .delete(cleaningRuleListings)
    .where(eq(cleaningRuleListings.ruleId, ruleId));
  if (valid.length > 0) {
    await db
      .insert(cleaningRuleListings)
      .values(valid.map((pid) => ({ ruleId, propertyId: pid })));
  }
}

async function replaceTeammates(
  db: Database,
  tenantId: string,
  ruleId: string,
  ids: string[],
): Promise<void> {
  const valid = await tenantTeammateIds(db, tenantId, ids);
  await db
    .delete(cleaningRuleTeammates)
    .where(eq(cleaningRuleTeammates.ruleId, ruleId));
  if (valid.length > 0) {
    await db
      .insert(cleaningRuleTeammates)
      .values(valid.map((tid) => ({ ruleId, teammateId: tid })));
  }
}

/** Resolve a checklistId, ensuring it belongs to the tenant. */
async function validChecklistId(
  db: Database,
  tenantId: string,
  checklistId: string | null | undefined,
): Promise<string | null> {
  if (!checklistId) return null;
  const owned = (
    await db
      .select({ id: cleaningChecklists.id })
      .from(cleaningChecklists)
      .where(
        and(
          eq(cleaningChecklists.id, checklistId),
          eq(cleaningChecklists.tenantId, tenantId),
        ),
      )
      .limit(1)
  )[0];
  if (!owned) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unbekannte Checkliste' });
  return checklistId;
}

export const cleaningRulesRouter = router({
  /** Placeholder catalog for editor chips. */
  vars: tenantProcedure.query(() =>
    CLEANING_VARS.map((v) => ({ ...v, custom: false })),
  ),

  list: tenantProcedure.query(async ({ ctx }) => {
    const rules = await ctx.db
      .select()
      .from(cleaningRules)
      .where(eq(cleaningRules.tenantId, ctx.tenantId!))
      .orderBy(desc(cleaningRules.createdAt));
    if (rules.length === 0) return [];
    const ids = rules.map((r) => r.id);
    const ls = await ctx.db
      .select({
        ruleId: cleaningRuleListings.ruleId,
        propertyId: cleaningRuleListings.propertyId,
      })
      .from(cleaningRuleListings)
      .where(inArray(cleaningRuleListings.ruleId, ids));
    const ts = await ctx.db
      .select({
        ruleId: cleaningRuleTeammates.ruleId,
        teammateId: cleaningRuleTeammates.teammateId,
      })
      .from(cleaningRuleTeammates)
      .where(inArray(cleaningRuleTeammates.ruleId, ids));
    const byL = new Map<string, string[]>();
    for (const l of ls) {
      const a = byL.get(l.ruleId) ?? [];
      a.push(l.propertyId);
      byL.set(l.ruleId, a);
    }
    const byT = new Map<string, string[]>();
    for (const t of ts) {
      const a = byT.get(t.ruleId) ?? [];
      a.push(t.teammateId);
      byT.set(t.ruleId, a);
    }
    return rules.map((r) => ({
      ...r,
      listingIds: byL.get(r.id) ?? [],
      teammateIds: byT.get(r.id) ?? [],
    }));
  }),

  create: editorProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        trigger: triggerStr,
        body: z.string().min(1).max(2000),
        checklistId: z.string().uuid().nullable().default(null),
        active: z.boolean().default(true),
        listingIds: idArr.default([]),
        teammateIds: idArr.default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const checklistId = await validChecklistId(
        ctx.db,
        ctx.tenantId!,
        input.checklistId,
      );
      const [row] = await ctx.db
        .insert(cleaningRules)
        .values({
          tenantId: ctx.tenantId!,
          name: input.name,
          trigger: input.trigger,
          body: input.body,
          checklistId,
          active: input.active,
        })
        .returning();
      await replaceListings(ctx.db, ctx.tenantId!, row!.id, input.listingIds);
      await replaceTeammates(ctx.db, ctx.tenantId!, row!.id, input.teammateIds);
      return {
        ...row,
        listingIds: await tenantPropertyIds(ctx.db, ctx.tenantId!, input.listingIds),
        teammateIds: await tenantTeammateIds(ctx.db, ctx.tenantId!, input.teammateIds),
      };
    }),

  update: editorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        trigger: triggerStr.optional(),
        body: z.string().min(1).max(2000).optional(),
        checklistId: z.string().uuid().nullable().optional(),
        active: z.boolean().optional(),
        listingIds: idArr.optional(),
        teammateIds: idArr.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const {
        id,
        listingIds: newListings,
        teammateIds: newTeammates,
        checklistId,
        ...patch
      } = input;

      const owned = (
        await ctx.db
          .select({ id: cleaningRules.id })
          .from(cleaningRules)
          .where(
            and(
              eq(cleaningRules.id, id),
              eq(cleaningRules.tenantId, ctx.tenantId!),
            ),
          )
          .limit(1)
      )[0];
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND' });

      const set: Record<string, unknown> = { ...patch };
      if (checklistId !== undefined) {
        set.checklistId = await validChecklistId(
          ctx.db,
          ctx.tenantId!,
          checklistId,
        );
      }
      if (Object.keys(set).length > 0) {
        await ctx.db
          .update(cleaningRules)
          .set({ ...set, updatedAt: new Date() })
          .where(eq(cleaningRules.id, id));
      }
      if (newListings !== undefined) {
        await replaceListings(ctx.db, ctx.tenantId!, id, newListings);
      }
      if (newTeammates !== undefined) {
        await replaceTeammates(ctx.db, ctx.tenantId!, id, newTeammates);
      }
      return { id };
    }),

  delete: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db
        .delete(cleaningRules)
        .where(
          and(
            eq(cleaningRules.id, input.id),
            eq(cleaningRules.tenantId, ctx.tenantId!),
          ),
        )
        .returning({ id: cleaningRules.id });
      if (res.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),

  /** Render the body with sample data and (for a test number) send via Twilio. */
  sendTest: editorProcedure
    .input(
      z.object({
        body: z.string().min(1).max(2000),
        toPhone: phone.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const preview = renderTemplate(input.body, CLEANING_SAMPLE_VARS);
      if (!input.toPhone) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Test-Telefonnummer fehlt (Format +49170…).',
        });
      }
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
      const { ok: countryOk, country } = await checkSmsCountry(
        ctx.db,
        ctx.tenantId!,
        input.toPhone,
      );
      if (!countryOk) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: country
            ? `SMS nach ${country} ist für diesen Workspace nicht freigeschaltet.`
            : 'Zielland der Telefonnummer nicht erkennbar.',
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
