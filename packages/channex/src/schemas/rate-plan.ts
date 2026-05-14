import { z } from 'zod';

export const RatePlan = z
  .object({
    id: z.string().uuid(),
    type: z.literal('rate_plan').optional(),
    attributes: z
      .object({
        title: z.string().optional(),
        property_id: z.string().uuid().optional(),
        room_type_id: z.string().uuid().optional(),
        currency: z.string().length(3).optional(),
        sell_mode: z.enum(['per_room', 'per_person']).optional(),
        rate_mode: z.enum(['manual', 'derived', 'auto', 'cascade']).optional(),
        is_active: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type RatePlan = z.infer<typeof RatePlan>;

export const RatePlanCreate = z.object({
  property_id: z.string().uuid(),
  room_type_id: z.string().uuid(),
  title: z.string().min(1),
  currency: z.string().length(3).default('EUR'),
  sell_mode: z.enum(['per_room', 'per_person']).default('per_room'),
  rate_mode: z.enum(['manual', 'derived', 'auto', 'cascade']).default('manual'),
});
export type RatePlanCreate = z.infer<typeof RatePlanCreate>;
