/**
 * Channex source identifiers — used to classify incoming bookings.
 * See: https://docs.channex.io/api-v.1-documentation/bookings-collection
 */
export const CHANNEX_OTA_NAMES = {
  AIRBNB: 'Airbnb',
  BOOKING_COM: 'BookingCom',
  EXPEDIA: 'A-Expedia',
} as const;

export const CHANNEX_UNIQUE_ID_PREFIX = {
  BOOKING_COM: 'BDC-',
  AIRBNB: 'ABB-',
  EXPEDIA: 'EXP-',
} as const;

/**
 * Plan limits — read by API middleware to gate features.
 * Stripe price IDs are filled in once products are created.
 */
export const PLAN_LIMITS = {
  free: { maxProperties: 3, messagingEnabled: false, reviewsEnabled: false },
  starter: { maxProperties: 10, messagingEnabled: true, reviewsEnabled: false },
  pro: { maxProperties: 50, messagingEnabled: true, reviewsEnabled: true },
  enterprise: { maxProperties: Infinity, messagingEnabled: true, reviewsEnabled: true },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;
