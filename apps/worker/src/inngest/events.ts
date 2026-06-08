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

  /**
   * Run the automated message dispatch immediately, in addition to its
   * 10-minute cron. Useful for ops ("send due messages now") and testing.
   */
  'messages/dispatch.now': {
    data: {
      reason?: string;
    };
  };

  /**
   * Run the automated cleaning-reminder dispatch immediately, in addition
   * to its 10-minute cron. Useful for ops and testing.
   */
  'cleaning/dispatch.now': {
    data: {
      reason?: string;
    };
  };

  /**
   * A Stripe webhook arrived. Carries only the event id; the handler
   * re-fetches via `stripe.events.retrieve` for tamper-resistance.
   */
  'stripe/event': {
    data: {
      eventId: string;
      /** Telemetry only — handler refetches by id either way. */
      type?: string;
    };
  };

  /**
   * Run the daily billing reconcile immediately (defensive sync of
   * per-property quantity to Stripe), in addition to its 03:15 cron.
   */
  'billing/reconcile.now': {
    data: {
      reason?: string;
    };
  };

  /**
   * Run the daily SMS-usage reconcile immediately (sum sent SMS segments per
   * tenant and report to the Stripe Billing Meter), in addition to its cron.
   */
  'sms-usage/reconcile.now': {
    data: {
      reason?: string;
    };
  };

  /**
   * Sync a booking's OTA message thread (or the active-window bookings) from
   * Channex into guest_messages. Fired by the Channex `message` webhook (with a
   * booking hint) and by a cron safety net. Re-fetches the thread — webhooks are
   * triggers, not the source of truth.
   */
  'guest-messages/sync': {
    data: {
      channexBookingId?: string;
      reason?: string;
    };
  };

  /**
   * A new inbound guest message was ingested. Phase 3 (AI assistant) hooks here
   * to draft a reply.
   */
  'guest-messages/incoming': {
    data: {
      guestMessageId: string;
      bookingId: string;
      tenantId: string;
    };
  };

  /**
   * Full Sync — push 500 days of availability + rates/restrictions for one
   * property in 2 Channex calls. One event per property; the handler is
   * throttled so a "sync all" (many events) paces itself under the rate
   * limit. Used for go-live, recovery, and PMS certification.
   */
  'channex/full-sync': {
    data: {
      propertyId: string;
      /** Window length in days. Default 500 (Channex certification spec). */
      days?: number;
      reason?: string;
    };
  };

  /**
   * Submit due host→guest reviews (Airbnb-only) to Channex — Phase B.
   * Deliberately event-triggered only (no cron yet): the send path can't run
   * until the "Messages & Reviews" app is installed per property and a real
   * Airbnb review exchange has been validated. Add a cron trigger after that.
   */
  'reviews/send.now': {
    data: {
      reason?: string;
    };
  };

  /**
   * A brand-new tenant just registered (first login → first tenant created).
   * The worker emails the platform owner (OWNER_NOTIFICATION_EMAIL). Emitted
   * by the API's `me.bootstrap` mutation ONLY when a tenant was actually
   * created (not on idempotent re-calls).
   */
  'tenant/registered': {
    data: {
      tenantId: string;
      tenantName: string;
      userEmail: string;
    };
  };
};
