# Setup Guide

What you need to do before `pnpm dev` works. Roughly 60-90 minutes the first
time. Most of this is account setup, not coding.

## 1. Local tools

| Tool | Version | Why | How |
|---|---|---|---|
| Node | ≥ 20.10 | Runtime | https://nodejs.org or `nvm install 20` |
| pnpm | ≥ 9 | Workspaces | `npm install -g pnpm@9` |
| Git | any modern | VCS | already installed |

Verify:

```bash
node --version    # v20.x
pnpm --version    # 9.x
```

## 2. Accounts to create

You don't need all of these at once. Phase numbers below indicate when you'll
first need each. **Bold = needed for Phase 0 install/migrate.**

### **Supabase** (Phase 0)
1. Sign up at https://supabase.com
2. Create a new project. Region: `eu-central-1` (Frankfurt) — lowest latency
   from Berlin
3. Set a strong DB password and save it in a password manager
4. From Project Settings → API: copy `URL`, `anon key`, `service_role key`
   into your `.env.local`
5. From Project Settings → Database → Connection string:
   - "Transaction" pooler (port 6543) → `DATABASE_URL`
   - "Session" pooler (port 5432) → `DATABASE_URL_DIRECT`

### **Channex** (Phase 0 — sandbox, Phase 4 — actual usage)
1. Sign up at https://staging.channex.io/signup for the **sandbox**
2. In your user profile, create an API key
3. Put it in `.env.local` as `CHANNEX_API_KEY`
4. Pick a random 32-char string for `CHANNEX_WEBHOOK_SECRET`. Generate with:
   ```powershell
   -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
   ```
5. Production Whitelabel sign-up waits until launch. Sandbox is free.

### Inngest (Phase 5)
- Local dev: `npx inngest-cli dev` — no account needed
- Production: https://inngest.com — sign up later

### Vercel (Phase 1 deploys)
- https://vercel.com — sign up with GitHub
- Connect this repo when ready

### Stripe (Phase 9)
- https://dashboard.stripe.com — test mode is fine for development
- Skip until billing phase

### Twilio (Phase 8)
- https://twilio.com — needs verified phone and credit card
- Skip until messaging phase

### Resend (Phase 1 — transactional email)
- https://resend.com — sign up, verify a sender domain
- Skip until first email needed

### Sentry (Phase 12)
- https://sentry.io — free tier covers us
- Skip until hardening

## 3. First-time install and migrate

After accounts are set up and `.env.local` is filled:

```bash
# In channel-manager/ root:
pnpm install                # installs all workspace packages, ~2-3 min first time

# Generate the initial migration from the Drizzle schema
pnpm db:generate

# Apply migrations (creates all tables + applies RLS policies)
pnpm db:migrate

# Open DB studio to verify
pnpm db:studio
```

You should see all tables created in Supabase. Verify RLS is on:
SQL editor in Supabase → `SELECT relname, relrowsecurity FROM pg_class WHERE
relname IN ('tenants', 'properties', 'bookings');` — all should be `t`.

## 4. iCloud sync gotcha

This project lives on iCloud. `node_modules` has thousands of files. iCloud
may try to sync them, which can:
- Slow down `pnpm install` (file locks during sync)
- Burn iCloud storage (~500MB-1GB for full install)
- Cause sync conflicts mid-install

Mitigations:
- pnpm uses a global store at `C:\Users\User\.pnpm-store` (outside iCloud) by
  default. Most of `node_modules` is hardlinks to that store.
- If problems arise: pause iCloud sync during `pnpm install`, or use a
  Windows junction to move `node_modules` outside iCloud.

If pain is unbearable, move the project to `C:\dev\channel-manager` and
re-clone.

## 5. Then what?

Run `pnpm dev`. Right now it only starts the worker stub (which prints a
message and exits). The web app stub has no entry yet. **Phase 1 fills this
in.**
