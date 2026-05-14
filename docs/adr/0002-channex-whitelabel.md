# ADR 0002 — Channex Whitelabel reseller model

**Status:** Accepted
**Date:** 2026-05-14

## Context

Channex.io offers three plan tiers relevant to us:

| Plan | Base | Per VR unit | Channel API |
|---|---|---|---|
| Standard | $30/mo | $4 | ❌ |
| Whitelabel | $130/mo | $0.50 | ✅ |
| Enterprise | $1,500/mo | custom | ✅ |

For a SaaS that re-sells channel-manager functionality, we have three setup
options:

1. **Reseller (Whitelabel):** one Channex account, all tenants under it.
2. **BYO (Standard or Whitelabel):** each tenant has their own Channex account
   and gives us an API key.
3. **Hybrid:** Channel API via our account, OTA OAuth via Channex iframe.

The Channel API (used for programmatic channel mapping) is Whitelabel-only.

## Decision

Use **Channex Whitelabel** with a single account. All tenants are partitioned
inside our Channex account.

Onboarding for a new tenant:
1. Tenant signs up in our app.
2. We programmatically create a Channex `Property + Room Type + Rate Plan`
   via the Channel API.
3. Mapping (connecting Airbnb/Booking listings to the new property) is done
   via embedded Channex iframe initially (Phase 7), custom UI in v2.

## Consequences

**+** $0.50/unit scales much better than $4/unit ($250/mo extra is the
break-even at ~70 units; we expect to cross that quickly).

**+** Channel API access lets us automate property creation and improve UX.

**+** Single Channex account means one set of credentials to monitor, rotate,
and budget.

**−** We become the responsible party for Channex compliance to our tenants
(Channex sees only our account, not theirs).

**−** If Channex suspends our account, all tenants are affected. Mitigation:
service-tier SLA negotiation, off-site backup of all booking data, monitoring.

**−** Channex Whitelabel costs $130/mo even at zero tenants. Acceptable for
serious commitment to the project.

## Alternatives considered

- **Standard plan, BYO:** killed by Standard not having Channel API. Forces
  tenants onto Whitelabel themselves, which is too expensive for small
  landlords.
- **Hybrid where tenant has Standard + we use our Whitelabel for mapping:**
  legally messy (whose account holds the data?), and Channex's data model
  doesn't really support it.

## References

- https://channex.io/pricing
- https://docs.channex.io/api-v.1-documentation/channel-api
