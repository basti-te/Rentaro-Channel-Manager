import { z } from 'zod';
import { ISODate } from './common';

/**
 * One rate/restriction update entry. POST /restrictions accepts an array of
 * these under `values`. Each entry can carry any subset of: rate, min_stay
 * variants, max_stay, closed flags, stop_sell.
 *
 * Rate is in cents (3000000 = 30,000.00 in the property's currency — for
 * EUR that's 30k EUR. Most listings use values like 8000 = 80 EUR.)
 *
 * https://docs.channex.io/api-v.1-documentation/ari
 */
export const RestrictionUpdate = z.object({
  property_id: z.string().uuid(),
  rate_plan_id: z.string().uuid(),
  date_from: ISODate,
  date_to: ISODate.optional(),

  /** Nightly rate in minor currency units (cents for EUR/USD). */
  rate: z.number().int().nonnegative().optional(),

  min_stay: z.number().int().min(1).optional(),
  min_stay_arrival: z.number().int().min(1).optional(),
  min_stay_through: z.number().int().min(1).optional(),
  max_stay: z.number().int().min(1).optional(),

  closed_to_arrival: z.boolean().optional(),
  closed_to_departure: z.boolean().optional(),
  stop_sell: z.boolean().optional(),
});
export type RestrictionUpdate = z.infer<typeof RestrictionUpdate>;
