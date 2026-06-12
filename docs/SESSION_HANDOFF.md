# Session Handoff — Pickup Notes

_Last sync: **Guest self-service invoices** session (2026-06-12).
Everything below is committed + pushed; git HEAD `27a9e45` on `main`._

**Shipped this session (2026-06-12, all on `main`):** the **guest invoice
feature** (Phases 0–3) — see **ADR 0013**. A guest enters their last name +
travel dates on a public portal and downloads a proper accommodation invoice
showing the **actually-paid** price.

- **Phase 0** — persist `bookings.ota_commission_cents` (mig 0027);
  `services/booking-amounts.ts` resolves real Brutto/Provision/Auszahlung per OTA
  (Airbnb `amount` = payout → gross rebuilt from `rooms[].days`); booking detail
  sheet shows all three.
- **Phase 1** — `tenant_invoice_settings` + `guest_invoices` (mig 0028);
  `computeInvoiceBreakdown` (7% VAT, **city tax = 5% of GROSS lodging only**,
  matches the operator's real invoice cent-for-cent); idempotent issuing with
  transactional `RE-<n>` numbering + frozen snapshot; **pdfkit** PDF in the worker
  at `GET /api/invoices/<token>.pdf` (1:1 the CITY APARTMENTS ESSEN layout);
  operator config page `/rechnungen` + a per-booking "Rechnung" block.
- **Phase 2** — public portal `/rechnung/:slug` (`invoices.publicLookup` /
  `publicIssue`; name + both dates, rate-limited, generic errors).
- **Phase 3** — Storno: partial unique index (`booking_id WHERE status='issued'`,
  mig 0029) + `voidInvoice` → corrected re-issue.

**Operator action items — invoices (do these to go live):**
1. **Apply migrations 0027 + 0028 + 0029** to PROD: `pnpm --filter @cm/db
   migrate:tables-only`. ⚠️ The code already selects `ota_commission_cents`, so
   this must run **before** the worker/web deploy or booking queries break.
2. **Enable RLS on the two new backend tables** (migrate:tables-only skips
   post-migrate): run in prod SQL —
   `ALTER TABLE public.tenant_invoice_settings ENABLE ROW LEVEL SECURITY;`
   `ALTER TABLE public.guest_invoices ENABLE ROW LEVEL SECURITY;`
3. **Configure** `/rechnungen` → click **"CITY APARTMENTS ESSEN-Vorlage"** →
   check the USt-IdNr (DE343901469) + set the **start invoice number** so it
   doesn't collide with past manual invoices → **enable** the portal (auto-mints
   the slug) → Speichern. Share the portal link only when ready (until enabled,
   nobody can use it).
4. **Test:** open a non-Airbnb booking → "Rechnung erstellen" → download; then
   the portal with that guest's name + dates. (Airbnb payout-only bookings are
   intentionally suppressed — gross not reconstructable.)

_(Earlier this session, pre-invoices: the AI guest-reply assistant was metered to
Stripe and consolidated into a dedicated "KI-Gastnachrichten" page. Those are
live on `main` too.)_

---

## Prior sync (2026-06-10) — AI guest-reply assistant + metering

_Last sync before that: HEAD `491a0de`._

**Shipped this session (2026-06-10, all on `main`):** the **AI guest-reply
assistant** — an opt-in, paid add-on that drafts replies to OTA guest messages
and can dispatch a teammate. See **ADR 0012** for the full design. Pieces:

- **Ingest** — `guest-messages-sync` pulls each OTA thread via Channex
  `GET /bookings/{id}/messages` into the new `guest_messages` table (dedup by
  `channex_message_id`), triggered by the Channex `message` webhook. Runs in
  parallel to the Channex iframe (which stays the read surface).
- **Draft + dispatch** — `guest-message-ai-draft` (Anthropic SDK, model-agnostic
  call, default `claude-opus-4-8`, override via `ANTHROPIC_MODEL`) grounds the
  model in per-apartment facts (`properties.ai_knowledge`, edited in the
  Apartments dialog) and offers a `notify_teammate` tool. Human-in-the-loop by
  default (status `draft`); per-tenant `ai_replies_enabled` master + `ai_auto_send`
  toggles at `/settings` → "KI-Antworten".
- **Teammate roles** — `teammates.role` (cleaner / handyman / other) with a role
  picker at `/teammates`, so dispatch can target a handyman vs. a cleaner.
- **Metering (Phase 5)** — `ai-usage-reconcile` (daily 03:45 + `ai-usage/reconcile.now`)
  bills **per AI reply sent** via a Stripe Billing Meter, mirroring SMS metering.
  Watermark `tenants.ai_usage_reported_through`. No-op until the Stripe pieces
  below exist.
- UI: AI-draft Senden/Bearbeiten/Verwerfen + dispatch log in BookingDetailSheet.

**Operator action items — AI add-on (do these to start billing AI):**
1. **Anthropic key** — `ANTHROPIC_API_KEY` set + deployed in the Railway worker
   (operator confirmed done; payment method on file). Without it the assistant
   no-ops (no drafts).
2. **Stripe Meter + metered Price** — create a Billing Meter (event e.g.
   `ai_replies`, aggregation Sum) and a recurring **per-reply** metered Price
   (NOT per-cent like SMS — the meter value is the reply count, so set the Price
   to your €/reply rate). Then set in the **worker** env:
   `STRIPE_AI_METER_EVENT_NAME=ai_replies` and `STRIPE_PRICE_AI_METERED=price_…`.
   Full steps in `docs/stripe-setup.md` → "AI guest-reply add-on". Until both are
   set, opted-in tenants get AI replies **unbilled**.
3. **Per-apartment KI-Wissen** — fill the "KI-Wissen" field in each apartment
   (Apartments → edit) so drafts have facts to answer from. Thin knowledge →
   thin answers.
