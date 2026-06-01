# ADR 0011 — Min-stay enforcement gap (Channex → Booking.com)

**Status:** Accepted — root cause confirmed 2026-06-01; no auto-monitoring built
**Context:** Single-tenant live (CITY APARTMENTS ESSEN), `rateSource = 'pricelabs'`.

## Symptom

A 2-night November booking came through Booking.com despite a 5-night min-stay.
The Booking.com extranet rate showed *"Keine Mindestaufenthaltsdauer"*, while the
**price** on the same rate read *"Gezogen aus Channex.io"*.

## What the data showed

- Channex `GET /restrictions` returned the **correct** `min_stay_arrival` /
  `min_stay_through` (5–7) on **all three** rate plans for Whg 18 — including the
  `Standard - BookingCom` plan (`36254820`) — for the affected dates.
- So the value was present in Channex; the gap was purely **Channex → Booking.com**
  (price propagated, the LOS restriction did not reach the rate guests booked).

## Root cause (confirmed)

**Multiple rate categories on the Booking.com listing.** The min-stay effectively
attached to one rate, but guests could book another that carried none — so Channex's
per-date restriction never governed the rate actually sold.

Confirmed by the operator: *"Ich habe das Restriktionen-Problem lösen können, indem
ich einfach die anderen Rates gelöscht habe."* Reducing the listing to a **single**
Booking.com rate category resolved enforcement immediately.

Two steps the operator also tried were **not** the decisive lever:

- A **Rentaro Full Sync** does nothing here — in `pricelabs` mode the ARI flusher
  suppresses stay restrictions (ADR 0006); min-stay reaches Channex only via PriceLabs.
- A **manual default min-stay** on the Booking rate is a separate, static setting
  (rate-default vs. per-date calendar value). It is not the PriceLabs-driven value
  and would be wrong for peak (needs 5–7) and for low-season gap-fill.

## Operational rule (corollary to ADR 0007)

**One Booking.com rate category per listing.** ADR 0007 fixes one room-type + one
rate-plan per property on our side; the OTA-side corollary is that the Booking.com
listing must expose exactly **one** rate. Extra rate categories silently break
min-stay enforcement (restrictions land on one, guests book another). This is a
required **onboarding check** for every future tenant, not a one-off.

## Decision

We do **not** build automated min-stay monitoring yet (operator's call, 2026-06).
OTA-side restriction enforcement stays operator-verified for now.

## Future guardrail (when needed)

The only automatic way to catch this class of failure is an **empirical
booking-time check**, because a Channex self-check always looks correct (as it did
here). On booking-feed ingestion: compute `nights = checkout − checkin` and compare
against the `min_stay_arrival` Channex reports for the **arrival date**; if
`nights < min_stay_arrival`, notify the operator (reuse the Resend pipeline). A
daily Channex self-consistency report would **not** have caught this.

## See also

- ADR 0006 (PriceLabs direct), ADR 0007 (one primary rate-plan, children inherit)
- `apps/worker/src/inngest/functions/ari-resolve.ts` (`resolveRateValues`)
- `packages/api/src/routers/rates.ts` (`channexEffectiveRates`), `packages/channex/src/resources/restrictions.ts` (`readRates`)
