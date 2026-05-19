import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { messageVariables, messageVariableValues } from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';
import { CUSTOM_VAR_KEY_RE } from '../services/custom-vars';
import { TEMPLATE_VARS } from '../services/templates';

const BUILTIN_KEYS = new Set(TEMPLATE_VARS.map((v) => v.key));

const keySchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(
    CUSTOM_VAR_KEY_RE,
    'Nur Buchstaben/Ziffern/_, muss mit Kleinbuchstaben beginnen.',
  )
  .refine((k) => !BUILTIN_KEYS.has(k), 'Dieser Name ist bereits ein Standard-Platzhalter.');

export const messageVariablesRouter = router({
  /** Variables + their per-apartment values (for the management grid). */
  list: tenantProcedure.query(async ({ ctx }) => {
    const vars = await ctx.db
      .select()
      .from(messageVariables)
      .where(eq(messageVariables.tenantId, ctx.tenantId!))
      .orderBy(asc(messageVariables.key));
    if (vars.length === 0) return [];
    const vals = await ctx.db
      .select({
        variableId: messageVariableValues.variableId,
        propertyId: messageVariableValues.propertyId,
        value: messageVariableValues.value,
      })
      .from(messageVariableValues)
      .where(
        inArray(
          messageVariableValues.variableId,
          vars.map((v) => v.id),
        ),
      );
    const byVar = new Map<string, { propertyId: string; value: string }[]>();
    for (const v of vals) {
      const arr = byVar.get(v.variableId) ?? [];
      arr.push({ propertyId: v.propertyId, value: v.value });
      byVar.set(v.variableId, arr);
    }
    return vars.map((v) => ({ ...v, values: byVar.get(v.id) ?? [] }));
  }),

  create: editorProcedure
    .input(z.object({ key: keySchema, label: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const dup = (
        await ctx.db
          .select({ id: messageVariables.id })
          .from(messageVariables)
          .where(
            and(
              eq(messageVariables.tenantId, ctx.tenantId!),
              eq(messageVariables.key, input.key),
            ),
          )
          .limit(1)
      )[0];
      if (dup)
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Variable {{${input.key}}} existiert bereits.`,
        });
      const [row] = await ctx.db
        .insert(messageVariables)
        .values({ tenantId: ctx.tenantId!, key: input.key, label: input.label })
        .returning();
      return { ...row, values: [] };
    }),

  update: editorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        label: z.string().trim().min(1).max(80),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(messageVariables)
        .set({ label: input.label, updatedAt: new Date() })
        .where(
          and(
            eq(messageVariables.id, input.id),
            eq(messageVariables.tenantId, ctx.tenantId!),
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
        .delete(messageVariables)
        .where(
          and(
            eq(messageVariables.id, input.id),
            eq(messageVariables.tenantId, ctx.tenantId!),
          ),
        )
        .returning({ id: messageVariables.id });
      if (res.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),

  /** Set (or, with empty value, clear) a variable's value for one apartment. */
  setValue: editorProcedure
    .input(
      z.object({
        variableId: z.string().uuid(),
        propertyId: z.string().uuid(),
        value: z.string().max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const owned = (
        await ctx.db
          .select({ id: messageVariables.id })
          .from(messageVariables)
          .where(
            and(
              eq(messageVariables.id, input.variableId),
              eq(messageVariables.tenantId, ctx.tenantId!),
            ),
          )
          .limit(1)
      )[0];
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND' });

      const trimmed = input.value.trim();
      if (trimmed === '') {
        await ctx.db
          .delete(messageVariableValues)
          .where(
            and(
              eq(messageVariableValues.variableId, input.variableId),
              eq(messageVariableValues.propertyId, input.propertyId),
            ),
          );
        return { cleared: true };
      }
      await ctx.db
        .insert(messageVariableValues)
        .values({
          variableId: input.variableId,
          propertyId: input.propertyId,
          value: trimmed,
        })
        .onConflictDoUpdate({
          target: [
            messageVariableValues.variableId,
            messageVariableValues.propertyId,
          ],
          set: { value: trimmed, updatedAt: new Date() },
        });
      return { value: trimmed };
    }),
});
