# Production deployment

Step-by-step for taking channel-manager from local-only to publicly
reachable. Hosting picks (per the chosen plan):

- **Web** (Vite SPA): Vercel
- **Worker** (Hono + Inngest serve): Railway
- **Inngest**: Inngest Cloud (separate from local dev)
- **Database / Auth / Realtime**: existing Supabase project (re-used)
- **Channex**: stays sandbox initially; production switch is its own step
- **Stripe**: stays test mode initially; live mode is the final step

Domain: auto-vergebene `*.vercel.app` + `*.up.railway.app`. Custom domain
can be added later without code changes (all URLs are env vars).

---

## 1 — Push to GitHub

The repo is currently local-only. Railway + Vercel deploy from GitHub.

1. Create an **empty private repo** on GitHub (e.g. `channel-manager`).
   Don't init with README — it's already populated locally.
2. In the repo root, add the remote and push:
   ```powershell
   cd C:\Users\User\iCloudDrive\channel-manager
   git remote add origin git@github.com:<your-user>/channel-manager.git
   git branch -M main
   git push -u origin main
   ```
3. Verify on GitHub that `docs/`, `apps/`, `packages/` are all there. The
   one file that must NOT be there: `.env.local` (already gitignored).

---

## 2 — Inngest Cloud

Required so the production worker can register its functions + receive
events securely.

1. `https://app.inngest.com` → Sign up (GitHub login works).
2. **Create app** → name it `channel-manager-prod` (or similar).
3. **Settings → Keys**:
   - `INNGEST_EVENT_KEY` — used by API to send events (server-side)
   - `INNGEST_SIGNING_KEY` — used by the worker to authenticate the serve
     endpoint with Inngest
4. Note both. They go into Railway env in step 3.

The serve endpoint URL is `https://<railway-url>/api/inngest` — you'll
register it inside Inngest **after** Railway gives you a URL (step 3.7).

---

## 3 — Railway (Worker)

Long-running Node service that hosts tRPC + Inngest serve + webhook
receivers.

1. `https://railway.app` → sign up (GitHub login).
2. **New Project → Deploy from GitHub repo** → select `channel-manager`.
3. Railway creates a service automatically. Open its **Settings**:
   - **Root directory**: `/` (repo root — pnpm workspace needs it)
   - **Build command**:
     ```
     pnpm install --frozen-lockfile
     ```
   - **Start command**:
     ```
     pnpm --filter @cm/worker start
     ```
   - Railway auto-detects Node 20+ via the root `package.json` engines field.
4. **Variables tab** — paste these in (values come from your `.env.local`
   plus the Inngest keys from step 2):
   ```
   NODE_ENV=production
   PORT=3001
   DATABASE_URL=...                     # existing Supabase pooler URL
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   APP_URL=https://<vercel-url>         # placeholder; update after step 4
   CHANNEX_API_URL=https://staging.channex.io/api/v1
   CHANNEX_API_KEY=...
   CHANNEX_WEBHOOK_SECRET=...
   TWILIO_ACCOUNT_SID=...
   TWILIO_AUTH_TOKEN=...
   TWILIO_FROM=...
   TWILIO_STATUS_SECRET=...
   PUBLIC_WEBHOOK_BASE_URL=https://<railway-url>   # placeholder; fill once Railway gives you a URL
   INNGEST_EVENT_KEY=...                # from step 2
   INNGEST_SIGNING_KEY=...              # from step 2
   STRIPE_SECRET_KEY=sk_test_...        # test mode for now
   STRIPE_WEBHOOK_SECRET=...            # filled after step 6
   STRIPE_PRICE_BASE_MONTHLY=price_...
   STRIPE_PRICE_BASE_ANNUAL=price_...
   STRIPE_PRICE_PROPERTY_MONTHLY=price_...
   STRIPE_PRICE_PROPERTY_ANNUAL=price_...
   ```
5. **Settings → Networking → Generate Domain** — Railway gives you a URL
   like `channel-manager-production.up.railway.app`. Copy it.
6. Update the env vars `PUBLIC_WEBHOOK_BASE_URL` to that URL.
7. **Inngest Cloud → your app → Apps → Add app** → enter
   `https://<railway-url>/api/inngest` as the serve URL. Inngest will hit
   that endpoint, discover the registered functions, and start sending
   events.
8. Trigger a redeploy if needed. Watch the logs — you should see
   `→ API server on http://localhost:3001` (Railway maps it externally).
9. Smoke-test: `https://<railway-url>/health` returns `{"ok":true,...}`.

---

## 4 — Vercel (Web)

Static SPA, deployed to a global CDN.

1. `https://vercel.com` → sign up (GitHub login).
2. **Add New… → Project** → import `channel-manager`.
3. Configure:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `apps/web`
   - **Build Command**: `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @cm/web build`
   - **Output Directory**: `dist`
   - **Install Command**: leave default — the build command handles install.
4. **Environment Variables** — three:
   ```
   VITE_SUPABASE_URL=...                          # same as Railway
   VITE_SUPABASE_ANON_KEY=...                     # same as Railway
   VITE_API_URL=https://<railway-url>/trpc        # CRITICAL — must point to Railway
   ```
   Without `VITE_API_URL` the web app would call `/trpc` on its own
   Vercel domain (no backend there).
