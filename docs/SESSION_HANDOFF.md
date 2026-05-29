# Session Handoff — Pickup Notes

_Last sync: end of the "Auto-Review Phase A" session (commit `03d1309`)._

This document is a fast pointer for whoever (which model, which session) picks
up the work. Read this first, then dive into the linked files.

---

## Repo + URLs

- **Repo**: <https://github.com/basti-te/Rentaro-Channel-Manager>
- **Web**: <https://rentaro.cloud>
- **Worker**: <https://cmworker-production.up.railway.app>
- **Channex (Production)**: `app.channex.io`
- **DB**: Supabase, transaction pooler on `:6543`
- **Local path**: `C:\Users\User\iCloudDrive\channel-manager`

Env vars live in three places (do NOT rely on `.env.local` for prod state):

| Where | What |
| --- | --- |
| Railway → `@cm/worker` | All server runtime: Channex, Inngest, Stripe, Twilio, DB |
| Vercel → web project | VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL |
| Supabase dashboard | Resend SMTP, Google OAuth client/secret |
| `.env.local` (locally) | Used **only** for CLI scripts (`pnpm channex:*`, `pnpm db:*`) |

---

## Where we are right now

### ✅ Done in the last sessions

- **Channex PMS certification** — all test cases passed, Production account
  created (`app.channex.io`), production webhook registered.
- **Guesty bulk import** — 2.803 historical bookings imported into
  CITY APARTMENTS ESSEN tenant via `pnpm db:import-guesty`. Cascade-safe
  delete scripts in place.
- **Production cutover plumbing** — `db:disconnect-channex` (reset Channex
  refs), `db:fix-tenant-currency` (swap default currency safely). Tenant
  default was wrong (USD), fixed back to EUR.
- **All 17 apartments** reconnected to Channex Production with new EUR
  Property/Room Type/Rate Plan triples. Test Property - Rentaro deleted.
- **Self-service onboarding** — full 4-step wizard at `/onboarding`,
  marketing landing at `/`, post-signup → guided setup.
- **Public Cleaning Calendar** — share-link generator under
  `/cleaning > Kalender-Links`, public read-only view at `/cal/:slug`
  with per-link field toggles + apartment scope.
- **Auto-Review Phase A** — template editor in Settings, Inngest cron
  queues outbound reviews 3 days after checkout. Submission not yet wired.

### 🟡 Holding pattern — needs operator action

The operator wants a **fresh start** before going live with OTAs:

1. Delete the 16 connected apartments **via UI** (apartment kebab → Delete).
   Cascade rules clean everything below (bookings, rate overrides,
   blocks, channex_properties mapping). The 16 USD-currency Channex
   Properties stay orphan in `app.channex.io` and can be archived
   manually there.
2. Pull a fresh Guesty CSV (current state, not the older snapshot).
3. Re-create 16 apartments in Rentaro (Whg 0 + Whg 1–13 + Whg 17, 18 — the
   gaps are Whg 14/15/16 which never existed).
4. Re-import via `pnpm db:import-guesty "<path-to-fresh-export.xls>"`.
5. Click **Verbinden** on each apartment → creates 16 fresh **EUR**
   Channex Properties (we confirmed `tenants.default_currency = 'EUR'`).
6. In `app.channex.io`: map Airbnb / Booking.com / Vrbo channels per
   property (OAuth flows + listing selection).
7. Disconnect the OTAs from Guesty (otherwise both push).
8. One Full Sync per apartment from the Apartments page.

**Reset is the operator's call to actually execute** — all tools are
ready. See `pnpm db:disconnect-channex --apply` if a full programmatic
reset is needed instead of UI clicks.

### ⏳ Open features (priority order)

1. **Auto-Review Phase B — Channex Reviews API integration**
   - Phase A queues outbound reviews into the `outbound_reviews` table.
   - Need to: research Channex' Reviews API (`https://docs.channex.io/api-v.1-documentation/reviews-collection`),
     find out if host-to-guest reviews are supported, wrap in
     `packages/channex/src/resources/reviews.ts`, write a second
     Inngest function `outbound-reviews-send` that picks queued rows
     and POSTs to Channex. Handle 14-day Airbnb deadline gracefully.
   - If Channex doesn't support host-to-guest reviews: fall back to a
     semi-automatic Inbox UI where the operator click-copies the
     rendered text and pastes into Airbnb manually.

2. **Listing Links page** — per-apartment list of OTA listing URLs
   (Airbnb, Booking.com, Vrbo), copy-friendly. Operator currently has
   to dig in Channex to find them. Likely a new tab on the Apartments
   page or a sub-route. Data lives in Channex (`channels` resource).

3. **BookingDetailSheet Review-Status integration** — currently the
   sheet has the Auto-Review toggle but doesn't show the queue state.
   Should display "Bewertung am dd.mm.yyyy geplant" / "gesendet" /
   "übersprungen" with a Skip button. tRPC procedure
   `outboundReviews.byBooking` already exists for this.

---

## Architecture cheat-sheet (1-minute refresh)

