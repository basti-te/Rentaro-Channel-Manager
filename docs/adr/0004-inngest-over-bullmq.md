# ADR 0004 — Inngest over BullMQ

**Status:** Accepted
**Date:** 2026-05-14

## Decision

Use Inngest for the job queue, scheduled jobs, and webhook fan-out.

## Reasons

- **No Redis to operate.** BullMQ requires Redis. Inngest is a managed
  service; we send events, it runs functions.
- **Step functions with durability.** Inngest's `step.run`, `step.sleep`,
  `step.waitForEvent` survive function restarts. Critical for our scheduled
  guest messaging (sleep until T-1d before checkin).
- **Retries with backoff baked in.** We don't have to re-implement.
- **Cron triggers are first-class.** "Every 5 minutes pull all bookings" is
  a one-liner.
- **Free tier covers our MVP.** 50k runs/month free.

## Trade-offs

**−** Vendor dependency. Mitigated by Inngest's open-source dev server (we
develop offline) and a clean abstraction layer: our code emits events; the
Inngest binding is one file.

**−** Less control over execution environment. At extreme scale (10k+
jobs/min sustained), BullMQ on dedicated workers might be cheaper.

## Migration path if we outgrow Inngest

Inngest functions are plain async functions wrapped by a registration. To
migrate to BullMQ:
1. Replace `inngest.createFunction()` with `new Queue.process()`.
2. Replace `inngest.send()` with `queue.add()`.
3. Steps map to BullMQ child jobs.

The business logic doesn't change.
