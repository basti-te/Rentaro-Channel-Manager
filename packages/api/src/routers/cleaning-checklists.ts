import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { cleaningChecklists, cleaningChecklistItems } from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';
import type { Database } from '@cm/db';

/** Replace a checklist's items wholesale (preserves given order). */
async function replaceItems(
  db: Database,
  tenantId: string,
  checklistId: string,
  items: string[],
): Promise<void> {
  await db
    .delete(cleaningChecklistItems)
    .where(eq(cleaningChecklistItems.checklistId, checklistId));
  const cleaned = items.map((s) => s.trim()).filter((s) => s.length > 0);
  if (cleaned.length > 0) {
    await db.insert(cleaningChecklistItems).values(
      cleaned.map((label, i) => ({
        tenantId,
        checklistId,
        position: i,
        label,
      })),
    );
  }
}

const items = z.array(z.string().trim().max(280)).max(100);

export const cleaningChecklistsRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    const lists = await ctx.db
      .select()
      .from(cleaningChecklists)
      .where(eq(cleaningChecklists.tenantId, ctx.tenantId!))
      .orderBy(desc(cleaningChecklists.createdAt));
    if (lists.length === 0) return [];
    const its = await ctx.db
      .select({
        checklistId: cleaningChecklistItems.checklistId,
        label: cleaningChecklistItems.label,
        position: cleaningChecklistItems.position,
      })
      .from(cleaningChecklistItems)
      .where(
        inArray(
          cleaningChecklistItems.checklistId,
          lists.map((l) => l.id),
        ),
      )
      .orderBy(asc(cleaningChecklistItems.position));
    const byList = new Map<string, string[]>();
    for (const it of its) {
      const arr = byList.get(it.checklistId) ?? [];
      arr.push(it.label);
      byList.set(it.checklistId, arr);
    }
    return lists.map((l) => ({ ...l, items: byList.get(l.id) ?? [] }));
  }),

  create: editorProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        items: items.default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(cleaningChecklists)
        .values({ tenantId: ctx.tenantId!, name: input.name })
        .returning();
      await replaceItems(ctx.db, ctx.tenantId!, row!.id, input.items);
      return { ...row, items: input.items };
    }),

  update: editorProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        items: items.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const owned = (
        await ctx.db
          .select({ id: cleaningChecklists.id })
          .from(cleaningChecklists)
          .where(
            and(
              eq(cleaningChecklists.id, input.id),
              eq(cleaningChecklists.tenantId, ctx.tenantId!),
            ),
          )
          .limit(1)
      )[0];
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND' });
      if (input.name !== undefined) {
        await ctx.db
          .update(cleaningChecklists)
          .set({ name: input.name, updatedAt: new Date() })
          .where(eq(cleaningChecklists.id, input.id));
      }
      if (input.items !== undefined) {
        await replaceItems(ctx.db, ctx.tenantId!, input.id, input.items);
      }
      return { id: input.id };
    }),

  delete: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db
        .delete(cleaningChecklists)
        .where(
          and(
            eq(cleaningChecklists.id, input.id),
            eq(cleaningChecklists.tenantId, ctx.tenantId!),
          ),
        )
        .returning({ id: cleaningChecklists.id });
      if (res.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),
});
