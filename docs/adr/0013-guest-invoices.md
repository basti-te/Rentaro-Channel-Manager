# ADR 0013 — Guest self-service invoices

**Status:** Accepted — built 2026-06-12 (Phases 0–3), behind a per-tenant opt-in
**Context:** OTA bookings (Airbnb / Booking.com). Business-traveller guests
regularly need a proper accommodation invoice. The operator (Leopards GmbH /
CITY APARTMENTS ESSEN) issued these by hand; we automate them with a guest
self-service portal — and surface the **actually-paid** price, not the payout.

## The crux: gross vs. payout

`bookings.price_cents` is Channex `amount`, which means different things per OTA:
- **Booking.com / Expedia:** `amount` = the gross the guest pays; the host owes
  `ota_commission` on top → payout = amount − commission.
- **Airbnb:** `amount` = the **payout** (Airbnb deducted its fee; the guest
  service fee never reaches us). The real accommodation gross is the sum of the
  per-night prices (`rooms[].days`).

So a naïve invoice would print the payout — the operator's exact complaint. We
now persist `ota_commission_cents` (Phase 0) and resolve, per source, the
**gross accommodation price** (`services/booking-amounts.ts`). The booking
detail sheet shows Brutto / Provision / Auszahlung instead of one number.

## Decision

1. **Fully automatic, with a confidence gate.** No per-booking host review
   (operator's call). The amount is derived automatically; bookings whose
   lodging price can't be reconstructed (e.g. Airbnb payout-only, no per-night
   data) are **suppressed** rather than invoiced wrong. The portal tells those
   guests to contact the host.

2. **Tax model — replicated from the operator's real invoice (verified
   cent-for-cent).** Lodging + cleaning are GROSS incl. VAT (`vat_rate_bp`, 700 =
   7%). **City tax = 5% of the GROSS lodging only** (not cleaning), 0% VAT, as a
   separate line. `computeInvoiceBreakdown` reconstructs the sample exactly:
   lodging 606,62 + cleaning 39,98 + city tax 30,33 → net 634,62, VAT 42,31,
   gross 676,93. Per-tenant config (`tenant_invoice_settings`); Kleinunternehmer
   §19 supported.

3. **Guest identification = last name + both dates** (operator's choice),
   hardened: exact check-in AND check-out, last-name substring, optional OTA-code
   second factor (`lookup_require_code`), per-portal in-memory rate limit,
   generic errors (no enumeration), ambiguous matches rejected. The residual
   PII-exposure risk is the operator's accepted trade-off.

4. **One issued invoice per booking, with Storno.** Sequential `RE-<n>` numbers
   (transactional counter), a frozen amount + issuer snapshot (later config/price
   changes never alter an issued document), an opaque download token. A PARTIAL
   unique index (`booking_id WHERE status='issued'`) allows voiding + a corrected
   re-issue while keeping the voided record.

5. **Server-side PDF (pdfkit), rendered in the worker** from the frozen snapshot
   (deterministic), served at `GET /api/invoices/<token>.pdf`. Layout mirrors the
   operator's existing CITY APARTMENTS ESSEN invoice 1:1. No headless browser.

## Consequences

- Degrades safely: feature off until `tenant_invoice_settings.enabled`; portal
  unreachable without the slug; unresolvable amounts never produce a wrong
  invoice; voided invoices 404.
- We persist guest billing details (`guest_invoices`). Backend-only tables, RLS
  default-deny, tenant-scoped; the public lookup runs on the service-role
  connection through our API.
- **Not tax advice.** Each tenant configures its own VAT status. The legal issuer
  for OTA stays is the host (accommodation), not Airbnb (guest service fee).

## See also

- ADR 0010 (Stripe billing — the SaaS's own invoices, unrelated to guest invoices)
- `services/booking-amounts.ts` (gross/commission/payout), `services/invoices.ts`
  (tax decompose), `services/invoice-issue.ts` (numbering + snapshot),
  `routers/invoices.ts` (operator + public), `apps/worker/src/invoices/` (PDF +
  download route), `routes/invoices.tsx` (config), `routes/invoice-public.tsx`
  (portal)
