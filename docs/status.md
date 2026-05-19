# Channel Manager — Current Status (Resume Handoff)

A snapshot of where the project stands and what's next. Read this first
when picking the work back up in a new Claude session.

For long-term design see [architecture.md](architecture.md) and the
[ADRs](adr/). For per-session rules see the root [CLAUDE.md](../CLAUDE.md).

---

## Quick start

```powershell
# Three terminals (or three Bash tasks):
cd C:\Users\User\iCloudDrive\channel-manager
pnpm --filter @cm/worker dev                         # tRPC + Inngest + webhooks on :3001
pnpm --filter @cm/web dev                            # Vite SPA on :5173
npx inngest-cli@latest dev -u http://localhost:3001/api/inngest --no-discovery  # Inngest dashboard :8288

# Optional 4th terminal — when working on billing locally:
stripe listen --forward-to localhost:3001/api/webhooks/stripe
```

Then open `http://localhost:5173/` → magic-link login → calendar.

iCloud sync may interfere with `node_modules` during heavy installs.
If install hangs, pause iCloud or move the repo to a non-iCloud path.

---

## Where we are

**Project root:** `C:\Users\User\iCloudDrive\channel-manager`
**Branch:** `main` (single-user mode locally, multi-tenant by design)
**Recent commits (`git log --oneline -12`):**

```
fb55cb8 billing: Billing UI + total lockout (stage D)
b0bedf5 billing: Stripe webhook + dispatcher + reconcile cron (stage C)
f7dcd88 billing: Stripe services + plan-guard + billing router (stage B)
e288ac9 billing: schema — billingExempt + subscription extras (stage A)
b97defe docs: ADR 0009 + status.md — Reinigung module
1c409bb cleaning: Reinigung UI — rules + checklists + teammates (stage D)
6641810 cleaning: automated dispatch cron + Twilio status (stage C)
ff216a5 cleaning: API — teammates, checklists, rules routers (stage B)
80c253e cleaning: schema — teammates, checklists, rules, outbox (stage A)
0aac9b5 docs: status.md — session handoff refresh
b428d40 settings: pin Europe/Berlin & EUR to top of the dropdowns
310e16e settings: timezone & currency as dropdowns
```
(Stripe billing + Reinigung added in recent sessions; see `git log` for the rest.)

## Phase status

| Phase | What | Status |
|---|---|---|
| 0 | Monorepo + Drizzle schema + RLS | ✅ |
| 1 | Auth + tRPC + dashboard shell + apartments | ✅ |
| 2a–c | Calendar UI + booking dialog + edit/cancel | ✅ |
| 4 | Typed Channex client (`@cm/channex`) | ✅ |
| 5a | Inngest worker + availability sync | ✅ |
| 5b.1 | Rate + min-stay sync | ✅ |
| 5b.2 | Live sync status (Supabase Realtime) + manual trigger | ✅ |
| 6 | Inbound Channex webhook + booking-feed ingest | ✅ |
| 7 | One-click property onboarding | ✅ |
| 8 | Sandbox booking simulator + inbound pipeline fix | ✅ |
| 9a | Global ARI outbox + debounced/throttled flusher | ✅ |
| 9b | Per-day rate & restriction overrides | ✅ |
| 9c | Per-tenant rateSource switch (pms \| pricelabs) | ✅ |
| 9d | Calendar rate/restriction editor (live-review ready) | ✅ |
| M1 | Channex guest-inbox iframe (OTT-embedded) | ✅ |
| M2 | Message templates CRUD + SMS test-send (Twilio) | ✅ |
| M3 | Trigger scheduler + automated send + delivery status | ✅ |
| Rein | Reinigung — teammate SMS automation (rules/checklists) | ✅ |
| — | Messaging Option B (own inbox + AI/KB auto-reply) | ⬜ planned (decided against for now — Option A iframe shipped) |
| Set | Settings page (Allgemein + Preise + SMS) | ✅ |
| Bill | Stripe SaaS billing — plans/subscriptions/metering/portal | ✅ |
| — | Self-service signup (public landing + signup form) | ⬜ deferred |
| — | Reviews automation | ⬜ planned (data model already in place) |
| — | Hardening (Sentry, tests, runbooks) | ⬜ planned |

> Note: commit messages use "Phase 8/9" for the certification work above.
> The earlier *planned* "Phase 8 Messaging / Phase 9 Stripe" placeholders
> were renumbered to "—" to avoid collision; they remain future work.

