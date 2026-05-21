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

/**
 * ARI write response. POST /availability and POST /restrictions return a
 * task envelope: { data: [{ id, type: 'task' }], meta: { message } }.
 * The `id` is the async-processing task id Channex generates — needed for
 * the PMS-certification "full sync" step.
 */
export const TaskResponse = z.object({
  data: z
    .array(z.object({ id: z.string(), type: z.string().optional() }))
    .optional(),
  meta: z.record(z.unknown()).optional(),
});

/** Extract the Channex task id(s) from an ARI write response (empty if none). */
export function parseTaskIds(response: unknown): string[] {
  const parsed = TaskResponse.safeParse(response);
  return parsed.success && parsed.data.data
    ? parsed.data.data.map((t) => t.id)
    : [];
}
