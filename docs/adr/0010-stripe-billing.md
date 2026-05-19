# ADR 0010 — Stripe SaaS billing (hybrid pricing, total lockout)

**Status:** Accepted
**Date:** 2026-05-20

## Context

The project moves from single-tenant operation to multi-tenant SaaS:
other vacation-rental operators will sign up, pay, and run their own
workspaces. The schema has always carried `tenants.stripeCustomerId`
and a `subscriptions` table; this ADR records how those finally get
wired up and what the user-facing policy is.

Constraints established up front (per the product owner):

- **Hybrid pricing** — fixed base fee per tenant **+** per-property
  fee on top, billed monthly **or annually with a 10 % discount**.
- **14-day trial, no card upfront** — sign-up friction should be low;
  conversion is enforced by the lockout at the end.
- **Total lockout** on `past_due` / `canceled` / `incomplete` /
  expired-trial — no soft read-only mode, no grace period.
- **Stripe Tax auto-calculation** — cross-border-ready for non-DE
  operators.
- **Annual is in scope from day 1** (initially I'd planned to defer it
  — pulled forward because of the discount mechanic).

## Decision

### Pricing realised as **4 Stripe Prices** under 2 Products

- "Channel Manager Base" → `STRIPE_PRICE_BASE_MONTHLY`,
  `STRIPE_PRICE_BASE_ANNUAL` (the annual price = 12 × monthly × 0.9 in
  the Dashboard).
- "Channel Manager — per Apartment" → `STRIPE_PRICE_PROPERTY_MONTHLY`,
  `STRIPE_PRICE_PROPERTY_ANNUAL`.

The 10 % discount is **encoded in the Stripe Dashboard prices, not in
code** — keeps money out of source control and lets the operator change
amounts without redeploying.

### Checkout flow

Tenant picks **monthly vs annual** *in our app* (clear discount messaging
on the option card), then we open a Stripe Checkout Session in
`subscription` mode with:

- `line_items: [{ price: basePriceId, quantity: 1 }, { price: propertyPriceId, quantity: activePropertyCount }]` — preserved order so
  `items.data[0]=base`, `items.data[1]=property`.
- `subscription_data.trial_period_days = remainingLocalTrialDays` so the
  trial UX continues seamlessly across the boundary.
- `automatic_tax: { enabled: true }` + `tax_id_collection.enabled` +
  `customer_update: { address: 'auto', name: 'auto' }`.
- `allow_promotion_codes: true` — Stripe-native promo codes via the
  Dashboard, no app code for coupons.

### Trial model

`onboardNewUser` inserts a subscription row at tenant creation:
`status='trialing'`, `trialEndsAt = now + 14d`, **no Stripe Subscription
yet**. The plan guard accepts `trialing` while `trialEndsAt > now`. When
the user picks a plan and completes Checkout, the Stripe Subscription is
created with the remaining trial days; the `customer.subscription.*`
webhook syncs status/period/quantity back into our row, and
`tenants.plan` / `tenants.status` are mirrored from the subscription so
hot reads don't need a join.

### Enforcement — total lockout

`packages/api/src/services/plan-guard.ts` exposes:

- `resolveAccess(db, tenantId)` — pure read returning `{ ok, reason,
  trialEndsAt, status }`. Used by the `billing.currentPlan` query.
- `assertActiveSubscription(db, tenantId)` — throws `FORBIDDEN
  SUBSCRIPTION_REQUIRED:<reason>` when not ok.

Applied as a tRPC middleware **on the existing `editorProcedure` /
`adminProcedure` / `ownerProcedure`** so every mutating router inherits
the gate automatically (zero per-router changes — single source of
truth). Reads (`tenantProcedure`) stay ungated so the locked-out tenant
can still load `/settings` to pay.

A separate **`billingProcedure`** (admin-scoped, NOT gated) is the
escape hatch for `billing.startCheckout` and `billing.openPortal` —
otherwise a locked-out tenant could never pay and unlock themselves.

