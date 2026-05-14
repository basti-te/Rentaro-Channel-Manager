import { z } from 'zod';

export const RoomType = z
  .object({
    id: z.string().uuid(),
    type: z.literal('room_type').optional(),
    attributes: z
      .object({
        title: z.string().optional(),
        property_id: z.string().uuid().optional(),
        count_of_rooms: z.number().int().optional(),
        occ_adults: z.number().int().optional(),
        occ_children: z.number().int().optional(),
        occ_infants: z.number().int().optional(),
        is_active: z.boolean().optional(),
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
export type RoomTypeCreate = z.infer<typeof RoomTypeCreate>;
