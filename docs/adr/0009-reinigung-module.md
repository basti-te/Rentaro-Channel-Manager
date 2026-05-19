# ADR 0009 — Reinigung (cleaning) as a parallel automation module

**Status:** Accepted
**Date:** 2026-05-19

## Context

Operators need cleaners notified about turnovers. The requirement (from
the product owner) is explicitly *automation*, not a task/assignment
board: a rule editor — like the message-template editor — that sends an
SMS to internal staff, triggered relative to reservation / check-in /
check-out, scoped per apartment, with cleaning-specific variables
(including the *next* reservation so the cleaner knows the deadline) and
an optional checklist.

The messaging automation (templates → trigger DSL → dispatch cron →
Twilio) already solves the hard parts. The open question was whether to
extend the messaging tables with a "recipient type" or build a parallel
module.

## Decision

Build a **parallel cleaning module** that reuses shared primitives rather
than overloading the guest-messaging domain:

- New tables: `teammates`, `cleaning_checklists` +
  `cleaning_checklist_items`, `cleaning_rules`, `cleaning_rule_listings`
  (apartment allow-list), `cleaning_rule_teammates` (fan-out),
  `cleaning_messages` (dispatch outbox).
- **Reused, not duplicated:** the trigger DSL + `computeDueAt`
  (`services/triggers.ts`), `renderTemplate`, the Twilio service, the
  explicit apartment-allow-list pattern, the dispatch-cron shape
  (atomic claim via a unique index + `ON CONFLICT DO NOTHING`), and the
  structured trigger builder (extracted to a shared
  `TriggerBuilder` component used by both editors).
- `cleaning_messages` reuses `message_status` (identical lifecycle) — no
  near-duplicate enum.
- Recipient is a **Teammate** (internal, name/phone), not the guest. A
  rule fans out to **N teammates** (junction table).
- Checklist is a **reusable library**; a rule attaches one, rendered into
  the body via `{{checklist}}` as a plain-text bullet list (SMS has no
  markup).
- Cleaning-specific vars include the **next reservation** for the same
  apartment (next check-in date/time, guest, count, notes), resolved by a
  forward lookup. Missing vars stay **literal** (`{{x}}`), consistent
  with custom-vars — surfaces missing data instead of silently blanking.
- Auto-SMS (not manual-only): rules dispatch on the same 10-min cron
  cadence as messaging.

Teammates are managed in Settings; rules + checklists on `/cleaning`.

## Consequences

**+** Clean domain separation: guest messaging and cleaner reminders
evolve independently; no `recipient_type` branching polluting the
messaging UI/queries.

**+** Proven mechanics inherited wholesale (DST-correct triggers,
idempotent dedupe, retry of stuck rows, Twilio status webhook — extended
to also advance `cleaning_messages`).

**+** Trigger builder is now a single shared component (messaging +
cleaning), removing the prior inline duplication.

**−** Some structural parallelism between the two dispatch crons. Accepted
over a forced abstraction — the recipient model (guest phone vs. N
teammates) and variable sets differ enough that a shared generic
dispatcher would be more complex than two focused ones.

**−** Auto-SMS to teammates costs money per trigger like guest SMS; the
budget-capped Twilio token and per-number consent caveat (status.md)
apply equally. Test-send is gated behind an explicit phone field.

**−** No per-booking override for cleaning rules yet (messaging has one).
Deferred until a real need appears; the resolution seam (apartment
allow-list) is the same, so it is additive later.

## Revisit if

- Cleaners need an app/portal or status-back (currently SMS-only,
  one-way).
- A rule needs per-booking on/off like message templates.
- A shared generic "automation" engine becomes worth the abstraction
  (e.g. a third recipient type appears).

## References

- `packages/db/src/schema.ts` — Reinigung tables
- `packages/api/src/services/cleaning.ts` — vars + next-reservation lookup
- `packages/api/src/routers/{teammates,cleaning-checklists,cleaning-rules}.ts`
- `apps/worker/src/inngest/functions/cleaning-dispatch.ts`
- `apps/web/src/components/TriggerBuilder.tsx` — shared builder
- ADR 0008 — per-tenant SMS sender (sender resolution reused)
