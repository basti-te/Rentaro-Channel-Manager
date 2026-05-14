# ADR 0006 — PriceLabs ↔ Channex direct integration (no custom connector)

**Status:** Accepted
**Date:** 2026-05-14

## Context

We want dynamic pricing for the apartments. PriceLabs is the chosen pricing
engine. There are two integration options:

A) Use the existing **PriceLabs ↔ Channex direct partner integration**.
   The user connects PriceLabs to their Channex account once via the
   PriceLabs UI. PriceLabs then pulls listings + reservations from Channex
   and pushes optimized prices back to Channex daily. Channex propagates
   the prices to Airbnb / Booking.com / etc.

B) Build our own **PriceLabs Connector API** integration (PMS-style):
   - Push listings + reservations from us to PriceLabs
   - Receive daily price webhooks at our endpoint
   - Persist a `price_overrides` table per day per apartment
   - Push those overrides to Channex via our `sync-rates` worker

   Requires PriceLabs to approve us as a partner and issue an integration
   token (`X-INTEGRATION-TOKEN` + `X-INTEGRATION-NAME` headers). Approval
   takes days to weeks. Maintenance burden ongoing.

## Decision

**Option A.** Use the PriceLabs ↔ Channex direct integration.

The user already has a PriceLabs account; setup takes minutes inside the
PriceLabs UI by pasting a Channex API key. Prices flow Pricelabs → Channex
→ OTAs without our code touching them.

## Consequences

**+** Zero code, zero maintenance for the pricing path.

**+** No need to apply for a PriceLabs partner token, which would otherwise
block release for weeks.

**+** PriceLabs is the source of truth for prices — they recompute daily
and push to Channex. Our `sync-rates` function still pushes the per-
apartment `default_rate_cents` as a baseline; PriceLabs's later writes
overwrite it, which is the desired behaviour.

**−** Prices set by PriceLabs are not visible in our Calendar (the free-
cell rate label only reflects `properties.default_rate_cents`). If we
ever want to surface PriceLabs's recommendation per day in our UI, we'd
need to either:
  - Read prices back from Channex (`GET /restrictions` per range), or
  - Build the custom Connector (Option B).

**−** The user has to manage two integrations (Channex + PriceLabs) in
two separate UIs, not a unified one in our app.

## Revisit if

- We open the SaaS to tenants who can't easily set up the direct connection
  themselves — at that point hiding the dual-config behind a unified
  onboarding flow becomes valuable, which probably means building Option B.
- Custom pricing rules ("Whg 0 always +10% on weekends") become a real
  requirement that PriceLabs can't express natively.
- We want to surface PriceLabs prices in our calendar UI without polling
  Channex.

## References

- [PriceLabs ↔ Channex direct setup guide](https://help.pricelabs.co/portal/en/kb/articles/how-to-integrate-pricelabs-with-channex)
- [PriceLabs Connector API spec](https://app.swaggerhub.com/apis-docs/PriceLabs/price-labs_connector/1.0.0) — the Option B alternative
