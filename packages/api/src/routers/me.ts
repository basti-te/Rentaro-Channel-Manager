import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { memberships, tenants, users } from '@cm/db';
import { router, authedProcedure } from '../trpc';
import { onboardNewUser } from '../services/onboarding';

export const meRouter = router({
  /** Returns the current user, their memberships, and the resolved tenant. */
  current: authedProcedure.query(async ({ ctx }) => {
    if (!ctx.userId) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    const userRow = (
      await ctx.db.select().from(users).where(eq(users.id, ctx.userId)).limit(1)
    )[0];

    const memberRows = await ctx.db
      .select({
        tenantId: memberships.tenantId,
        role: memberships.role,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
      })
      .from(memberships)
      .leftJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, ctx.userId));

    return {
      user: userRow ?? { id: ctx.userId, email: ctx.userEmail, fullName: null, avatarUrl: null },
      memberships: memberRows,
    };
  }),

  /**
   * Bootstrap: on first login, create a personal tenant for the user.
   * Idempotent — does nothing if the user already has a membership.
   */
  bootstrap: authedProcedure
    .input(
      z
        .object({
          tenantName: z.string().min(1).max(80).optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.userId || !ctx.userEmail) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return onboardNewUser(ctx.db, {
        userId: ctx.userId,
        email: ctx.userEmail,
        tenantName: input?.tenantName,
      });
    }),
});
