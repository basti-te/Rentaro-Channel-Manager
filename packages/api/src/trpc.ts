import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { AppContext } from './context';
import { memberships } from '@cm/db';
import { eq } from 'drizzle-orm';

const t = initTRPC.context<AppContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        code: error.code,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

/**
 * Authenticates via the Supabase JWT in the Authorization header.
 * Populates ctx.userId and ctx.userEmail.
 */
const authMiddleware = middleware(async ({ ctx, next }) => {
  if (!ctx.bearer) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Missing bearer token' });
  }
  const { data, error } = await ctx.supabaseAdmin.auth.getUser(ctx.bearer);
  if (error || !data.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid token' });
  }
  return next({
    ctx: {
      ...ctx,
      userId: data.user.id,
      userEmail: data.user.email ?? null,
    },
  });
});

/**
 * Resolves the tenant. By default, picks the user's first membership.
 * For users with multiple tenants, a `x-tenant-id` header (or future
 * tenant-switcher UI) overrides this.
 *
 * If the user has no memberships yet, this throws — onboarding must create
 * one before tenant-scoped procedures are callable.
 */
const tenantMiddleware = middleware(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }

  const rows = await ctx.db
    .select({ tenantId: memberships.tenantId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, ctx.userId));

  if (rows.length === 0) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'NO_TENANT',
    });
  }

  // For now: pick the first membership. Multi-tenant UI (Phase 9+) will pass
  // a `x-tenant-id` header that we should respect here.
  const m = rows[0]!;
  return next({
    ctx: { ...ctx, tenantId: m.tenantId, role: m.role },
  });
});

const requireRole = (allowed: Array<NonNullable<AppContext['role']>>) =>
  middleware(async ({ ctx, next }) => {
    if (!ctx.role || !allowed.includes(ctx.role)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient role' });
    }
    return next({ ctx });
  });

/** Authed but tenant-agnostic — for onboarding, account, "me" endpoints. */
export const authedProcedure = publicProcedure.use(authMiddleware);

/** Authed AND scoped to a tenant. Most procedures use this. */
export const tenantProcedure = authedProcedure.use(tenantMiddleware);

/** Tenant-scoped + role-gated. */
export const ownerProcedure = tenantProcedure.use(requireRole(['owner']));
export const adminProcedure = tenantProcedure.use(requireRole(['owner', 'admin']));
export const editorProcedure = tenantProcedure.use(
  requireRole(['owner', 'admin', 'manager']),
);
