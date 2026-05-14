import { z } from 'zod';

export const RatePlan = z
  .object({
    id: z.string().uuid(),
    type: z.literal('rate_plan').optional(),
    // Channex returns null for unset fields; .nullish() accepts both null
    // and undefined.
    attributes: z
      .object({
        title: z.string().nullish(),
        property_id: z.string().uuid().nullish(),
        room_type_id: z.string().uuid().nullish(),
        currency: z.string().nullish(),
        sell_mode: z.enum(['per_room', 'per_person']).nullish(),
        rate_mode: z.enum(['manual', 'derived', 'auto', 'cascade']).nullish(),
        is_active: z.boolean().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

export type RatePlan = z.infer<typeof RatePlan>;

/**
 * Each rate plan needs ≥1 option defining the occupancy it sells for.
 * For per_room mode, a single option for the room's max occupancy is
 * enough — the rate applies regardless of actual guest count.
 */
export const RatePlanOption = z.object({
  occupancy: z.number().int().min(1),
  is_primary: z.boolean().default(true),
  /** Optional starter rate (currency major units, e.g. "80.00"). Subsequent
   *  updates flow via POST /restrictions. */
  rate: z.union([z.string(), z.number()]).optional(),
});

export const RatePlanCreate = z.object({
  property_id: z.string().uuid(),
  room_type_id: z.string().uuid(),
  title: z.string().min(1),
  currency: z.string().length(3).default('EUR'),
  sell_mode: z.enum(['per_room', 'per_person']).default('per_room'),
  rate_mode: z.enum(['manual', 'derived', 'auto', 'cascade']).default('manual'),
  options: z.array(RatePlanOption).min(1).default([{ occupancy: 2, is_primary: true }]),
});
export type RatePlanCreate = z.input<typeof RatePlanCreate>;
