import { Hono } from 'hono';
import { createDb, webhookDeliveries, channexProperties } from '@cm/db';
import { eq } from 'drizzle-orm';
import { env } from '../env';
import { inngest } from '../inngest/client';

/**
 * Constant-time compare for short strings — keeps timing attacks at bay
 * even though the secret travels in the URL path.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const BOOKING_EVENTS = new Set([
  'booking',
  'booking_new',
  'booking_modification',
  'booking_cancellation',
  'non_acked_booking',
]);

/**
 * Mountable Hono sub-app for Channex inbound webhooks.
 *
 * Channex sends:
 *   POST /api/webhooks/channex/<CHANNEX_WEBHOOK_SECRET>
 *   body: { event, property_id, user_id, timestamp, payload? }
 *
 * We:
 *   1. Verify the secret with a constant-time comparison.
 *   2. Persist the delivery into webhook_deliveries (audit + later replay).
 *   3. Emit an Inngest event so the worker pulls from the Booking
 *      Revisions Feed (the doc-recommended pattern — never trust the
 *      webhook payload, always re-fetch).
 *   4. Return 200 within ~100 ms so Channex doesn't retry.
 */
export const channexWebhook = new Hono();

channexWebhook.post('/:secret', async (c) => {
  const secret = c.req.param('secret');
  if (!safeEqual(secret, env.CHANNEX_WEBHOOK_SECRET)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  // Channex spec: body can be empty for non-`send_data` webhooks
  let body: Record<string, unknown> | null = null;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  const event = typeof body?.event === 'string' ? body.event : 'unknown';
  const channexPropertyId =
    typeof body?.property_id === 'string' ? body.property_id : null;
  const payload =
    body && typeof body.payload === 'object' && body.payload !== null
      ? body.payload
      : null;

  // ── 1. Persist the delivery ─────────────────────────────────────────
  const db = createDb(env.DATABASE_URL);
  let tenantId: string | null = null;
  if (channexPropertyId) {
    const rows = await db
      .select({ tenantId: channexProperties.tenantId })
      .from(channexProperties)
      .where(eq(channexProperties.channexPropertyId, channexPropertyId))
      .limit(1);
    tenantId = rows[0]?.tenantId ?? null;
  }

  await db.insert(webhookDeliveries).values({
    source: 'channex',
    event,
    tenantId,
    payload: body ?? {},
    // external_id intentionally null — Channex doesn't include a delivery id,
    // and the UNIQUE index allows multiple nulls. Idempotency for the actual
    // booking happens on UPSERT via channex_booking_id.
  });

  // ── 2. Trigger ingestion if this is a booking event ────────────────
  if (BOOKING_EVENTS.has(event)) {
    const hintBookingId =
      payload && typeof (payload as Record<string, unknown>).booking_id === 'string'
        ? ((payload as Record<string, unknown>).booking_id as string)
        : undefined;

    await inngest.send({
      name: 'channex/booking.ingest',
      data: { reason: `webhook:${event}`, hintBookingId },
    });
  }

  // ── 3. Sync the OTA message thread on a message event ──────────────
  if (event === 'message') {
    const hint =
      payload && typeof (payload as Record<string, unknown>).booking_id === 'string'
        ? ((payload as Record<string, unknown>).booking_id as string)
        : undefined;
    await inngest.send({
      name: 'guest-messages/sync',
      data: { channexBookingId: hint, reason: 'webhook:message' },
    });
  }

  return c.json({ received: true });
});
