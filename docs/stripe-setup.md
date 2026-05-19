# Stripe billing setup

One-time setup so the SaaS-billing layer (ADR 0010) can run. Do this once
in **test mode** to develop against, then repeat in **live mode** before
launching to paying operators.

## Pricing model

Hybrid — every paying tenant gets:

- a **base fee** per month (one Stripe Price), and
- a **per-property fee** per month (a second Stripe Price), billed for as
  many active apartments as the tenant has.

Each fee exists twice — once as a **monthly** Price and once as an
**annual** Price (with a 10 % discount baked into the annual amount in
the Dashboard). Total: 4 Prices configured via env vars.

No money amounts live in code. You can change the EUR figures any time by
editing the Prices in the Stripe Dashboard.

## 1 — Create Stripe Products + Prices

In the Stripe Dashboard (test mode):

1. **Products → Add product → "Channel Manager Base"**
   - Add price: recurring, monthly, EUR. → `STRIPE_PRICE_BASE_MONTHLY`.
   - Add another price on the same Product: recurring, yearly, EUR, set
     to `12 × monthly × 0.9`. → `STRIPE_PRICE_BASE_ANNUAL`.

2. **Products → Add product → "Channel Manager — per Apartment"**
   - Add price: recurring, monthly, EUR. → `STRIPE_PRICE_PROPERTY_MONTHLY`.
   - Add another price: recurring, yearly, EUR, set to
     `12 × monthly × 0.9`. → `STRIPE_PRICE_PROPERTY_ANNUAL`.

Copy each `price_…` id — you'll put them in `.env.local` below.

## 2 — Enable Stripe Tax

`automatic_tax: { enabled: true }` is set on every Checkout Session, so:

1. **Settings → Tax → Enable Stripe Tax** (test mode).
2. Configure origin address + supported regions (DE/EU at minimum).
3. Activate the Stripe Tax product on each of the 4 Prices created above
   (Dashboard → Price → "Behavior: Inclusive / Exclusive of tax" — pick
   whichever your prices are quoted as).

Without this, Checkout will fail with an `automatic_tax` configuration
error.

## 3 — Configure the Customer Portal

`Settings → Billing → Customer portal`:

- **Return URL**: `https://<your-app>/settings` (matches `APP_URL`).
- **Functionality**: enable subscription updates, plan changes, payment
  method updates, invoice history.
- **Allowed products**: the two Products you created.
- **Cancellation**: enable, your choice of immediate / end of period.
- **Save**.

## 4 — Configure webhooks

The worker exposes:

```
POST  <PUBLIC_WEBHOOK_BASE_URL>/api/webhooks/stripe
```

Stripe authenticates via the `stripe-signature` HMAC, so no URL-path
secret is needed.

### Local development

Use the Stripe CLI to forward events to your localhost worker:

```bash
stripe login
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

The CLI prints a signing secret (`whsec_…`) — put it into
`STRIPE_WEBHOOK_SECRET` in `.env.local`. Keep `stripe listen` running
while you exercise checkout flows.

### Production

`Developers → Webhooks → Add endpoint`:

- URL: `https://<your-worker>/api/webhooks/stripe`
- Events to send (at minimum):
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.trial_will_end`
  - `checkout.session.completed`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `invoice.payment_succeeded`

Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET` in your
production env.

## 5 — Env vars

Add to `.env.local` (test mode):

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...          # from `stripe listen` in dev

STRIPE_PRICE_BASE_MONTHLY=price_...
STRIPE_PRICE_BASE_ANNUAL=price_...
STRIPE_PRICE_PROPERTY_MONTHLY=price_...
STRIPE_PRICE_PROPERTY_ANNUAL=price_...
```

When you're ready to go live, swap each value with the live-mode
counterpart (same env var names — no code change).

## 6 — Smoke test

1. Sign up a new test user (different email from the owner).
2. The user lands on `/calendar` — works for 14 days even without
   billing (local trial via the new `subscriptions` row).
3. Open `/settings` → Billing section → pick **Monatlich** or
   **Jährlich (−10 %)** → redirected to Stripe Checkout.
4. Pay with Stripe test card `4242 4242 4242 4242`, any future expiry,
   any CVC, any postcode.
5. Back in the app, the Billing section shows "Abonnement aktiv".
6. Add or deactivate a property — within ~24 h the daily
   `billing-reconcile` cron pushes the new quantity to Stripe. (You can
   trigger it immediately with the `billing/reconcile.now` Inngest
   event from the Inngest dev UI.)
7. Simulate payment failure: in Stripe Dashboard, set the subscription
   to `past_due` (or use a test card that declines). The next request
   triggers the lockout — the dashboard renders `<LockoutScreen />`
   until you reactivate via Customer Portal.

## Owner workspace

The project-owner's existing tenant is `billingExempt = true` (set in
migration `0013`). It bypasses the gate entirely and never sees the
plan picker or lockout. Toggle the flag manually if you ever onboard a
comped account.
