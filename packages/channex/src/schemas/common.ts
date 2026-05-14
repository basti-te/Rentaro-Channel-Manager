import { z } from 'zod';

/**
 * Channex envelope. Every response is shaped as { data, meta?, error? }.
 * `data` is either an object (single) or an array (collection).
 */
export const ChannexErrorBody = z
  .object({
    code: z.string().optional(),
    title: z.string().optional(),
    message: z.string().optional(),
    details: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const PaginationMeta = z
  .object({
    page: z.number().int().optional(),
    limit: z.number().int().optional(),
    total: z.number().int().optional(),
    pages: z.number().int().optional(),
  })
  .passthrough();

/** Generic envelope generator — pass the data schema in. */
export function envelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    data: data.optional(),
    meta: PaginationMeta.optional(),
    errors: z.array(ChannexErrorBody).optional(),
    error: ChannexErrorBody.optional(),
  });
}

/** YYYY-MM-DD strings — Channex returns dates this way. */
export const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
