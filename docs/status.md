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
**Recent commits (`git log --oneline -15`):**

```
7236433 Phase 7: one-click property onboarding to Channex
c5027ea booking: min-stay is a soft suggestion, not a hard auto-bump
fd41693 calendar: drag-select uses last cell as checkout, not last night
e0331cb Phase 6: inbound Channex webhook + booking-feed ingest
10e687d docs: ADR 0006 — PriceLabs ↔ Channex direct, skip custom connector
6286fb8 Phase 5b.1: rate + min-stay sync to Channex
be2ca66 Phase 5b.2: live sync status + manual trigger per apartment
99441d7 db: cache postgres-js client per connection string
5a4b61c Phase 5a: Inngest sync pipeline (Channex availability push)
fff3aa6 Phase 4: typed Channex client (Whitelabel)
d118903 Phase 2c: edit bookings + soft-cancel for external (OTA) sources
5a6caea Phase 2b: booking dialog and detail sheet with full breakdown
2aa8ba5 calendar: trim left rail 132 -> 112 px (~15% narrower)
beadfba Phase 2 polish: rate per night in free cells, half-cell bookings, mobile tab bar
3171505 Phase 2a: calendar UI skeleton with sticky grid + booking blocks
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
| 8a | Reinigung (cleaning module) | ⬜ planned |
| 8 | Messaging (SMS + Channex inbox) | ⬜ planned |
| Settings | Tenant + property defaults editor | ⬜ planned |
| 9 | Stripe billing | ⬜ deferred to SaaS launch |
| 10 | Self-service onboarding | ⬜ deferred |
| 11 | Reviews automation | ⬜ planned (data model already in place) |
| 12 | Hardening (Sentry, tests, runbooks) | ⬜ planned |

PriceLabs: decided to use the **direct PriceLabs ↔ Channex integration**
([ADR 0006](adr/0006-pricelabs-direct-channex.md)) — no custom connector.
Activates once on Production Channex.

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
| Outbound sync | Booking create/update/delete fires `apartment/availability.sync`; property defaults change fires `apartment/rates.sync` |
| Inngest worker | sync-availability + sync-rates + ingest-bookings registered; durable steps with retries |
| Manual sync button | Per-apartment in calendar left rail; live status via Supabase Realtime on `sync_jobs` |
| Inbound webhook | `/api/webhooks/channex/<secret>` validated, persisted in `webhook_deliveries`, emits `channex/booking.ingest`. Worker pulls feed, upserts bookings, acks |
| Property onboarding | Click "Verbinden" → creates Channex Property + Room Type + Rate Plan + DB mapping + initial sync |
| Mobile nav | Bottom tab bar Kalender / Nachrichten / Reinigung / Menü (last three are placeholders) |

---

## Architecture map

```
channel-manager/
├── apps/
│   ├── web/                    React 18 + Vite + Tailwind, TanStack Router + Query, tRPC client
│   │   └── src/routes/calendar/   The hard UI; Calendar.tsx is the grid, NewBookingDialog, BookingDetailSheet
│   └── worker/                 Hono on :3001 — tRPC + Inngest serve + Channex webhook receiver
│       └── src/inngest/        client, events.ts (event types), functions/ (sync-availability, sync-rates, ingest-bookings)
├── packages/
│   ├── db/                     Drizzle schema, migrations, post-migrate SQL (RLS + realtime publication), scripts/
│   ├── api/                    tRPC routers: me, propertyGroups, properties, bookings, sync; AppContext + AppEvents type
│   ├── channex/                Typed REST client (properties, room_types, rate_plans, availability, restrictions, bookings.feed, webhooks)
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
Booking change in our app
  └── tRPC mutation (bookings.createInternal / update / delete)
        ├── DB write
        └── ctx.inngest.send('apartment/availability.sync', { tenantId, propertyId, from, to, reason })
              └── Worker (Inngest function sync-apartment-availability)
                    ├── INSERT sync_jobs row (status=running)
                    ├── Look up channex_properties for this property
                    │     └── No mapping? mark success-skipped, exit
                    ├── Read overlapping bookings, compute occupied days
                    ├── Compact into contiguous spans
                    ├── POST /availability via @cm/channex
                    └── UPDATE sync_jobs (status=success/failed)
                          └── Supabase Realtime → browser updates the sync button live

Booking in Airbnb (or any connected OTA)
  └── Channex webhook → POST /api/webhooks/channex/<secret>
        ├── Verify secret (constant-time)
        ├── INSERT webhook_deliveries
        └── ctx.inngest.send('channex/booking.ingest', { reason, hintBookingId })
              └── Worker (ingest-channex-bookings)
                    ├── channex.bookings.feed.fetch({ limit: 50 })
                    ├── For each revision: channex.bookings.get(booking_id) → mapChannexBooking()
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

---

## Open items / next priorities

### High-value, channel-independent (good to build next)

- **Settings page** (1–2 days). Routes `/settings/account`,
  `/settings/property/:id`. Lets the user edit:
  - Tenant defaults: city-tax rate, check-in/-out times, currency
  - Per-property: name, group, default rate, cleaning fee, min-stay,
    description. Already triggers rate-sync via `properties.update`.
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