4. **Turn it on** — `/settings` → "KI-Antworten" master switch; leave Auto-Send
   OFF until the drafts look trustworthy.

_(Note: this doc skipped the intervening post-go-live sessions — SMS add-on +
per-country pricing/allow-list, Statistik dashboard, trigger builder
"sofort"/last-minute/min-lead-time, landing refresh. All are on `main` and live;
they just weren't re-synced here. The AI assistant is the freshest work.)_

---

## Prior sync (2026-05-31) — OTA go-live + post-launch polish

**Shipped 2026-05-30/31 (all on `main`, deployed via Vercel/Railway):**
- **OTA cutover LIVE** — 16 apts connected + Airbnb/Booking mapped (self-service
  `/channels` iframe), Guesty disconnected, 2.8k bookings imported, PriceLabs
  pushing variable prices, Preis-Quelle=PriceLabs, Full Sync done. Verified
  against prod Channex. (Details in the GO-LIVE section below.)
- **E-mail notifications** (Resend) — LIVE & VERIFIED (2026-05-31): address +
  toggles set in Settings, real alerts confirmed firing on inbound events.
- **Self-service channel mapping** (`/channels`) + **groups CRUD/drag-reorder**
  + **calendar today-marker/mobile fixes**.
- **PriceLabs prices + min-stay shown in calendar** (both read back from
  Channex; commits `…`/`9cb4c5f`) + rate editor locks price AND min-stay in
  PriceLabs mode + settings hint. Min-stay ownership moved to PriceLabs
  (`0df9f31`) — ARI flusher suppresses all stay restrictions in pricelabs mode;
  operator set PriceLabs update-type to "Price and Restrictions"; verified
  variable min-stay landing in Channex.
- **Live calendar** — inbound bookings appear without reload (`useBookingsRealtime`).
- **Desktop/mobile parity** — Reviews/Teammates/Notifications split out of
  Settings into own pages (`/reviews`, `/teammates`, `/notifications`), in both
  sidebar + mobile menu; mobile Settings link un-greyed.
- **Auth fix** — both Sebastian users (gmail magic-link, googlemail +Google) now
  own CITY APARTMENTS ESSEN; Google login on the iPhone PWA works.
- **Cleaning-calendar fix** (`d4b98e7`) — public `/cal/:slug` now uses an
  overlap date filter, so in-progress stays show (was check-in-in-window only).

**Open / parked:**
- PriceLabs parent/child listings: operator asked PriceLabs support how to
  drop the unused PARENT (old direct) listings without un-mapping/disabling the
  CHILD listings (the CHILDs are the Channex-connected ones that push price +
  restrictions). Do NOT "Disable Child Listing Sync" / "Un-map" — both kill the
  live pipeline. Availability stays with Rentaro, so no double-booking risk
  regardless.
- Auto-Review Phase B still needs a real Airbnb review to validate, then a cron.

**Open / next:**
- Auto-Review Phase B still needs a real Airbnb review to validate, then a cron.
- Public cleaning calendar window is 30 days forward; widen if the operator wants.
- Empty duplicate workspace `30ce2ddc-…` left in place (0 members, harmless).

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

### ✅ GO-LIVE COMPLETE (2026-05-30)

The full OTA cutover is done and **verified against production Channex**:

1. ✅ 16 apartments created + connected (CITY APARTMENTS ESSEN tenant, all EUR).
2. ✅ Airbnb + Booking.com mapped per apartment (self-service via the new
   `/channels` iframe). Booking pricing type = **Standard** (per-room), not OBP.
3. ✅ Guesty disconnected from the OTAs (Channex is now the sole channel manager).
4. ✅ 2.817 bookings imported (`pnpm db:import-guesty`, tenant default).
5. ✅ PriceLabs connected (ADR 0006 direct integration) and pushing **variable
   daily prices** into Channex — verified read-back showed 24–48 distinct
   rates/apartment (not the old 350-flat default). ⚠️ PriceLabs update-type
   must now be **"Price and Restrictions"** (see point 6).
6. ✅ **Preis-Quelle = PriceLabs** (Settings toggle). Decision **REVISED
   2026-05-31** (commit `0df9f31`): **PriceLabs owns price AND all stay
   restrictions** (min-stay, max-stay, CTA/CTD). Rentaro keeps ONLY
   availability + stop_sell. The ARI flusher (`ari-resolve.ts`
   `resolveRateValues`) now suppresses all stay-restriction fields in
   pricelabs mode and skips empty no-op entries; the rate editor locks the
   min-stay field (not just rate). ⚠️ **Operator must set PriceLabs
   update-type to "Price and Restrictions"** — otherwise nobody writes
   min-stay (no double-booking risk: availability stays with Rentaro).
   (Supersedes the 2026-05-30 "Rentaro keeps min-stay" split.)
7. ✅ Full Sync run for all apartments — availability now in Channex; verified
   Channex blocked-days ≥ DB booked-nights for all 16.

**Known event:** one double-booking slipped in during the mapping→full-sync
window (the listings were live on OTAs before availability was pushed).
Operator handled it manually. For any future tenant onboarding, **push Full
Sync immediately after channel mapping** to shrink that window.

### Where things run now (steady state)

- **PriceLabs** → daily prices → **Channex** → OTAs.
- **Rentaro** → availability (from bookings/blocks) + restrictions → **Channex** → OTAs.
- **OTA bookings** → Channex webhook → `ingest-bookings` → Rentaro DB (+ e-mail
  notifications once RESEND_* + the migration are live; see notifications item).
- Calendar shows PriceLabs prices read back from Channex (brand-colored); the
  rate editor is locked in PriceLabs mode.

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
