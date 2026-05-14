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
   * Push availability for one apartment over a date range to Channex.
   * Fired after a booking is created, edited, or cancelled.
   *
   * Worker:
   *   - reads bookings overlapping [from, to] for the property
   *   - computes which nights are occupied
   *   - bulk-pushes availability (0 or 1) per night via channex.availability.push()
   *   - writes the outcome to sync_jobs
   */
  'apartment/availability.sync': {
    data: {
      tenantId: string;
      /** Internal properties.id (NOT the Channex property uuid). */
      propertyId: string;
      /** Inclusive YYYY-MM-DD start of the range to recompute. */
      from: string;
      /** EXCLUSIVE YYYY-MM-DD end of the range. */
      to: string;
      /** Free-form reason for telemetry (e.g. "booking.created"). */
      reason?: string;
    };
  };

  /**
   * Push the apartment's nightly rate + min-stay to Channex over a date
   * range. Fired when properties.defaultRateCents or defaultMinStay changes,
   * and on manual sync.
   *
   * Per-day rate overrides (weekends, holidays) come in a future phase via a
   * dedicated `rate_overrides` table.
   */
  'apartment/rates.sync': {
    data: {
      tenantId: string;
      propertyId: string;
      from: string;
      to: string;
      reason?: string;
    };
  };
};