PriceLabs: decided to use the **direct PriceLabs ↔ Channex integration**
([ADR 0006](adr/0006-pricelabs-direct-channex.md)) — no custom connector.
The Phase 9c `rateSource` switch makes this plug-and-play: per tenant,
`pms` (we push rates) or `pricelabs` (PriceLabs owns rates in Channex, we
only push restrictions). Default `pms`; flip once on Production Channex.

### Channex certification readiness (Phase 9)

The integration now satisfies the [PMS certification](https://docs.channex.io/api-v.1-documentation/pms-certification-tests)
prerequisites and the code-side test scenarios:

| Prereq / cert test | Covered by |
|---|---|
| Event-driven change detection (no polling) | Outbox + `ari/changed` event |
| Queue/outbox + 20 ARI/min | Global flusher, debounce 8s + throttle 6/min |
| Retry/backoff 429/5xx | `@cm/channex` client (exp. backoff) + Inngest retries |
| Webhook + acknowledgement | `/api/webhooks/channex` + booking-revisions feed ack |
| Internal↔Channex ID mapping | `channex_properties` table |
| Tests 2–8 (rate/restriction scenarios) | Per-day `rate_overrides` + span-compacted batched push |
| Test 11 (booking receive & ack) | Feed ingest + ack (Phase 6/8) |
| Test 12 (rate limit) | Global throttle 6/min (< 20) |
| Test 13 (delta-only updates) | Outbox is delta; no timer full-sync (5-min cron drains only) |
| Stage 4 live review (change price in UI → call fires) | Calendar "Preise" mode → RateEditorDialog (Phase 9d) |

**Open product decision (not a code gap):** confirm rate-ownership scope
with Channex/PriceLabs. If the PMS must push rates for certification, we
keep `rateSource='pms'`; if PriceLabs owns them, certify
availability+restrictions only. The 9c switch handles either outcome.

**Declared scope (Test 14):** one room type + one rate plan per property
(vacation-rental model) — multi-room-type / multi-rate-plan is
deliberately out of scope. Rationale + additive migration path in
[ADR 0007](adr/0007-single-roomtype-rateplan-per-property.md).

---

## What works today (sandbox-verified)

| Feature | How it works |
|---|---|
| Login (magic link + Google OAuth) | Supabase Auth, post-login redirect `/calendar` |
| Tenant bootstrap | `me.bootstrap` mutation on first login |
| Apartments + groups | `propertyGroups.*` and `properties.*` routers, drag-handle placeholder |
| Calendar | Property rows × day columns, sticky rail (112px) + sticky header, half-cell booking visuals, weekend shading, today highlight |
| Free-cell info | Tabular nightly rate + min-stay label, hidden when occupied |
| Drag-select range | Last cell = checkout, soft min-stay enforcement |
| Booking dialog | Modes: guest / block. Fields: dates, times, guest count, rate, cleaning fee, auto-tax (5% city tax snapshot), notes, auto-review toggle |
| Booking detail sheet | Source/status badges, date blocks with times, price breakdown, OTA metadata, delete or storno-with-availability-release |
| Outbound sync (ARI) | Booking/block/rate/min-stay change writes a dirty-range row to `ari_pending` + emits `ari/changed`. One global flusher (`ari-flush`, debounce 8s + throttle 6/min) claims all unflushed rows across every tenant/property and emits ONE batched `POST /availability` + ONE `POST /restrictions`. 5-min cron drains stragglers (delta-only) |
| Per-day rates | `rate_overrides` table (rate, min/max stay, CTA/CTD, stop-sell per property/date). NULL inherits property default. Resolver compacts identical consecutive days into spans |
| Rate-source switch | `tenants.rate_source` = `pms` (default) or `pricelabs`. In `pricelabs` the flusher suppresses the `rate` field but still pushes PMS-owned restrictions. `settings.setRateSource` (admin) flips it + re-asserts a 180-day window |
| Inngest worker | `ari-flush` + `ari-flush-cron` + `ingest-bookings` registered; durable steps with retries. (`sync-availability`/`sync-rates` removed — logic lives in `ari-resolve`) |
| Manual sync button | Per-apartment in calendar left rail; live status via Supabase Realtime on `sync_jobs` (flusher writes per-property audit rows) |
| Inbound webhook | `/api/webhooks/channex/<secret>` validated, persisted in `webhook_deliveries`, emits `channex/booking.ingest`. Worker pulls the booking-revisions feed, reads `attributes.booking_id` inline (no re-fetch), upserts bookings, acks |
| Sandbox booking simulator | Apartments page (dev-only, CRS-capable properties): `bookings.simulateChannexBooking` mints an OTA booking via Channex CRS API then triggers ingest. Only shown where Channex has a CRS app connected (`bookings.crsCapableProperties`) |
| Calendar rate editor | "Buchungen \| Preise" mode toggle. In Preise mode a drag/click range opens `RateEditorDialog` (price, min-stay, stop-sell, clear). Free cells show effective per-day rate (override-aware, stop-sell flagged) |
| Guest inbox (Messages) | `/messages` → tab **Inbox**: per-apartment selector + embedded Channex chat. `messages.iframeSession` mints a Channex one-time token server-side (API key never in browser) and returns the `/auth/exchange?...&redirect_to=/messages` URL; rendered in a sandboxed iframe. Needs the Channex **Messages app** installed on the property; threads only appear with a real messaging-capable OTA channel |
| Message templates (M2) | `/messages` → tab **Vorlagen**: `messageTemplates` router (list/create/update/delete/vars/sendTest). Tenant-scoped, fixed channel per template (sms/airbnb/booking_com/email), trigger DSL string stored, `{{placeholder}}` body. Editor dialog with trigger presets + variable chips + preview/test. SMS test-send via dependency-free Twilio REST (`services/twilio.ts`); graceful "not configured" if `TWILIO_*` unset. **Triggers stored but not yet evaluated — automation is M3.** Real SMS verified live (sender "Information"/"LeopardsGmb"). |
| Per-tenant SMS sender | `tenants.sms_sender_id`; effective sender = `tenant.sms_sender_id ?? env.TWILIO_FROM`. `settings.setSmsSenderId` (admin, validates ≤11/≥1 letter/[A-Za-z0-9 ]); empty clears to account default. UI: SMS-Absender section on the **Settings page** (moved off the Vorlagen tab). [ADR 0008](adr/0008-per-tenant-sms-sender.md). Per-property sender deferred. |
| Settings page | `/settings` (nav enabled). Sections: **Allgemein** (`settings.updateTenant` admin — name, timezone, currency, city-tax stored bp/shown %, check-in/-out times), **Preis-Quelle** (segmented `setRateSource` — first UI), **SMS-Absender** (`setSmsSenderId`). Non-admins read-only notice. **Verified live:** form prefilled, City-Tax 5→7.5 % saved + persists. |
| Automated dispatch (M3) | `messages-dispatch` Inngest cron (every 10 min): parses each active template's trigger (`booking_created`, `checkin/checkout:±Nd@HH:MM`, DST-correct via Intl + tenant tz), finds due (booking × template), atomically claims a `messages` row (unique `booking_id+template_id`, ON CONFLICT DO NOTHING), renders `{{vars}}` from the booking, sends per channel (SMS→Twilio, OTA→`channex.bookings.sendMessage`), walks status `queued→sent→delivered/failed`; stuck-`queued` retried. 2-day grace prevents backfill spam. Twilio `StatusCallback` → `/api/webhooks/twilio/:secret` advances delivered/failed (needs public URL — skipped in local dev). `messages.listByBooking` + `messages.timelineForBooking` (merges projected template schedule with real rows). Manual `messages/dispatch.now` trigger alongside the cron. Booking detail sheet shows a hierarchical **Nachrichten** section. **Verified live:** real Twilio send (SID); trigger/DST math 9/9. |
| Automation builder (M4) | **Apartment scope (explicit allow-list)** via `message_template_listings` — a template reaches nobody until apartments are assigned; **per-booking override** via `message_booking_overrides` (force on/off; resolution = override ?? in-scope, shared `isTemplateEnabledForBooking`). DSL gains a `reservation` anchor (`reservation:±Nd@HH:MM`, booking-creation date in tenant tz; legacy `booking_created` still parsed; offsets capped 90d). Template editor: structured trigger builder (Ereignis → Relation per anchor → Tage 1–90 → Uhrzeit, listing-local) + Apartments checkbox allow-list. Booking detail: per-template Switch + "Deaktiviert" group + "auf Apartment-Standard" reset. Dispatch + timeline both honor scope+override. **Verified live (3 stages):** trigger/scope 11/11; builder round-trips `checkin:-1d@18:00`; Whg 0 assignment persists; Whg 8 out-of-scope booking toggled on → Geplant + override, persists. [ADR 0008-style decision: explicit list + both override layers.] |
| Custom variables | Tenant-defined `{{placeholders}}` (`message_variables` key/label, unique per tenant, no built-in collision) filled **per apartment** (`message_variable_values`). `resolveCustomVars(tenant, property)` merges into dispatch + timeline render; unset apartment → `{{key}}` stays literal (chosen fallback). `messageVariables` router (list/create/update/delete/setValue); `messageTemplates.vars` returns built-in + custom for editor chips. UI: third **Variablen** tab (create + per-apartment value editor) + custom chip in the template editor. **Verified live:** `{{wifiCode}}` created, Whg 0 filled (1/16, persists), chip shows in editor. |
| Reinigung (cleaning) | `/cleaning` → tabs **Regeln** + **Checklisten**. Cleaning rules mirror message templates but notify internal **Teammates** (Settings → Teammates, name/phone/active) by SMS instead of the guest. Rule = shared trigger DSL (reservation/checkin/checkout:±Nd@HH:MM via the shared `TriggerBuilder`) + explicit apartment allow-list + N teammates (fan-out) + optional **reusable checklist** rendered via `{{checklist}}`. Cleaning vars include the **next reservation** for the apartment (`nextCheckinDate/Time`, `nextGuestName`, `nextGuestCount`, `nextNotes`); missing → placeholder stays literal. `cleaning-dispatch` Inngest cron (every 10 min + `cleaning/dispatch.now`) mirrors `messages-dispatch`: atomic claim on unique `(rule,booking,teammate)`, Twilio send, status walk, stuck-retry, 2-day grace. Twilio status webhook also advances `cleaning_messages`. `cleaning_messages` in the Realtime publication. **Verified via throwaway E2E:** trigger due-time, next-reservation (same-day turnover), checklist render, dedupe 4/4. [ADR 0009](adr/0009-reinigung-module.md). |
| Billing (Stripe) | Hybrid pricing (base fee + per-property), monthly + annual −10 %, 14-day no-card trial, total lockout on past_due/canceled/expired-trial. `/settings` → Billing section: trial countdown, plan picker (Monatlich / Jährlich), "Kundenportal öffnen" → Stripe-hosted billing portal. Plan picker → Stripe Checkout (Stripe Tax auto, tax id collection, promotion codes allowed; trial_period_days = remaining local-trial days for seamless continuation). Webhook `POST /api/webhooks/stripe` (signature-verified, no URL secret), idempotent via `webhook_deliveries` UNIQUE(source,external_id); `stripe-event` Inngest function refetches and runs `syncSubscriptionFromStripe`. Daily `billing-reconcile` cron (03:15) pushes active-property count → Stripe quantity. Plan gate lives on `editorProcedure`/`adminProcedure`/`ownerProcedure` (single source of truth — all mutating routers inherit); `billingProcedure` is the ungated escape hatch for checkout/portal. Front-end mirror: `_dashboard.tsx` renders `<LockoutScreen />` in place of `<Outlet />` when blocked. Owner workspace `billingExempt=true` (backfilled in migration 0013) bypasses everything. **Verified via throwaway E2E:** owner exempt, new-tenant trial creation, trial-expired block, past_due block — 7/7. Stripe-side flow (Checkout → webhook → sync) needs `stripe listen` + test keys — see [docs/stripe-setup.md](stripe-setup.md). [ADR 0010](adr/0010-stripe-billing.md). |
| Property onboarding | Click "Verbinden" → creates Channex Property + Room Type + Rate Plan + DB mapping + initial ARI enqueue |
| Mobile nav | Bottom tab bar Kalender / Nachrichten / Reinigung / Menü (last three are placeholders) |

---

## Architecture map

```
channel-manager/
├── apps/
│   ├── web/                    React 18 + Vite + Tailwind, TanStack Router + Query, tRPC client
│   │   └── src/routes/calendar/   The hard UI; Calendar.tsx is the grid, NewBookingDialog, BookingDetailSheet
│   └── worker/                 Hono on :3001 — tRPC + Inngest serve + Channex webhook receiver
│       └── src/inngest/        client, events.ts, functions/ (ari-flush, ari-resolve, ingest-bookings, channex-booking-mapper, messages-dispatch, cleaning-dispatch, stripe-event, billing-reconcile); webhooks/ (channex, twilio, stripe)
├── packages/
│   ├── db/                     Drizzle schema (incl. ari_pending, rate_overrides, tenants.rate_source), migrations 0001–0007, post-migrate SQL (RLS + realtime), scripts/
│   ├── api/                    tRPC routers: me, propertyGroups, properties, bookings, sync, rates, settings, messages, messageTemplates, messageVariables, teammates, cleaningChecklists, cleaningRules, billing; services/ (ari, twilio, templates, triggers, scope, custom-vars, cleaning, stripe, plan-guard, onboarding); AppContext + AppEvents
│   ├── channex/                Typed REST client (auth/one_time_token, properties incl. crsCapable, room_types, rate_plans, availability, restrictions, bookings incl. create + feed, webhooks)
│   ├── shared/                 Zod schemas, branded types, constants (Plan limits, OTA name mappings)
│   └── ui/                     cn() helper; expand when sharing components between apps
└── docs/
    ├── architecture.md         living architecture
    ├── status.md               THIS FILE
    ├── setup.md                first-time setup guide
    ├── channex-webhook-setup.md  registering the global webhook in production
    └── adr/                    0001–0010 architecture decisions
```

### Sync data flow (end-to-end, verified against sandbox)

```
ARI change in our app (booking/block, property default, per-day override)
  └── tRPC mutation (bookings.* / properties.update / rates.setOverrides / sync.triggerProperty)
        ├── DB write
        └── enqueueAri(): INSERT ari_pending {tenantId, propertyId, kind, from, to}
                          + ctx.inngest.send('ari/changed')
              └── Worker — ONE global function `ari-flush`
                    (debounce 8s collapses bursts, throttle 6/min caps calls,
                     both keyed globally = account-wide single stream)
                    ├── Claim ALL unflushed ari_pending rows (every tenant/property)
                    ├── Merge to one [min,max) window per (property, kind)
                    ├── loadMappings() (channex_properties ⨝ tenants.rate_source)
                    ├── resolveAvailabilityValues() — occupied days from bookings, span-compacted
                    ├── resolveRateValues() — per-day effective rate/min-stay/restrictions
                    │     (rate suppressed if tenant.rate_source = 'pricelabs'), span-compacted
                    ├── ONE POST /availability + ONE POST /restrictions (all properties)
                    ├── Mark rows flushed + INSERT per-property sync_jobs (success)
                    └── Supabase Realtime → calendar sync badges update live
   (5-min `ari-flush-cron` re-runs the same flush to drain failed pushes; delta-only)

Booking in Airbnb (or any connected OTA) — sandbox: simulator mints it
  └── Channex webhook → POST /api/webhooks/channex/<secret>   (sandbox: simulator
        ├── Verify secret (constant-time)                       fires the event directly)
        ├── INSERT webhook_deliveries
        └── ctx.inngest.send('channex/booking.ingest', { reason, hintBookingId })
              └── Worker (ingest-channex-bookings)
                    ├── channex.bookings.feed.fetch({ limit: 50 })
                    ├── For each revision: read attributes inline (booking_id +
                    │     full booking data — no re-fetch) → mapChannexBooking()
                    │     └── UPSERT bookings keyed on channex_booking_id (UNIQUE)
                    └── channex.bookings.feed.ack(rev.id) after each successful upsert
                          └── Supabase Realtime → calendar shows the booking live
```

---

## Known quirks (write these down for new sessions)

1. **Channex `property_type` is singular** — `"apartment"` not `"apartments"`.
   Plural returns HTTP 422 with `details: { property_type: ["is invalid"] }`.
2. **Channex returns `null` for empty fields** — every Zod schema in
   `@cm/channex/src/schemas/*` uses `.nullish()` instead of `.optional()`.
3. **Channex rate plans require `options`** — at least
   `[{ occupancy: 2, is_primary: true }]`. Without it, 422 with
   `details: { options: ["can't be blank"] }`. Defaulted in
   `RatePlanCreate` schema.
4. **Channex rejects generic `min_stay`** on per-room rate plans —
   use `min_stay_arrival` and `min_stay_through` instead.
5. **`bigint` survives Inngest step.run badly** — convert to `number`
   inside the step before returning. Done in sync-rates.
6. **iCloud + `node_modules`** — sometimes hangs install. Use pnpm
   global store outside iCloud; pause iCloud sync during heavy ops.
   Also: iCloud can interrupt an editor's atomic write (temp → rename),
   leaving a `*.tmp.NNNN.*` file and the real file missing/shown as
   deleted in `git status`. Fix: the `.tmp` holds the intended content —
   `mv` it back over the target, then re-typecheck. Don't commit the
   `.tmp`.
7. **tsx-watch in apps/worker doesn't pick up changes in
   `packages/channex` etc.** — manual worker restart needed after
   touching packages.
8. **Direct Postgres connection (port 5432) is IPv6-only on Supabase
   free tier.** Runtime uses the **Transaction Pooler** at
   `aws-0-eu-west-1.pooler.supabase.com:6543`. Migrations use the
   direct `db.<ref>.supabase.co:5432`. URL-encode special chars in the
   password (`!` → `%21`).
9. **PowerShell HEREDOC commit messages** — avoid double-quoted strings
   inside the message; PowerShell will treat them as path tokens and
   `git commit -m` fails. Use plain words or single quotes around the
   embedded string.
10. **Channex sandbox vs production** — PriceLabs only connects to
    Channex production (paid subscription). Sandbox is for our API
    integration development; PriceLabs comes online after migrating to
    production.
11. **Channex Booking CRS API needs a connected CRS app** — `POST /bookings`
    returns `403 {"errors":{"code":"forbidden"}}` unless the property has a
    CRS application connected (surfaces as an extra `@channex.io` app user in
    `relationships.users`). In our sandbox only **Whg 0** has it (Apaleo test
    app from the seed); the 15 onboarded properties don't. Not a bug — the
    simulator UI is gated by `bookings.crsCapableProperties` so it only
    appears where it works.
12. **Booking-revisions feed shape** — full booking data lives in
    `attributes`, and the booking's own UUID is `attributes.booking_id`
    (top-level `id` is the *revision* id). `BookingRevision`/`Booking` share
    `BookingAttributes`; the ingest reads it inline (no `bookings.get`
    re-fetch). Getting this wrong = silent `missing_booking_id` skips.
13. **Inngest `runId` is a ULID, not a UUID** — `ari_pending.batch_id` is
    `text` (not `uuid`) so the flush can stamp the runId for tracing.
14. **Supabase magic links can't be opened in a different browser** —
    single-use AND PKCE-bound to the browser that requested them (the
    `code_verifier` lives there). A headless/preview browser will bounce to
    `/login` even with a valid token. For authed UI checks, use the
    Claude-in-Chrome extension on the user's already-logged-in browser.
15. **Channex Messages needs the "Messages app" + a messaging OTA channel**
    — `/auth/one_time_token` and the chat iframe require the Messages app
    installed per property (`app.channex.io/applications`, paid). Even with
    it installed, the iframe shows *"Property not have any active channel
    with message support"* until a real Airbnb/Booking.com channel is
    connected (production). Same channel-less sandbox limit as bookings/ARI;
    not a code defect. Installed on **Whg 0** in our sandbox.
16. **Channex iframe auth = one-time token (OTT)** — never put the API key
    in an iframe URL. `POST /auth/one_time_token` server-side → 15-min
    single-use token → `/auth/exchange?oauth_session_key=…&app_mode=headless
    &redirect_to=/messages&property_id=…`. `redirect_to=/messages` is
    verified correct for the chat screen.

---

## Open items / next priorities

### Done since the original handoff (do NOT rebuild)

- **Phase 8** sandbox booking simulator; **Phase 9a–d** ARI outbox +
  global throttled flusher, per-day rate/restriction overrides,
  per-tenant rateSource, calendar rate editor → Channex
  certification-ready (see the cert table above).
- **Messaging M1–M4 + extras**: Channex guest-inbox iframe; template
  CRUD; per-tenant SMS sender (ADR 0008); automated dispatch cron
  (trigger DSL incl. `reservation`, DST-safe) + Twilio + delivery
  webhook; per-booking message timeline; apartment scope +
  per-booking override; structured trigger builder; tenant **custom
  variables** (per-apartment values).
- **Settings page** `/settings` (Allgemein/Preise/SMS, tz+currency
  dropdowns, Berlin/EUR pinned).
- **Reinigung module** (ADR 0009): teammate SMS automation — rules
  (shared trigger DSL + apartment allow-list + N-teammate fan-out +
  optional reusable checklist + next-reservation vars), `/cleaning`
  page (Regeln/Checklisten), Teammates in Settings, `cleaning-dispatch`
  cron, shared `TriggerBuilder` extracted from the message editor.
- **Stripe SaaS billing** (ADR 0010): hybrid pricing (base +
  per-property), monthly + annual −10 %, 14-day no-card trial, total
  lockout on failure/expiry. Plan guard on editor/admin/owner
  procedures + ungated `billingProcedure` escape hatch; webhook +
  daily reconcile via Inngest; `<BillingCard>` + `<LockoutScreen>` UI.
  Owner workspace exempt via `tenants.billingExempt` (backfilled).
  Operator setup: [docs/stripe-setup.md](stripe-setup.md).

### Genuinely next (good candidates)

- **Cleaning follow-ups** (intentionally deferred from ADR 0009):
  per-booking on/off override for cleaning rules (messaging has one);
  a "letzte/geplante Erinnerungen" timeline on `/cleaning` (would use
  a `useCleaningMessagesRealtime` hook — `cleaning_messages` is already
  in the Realtime publication; no message-history UI consumes it yet);
  cleaner status-back (currently SMS one-way).
- **Messaging polish**: custom-variable label edit (API
  `messageVariables.update` exists, no UI); test-send with apartment
  picker (custom vars resolve); searchable combobox for the long
  tz/currency selects.
- **Resend a failed message**: the `messages(booking_id,template_id)`
  unique index blocks re-send of a `failed` (e.g. `no_phone`) row by
  design — add an explicit "retry" that clears/re-claims it.
- **Per-property settings view** (defaults/variables/sender per
  apartment in one place) if a centralized editor is wanted.

### Production readiness

- **Secret rotation reminder** — Channex API key, Supabase service
  role, Supabase DB password, **and the Twilio Auth Token** all
  appeared in chat during development. Rotate before going to
  production:
  - Channex: User Profile → API Keys → regenerate
  - Supabase: Project Settings → Database → Reset password
  - Supabase: Settings → API → roll service_role key
  - Twilio: Console → Account → Auth Token → regenerate (currently a
    budget-capped test token, intentionally accepted by the owner)
- **Hardening (Phase 12)**: Sentry, structured logs, Vitest unit
  tests, an integration test that drives the full sync cycle.

### Deferred to actual SaaS launch

- **Public signup flow** — landing page, signup form, magic-link
  invite to a fresh workspace. Currently bootstrap happens on first
  Supabase login (no marketing front door).
- **SMS overage / usage-based billing** — pass Twilio cost through to
  the tenant invoice via Stripe usage records. Plumbing not yet built.
- **Reviews automation** (Phase 11).

### Smaller polish items

- **External booking auto-review toggle in detail sheet** — currently
  only changeable via the edit dialog.
- **Drag past occupied cells** — clamp currently stops one cell short
  of allowing back-to-back booking creation. Workaround: edit dates
  manually in the dialog.
- **Sync status: two badges per row** — availability + rates can have
  different last-results; currently shown as one.
- **Property reorder via drag** — handle is visible but `@dnd-kit`
  isn't wired. Backend `properties.reorder` mutation exists.

---

## Channex (sandbox) state

- 1 Channex API key, 1 webhook secret (in `.env.local`)
- **All 16 apartments connected** via the Phase 7 onboarding flow.
  Whg 0 was bootstrapped manually with the (now-removed)
  `setup-channex-mapping` script; the other 15 went through the
  `properties.onboardToChannex` mutation triggered from the UI.
- No real OTA channels connected — that needs a paid Channex account
  and Airbnb / Booking.com partner credentials.
- **CRS booking** works only on **Whg 0** (has the Apaleo CRS app from
  the seed). The sandbox booking simulator is therefore limited to Whg 0;
  it's enough to exercise the full inbound pipeline E2E.
- **Messages app** installed on **Whg 0**. OTT + chat iframe verified
  working; threads stay empty until a real messaging OTA channel exists.

Run `pnpm --filter @cm/db check-onboarding` for the live mapping.

### Resetting for production switch

When moving from sandbox to production Channex, the channex_properties
rows are throwaway. Steps:

1. Update `CHANNEX_API_URL` and `CHANNEX_API_KEY` in `.env.local`.
2. Wipe sandbox mappings:
   ```sql
   UPDATE properties SET channex_property_ref = NULL;
   DELETE FROM channex_properties;
   ```
3. Apartments page → click "Verbinden" on each → creates fresh
   Production Channex resources via the same mutation.
4. (Production only) Register the inbound webhook once via the steps
   in [channex-webhook-setup.md](channex-webhook-setup.md).

---

## Useful scripts

```powershell
# DB
pnpm --filter @cm/db seed              # apartments + groups
pnpm --filter @cm/db migrate           # drizzle + RLS + realtime
pnpm --filter @cm/db dump              # current apartments listing
pnpm --filter @cm/db check-onboarding  # which apartments are connected
pnpm --filter @cm/db sync-jobs:latest  # 3 most recent sync runs
pnpm --filter @cm/db webhooks:latest   # 3 most recent webhook deliveries
npx tsx packages/db/scripts/latest-channex-bookings.ts  # last 5 OTA-ingested bookings

# Channex
pnpm channex:smoke                     # ping + list resources

# Typecheck (all packages)
pnpm -r typecheck
```

---

## Sensitive credentials

All in `.env.local` (gitignored). Critical: never commit. Already rotated
once during dev; consider rotating again before any deployment.

| Var | Source |
|---|---|
| `SUPABASE_*` | Supabase Project Settings → API |
| `DATABASE_URL` | Transaction Pooler (port 6543) |
| `DATABASE_URL_DIRECT` | Direct (port 5432), migrations only |
| `CHANNEX_API_KEY` | Channex User Profile (sandbox or prod) |
| `CHANNEX_WEBHOOK_SECRET` | 48-char random string, put into Channex webhook URL |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio Console → Account Info (optional; SMS test/automation) |
| `TWILIO_FROM` | Twilio number (E.164) or approved alphanumeric sender id |
| `TWILIO_STATUS_SECRET` | Path secret for `/api/webhooks/twilio/:secret` (optional) |
| `PUBLIC_WEBHOOK_BASE_URL` | Public base URL for inbound webhooks; unset in dev → Twilio status callback skipped |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys (test or live). Optional; billing degrades to "not configured" if unset. |
| `STRIPE_WEBHOOK_SECRET` | `stripe listen` output in dev, or webhook endpoint signing secret in prod |
| `STRIPE_PRICE_BASE_{MONTHLY,ANNUAL}` | The 2 Stripe Prices on the "Base" Product |
| `STRIPE_PRICE_PROPERTY_{MONTHLY,ANNUAL}` | The 2 Stripe Prices on the "per Apartment" Product |
| `VITE_SUPABASE_*` | Browser-side duplicates of SUPABASE_* (anon key only) |

---

## How to brief a new Claude session

Paste this in the new session's first message:

> Pick up work on the channel-manager project at
> `C:\Users\User\iCloudDrive\channel-manager`. Read `docs/status.md`
> first (full state + handoff notes), then `CLAUDE.md`, then
> [DESCRIBE YOUR TASK].

### Operational notes for the next session (read these)

- **Everything is committed.** `git log` HEAD ≈ the docs commit that
  accompanies the Stripe-billing stages (`billing: …` A–D + this status
  update; ADR 0010). Working tree is clean **except**
  `packages/db/migrations/9999_rls_policies.sql`, which is
  **intentionally left untracked** — do not commit it, do not delete it.
  (RLS for new tables goes in `packages/db/post-migrate/01_rls_policies.sql`,
  applied by `pnpm --filter @cm/db migrate`; the `migrations/9999_…` file
  is a separate untracked artifact, not the applied path.)
- **Dev servers** (start if not running, from the repo root):
  - `pnpm --filter @cm/worker dev` → tRPC + Inngest + webhooks on **:3001**
  - `pnpm --filter @cm/web dev` → Vite SPA on **:5173**
  - `npx inngest-cli@latest dev -u http://localhost:3001/api/inngest --no-discovery` → Inngest UI **:8288**
  - Worker does NOT reliably hot-reload changes in `packages/*`; after
    editing a package, restart the worker.
- **Auth is magic-link (Supabase, PKCE).** A magic link can't be
  completed in a different browser (single-use + PKCE verifier). For
  authed UI verification, use the **Claude-in-Chrome extension** on the
  user's already-logged-in browser (the user enables it on request).
- **Twilio** test credentials are in `.env.local` (budget-capped, owner
  accepted). Sending real SMS costs money — get explicit per-number
  consent before any live send.
- **Sandbox limits** (not bugs): no real OTA channels → OTA messaging /
  bookings only simulatable; Channex **CRS booking** and the
  **Messages app** are enabled only on **Whg 0**.
- **Verify before claiming done**: `pnpm -r typecheck` must be clean;
  prefer a throwaway script under `packages/db/scripts/` for logic
  E2E, deleted after. Commit per feature with the established message
  style; update this file as part of the change.
- **Decisions are ADRs** `docs/adr/0001–0010`. The Channex
  certification status + the deliberate single-room-type scope are in
  the phase/cert tables above and ADR 0007.
