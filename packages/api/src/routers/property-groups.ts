import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, max } from 'drizzle-orm';
import { propertyGroups } from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';

const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { message: 'Color must be a #rrggbb hex string' });

export const propertyGroupsRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(propertyGroups)
      .where(eq(propertyGroups.tenantId, ctx.tenantId!))
      .orderBy(asc(propertyGroups.sortOrder), asc(propertyGroups.name));
  }),

  create: editorProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80).trim(),
        color: colorSchema.default('#3b82f6'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const maxRow = await ctx.db
        .select({ m: max(propertyGroups.sortOrder) })
        .from(propertyGroups)
        .where(eq(propertyGroups.tenantId, ctx.tenantId!));
      const nextOrder = (maxRow[0]?.m ?? 0) + 10;

      const [row] = await ctx.db
        .insert(propertyGroups)
        .values({
          tenantId: ctx.tenantId!,
          name: input.name,
          color: input.color,
          sortOrder: nextOrder,
        })
        .returning();
      return row;
    }),

  update: editorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(80).trim().optional(),
        color: colorSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const [row] = await ctx.db
        .update(propertyGroups)
        .set(patch)
        .where(and(eq(propertyGroups.id, id), eq(propertyGroups.tenantId, ctx.tenantId!)))
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  delete: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(propertyGroups)
        .where(
          and(eq(propertyGroups.id, input.id), eq(propertyGroups.tenantId, ctx.tenantId!)),
        )
        .returning({ id: propertyGroups.id });
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),

  reorder: editorProcedure
    .input(z.object({ orderedIds: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        for (let i = 0; i < input.orderedIds.length; i++) {
          await tx
            .update(propertyGroups)
            .set({ sortOrder: (i + 1) * 10 })
            .where(
              and(
                eq(propertyGroups.id, input.orderedIds[i]!),
                eq(propertyGroups.tenantId, ctx.tenantId!),
              ),
            );
        }
      });
      return { ok: true };
    }),
});
