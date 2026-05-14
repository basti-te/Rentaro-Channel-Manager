import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, eq, max } from 'drizzle-orm';
import { properties, propertyGroups } from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';

export const propertiesRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        property: properties,
        group: propertyGroups,
      })
      .from(properties)
      .leftJoin(propertyGroups, eq(propertyGroups.id, properties.groupId))
      .where(eq(properties.tenantId, ctx.tenantId!))
      .orderBy(
        asc(propertyGroups.sortOrder),
        asc(properties.sortOrder),
        asc(properties.name),
      );

    return rows.map((r) => ({
      ...r.property,
      group: r.group,
    }));
  }),

  create: editorProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80).trim(),
        groupId: z.string().uuid().nullable(),
        description: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Ensure group, if given, belongs to this tenant
      if (input.groupId) {
        const exists = await ctx.db
          .select({ id: propertyGroups.id })
          .from(propertyGroups)
          .where(
            and(eq(propertyGroups.id, input.groupId), eq(propertyGroups.tenantId, ctx.tenantId!)),
          )
          .limit(1);
        if (exists.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Group not in tenant' });
        }
      }

      const maxRow = await ctx.db
        .select({ m: max(properties.sortOrder) })
        .from(properties)
        .where(eq(properties.tenantId, ctx.tenantId!));
      const nextOrder = (maxRow[0]?.m ?? 0) + 10;

      const [row] = await ctx.db
        .insert(properties)
        .values({
          tenantId: ctx.tenantId!,
          name: input.name,
          groupId: input.groupId,
          description: input.description,
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
        groupId: z.string().uuid().nullable().optional(),
        description: z.string().max(2000).optional(),
        active: z.boolean().optional(),
        defaultRateCents: z.number().int().nonnegative().nullable().optional(),
        defaultMinStay: z.number().int().min(1).max(60).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, defaultRateCents, ...rest } = input;
      const patch = {
        ...rest,
        ...(defaultRateCents !== undefined && {
          defaultRateCents: defaultRateCents === null ? null : BigInt(defaultRateCents),
        }),
      };
      const [row] = await ctx.db
        .update(properties)
        .set(patch)
        .where(and(eq(properties.id, id), eq(properties.tenantId, ctx.tenantId!)))
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      // Rate or min-stay touched? Push to Channex over the next ~6 months.
      if (input.defaultRateCents !== undefined || input.defaultMinStay !== undefined) {
        const today = new Date();
        const from = today.toISOString().slice(0, 10);
        const toDate = new Date(today);
        toDate.setUTCDate(toDate.getUTCDate() + 180);
        await ctx.inngest.send({
          name: 'apartment/rates.sync',
          data: {
            tenantId: ctx.tenantId!,
            propertyId: id,
            from,
            to: toDate.toISOString().slice(0, 10),
            reason: 'property.updated',
          },
        });
      }

      return row;
    }),

  delete: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(properties)
        .where(and(eq(properties.id, input.id), eq(properties.tenantId, ctx.tenantId!)))
        .returning({ id: properties.id });
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { id: input.id };
    }),

  reorder: editorProcedure
    .input(z.object({ orderedIds: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        for (let i = 0; i < input.orderedIds.length; i++) {
          await tx
            .update(properties)
            .set({ sortOrder: (i + 1) * 10 })
            .where(
              and(
                eq(properties.id, input.orderedIds[i]!),
                eq(properties.tenantId, ctx.tenantId!),
              ),
            );
        }
      });
      return { ok: true };
    }),
});
