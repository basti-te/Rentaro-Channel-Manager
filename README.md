# Channel Manager

Multi-tenant channel manager for vacation rentals. Built on Channex.io (Whitelabel).

## Status

Phase 0 — Foundation. No runnable app yet. See [docs/architecture.md](docs/architecture.md) for the full design.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind |
| API | tRPC, Vercel Functions |
| Worker | Inngest (job queue with retries, cron, fan-out) |
| DB | Supabase Postgres + Row-Level Security |
| ORM | Drizzle |
| Auth | Supabase Auth (Email, Google) |
| Real-time | Supabase Realtime (postgres_changes) |
| Channel API | Channex.io Whitelabel |
| Billing | Stripe |
| SMS | Twilio |
| Email | Resend |
| Observability | Sentry + Better Stack |
| Hosting | Vercel (web + api) + Railway (worker, optional) |

## Repository layout

```
.
├── apps/
│   ├── web/             React + Vite SPA
│   └── worker/          Long-running listener (Inngest dev server, scheduled scans)
├── packages/
│   ├── db/              Drizzle schema + migrations + client
│   ├── api/             tRPC routers (shared between web and worker)
│   ├── channex/         Typed Channex.io API client
│   ├── shared/          Zod schemas, constants, branded types
│   └── ui/              Shared React components (Tailwind + Radix primitives)
├── docs/
│   ├── architecture.md  Living architecture overview
│   └── adr/             Architecture Decision Records
└── infra/               Deployment configs (created as we add platforms)
```

## Getting started

You'll need: Node 20+, pnpm 9+, a Supabase project, and a Channex Whitelabel sandbox account.

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env template and fill in
cp .env.example .env.local

# 3. Apply database migrations
pnpm db:migrate

# 4. Start dev servers (web + worker + inngest)
pnpm dev
```

See [docs/setup.md](docs/setup.md) for a step-by-step setup guide (created in Phase 1).

## Multi-tenancy

Every business table has a `tenant_id`. Postgres RLS policies enforce isolation — even if an API endpoint has a bug, no cross-tenant data leaks at the DB layer.

The Channex Whitelabel account is shared across all tenants. Each tenant's Channex `property_id` is mapped in `channex_properties.tenant_id`, and inbound webhooks are routed by that mapping.

## License

Proprietary. All rights reserved.
