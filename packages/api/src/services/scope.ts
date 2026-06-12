/**
 * Whether a template should fire for a specific booking.
 *
 * Resolution (per ADR-style decision "Beides"):
 *   1. a per-booking override wins        (force on / force off)
 *   2. otherwise the apartment scope      (booking.property in the
 *      template's explicit listing allow-list)
 *
 * No listings + no override → off (explicit-list model: a template is
 * inactive until apartments are assigned).
 */
export function isTemplateEnabledForBooking(opts: {
  propertyId: string;
  /** propertyIds the template is scoped to (its listing allow-list). */
  scopedPropertyIds: Set<string>;
  /** Per-booking override.enabled, or undefined when none exists. */
  override?: boolean;
}): boolean {
  if (opts.override === true) return true;
  if (opts.override === false) return false;
  return opts.scopedPropertyIds.has(opts.propertyId);
}

/**
 * Whether a template's channel can be delivered to a booking from a given OTA
 * source.
 *
 * OTA-channel templates (`airbnb` / `booking_com`) are posted into the
 * booking's OTA chat via Channex `sendMessage(bookingId, …)`, which routes
 * purely by booking — it takes no channel argument. So an OTA template must
 * only target bookings that actually came from that OTA; otherwise a single
 * booking receives EVERY OTA template (both the airbnb and the booking_com
 * one) in its one real chat — i.e. the guest sees each automated message
 * duplicated. (This was the Booking.com check-in/-out double-send.)
 *
 * SMS / email are medium-based (phone / address), not OTA-bound, so they apply
 * to bookings from any source.
 */
export function isChannelApplicableToSource(
  channel: 'sms' | 'airbnb' | 'booking_com' | 'email',
  source: string,
): boolean {
  if (channel === 'airbnb' || channel === 'booking_com') return source === channel;
  return true;
}