5. **Deploy**. Vercel runs the build, produces the static bundle, serves
   it via CDN. Vercel gives you a URL like `channel-manager.vercel.app`.
6. Go back to Railway → update `APP_URL` env to the Vercel URL → redeploy
   the worker (CORS comes from there).

---

## 5 — Supabase auth — redirect URLs

Without this, magic-link login from the production domain bounces back to
`/login`.

1. Supabase Dashboard → your project → **Authentication → URL
   Configuration**.
2. **Site URL** → `https://<vercel-url>`
3. **Redirect URLs** (additive list) → add:
   - `https://<vercel-url>/**`
   - `http://localhost:5173/**` (keep for local dev)
4. Save.

Magic-link emails will now redirect to the Vercel domain. Note the
known quirk (status.md #14): magic links are PKCE-bound to the browser
that requested them.

---

## 6 — Stripe webhook (test mode)

Replaces `stripe listen` for production-like flows.

1. Stripe Dashboard (still in **Test mode**) → **Developers → Webhooks
   → Add endpoint**.
2. **Endpoint URL**: `https://<railway-url>/api/webhooks/stripe`
3. **Events to send** (minimum set):
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.trial_will_end`
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `invoice.payment_succeeded`
4. After creating, click the endpoint → copy the **Signing secret**
   (`whsec_…`).
5. Railway → Variables → set `STRIPE_WEBHOOK_SECRET` to that value →
   redeploy.

`stripe listen --forward-to localhost:3001/...` stays useful for local
development, but production runs entirely through this endpoint.

---

## 7 — Smoke-test

1. Browse `https://<vercel-url>` → magic-link sign-in with your own
   email → you land on `/calendar`.
2. Calendar loads with your 17 apartments → bookings visible.
3. **Verify owner exemption**: `/settings` → Billing section shows
   "Workspace abrechnungsfrei (Owner-Konto)". No lockout, no plan
   picker.
4. **Verify second-tenant flow**: sign in with a *different* email
   (e.g. a private address). The dashboard layout creates a fresh
   tenant → trialing subscription row → 14 days of access.
5. Go to `/settings` → Billing → click **Monatlich** → redirected to
   Stripe Checkout → pay with `4242 4242 4242 4242` → return to app →
   subscription active.
6. Stripe Dashboard → Webhooks → your endpoint → **Recent deliveries**
   should show `2xx` responses for the `customer.subscription.created`
   + `invoice.paid` events. If not, check Railway logs — the
   `stripe-event` Inngest function will surface failures there.
7. Inngest Cloud → your app → **Runs** tab — you should see the
   `stripe-event` function runs land here.

---

## 8 — Channex production switch (later)

Initially the deployed app talks to the **Channex sandbox**. To onboard
real apartments / connect real OTAs:

1. Paid Channex production account → new API key + webhook secret.
2. Railway → update `CHANNEX_API_URL=https://channex.io/api/v1`,
   `CHANNEX_API_KEY=...`, `CHANNEX_WEBHOOK_SECRET=...`.
3. Run the reset SQL from status.md ("Resetting for production switch"):
   ```sql
   UPDATE properties SET channex_property_ref = NULL;
   DELETE FROM channex_properties;
   ```
4. Re-onboard each apartment via the "Verbinden" button.
5. Register the production Channex webhook — see
   [docs/channex-webhook-setup.md](channex-webhook-setup.md), URL =
   `https://<railway-url>/api/webhooks/channex/<CHANNEX_WEBHOOK_SECRET>`.

Until step 8 is done, Channex-related flows (OTA sync, real bookings)
only exercise the sandbox.

---

## 9 — Stripe live mode (final step before public)

1. Stripe Dashboard → toggle to **Live mode**.
2. Repeat sections 1–4 of [docs/stripe-setup.md](stripe-setup.md):
   products + 4 prices + Stripe Tax + Customer Portal.
3. Get the live secret key (`sk_live_…`).
4. Create a **live mode webhook endpoint** with the same URL + events
   as step 6 above; copy its **live** signing secret.
5. Railway → swap all 6 Stripe vars with the live values → redeploy.
6. Final smoke-test with a real card (yours, small amount) → cancel
   immediately via Customer Portal to verify the cancel flow works.

---

## Ongoing operational notes

- **Migrations**: when a new Drizzle migration lands on `main`, run
  ```powershell
  $env:DATABASE_URL_DIRECT='<direct prod url>'
  pnpm --filter @cm/db migrate
  ```
  from your local machine. (Railway redeploys don't run migrations
  automatically — intentional, to keep schema changes deliberate.)
- **Logs**: Railway → service → Deployments → Logs. Inngest Cloud →
  Runs. Vercel → Deployments → Functions/Logs.
- **Secret rotation**: status.md "Production readiness" lists the
  4 secrets to rotate before exposing to real customers. Do that as
  step 0 of going public.
- **Cost watch**: Railway worker ≈ $5/mo, Stripe Tax ≈ 0.5 % per
  invoice, Twilio cost-capped (status.md). Channex production: paid
  subscription, separate billing.
