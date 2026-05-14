# CLAUDE.md — Channel Manager

Instructions for future Claude sessions on this project.

## Project mission

Multi-tenant SaaS channel manager for vacation rentals, built on Channex.io Whitelabel.
Currently single-tenant in use (one user, 17 apartments in Berlin) but multi-tenant from day one in architecture.

## Architecture rules (DO NOT violate without explicit ADR)

1. **Tenant isolation is non-negotiable.** Every business table has `tenant_id`. RLS is enabled. API routes always scope by current user's tenant memberships.
2. **Money is `bigint` cents + ISO currency code.** Never floats. Never assume EUR.
3. **Timestamps are `TIMESTAMPTZ` in UTC.** Booking dates (`checkin`/`checkout`) are `DATE` (no time, no tz).
4. **Channex API is hit only from the backend.** Never from the browser. API keys live in env vars or KMS, never in the frontend bundle.
5. **Webhooks are triggers, not sources of truth.** When a Channex webhook arrives, we re-fetch state via the API rather than trusting the payload (Channex docs: webhooks may arrive out of order).
6. **Booking-feed acknowledgment only after successful persistence.** Upsert by `channex_booking_id` UNIQUE; ACK after commit.
7. **Batch ARI updates.** One request with N day changes, not N requests with one change each.
8. **All side-effects through Inngest jobs.** Buttons enqueue jobs and return 202 immediately; UI subscribes to job status via Supabase Realtime.
9. **Audit log every mutation.** Owner can later see who did what.
10. **Type-safe end-to-end.** Drizzle schema → tRPC routers → React via inferred types. No `any` without a `// eslint-disable` and a reason.

## Stack reminder

- pnpm 9 workspaces + Turbo
- Node 20+
- React + Vite (no Next.js — we don't need SSR, and Vite is faster for dev)
- tRPC (not REST) for internal API
- Drizzle (not Prisma — better with RLS, no Rust binary, serverless-friendly)
- Inngest (not BullMQ — no Redis to operate)
- Supabase (Postgres + Auth + Realtime + Storage)

## Channex integration cheat-sheet

- Base URL sandbox: `https://staging.channex.io/api/v1`
- Base URL prod: `https://channex.io/api/v1`
- Auth header: `user-api-key: <key>`
- Push availability: `POST /availability` with `room_type_id`, `date_from`, `date_to`, `availability`
- Push rates/restrictions: `POST /restrictions` with `rate_plan_id`, `rate` (CENTS!), `min_stay`, `closed_to_arrival`, `stop_sell`
- Bookings: read-only via `/bookings/feed` (use ACK). MANUAL BOOKING CREATION IS NOT SUPPORTED — model as availability block instead.
- Webhooks: out-of-order possible, use as triggers only
- Source of incoming booking: `ota_name` field (`BookingCom`, `Airbnb`, `A-Expedia`) or `unique_id` prefix (`BDC-`, `ABB-`, `EXP-`)

## Useful commands

```bash
pnpm dev              # All apps in dev mode
pnpm db:generate      # Generate migration from Drizzle schema changes
pnpm db:migrate       # Apply pending migrations
pnpm db:studio        # Drizzle Studio (DB GUI)
pnpm typecheck        # Across all packages
pnpm lint
pnpm test
```

## Before writing frontend code

Invoke the `frontend-design` skill. This is enforced for visual quality. The calendar UI in particular needs careful design — it's the hardest part of the app and the user-facing centerpiece.

## File-creation policy

Don't create new top-level config files, documentation, or markdown without a reason. Prefer extending existing files. ADRs go in `docs/adr/NNNN-title.md`.

## User context

- Owner: Sebastian Teufel (sebastian.teufel.st@googlemail.com)
- 17 apartments across 3 buildings in Berlin (Vorrathstraße, Sybelstraße, Manteuffelstraße)
- Apartment naming: "Whg 0" through "Whg 18" (with gaps — Whg 14, 15, 16 don't exist)
- Plans to open SaaS to other landlords in the future