```
Browser  →  Vercel  →  tRPC API on Railway (Hono + Drizzle)  →  Supabase Postgres
                              │
                              ├──→  Inngest events  →  Railway Worker (same node)
                              │                          ├─ ari-flush          (rates + availability)
                              │                          ├─ ingest-bookings     (Channex webhooks)
                              │                          ├─ channex-full-sync   (500-day reset)
                              │                          ├─ messages-dispatch   (auto SMS / OTA msg)
                              │                          ├─ cleaning-dispatch   (SMS to cleaners)
                              │                          ├─ outbound-reviews-dispatch (Phase A)
                              │                          └─ billing-reconcile / stripe-event
                              │
                              ├──→  Channex API  →  Booking.com / Airbnb / Vrbo
                              ├──→  Stripe API   (subscriptions + webhook back)
                              ├──→  Twilio API   (SMS)
                              └──→  Resend SMTP (via Supabase Auth — not direct)
```

ARI changes go through the **`ari_pending` outbox** (debounced 8s,
throttled 6/min). Booking ingest uses **Channex `/booking_revisions/feed`
+ ack**, never naïve polling. Tenant isolation enforced both in tRPC
context and via Postgres RLS as backup.

---

## CLI scripts the operator (and you) will use

```
pnpm channex:ids              # list Channex IDs (property / room / rate plan)
pnpm channex:tasks            # recent ARI / Full Sync task IDs from sync_jobs
pnpm channex:smoke            # connectivity + basic sandbox check
pnpm channex:register-webhook # idempotent webhook registration
pnpm channex:check-feed       # peek at unacked booking revisions
pnpm channex:revisions <id>   # list revisions for a booking_id
pnpm channex:verify-task <id> # 3-layer cross-check (DB + outbox + Channex)

pnpm db:generate              # drizzle-kit generate migrations
pnpm db:migrate               # apply migrations + post-migrate SQL
pnpm db:import-guesty <xls>   # bulk import from Guesty For Hosts export
pnpm db:delete-test-bookings  # wipe non-imported bookings (dev cleanup)
pnpm db:disconnect-channex    # null out channex_property_ref for a tenant
```

All scripts read from `.env.local`. Update those three Channex env vars
in `.env.local` if you switch environments.

---

## Pending decisions to relay to the operator

1. **Phase B path** — full automation through Channex Reviews API, OR
   semi-automatic copy-paste-to-Airbnb workflow. Depends on what the
   Channex API actually exposes for host-to-guest reviews.
2. **Auto-Review language detection** — currently always 'de'. If the
   operator wants the cron to pick 'en' for English-speaking guests,
   we need a language signal on `bookings` (Channex sometimes provides
   it in the payload; we'd need to extract + persist it).
3. **Listing Links UX** — where does it live? New tab on Apartments?
   Sub-route under Settings? Per-apartment slide-out panel?

---

## Watch-outs / iCloud quirks

- The project lives inside iCloud Drive (`C:\Users\User\iCloudDrive\...`).
  Twice now during `pnpm install` or schema regeneration, iCloud has
  intercepted the file write and left orphan `*.tmp.<random>` files
  next to the real ones (the real files were renamed away). Recovery:
  `find packages apps -name "*.tmp.*"` and rename them back.
  Long-term fix: move the project out of iCloud or pin the iCloud
  status for the repo to "Always keep on device". Not urgent.

- Drizzle migrations write to `meta/_journal.json`. Don't hand-edit
  that file; always use `pnpm db:generate` for schema additions.

- Don't touch `packages/db/migrations/9999_rls_policies.sql` —
  it's intentionally outside the drizzle journal and runs as a
  separate post-migrate step.

---

## Key files for a quick code orientation

| Concern | File |
| --- | --- |
| Schema | `packages/db/src/schema.ts` |
| Channex client | `packages/channex/src/` |
| ARI outbox | `packages/api/src/services/ari.ts` |
| ARI flush function | `apps/worker/src/inngest/functions/ari-flush.ts` |
| Channex full sync | `apps/worker/src/inngest/functions/channex-full-sync.ts` |
| Booking ingest | `apps/worker/src/inngest/functions/ingest-bookings.ts` |
| Channex webhook handler | `apps/worker/src/webhooks/channex.ts` |
| Auto-review dispatch (Phase A) | `apps/worker/src/inngest/functions/outbound-reviews-dispatch.ts` |
| Public cleaning calendar | `apps/web/src/routes/cleaning-public.tsx` |
| Onboarding wizard | `apps/web/src/routes/onboarding.tsx` |
| Landing page | `apps/web/src/routes/landing.tsx` |
| Booking detail sheet (operator) | `apps/web/src/routes/calendar/BookingDetailSheet.tsx` |
| Settings (incl. review templates) | `apps/web/src/routes/settings.tsx` |

---

## How to verify the system is healthy after switching sessions

```
pnpm --filter @cm/web typecheck
pnpm --filter @cm/api typecheck
pnpm --filter @cm/worker typecheck
pnpm --filter @cm/db typecheck

pnpm channex:smoke          # connectivity check (sandbox or prod, depending on .env.local)
pnpm channex:tasks          # latest sync activity
```

A healthy Production state looks like:

- `pnpm channex:ids` shows 16 (or 0 if the reset was already executed
  but apartments haven't been re-onboarded yet) properties, all EUR
- `pnpm channex:tasks` shows recent ARI flushes if the operator has
  been making changes; otherwise a few `onboarding.initial` rows
- Inngest Cloud dashboard → `channel-manager-*` functions are healthy
- Railway → `@cm/worker` Deployments tab → latest deploy `Active` on
  the head commit of `main`
- Supabase → Postgres → tenant CITY APARTMENTS ESSEN row shows
  `default_currency = 'EUR'` and `onboarded_at` is NOT NULL

---

Happy hacking. The system is in a good place; the remaining items are
clearly scoped and well-tooled.
