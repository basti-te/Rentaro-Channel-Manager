import { z } from 'zod';

export const RoomType = z
  .object({
    id: z.string().uuid(),
    type: z.literal('room_type').optional(),
    // Channex returns null for unset fields; .nullish() accepts both null
    // and undefined.
    attributes: z
      .object({
        title: z.string().nullish(),
        property_id: z.string().uuid().nullish(),
        count_of_rooms: z.number().int().nullish(),
        occ_adults: z.number().int().nullish(),
        occ_children: z.number().int().nullish(),
        occ_infants: z.number().int().nullish(),
        is_active: z.boolean().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

export type RoomType = z.infer<typeof RoomType>;

export const RoomTypeCreate = z.object({
  property_id: z.string().uuid(),
  title: z.string().min(1),
  count_of_rooms: z.number().int().min(1).default(1),
  occ_adults: z.number().int().min(1).default(2),
  occ_children: z.number().int().min(0).default(0),
  occ_infants: z.number().int().min(0).default(0),
});
export type RoomTypeCreate = z.input<typeof RoomTypeCreate>;
