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

/**
 * Plan-gate middleware: blocks mutating endpoints when the tenant's
 * subscription is not active or trialing. Billing-exempt tenants pass
 * straight through. Reads (tenantProcedure) are NOT gated so a locked-out
 * tenant can still load `/settings/billing` and pay.
 */
import { assertActiveSubscription, resolveAccess } from './services/plan-guard';
import type { Feature } from './services/entitlements';

const planGuardMiddleware = middleware(async ({ ctx, next }) => {
  if (!ctx.tenantId) throw new TRPCError({ code: 'UNAUTHORIZED' });
  await assertActiveSubscription(ctx.db, ctx.tenantId);
  return next({ ctx });
});

/**
 * Feature-gate middleware factory. Throws FEATURE_LOCKED:<feature>:<tier> when
 * the tenant's tier doesn't unlock `feature`. Compose ON TOP of a plan-gated
 * base procedure (editor/admin/owner) so both lockout and feature gating apply.
 */
export const requireFeature = (feature: Feature) =>
  middleware(async ({ ctx, next }) => {
    if (!ctx.tenantId) throw new TRPCError({ code: 'UNAUTHORIZED' });
    const access = await resolveAccess(ctx.db, ctx.tenantId);
    if (!access.features.includes(feature)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `FEATURE_LOCKED:${feature}:${access.tier}`,
      });
    }
    return next({ ctx });
  });

/** Authed but tenant-agnostic — for onboarding, account, "me" endpoints. */
export const authedProcedure = publicProcedure.use(authMiddleware);

/** Authed AND scoped to a tenant. Most procedures use this. Read-only — NOT plan-gated. */
export const tenantProcedure = authedProcedure.use(tenantMiddleware);

/**
 * Tenant-scoped + role-gated + **plan-gated** (the lockout). All mutating
 * procedures inherit the SUBSCRIPTION_REQUIRED check via these.
 */
export const ownerProcedure = tenantProcedure
  .use(requireRole(['owner']))
  .use(planGuardMiddleware);
export const adminProcedure = tenantProcedure
  .use(requireRole(['owner', 'admin']))
  .use(planGuardMiddleware);
export const editorProcedure = tenantProcedure
  .use(requireRole(['owner', 'admin', 'manager']))
  .use(planGuardMiddleware);

/**
 * Escape hatch for the billing router only — admin-scoped but NOT
 * plan-gated, otherwise a locked-out tenant could never start checkout to
 * pay and unlock themselves.
 */
export const billingProcedure = tenantProcedure.use(
  requireRole(['owner', 'admin']),
);
