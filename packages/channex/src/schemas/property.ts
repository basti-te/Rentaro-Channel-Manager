import { z } from 'zod';

/**
 * Channex Property — the top-level entity. For vacation rentals typically
 * one property per apartment; for hotels one property per hotel.
 *
 * Only the fields we use are explicitly validated; everything else passes
 * through via `passthrough()` so Channex API changes don't break us.
 */
export const Property = z
  .object({
    id: z.string().uuid(),
    type: z.literal('property').optional(),
    attributes: z
      .object({
        title: z.string().optional(),
        currency: z.string().length(3).optional(),
        timezone: z.string().optional(),
        property_type: z.string().optional(),
        country: z.string().optional(),
        city: z.string().optional(),
        zip_code: z.string().optional(),
        address: z.string().optional(),
        latitude: z.union([z.string(), z.number()]).optional(),
        longitude: z.union([z.string(), z.number()]).optional(),
        is_active: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type Property = z.infer<typeof Property>;

/** Payload accepted by POST /properties (subset we care about). */
export const PropertyCreate = z.object({
  title: z.string().min(1),
  currency: z.string().length(3).default('EUR'),
  timezone: z.string().default('Europe/Berlin'),
  property_type: z.string().default('apartments'),
  country: z.string().length(2).optional(),
  city: z.string().optional(),
});
export type PropertyCreate = z.infer<typeof PropertyCreate>;
