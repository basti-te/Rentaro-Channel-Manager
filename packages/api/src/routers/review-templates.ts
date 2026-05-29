import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq } from 'drizzle-orm';
import { reviewTemplates } from '@cm/db';
import { router, tenantProcedure, editorProcedure } from '../trpc';

/**
 * Operator-managed templates for outbound (host-to-guest) reviews.
 *
 *   - One template can be marked as the language default; the dispatch
 *     cron picks it automatically for any new auto-review-enabled booking
 *     after the 3-day waiting period.
 *   - The template body uses `{{key}}` placeholders shared with the
 *     messaging system (guestName, propertyName, nights, …) so operators
 *     learn one variable language.
 *   - Star rating is fixed per template (default 5); we do not expose
 *     sub-category ratings — they're sent as 5 unconditionally for v1.
 *
 * The partial unique index on (tenant_id, language) WHERE is_default
 * enforces "at most one default per language" at the DB layer; this
 * router does the explicit unset-then-set so the operator can swap
 * defaults from the UI without seeing a constraint error.
 */

const language = z.enum(['de', 'en']);

const createInput = z.object({
  name: z.string().trim().min(1).max(80),
  language,
  body: z.string().trim().min(1).max(2000),
  starRating: z.number().int().min(1).max(5).default(5),
  isDefault: z.boolean().default(false),
});

const updateInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  language: language.optional(),
  body: z.string().trim().min(1).max(2000).optional(),
  starRating: z.number().int().min(1).max(5).optional(),
  isDefault: z.boolean().optional(),
});

export const reviewTemplatesRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(reviewTemplates)
      .where(eq(reviewTemplates.tenantId, ctx.tenantId!))
      .orderBy(
        desc(reviewTemplates.isDefault),
        asc(reviewTemplates.language),
        asc(reviewTemplates.name),
      );
  }),

  create: editorProcedure
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        // If this row is the new default, demote any current default for
        // the same (tenant, language) before inserting — otherwise the
        // partial unique index throws.
        if (input.isDefault) {
          await tx
            .update(reviewTemplates)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(
              and(
                eq(reviewTemplates.tenantId, ctx.tenantId!),
                eq(reviewTemplates.language, input.language),
                eq(reviewTemplates.isDefault, true),
              ),
            );
        }
        const [row] = await tx
          .insert(reviewTemplates)
          .values({
            tenantId: ctx.tenantId!,
            name: input.name,
            language: input.language,
            body: input.body,
            starRating: input.starRating,
            isDefault: input.isDefault,
          })
          .returning();
        return row!;
      });
    }),

  update: editorProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      return ctx.db.transaction(async (tx) => {
        if (patch.isDefault === true) {
          // Need the language we're setting default *for* — if the
          // update doesn't include language, look it up.
          const lang =
            patch.language ??
            (
              await tx
                .select({ language: reviewTemplates.language })
                .from(reviewTemplates)
                .where(
                  and(
                    eq(reviewTemplates.id, id),
                    eq(reviewTemplates.tenantId, ctx.tenantId!),
                  ),
                )
                .limit(1)
            )[0]?.language;
          if (lang) {
            await tx
              .update(reviewTemplates)
              .set({ isDefault: false, updatedAt: new Date() })
              .where(
                and(
                  eq(reviewTemplates.tenantId, ctx.tenantId!),
                  eq(reviewTemplates.language, lang),
                  eq(reviewTemplates.isDefault, true),
                ),
              );
          }
        }
        const [row] = await tx
          .update(reviewTemplates)
          .set({ ...patch, updatedAt: new Date() })
          .where(
            and(
              eq(reviewTemplates.id, id),
              eq(reviewTemplates.tenantId, ctx.tenantId!),
            ),
          )
          .returning();
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        return row;
      });
    }),

  delete: editorProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(reviewTemplates)
        .where(
          and(
            eq(reviewTemplates.id, input.id),
            eq(reviewTemplates.tenantId, ctx.tenantId!),
          ),
        )
        .returning({ id: reviewTemplates.id });
      if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true };
    }),
});
