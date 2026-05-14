# ADR 0001 — Multi-tenant from day one

**Status:** Accepted
**Date:** 2026-05-14

## Context

Initial use case is single-user (Sebastian, 17 apartments). Future intent is
to open as SaaS to other landlords. We must decide whether to start single-
tenant and refactor later, or build multi-tenant immediately.

## Decision

Build multi-tenant from the start.

Every business table has a `tenant_id` column. Postgres RLS policies enforce
isolation. Auth flows through `users → memberships → tenants`. The Stripe
billing layer is scaffolded but only activated when SaaS launches.

## Consequences

**+** Refactoring from single-tenant to multi-tenant later is one of the most
painful migrations possible — it touches every query, every URL, every
permission check. Doing it now is much cheaper.

**+** RLS gives defense-in-depth: even if an API endpoint has a bug, no
cross-tenant data leak at the database layer.

**+** The Channex Whitelabel model maps naturally to multi-tenancy.

**−** Slightly more boilerplate per query (joining through `memberships` or
filtering by `tenant_id`).

**−** Need to be careful with Realtime subscriptions to filter by tenant.

## Alternatives considered

- **Single-tenant first, refactor later.** Rejected: the cost of retrofitting
  is much higher than building it in upfront, and we already know the SaaS
  intent.
- **Schema-per-tenant.** Rejected: harder migrations (must apply to every
  schema), harder ops, harder cross-tenant analytics.
- **Database-per-tenant.** Rejected: enormous operational overhead, no
  realistic path at our scale.