The front-end mirrors the back-end gate with a top-level check in
`_dashboard.tsx`: when `billing.currentPlan.ok` is false, the main
content area renders `<LockoutScreen />` instead of `<Outlet />`. The
sidebar stays for orientation; the user can navigate the URL but every
route resolves to the lockout screen until they subscribe.

### Webhooks — signature-only auth, Inngest-driven

`POST /api/webhooks/stripe` verifies via `stripe-signature` (HMAC,
cryptographic) — no URL-path secret, since the signature **is** the
auth. The handler persists to `webhook_deliveries`
(UNIQUE(source,external_id) gives at-least-once idempotency), emits a
`stripe/event` Inngest event carrying only the event id, and acks.

The `stripe-event` Inngest function re-fetches via
`stripe.events.retrieve(eventId)` (tamper-resistant against payload
modification) and routes through `syncSubscriptionFromStripe`. Same
pattern as the existing Channex/Twilio webhooks (CLAUDE.md rule #8).

### Metering — daily defensive reconcile

`billing-reconcile` Inngest cron (`15 3 * * *`) iterates every
non-exempt tenant with a non-terminal subscription and pushes
`activePropertyCount` → Stripe as the per-property line item's
quantity. Self-healing if the webhook-driven sync ever misses an update
(mirrors `ari-flush-cron`).

### Owner exemption

`tenants.billingExempt boolean default false`, set to `true` for every
tenant existing at migration time (one-time backfill in migration
`0013`). The owner's own workspace never goes through Stripe, never
hits the gate. Toggle the column manually to comp future accounts.

## Consequences

**+** Single source of truth for the gate (3 procedure factories
include planguard middleware). New routers automatically inherit the
lockout — no per-mutation `assertActiveSubscription` calls.

**+** Money values stay out of the codebase (Stripe Dashboard owns
prices). Annual discount changes are a Dashboard edit.

**+** Webhook + reconcile is event-driven with a periodic safety net —
identical philosophy to ARI/messaging dispatch, no new pattern to learn.

**+** Owner workspace is grandfathered cleanly; the schema flag
generalises to comped accounts later.

**−** Total lockout is aggressive. A genuinely good customer whose card
expires loses operational access until they re-enter the Portal. The
trade-off is consistency with the chosen "redirect to billing page"
policy + zero risk of free indefinite usage. Soft-readonly mode would
be a strict superset; revisit if real customers complain.

**−** Trial state lives in our DB until first Checkout. If the trial
subscription row is ever deleted, the tenant becomes `no_subscription`
→ locked. Handled via FK `ON DELETE CASCADE` and the onboarding flow
creating it atomically; document for ops.

**−** The line-item layout (base index 0, property index 1) is a
positional contract. Documented in `services/stripe.ts`; would break if
a future change shuffled `line_items` in the Checkout call.

**−** Stripe Tax + `automatic_tax: true` requires Dashboard
configuration before checkout works — captured in
`docs/stripe-setup.md`; will fail loudly otherwise.

## Revisit if

- Customers ask for a soft read-only state instead of total lockout.
- We add SMS overage / usage-based pricing — currently zero meters.
- Affiliate/referral revenue share appears (Stripe Connect, separate
  decision).
- A second product tier ("Pro", "Enterprise") is introduced — the plan
  enum already supports it; the resolver in `syncSubscriptionFromStripe`
  would learn to map Stripe Products to tier labels.

## References

- `packages/db/src/schema.ts` — `tenants.billingExempt`, `subscriptions.*`
- `packages/api/src/services/stripe.ts` — Stripe wrapper + checkout/portal
- `packages/api/src/services/plan-guard.ts` — gate
- `packages/api/src/trpc.ts` — `editorProcedure` / `adminProcedure` /
  `ownerProcedure` / `billingProcedure`
- `packages/api/src/routers/billing.ts`
- `apps/worker/src/webhooks/stripe.ts`
- `apps/worker/src/inngest/functions/{stripe-event,billing-reconcile}.ts`
- `apps/web/src/components/{BillingCard,LockoutScreen}.tsx`
- `docs/stripe-setup.md` — operator setup guide
