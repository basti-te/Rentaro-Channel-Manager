# ADR 0011 — Min-stay enforcement gap (Channex → Booking.com)

**Status:** Accepted (2026-05) — resolved operationally; no auto-monitoring yet
**Context:** Single-tenant live (CITY APARTMENTS ESSEN), `rateSource = 'pricelabs'`.

## Symptom

A 2-night November booking came through Booking.com despite a 5-night min-stay.
The Booking.com extranet rate showed *"Keine Mindestaufenthaltsdauer"*, while the
**price** on the same rate read *"Gezogen aus Channex.io"*.

## What the data showed

- Channex `GET /restrictions` returned the **correct** `min_stay_arrival` /
  `min_stay_through` (5–7) on **all three** rate plans for Whg 18 — including the
  `Standard - BookingCom` plan (`36254820`) — for the affected November dates.
- So the value was present in Channex; the gap was purely **Channex → Booking.com**
  (price propagated from the rate plan, the LOS restriction did not).

## Root cause (most likely)

A **duplicate Booking.com rate category** in the extranet (a "weekly" + a "daily"
rate). The restriction effectively applied to one, but guests could book the
other, which carried no min-stay. Per ADR 0007 the Channex children inherit
restrictions from the primary, so the Channex side looked correct throughout —
the break was on the Booking.com side.

## Resolution

Operator (a) deleted the second Booking.com rate category, reducing to one
bookable rate, and (b) triggered a **fresh PriceLabs sync**, which wrote the
restrictions onto the now-unambiguous single rate. Min-stay then enforced.

Note: a **Rentaro Full Sync does NOT** affect this — in `pricelabs` mode the ARI
flusher suppresses stay restrictions (ADR 0006); min-stay reaches Channex only
via PriceLabs.

## Decision

We do **not** build automated min-stay monitoring yet (operator's call,
2026-05). OTA-side restriction enforcement stays operator-verified for now.

## Future guardrail (when needed)

The only automatic way to catch this class of failure is an **empirical
booking-time check**, because a Channex self-check always looks correct (as it
did here). On booking-feed ingestion: compute `nights = checkout − checkin` and
compare against the `min_stay_arrival` Channex reports for the **arrival date**;
if `nights < min_stay_arrival`, notify the operator (reuse the Resend pipeline).
A daily Channex self-consistency report would **not** have caught this.

## See also

- ADR 0006 (PriceLabs direct), ADR 0007 (one primary rate-plan, children inherit)
- `apps/worker/src/inngest/functions/ari-resolve.ts` (`resolveRateValues`)
- `packages/api/src/routers/rates.ts` (`channexEffectiveRates`), `packages/channex/src/resources/restrictions.ts` (`readRates`)
