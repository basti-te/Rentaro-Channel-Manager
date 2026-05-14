# Architecture — Channel Manager

Living document. Update as decisions evolve. Major decisions get their own ADR
in `docs/adr/`.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                   React + Vite + TS (Vercel)                     │
│              Multi-Tenant SPA, TanStack Router                   │
└────────────────┬────────────────────────────────────────────────┘
                 │  tRPC over HTTPS
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│   API Layer (Vercel Functions)      Workers (Railway/Fly)       │
│   - tRPC routers                    - Inngest functions         │
│   - Auth middleware                 - Webhook receivers         │
│   - Tenant guard                    - Scheduled scans           │
└────────┬────────────────────────────────────┬───────────────────┘
         │                                    │
         ▼                                    ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Supabase         │  │ Inngest          │  │ Channex Whitelab │
│ - Postgres + RLS │  │ - Job queue      │  │ - 1 account      │
│ - Auth           │  │ - Cron + retry   │  │ - Channel API    │
│ - Realtime       │  │ - Step functions │  │ - Global webhook │
└──────────────────┘  └──────────────────┘  └──────────────────┘
                                            │
        Stripe (billing) — Twilio (SMS) — Resend (email) — Sentry
```

## Core principles

1. **Tenant isolation at the database layer.** RLS policies enforce that no
   user can see another tenant's data, even if API code has a bug. The API
   uses the Supabase service role and enforces tenant scoping in middleware;
   RLS is defense in depth.
2. **Side-effects through Inngest jobs.** UI buttons enqueue jobs and return
   immediately. Job status flows back via Supabase Realtime (postgres_changes
   on `sync_jobs.status`).
3. **Channex API is server-side only.** API keys never touch the browser.
4. **Webhooks are triggers, not sources of truth.** Channex docs warn that
   webhooks may arrive out of order. We use them as "re-fetch now" signals.
5. **Money in `bigint` cents + ISO 4217 currency.** No floats. No assumed EUR.
6. **Timestamps in UTC (`TIMESTAMPTZ`). Booking dates as `DATE`** (no tz).
7. **Type-safe end-to-end.** Drizzle schema → tRPC routers → React.

## Channex integration model

### One Whitelabel account, N tenants

We hold a single Channex Whitelabel account. Every tenant's properties live
inside our account, partitioned by `channex_properties.tenant_id` in our DB.

When a webhook arrives:
1. POST `/api/webhooks/channex` (path includes our global webhook secret)
2. We look up `tenant_id` from `channex_properties.channex_property_id`
3. Enqueue Inngest job with `tenant_id` baked in
4. Return 200 OK within 200ms (Channex retries on slow responses)

### Mapping flow (Iframe-first, custom UI later)

For MVP we embed Channex's mapping iframe in our settings UI. This skips the
weeks of OTA-onboarding-flow plumbing. In v2 we move to a custom UI using the
Channel API (which our Whitelabel account has access to).

### Manual booking ↔ Channex

Channex does NOT accept new bookings via API. Bookings only come INTO Channex
from OTAs. To "push" a manual booking, we:
1. Store it locally with `source=internal`
2. Enqueue a `push_availability` job
3. Worker sets `availability=0` for the booked dates via Channex API
4. Channex propagates "unavailable" to Airbnb + Booking
5. Guest data stays in our DB only

Pure blocks (no guest) work the same way with `source=block`.

## Data model summary

See `packages/db/src/schema.ts` for authoritative definitions.

```
tenants ─┬─ memberships ─ users
         ├─ subscriptions
         ├─ channex_properties ─── properties ─── bookings ─── messages
         ├─                       │                           
         ├─ property_groups ──────┘                            
         ├─ sync_jobs                                          
         ├─ message_templates, review_templates                
         ├─ reviews                                            
         ├─ audit_log                                          
         └─ webhook_deliveries (idempotency)                   
```

## Build phases

| Phase | Title | Status |
|---|---|---|
| 0 | Foundation (repo, schema, RLS) | **In progress** |
| 1 | Apartments + Groups CRUD | Pending |
| 2 | Calendar UI (the hard one) | Pending |
| 3 | Manual booking + block | Pending |
| 4 | Channex client (typed) | Pending |
| 5 | Sync worker (Inngest, outbound) | Pending |
| 6 | Webhook receiver (inbound) | Pending |
| 7 | Channel mapping (iframe) | Pending |
| 8 | Messaging (SMS + Channex inbox) | Pending |
| 9 | Stripe billing | Pending |
| 10 | Self-service onboarding | Pending |
| 11 | Reviews | Pending |
| 12 | Hardening (Sentry, tests, backups) | Pending |

## ADRs

- [0001 — Multi-tenant from day one](adr/0001-multi-tenant-from-day-one.md)
- [0002 — Channex Whitelabel reseller model](adr/0002-channex-whitelabel.md)
- [0003 — Drizzle over Prisma](adr/0003-drizzle-over-prisma.md)
- [0004 — Inngest over BullMQ](adr/0004-inngest-over-bullmq.md)
- [0005 — Vite SPA over Next.js](adr/0005-vite-over-nextjs.md)
