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

## SMS add-on (usage-based metering)

SMS is an **opt-in add-on**, off by default for new tenants
(`tenants.sms_enabled`), toggled at `/settings` → "SMS-Versand". When on, a
tenant is billed **per SMS segment** via a Stripe **Billing Meter**. Until the
Stripe pieces below exist, the metering job is a no-op (SMS still send for
opted-in tenants — they just aren't billed yet).

### One-time Stripe setup

1. **Create a Meter** (Dashboard → Billing → Meters, or API):
   - Event name: e.g. `sms_segments` (this is `STRIPE_SMS_METER_EVENT_NAME`).
   - Aggregation: **Sum** of the event `value`.
   - Customer mapping: default (`stripe_customer_id`); payload value key:
     default (`value`). The worker sends exactly these keys.
2. **Create a metered Price** linked to that Meter (a recurring usage Price on
   the same product as the base plan), priced at **€0.01 per unit**. Rentaro
   reports the *charge in cents* as the meter value (per-country Twilio cost ×
   FX × markup), so €0.01/unit makes the invoice total exact. Its id is
   `STRIPE_PRICE_SMS_METERED`.
3. Set both in the **worker** env:
   ```
   STRIPE_SMS_METER_EVENT_NAME=sms_segments
   STRIPE_PRICE_SMS_METERED=price_...
   ```

### How it bills

- `sms-usage-reconcile` runs daily (03:30) — or on demand via the
  `sms-usage/reconcile.now` Inngest event.
- For each SMS-on, non-exempt tenant with an active subscription it computes
  Σ(segments × per-country customer price) for every SMS sent since
  `tenants.sms_usage_reported_through` (guest `messages` + `cleaning_messages`),
  reports that charge (in cents) as one meter event, attaches the metered Price
  to the subscription (idempotent), then advances the watermark.
- Per-country prices live in `sms-rates.ts` (Twilio cost × FX × markup); segment
  counts follow Twilio's GSM-7/UCS-2 rules (`smsSegments`); the destination
  country is parsed from the recipient number (`resolveSmsCountry`).
- A tenant only sends SMS to countries on its **allow-list**
  (`tenant_sms_countries`, edited at `/sms-laender`) — itself a subset of the
  Twilio account's Geo Permissions.
- **First run baselines** the watermark to "now" without billing history, so
  switching metering on never retro-charges past SMS.

## AI guest-reply add-on (usage-based metering)

The AI guest-reply assistant is an **opt-in add-on**, off by default
(`tenants.ai_replies_enabled`), toggled at `/settings` → "KI-Antworten". When on,
a tenant is billed **per reply the AI actually sends** via a Stripe **Billing
Meter**. Until the Stripe pieces below exist, the metering job is a no-op (the AI
still drafts/sends for opted-in tenants — they just aren't billed yet).

A reply counts as billable only once it leaves the building: a `guest_messages`
row with `ai_generated = true` AND `status = 'sent'`. Drafts a human never
approves (`status = 'draft'`) or dismisses are never billed — only auto-sent
replies and human-approved drafts.

### One-time Stripe setup

1. **Create a Meter** (Dashboard → Billing → Meters, or API):
   - Event name: e.g. `ai_replies` (this is `STRIPE_AI_METER_EVENT_NAME`).
   - Aggregation: **Sum** of the event `value`.
   - Customer mapping: default (`stripe_customer_id`); payload value key:
     default (`value`). The worker sends exactly these keys.
2. **Create a metered Price** linked to that Meter (a recurring usage Price on
   the same product as the base plan), priced at **your per-reply rate** (e.g.
   €0.10 per unit). Unlike SMS, Rentaro reports the *reply count* as the meter
   value — so set the Price to exactly what you want to charge per AI reply. Its
   id is `STRIPE_PRICE_AI_METERED`.
3. Set both in the **worker** env:
   ```
   STRIPE_AI_METER_EVENT_NAME=ai_replies
   STRIPE_PRICE_AI_METERED=price_...
   ```

### How it bills

- `ai-usage-reconcile` runs daily (03:45) — or on demand via the
  `ai-usage/reconcile.now` Inngest event.
- For each AI-on, non-exempt tenant with an active subscription it counts the AI
  replies that became `sent` (windowed on `updated_at`) since
  `tenants.ai_usage_reported_through`, reports that count as one meter event,
  attaches the metered Price to the subscription (idempotent), then advances the
  watermark.
- The identifier is keyed by the window start, so a retried run dedups in Stripe
  instead of double-billing.
- **First run baselines** the watermark to "now" without billing history, so
  switching metering on never retro-charges past AI replies.
