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
