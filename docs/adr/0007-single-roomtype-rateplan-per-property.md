# ADR 0007 — One room type + one rate plan per property (vacation-rental scope)

**Status:** Accepted
**Date:** 2026-05-16

## Context

Channex's data model is hierarchical:

```
Property
└── Room Type (e.g. "King Suite", "Queen Suite")
      └── Rate Plan (e.g. "with breakfast", "without breakfast")
            └── per-day rate + restrictions
```

A hotel can have several room types per property, several rate plans per
room type, and a different price per day for each room-type/rate-plan
combination.

Our actual inventory is **16 self-contained apartments**. Each apartment
is exactly one sellable unit with exactly one nightly price. There is no
"room type" choice and no rate-plan variants (no breakfast tiers, no
flexible/non-refundable split) — a guest books *the apartment*.

We deliberately modelled the integration to match this reality:

- `channex_properties` carries exactly one `channex_room_type_id` and one
  `channex_rate_plan_id` per row (1 property → 1 room type → 1 rate plan).
- `rate_overrides` is keyed on `(property_id, date)` — per-day price/
  restriction granularity, but no room-type / rate-plan dimension.
- `resolveRateValues` / `resolveAvailabilityValues` use the single
  room-type / rate-plan id from the mapping.
- `properties.onboardToChannex` creates exactly one room type + one rate
  plan in Channex.

The question raised: should we generalise now to the full hotel matrix
(N room types × N rate plans × per-day price)?

## Decision

**No. We keep the 1 property = 1 room type = 1 rate plan model and do not
build multi-room-type / multi-rate-plan support now.**

Per-day price/restriction variation **is** supported (`rate_overrides`).
Only the room-type/rate-plan *matrix* is out of scope.

For Channex PMS certification we **disclose** this explicitly (certification
Test 14 asks partners to declare unsupported features): *"Single rate plan
per room type, one room type per property — vacation-rental model."* This
is a recognised, common PMS scope and not a certification failure.

## Consequences

**+** Matches the real product (apartments). No speculative complexity in
the schema, resolver, onboarding, or calendar UI.

**+** Certification proceeds with a declared scope; no extra build needed.

**+** The expensive, already-built infrastructure is **entity-agnostic**
and does not need rework if we generalise later:
  - The Channex client (`availability.push` / `restrictions.push`) already
    accepts arrays mixing arbitrary `room_type_id` / `rate_plan_id` in one
    call.
  - The global ARI outbox + debounced/throttled flusher (ADR-adjacent,
    Phase 9a) is property-/entity-agnostic — more room/rate combinations
    are just more array entries in the *same* batched call, not an
    architectural change.

**−** A hotel tenant (multiple room types, breakfast/refundable rate
variants) cannot be onboarded as-is.

**−** The 1:1:1 assumption is spread across several layers, so generalising
touches schema + resolver + onboarding + UI (see migration path below).

## Migration path (if a hotel tenant becomes real)

Additive, **not** a rewrite. Estimated ~3–5 days because the flusher,
rate-limiter, batching and transport stay unchanged:

1. Promote the three id columns on `channex_properties` into proper
   `room_types` and `rate_plans` tables (property 1—N room_types 1—N
   rate_plans).
2. Extend `rate_overrides` with a `rate_plan_id` dimension
   (key → `(rate_plan_id, date)`); availability stays per room type.
3. Make `resolveRateValues` / `resolveAvailabilityValues` iterate over a
   property's room types / rate plans instead of the single id.
4. Extend `properties.onboardToChannex` to create the room-type/rate-plan
   structure, and the calendar UI to pick the room-type/rate-plan a price
   edit applies to.

## Revisit if

- We onboard a tenant with true hotel inventory (multiple room types, or
  rate-plan variants like breakfast / refundable).
- A vacation-rental tenant needs rate-plan variants (e.g. a
  non-refundable discount rate) on the same unit.
- Channex certification scope is renegotiated to require multi-room/rate.

## References

- [Channex ARI / rate plans](https://docs.channex.io/api-v.1-documentation/ari)
- [Channex PMS certification — Test 14 (disclose unsupported features)](https://docs.channex.io/api-v.1-documentation/pms-certification-tests)
- `packages/db/src/schema.ts` — `channex_properties`, `rate_overrides`
- `apps/worker/src/inngest/functions/ari-resolve.ts` — resolvers
