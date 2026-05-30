# Session Handoff — Pickup Notes

_Last sync: **E-mail notifications** build session (2026-05-30). Operator
e-mail alerts (new booking / cancellation / modification / sync error) built
end-to-end via Resend; all four packages typecheck clean. Plus Auto-Review
Phase B (2026-05-29, Open features #1). All uncommitted on top of git HEAD
`a6f01bd`._

**Operator action items for notifications (2026-05-30 build):**
1. ✅ **Migration applied to PROD** (2026-05-30) — `0020_aspiring_black_tarantula.sql`;
   verified all 5 `notify_*` columns present on `tenants`, defaults `true`.
2. ✅ **Railway worker env set** — `RESEND_API_KEY` + `RESEND_FROM` (operator
   confirmed 2026-05-30). Redeploy/restart the worker if it was running before
   the vars were added, so it picks them up.
3. ✅ **Resend sender domain verified** — `rentaro.cloud` shows Verified
   (DKIM ✓, SPF MX+TXT ✓, DMARC present), region Ireland (eu-west-1),
   confirmed 2026-05-30. `RESEND_FROM` must use an address on this domain
   (e.g. `Rentaro <alerts@rentaro.cloud>`).
4. Then Settings → **Benachrichtigungen** → enter the address + flip the
   per-event toggles. **Sync-error alerts can fire now** (after a worker
   restart so it has the env). **Booking alerts only fire once OTA channels
   are mapped** (they ride the existing booking-ingest feed).

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
- **Self-service channel mapping (build, 2026-05-30)** — tenants connect +
  map their own Airbnb / Booking.com / Vrbo listings via the embedded Channex
  `/channels` iframe (one-time-token flow, same as Messages). `channels`
  tRPC router (`iframeSession`, `redirect_to=/channels` + `lng=de`); shared
  `ChannelMappingFrame` component; dedicated `/channels` page (in sidebar +
  mobile menu + Apartments-header link) AND a per-apartment „Kanäle"
  button+modal on the Apartments page. Whitelabel-only Channex feature.
  Typecheck green, pushed (`3e9c2a1`). **Untested live** — needs the operator
  to open it against a real connected apartment + actually connect an OTA.
- **Auto-Review Phase B (build)** — Channex reviews client
  (`packages/channex/src/{schemas/review.ts,resources/reviews.ts}`),
  read-only probe `pnpm channex:reviews`, and the send function
  `apps/worker/src/inngest/functions/outbound-reviews-send.ts` (wired via
  the `reviews/send.now` event, **no cron yet**). All typechecks clean.
  Cannot run end-to-end until OTA mapping + a real Airbnb review exist.
- **E-mail notifications (build, 2026-05-30)** — operator alerts via Resend.
  New `packages/api/src/services/email.ts` (Resend REST, graceful
  not-configured like twilio.ts) + `notifications.ts` (gate on per-tenant
  address + toggle; best-effort, never throws). Wired into `ingest-bookings`
  (classifies new/cancellation/modification by comparing the pre-upsert row;
  same-revision re-delivery doesn't re-notify) and `ari-flush` /
  `ari-flush-cron` via Inngest `onFailure` → alerts tenants holding unflushed
  rows. Schema: `tenants.notify_email` + `notify_new_booking` /
  `notify_cancellation` / `notify_modification` / `notify_sync_error`
  (migration 0020, **unapplied**). Settings → **Benachrichtigungen**
  (address + 4 toggles, `settings.setNotifications`). Operator action items at
  the top of this doc. Follow-ups: review-send failure isn't alerted (that
  function catches per-row, so `onFailure` won't fire — needs an explicit
  hook); mails are German-only.

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
9. **Connect PriceLabs** (ADR 0006 — direct PriceLabs ↔ Channex, no
   connector to build). In the PriceLabs UI, link the **production**
   Channex account (paste the prod Channex API key). Let PriceLabs pull
   listings + push its first price set. THEN flip rate ownership in-app:
   Settings → **Preis-Quelle** → PriceLabs (admin `settings.setRateSource`).
   That makes the ARI flusher stop pushing the `rate` field (it keeps
   pushing restrictions) and re-asserts a 180-day window. **Flip AFTER
   PriceLabs is live** — flipping first leaves listings with no rate
   (we'd suppress it before PriceLabs has pushed one).

**Reset is the operator's call to actually execute** — all tools are
ready. See `pnpm db:disconnect-channex --apply` if a full programmatic
reset is needed instead of UI clicks.

### ⏳ Open features (priority order)

1. **Auto-Review Phase B — Channex Reviews API integration**
   _(BUILT 2026-05-29, uncommitted. Docs: "Send Guest Review" at
   `https://docs.channex.io/api-v.1-documentation/reviews-collection`.)_

   **Host→guest reviews ARE supported — Airbnb-only**, via
   `POST /reviews/:review_id/guest_review`. The code is written; it just
   can't run end-to-end until the OTA mapping + a real Airbnb review exist.

   **Operator decisions (locked 2026-05-29):**
   - **Always 5★.** The per-booking auto-review toggle (default ON) is the
     only opt-out — switch it OFF in BookingDetailSheet and Phase A stops
     queuing. There is **no separate hold/veto window**.
   - **Airbnb-only.** Booking.com / Expedia / Vrbo → row marked `skipped`
     (`unsupported_ota:<source>`). No copy-paste fallback in scope.

   **What's built:**
   - `packages/channex/src/schemas/review.ts` + `resources/reviews.ts`:
     `list()`, `get(id)`, `reply(id,text)`, `sendGuestReview(id,input)`,
     `scores.get/detailed`. `reviewId(r)` helper. Wired into the client.
   - `apps/worker/src/inngest/functions/outbound-reviews-send.ts` — the send
     path. Triggered by the `reviews/send.now` event (**no cron yet** — fire
     it manually once unblocked, then add a cron). Logic: bulk-expire queued
     rows whose checkout is >14d old (no API call — this neutralises the
     ~2,803 historical Guesty rows so they never hit Channex); list Airbnb
     reviews once, index review_ids by Channex booking id + ota_reservation
     code; per due row resolve the id → `sent`, no id → left `queued`
     (`waiting`), non-Airbnb → `skipped`. If `GET /reviews` 403s (app not
     installed) it leaves everything queued and reports `blocked`.
   - **No migration needed.** "Always 5★" means all three categories derive
     from the existing `outbound_reviews.starRating` and `is_recommended =
     rating>=4`; `status` is free-text so `expired`/`skipped` add no columns.
   - Read-only probe: `pnpm channex:reviews` (lists `GET /reviews` for the
     account `.env.local` targets; prints Airbnb-with-review_id count).

   **Blockers / next steps (in order):**
   1. ✅ `Messages & Reviews` app installed per Property (done 2026-05-29).
   2. ⏭️ **OTA channel mapping** in app.channex.io — operator's next step
      (also Holding-pattern #6). Until Airbnb is mapped, reviews carry no
      resolvable id.
   3. ⏳ **Validate assumption #2** — that a `review_id` actually surfaces in
      `GET /reviews` after an Airbnb checkout. Run `pnpm channex:reviews`;
      look for "airbnb (with review_id: N ← Phase B targets)" > 0. This is
      the one thing still unverified against the live API.
   4. Fire `reviews/send.now` manually (Inngest dashboard) on a real review;
      confirm it posts. Only then add a `{ cron }` trigger to the function.
   - Still TODO (UI, separate): BookingDetailSheet review-status + Skip
     (Open features #3). The Settings score/recommend editor is moot while
     "always 5★" holds.

2. **Listing Links — Settings section** with per-apartment OTA listing
   URLs (Airbnb, Booking.com, Vrbo), copy-friendly. Operator currently has
   to dig in Channex to find them.

   **DEFERRED by operator (2026-05-30) until Channex is properly connected
   (channels mapped — Holding-pattern #6).** Reason: nothing to show until
   channels exist, AND the Channex `/channels` API contract is unverified —
   docs.channex.io returns 404 for the channels-collection page, so we don't
   yet know if it exposes a clickable listing URL or only an OTA listing/
   hotel id (Booking.com likely id-only). **First step on resume:** with at
   least one channel mapped, inspect a real `GET /channels` response (mirror
   the reviews approach — a throwaway probe script like
   `packages/channex/scripts/list-reviews.ts`) to see the actual fields,
   THEN decide auto-from-Channex vs. a manual per-apartment URL field (small
   schema migration) vs. hybrid. Likely a new section on `/settings` or a
   tab on the Apartments page. Channex Channel API is Whitelabel-only (we
   qualify); shortcodes live in Channex "Channel Codes".

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
                              │                          ├─ outbound-reviews-dispatch (Phase A — queues)
                              │                          ├─ outbound-reviews-send     (Phase B — Airbnb, event-only)
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

1. **Phase B rating policy — RESOLVED (2026-05-29).** Operator chose
   **auto-rate-all 5★**, per-booking toggle (default ON) as the only
   opt-out, **no hold/veto window**; Airbnb-only, Booking.com/Vrbo out of
   scope. The `Messages & Reviews` 403 blocker is cleared (app installed).
   Built per these decisions — see Open features #1. Nothing left to relay
   here; the open item is now OTA mapping (operator) + validation.
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
