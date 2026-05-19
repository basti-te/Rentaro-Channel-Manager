import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, eq } from 'drizzle-orm';
import { teammates } from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';

/** Loose E.164 check — Twilio does the authoritative validation. */
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Erwartet wird eine Nummer im Format +49170…');

export const teammatesRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(teammates)
      .where(eq(teammates.tenantId, ctx.tenantId!))
      .orderBy(asc(teammates.name));
  }),

  create: editorProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        phone,
        active: z.boolean().default(true),
        notes: z.string().trim().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(teammates)
        .values({
          tenantId: ctx.tenantId!,
          name: input.name,
          phone: input.phone,
          active: input.active,
          notes: input.notes ?? null,
        })
        .returning();
      return row;
    }),

  update: editorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        phone: phone.optional(),
        active: z.boolean().optional(),
        notes: z.string().trim().max(1000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      if (Object.keys(patch).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nichts zu ändern' });
      }
      const [row] = await ctx.db
        .update(teammates)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(eq(teammates.id, id), eq(teammates.tenantId, ctx.tenantId!)),
        )
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  delete: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db
        .delete(teammates)
        .where(
          and(eq(teammates.id, input.id), eq(teammates.tenantId, ctx.tenantId!)),
        )
        .returning({ id: teammates.id });
      if (res.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),
});
