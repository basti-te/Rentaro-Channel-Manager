# ADR 0008 — Per-tenant SMS sender, account-wide env as fallback

**Status:** Accepted
**Date:** 2026-05-19

## Context

Outbound SMS uses an alphanumeric Twilio sender id (the `From` value the
guest sees, e.g. `Information` or `LeopardsGmb`). Germany allows
alphanumeric sender ids without registration.

This is a multi-tenant PMS: every tenant (vacation-rental operator) should
message guests under **their own brand**, not a single shared name. A
single account-wide `TWILIO_FROM` env value works for one operator but is
wrong for SaaS — guests of tenant B would see tenant A's (or a generic)
sender.

Twilio supports setting the sender per message ("dynamic alphanumeric
sender"), so the transport already allows this; only our data model and
resolution needed to catch up. Our `sendSms(config, …)` already takes
`from` as a parameter, so this is additive, not a refactor.

## Decision

Store an optional **`tenants.sms_sender_id`** per tenant. At send time the
effective sender is resolved as:

```
tenant.sms_sender_id  ??  env.TWILIO_FROM   (account-wide default)
```

- Tenants set/clear their sender via `settings.setSmsSenderId`
  (admin-only). Validation enforces Twilio's rule: ≤11 chars, ≥1 letter,
  only `A–Z a–z 0–9` and spaces. Empty clears it → fall back to the env
  default.
- `TWILIO_FROM` stays as the account-wide fallback for tenants that
  haven't configured one (and for local/dev).
- Surfaced in the UI on Messages → Vorlagen ("SMS-Absender" card) until a
  dedicated Settings page exists.

## Consequences

**+** Correct multi-tenant behaviour: each operator messages under their
own brand; new tenants work out of the box via the fallback.

**+** No transport/architecture change — sender is already a per-call
parameter; M3's automated sender will resolve it the same way.

**+** Validation centralised in the API, not trusted from env only
(env was implicitly trusted; user-entered values are now checked).

**−** No per-property sender (only per-tenant). A tenant with multiple
distinct brands across properties can't differentiate. Deferred until a
real need appears (would extend resolution to property-level override).

**−** Alphanumeric senders are one-way: guests can't reply, so no
SMS-reply STOP/opt-out. Accepted for operational messages (check-in/out
info) per the product owner; revisit if marketing-style messaging is
added or if a country requires reply-based opt-out.

**−** Deliverability of a given sender id can vary by route/carrier;
that's a Twilio/operations concern, not a code issue.

## Revisit if

- A tenant needs different senders per property/brand.
- We add guest-replyable SMS (needs a real number, not alphanumeric).
- A target country requires sender-id registration or reply-based opt-out.

## References

- [Twilio — personalize SMS alphanumeric sender id](https://www.twilio.com/en-us/blog/personalize-sms-alphanumeric-sender-id)
- `packages/db/src/schema.ts` — `tenants.sms_sender_id`
- `packages/api/src/routers/settings.ts` — `setSmsSenderId`
- `packages/api/src/routers/message-templates.ts` — sender resolution
