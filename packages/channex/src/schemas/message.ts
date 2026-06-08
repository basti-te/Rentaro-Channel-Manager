import { z } from 'zod';

/**
 * A message in a booking's OTA thread (Airbnb / Booking.com / Expedia) as
 * returned by GET /bookings/{id}/messages. Verified shape:
 *   { id, type, attributes: { message, sender, inserted_at, updated_at,
 *     attachments }, relationships }
 *
 * `sender` is "property" for host/outbound messages; any other value
 * (e.g. the guest/customer) means inbound. Lenient passthrough — attribute
 * names vary slightly by channel.
 */
export const ChannexMessage = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    attributes: z
      .object({
        message: z.string().nullable().optional(),
        sender: z.string().nullable().optional(),
        inserted_at: z.string().nullable().optional(),
        updated_at: z.string().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type ChannexMessage = z.infer<typeof ChannexMessage>;
