# ADR 0012 — AI guest-reply assistant

**Status:** Accepted — built 2026-06, live behind a per-tenant opt-in
**Context:** Single-tenant live (CITY APARTMENTS ESSEN). Guests message via the
OTA inbox (Airbnb / Booking.com), surfaced through the Channex messaging iframe.
The operator wanted the routine questions ("Wo parke ich?", "Wie ist der
WLAN-Code?", "Es fehlen Handtücher") answered automatically, and a way for the
assistant to quietly pull in a teammate (cleaner / handyman) when a request needs
human hands.

## Decision

Build an AI assistant that drafts replies to inbound OTA guest messages and can
dispatch a teammate in the background. Four choices fix its shape:

1. **Human-in-the-loop by default.** Inbound message → AI **draft** (status
   `draft`); the operator approves/edits/dismisses it in the booking sheet. An
   **Auto-Send** switch (`tenants.ai_auto_send`) lets a tenant opt into sending
   without review once they trust it. Both gates are per-tenant and off by
   default; the master switch is `tenants.ai_replies_enabled`.

2. **Ingest threads in parallel to the Channex iframe — don't replace it.** The
   iframe stays the operator's read surface. We additionally pull each thread via
   `GET /bookings/{id}/messages` into `guest_messages` (dedup by
   `channex_message_id`) so the model has grounded conversation history and we own
   the data for drafting, dispatch, and billing. Reads only; outbound still goes
   through `bookings.sendMessage`.

3. **Grounded, model-agnostic generation.** The system prompt grounds the model
   in **per-apartment facts only** (`properties.ai_knowledge`, edited in the
   Apartments dialog) — no invented details. The Anthropic call passes no
   tuning params (no temperature/effort/thinking), so the model is swappable via
   `ANTHROPIC_MODEL` (default `claude-opus-4-8`). A `notify_teammate` tool lets
   the model dispatch a cleaner/handyman; dispatches are recorded in
   `teammate_dispatches` and delivered as SMS (reusing the SMS pipeline).

4. **Paid add-on, metered per reply.** Like SMS, the assistant is opt-in and
   billed via a Stripe **Billing Meter** — but the meter value is the **count of
   replies sent** (not cents), so the operator sets a per-reply Price. A reply is
   billable once it is actually sent: `guest_messages.ai_generated = true AND
   status = 'sent'`. Unapproved/dismissed drafts are never billed.

## Why webhooks are triggers, not sources

Per the project rule, the Channex `message` webhook only **triggers**
`guest-messages/sync`, which re-fetches the full thread via the API. Webhooks can
arrive out of order; the re-fetch is the source of truth. New inbound rows emit
`guest-messages/incoming`, which the drafting function consumes.

## Billing mechanics (mirror of SMS metering)

`ai-usage-reconcile` runs daily (03:45) — or on demand via
`ai-usage/reconcile.now`. For each AI-on, non-exempt tenant with an active
subscription it counts AI replies that became `sent` (windowed on `updated_at`)
since `tenants.ai_usage_reported_through`, reports that count as one meter event
(identifier keyed by the window start → retries dedup, never double-bill),
attaches the metered Price to the subscription (idempotent), then advances the
watermark. **First run baselines** the watermark to "now" without billing
history. No-op until `STRIPE_AI_METER_EVENT_NAME` + `STRIPE_PRICE_AI_METERED` are
set — see `docs/stripe-setup.md`.

## Consequences

- The feature degrades safely: no `ANTHROPIC_API_KEY` → no drafts; no Stripe
  meter → replies still send, just unbilled; auto-send off → nothing leaves
  without a human.
- Reply quality is bounded by `properties.ai_knowledge`. Thin knowledge → thin
  answers; this is the operator's lever, surfaced in the Apartments UI.
- We now persist guest-message content (`guest_messages`). Backend-only table,
  RLS default-deny, tenant-scoped.

## See also

- ADR 0008 (per-tenant SMS sender — dispatch delivery), ADR 0010 (Stripe billing)
- `apps/worker/src/inngest/functions/guest-messages-sync.ts` (ingest),
  `guest-message-ai-draft.ts` (draft + dispatch), `ai-usage-reconcile.ts` (metering)
- `packages/api/src/routers/guest-messages.ts` (thread / approve / dismiss),
  `packages/channex/src/resources/bookings.ts` (`listMessages`)
