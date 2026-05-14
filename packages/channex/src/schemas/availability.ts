import { z } from 'zod';
import { ISODate } from './common';

/**
 * One availability update entry. POST /availability accepts an array of these
 * under `values`. A `date_from` without `date_to` updates a single date.
 *
 * https://docs.channex.io/api-v.1-documentation/ari
 */
export const AvailabilityUpdate = z.object({
  property_id: z.string().uuid(),
  room_type_id: z.string().uuid(),
  date_from: ISODate,
  /** When omitted, updates only `date_from`. Inclusive. */
  date_to: ISODate.optional(),
  /** Units available (0 = sold out / blocked). */
  availability: z.number().int().min(0),
});
export type AvailabilityUpdate = z.infer<typeof AvailabilityUpdate>;
