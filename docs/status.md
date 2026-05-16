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
6017898 Phase 9d: calendar rate/restriction editor (live-review ready)
92473d4 Phase 9c: per-tenant rateSource (pms | pricelabs)
0e56c89 Phase 9b: per-day rate & restriction overrides
eec8ab1 Phase 9a: global ARI outbox + debounced/throttled flusher
51628f6 Phase 8: sandbox booking simulator + inbound pipeline fix
bdd3adf status: all 16 apartments connected; remove obsolete setup script
f7c2bfd docs: add status.md handoff covering Phase 0-7 state
7236433 Phase 7: one-click property onboarding to Channex
c5027ea booking: min-stay is a soft suggestion, not a hard auto-bump
fd41693 calendar: drag-select uses last cell as checkout, not last night
e0331cb Phase 6: inbound Channex webhook + booking-feed ingest
6286fb8 Phase 5b.1: rate + min-stay sync to Channex
```

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
| — | Reinigung (cleaning module) | ⬜ planned |
| — | Messaging (SMS + Channex inbox) | ⬜ planned |
| — | Settings page (tenant + property defaults editor) | ⬜ planned |
| — | Stripe billing | ⬜ deferred to SaaS launch |
| — | Self-service onboarding | ⬜ deferred |
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
│       └── src/inngest/        client, events.ts, functions/ (ari-flush, ari-resolve, ingest-bookings, channex-booking-mapper)
├── packages/
│   ├── db/                     Drizzle schema (incl. ari_pending, rate_overrides, tenants.rate_source), migrations 0001–0007, post-migrate SQL (RLS + realtime), scripts/
│   ├── api/                    tRPC routers: me, propertyGroups, properties, bookings, sync, rates, settings; services/ari.ts (enqueueAri); AppContext + AppEvents
│   ├── channex/                Typed REST client (properties incl. crsCapable, room_types, rate_plans, availability, restrictions, bookings incl. create + feed, webhooks)
│   ├── shared/                 Zod schemas, branded types, constants (Plan limits, OTA name mappings)
│   └── ui/                     cn() helper; expand when sharing components between apps
└── docs/
    ├── architecture.md         living architecture
    ├── status.md               THIS FILE
    ├── setup.md                first-time setup guide
    ├── channex-webhook-setup.md  registering the global webhook in production
    └── adr/                    0001–0006 architecture decisions
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

---

## Open items / next priorities

### High-value, channel-independent (good to build next)

- **Settings page** (1–2 days). Backend partly exists: `settings.tenant`
  + `settings.setRateSource` (Phase 9c). Still needs UI routes
  `/settings/account`, `/settings/property/:id` to edit:
  - Tenant defaults: city-tax rate, check-in/-out times, currency,
    **rate source (pms / pricelabs)** — backend ready, no UI yet
  - Per-property: name, group, default rate, cleaning fee, min-stay,
    description. Already triggers ARI rate enqueue via `properties.update`.
- **Reinigung module** (3–5 days). New schema:
  `cleaning_tasks` (auto-generated from bookings), `cleaners`,
  `cleaner_assignments`. Calendar-like view of cleaning slots,
  drag-assign, SMS notifications via Twilio.
- **Messaging Phase 8** (3–4 days). Twilio SMS + Channex Inbox via
  webhooks. Template engine for scheduled guest messages
  (`checkin:-1d@18:00`, `checkout:+0d@10:00`). Schema for `messages` +
  `message_templates` already exists.

### Production readiness

- **Secret rotation reminder** — Channex API key, Supabase service
  role, Supabase DB password all appeared in chat during development.
  Rotate before going to production:
  - Channex: User Profile → API Keys → regenerate
  - Supabase: Project Settings → Database → Reset password
  - Supabase: Settings → API → roll service_role key
- **Hardening (Phase 12)**: Sentry, structured logs, Vitest unit
  tests, an integration test that drives the full sync cycle.

### Deferred to actual SaaS launch

- Stripe billing (Phase 9), multi-tenant onboarding flow (Phase 10),
  reviews automation (Phase 11).

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
| `VITE_SUPABASE_*` | Browser-side duplicates of SUPABASE_* (anon key only) |

---

## How to brief a new Claude session

Paste this in the new session's first message:

> Pick up work on the channel-manager project at
> `C:\Users\User\iCloudDrive\channel-manager`. Read
> `docs/status.md` and `CLAUDE.md` for context, then [DESCRIBE YOUR TASK].
