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
    // Channex returns null (not undefined) for empty fields, so every
    // optional field uses .nullish() (= optional + nullable) instead of
    // bare .optional().
    attributes: z
      .object({
        title: z.string().nullish(),
        currency: z.string().nullish(),
        timezone: z.string().nullish(),
        property_type: z.string().nullish(),
        country: z.string().nullish(),
        city: z.string().nullish(),
        zip_code: z.string().nullish(),
        address: z.string().nullish(),
        latitude: z.union([z.string(), z.number()]).nullish(),
        longitude: z.union([z.string(), z.number()]).nullish(),
        is_active: z.boolean().nullish(),
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
  /** Channex expects singular ("apartment"), not "apartments". Verified
   *  against the sandbox via GET /properties on an existing entity. */
  property_type: z.string().default('apartment'),
  /** ISO-3166-1 alpha-2. Channex requires this on create. */
  country: z.string().length(2).default('DE'),
  city: z.string().optional(),
  zip_code: z.string().optional(),
  address: z.string().optional(),
});
/** Input type — defaults are filled in at parse time, so the caller may omit them. */
export type PropertyCreate = z.input<typeof PropertyCreate>;
