import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { tenants, users, memberships } from '@cm/db';
import { router, tenantProcedure, billingProcedure } from '../trpc';
import { resolveAccess } from '../services/plan-guard';
import { limitsForTier } from '../services/entitlements';
import {
  TRIAL_DAYS,
  getStripe,
  isStripeConfigured,
  createCheckoutSession,
  createPortalSession,
  pricesFor,
  type BillingInterval,
} from '../services/stripe';

const interval = z.enum(['monthly', 'annual']);

export const billingRouter = router({
  /**
   * The data the front-end needs to render the Billing UI AND enforce the
   * total-lockout redirect. Safe to call on tenantProcedure (no plan gate)
   * so a locked-out tenant can still read this from /settings/billing.
   */
  currentPlan: tenantProcedure.query(async ({ ctx }) => {
    const access = await resolveAccess(ctx.db, ctx.tenantId!);
    const t = (
      await ctx.db
        .select({
          stripeCustomerId: tenants.stripeCustomerId,
          billingExempt: tenants.billingExempt,
        })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId!))
        .limit(1)
    )[0];
    return {
      ...access,
      limits: limitsForTier(access.tier),
      billingExempt: t?.billingExempt ?? false,
      hasStripeCustomer: !!t?.stripeCustomerId,
      trialDaysTotal: TRIAL_DAYS,
    };
  }),

  /**
   * The configured plan options for the picker. Empty array if Stripe is
   * not configured in this environment.
   */
  plans: tenantProcedure.query(({ ctx }) => {
    if (!isStripeConfigured(ctx.env)) return [] as Array<{ interval: BillingInterval; label: string }>;
    const out: Array<{ interval: BillingInterval; label: string }> = [];
    if (pricesFor(ctx.env, 'monthly')) out.push({ interval: 'monthly', label: 'Monatlich' });
    if (pricesFor(ctx.env, 'annual')) out.push({ interval: 'annual', label: 'Jährlich (−10 %)' });
    return out;
  }),

  /**
   * Mint a Stripe Checkout Session URL. Caller redirects the browser to it.
   * Refuses for billing-exempt tenants (they don't pay).
   */
  startCheckout: billingProcedure
    .input(z.object({ interval }))
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe(ctx.env);
      if (!stripe || !isStripeConfigured(ctx.env)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'Stripe ist nicht konfiguriert. STRIPE_SECRET_KEY und die 4 Price-IDs in .env.local setzen.',
        });
      }
      const t = (
        await ctx.db
          .select({ billingExempt: tenants.billingExempt })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId!))
          .limit(1)
      )[0];
      if (t?.billingExempt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Dieser Workspace ist von der Abrechnung ausgenommen.',
        });
      }
      // Owner email from the requesting user — needed for new Stripe Customer.
      const u = (
        await ctx.db
          .select({ email: users.email })
          .from(users)
          .innerJoin(memberships, eq(memberships.userId, users.id))
          .where(eq(users.id, ctx.userId!))
          .limit(1)
      )[0];
      const ownerEmail = u?.email ?? ctx.userEmail;
      if (!ownerEmail) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Keine E-Mail-Adresse hinterlegt.' });
      }
      return createCheckoutSession({
        stripe,
        db: ctx.db,
        env: ctx.env,
        tenantId: ctx.tenantId!,
        ownerEmail,
        interval: input.interval,
      });
    }),

  /** Mint a Stripe Customer Portal Session URL. */
  openPortal: billingProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe(ctx.env);
    if (!stripe) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Stripe ist nicht konfiguriert.',
      });
    }
    try {
      return await createPortalSession({
        stripe,
        db: ctx.db,
        env: ctx.env,
        tenantId: ctx.tenantId!,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'no_stripe_customer') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Noch kein Stripe-Kunde — bitte zuerst ein Abonnement starten.',
        });
      }
      throw new TRPCError({ code: 'BAD_GATEWAY', message: msg });
    }
  }),
});
