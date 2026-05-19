/**
 * Stripe webhook receiver.
 *
 *   POST /api/webhooks/stripe
 *   header: stripe-signature
 *   body:   raw bytes (must NOT be parsed before verification)
 *
 * Stripe signs every payload (HMAC-SHA256 with STRIPE_WEBHOOK_SECRET), so
 * the signature header IS the auth — no URL-path secret needed. We treat
 * the webhook as a trigger only: persist the event to webhook_deliveries
 * (idempotent via UNIQUE(source, external_id)) and emit a `stripe/event`
 * Inngest event carrying the event id. The Inngest handler re-fetches via
 * `stripe.events.retrieve` (defence against payload tampering / partial
 * replays) and applies state to our DB.
 */
import { Hono } from 'hono';
import { createDb, webhookDeliveries } from '@cm/db';
import { verifyStripeWebhook } from '@cm/api';
import { env } from '../env';
import { inngest } from '../inngest/client';

export const stripeWebhook = new Hono();

stripeWebhook.post('/', async (c) => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: 'not_configured' }, 503);
  }
  const sig = c.req.header('stripe-signature');
  if (!sig) return c.json({ error: 'missing_signature' }, 400);

  const rawBody = await c.req.text();
  let event;
  try {
    event = verifyStripeWebhook(env, rawBody, sig);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'invalid_signature', message: msg }, 400);
  }

  const db = createDb(env.DATABASE_URL);
  try {
    await db.insert(webhookDeliveries).values({
      source: 'stripe',
      externalId: event.id,
      event: event.type,
      payload: event as unknown as Record<string, unknown>,
    });
  } catch {
    // UNIQUE(source, external_id) conflict — duplicate delivery, ack only.
    return c.json({ received: true, duplicate: true });
  }

  await inngest.send({
    name: 'stripe/event',
    data: { eventId: event.id, type: event.type },
  });

  return c.json({ received: true });
});
