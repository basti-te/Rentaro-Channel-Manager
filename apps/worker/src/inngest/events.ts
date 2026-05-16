/**
 * Strongly-typed event map for our Inngest client. Both worker (creates
 * functions) and API (sends events) share these types.
 *
 * Add events here in `name → { data }` shape. Use `domain/action.verb`.
 */

/**
 * `type` (not `interface`) so the shape satisfies Inngest's
 * `Record<string, EventPayload>` constraint.
 */
export type Events = {
  /**
   * An ARI-relevant change happened (booking/block/rate/min-stay) and a
   * dirty-range row was written to `ari_pending`. This event only *triggers*
   * the global flusher — it carries no authoritative data; the flusher reads
   * the outbox table for the full picture.
   *
   * The flusher (functions/ari-flush.ts) is debounced (collapse bursts) and
   * throttled (hard cap on calls/min) so that 1 or 1000 properties changing
   * at once still results in ONE batched /availability + ONE /restrictions
   * call, respecting Channex's 20 ARI/min limit.
   */
  'ari/changed': {
    data: {
      /** Telemetry only — e.g. "booking.created", "rate.updated". */
      reason?: string;
    };
  };

  /**
   * Pull unacknowledged booking revisions from Channex and persist them.
   * Fired by the Channex global webhook endpoint on booking_new /
   * booking_modification / booking_cancellation events.
   *
   * The job ignores the webhook payload (Channex docs: payloads may arrive
   * out of order) and walks the Booking Revisions Feed instead — that's
   * the authoritative, at-least-once source.
   *
   * Idempotent: bookings.channex_booking_id is UNIQUE, so duplicate
   * deliveries upsert harmlessly.
   */
  'channex/booking.ingest': {
    data: {
      /** Where the trigger came from, for telemetry. */
      reason: string;
      /** Optional hint — the booking_id from the webhook, helps grep logs. */
      hintBookingId?: string;
    };
  };
};
