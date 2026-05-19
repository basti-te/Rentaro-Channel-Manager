import { Hono } from 'hono';
import { createDb, messages, cleaningMessages } from '@cm/db';
import { eq } from 'drizzle-orm';
import { env } from '../env';

/** Constant-time string compare (secret travels in the URL path). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Twilio delivery-status callback.
 *
 *   POST /api/webhooks/twilio/<TWILIO_STATUS_SECRET>
 *   form: MessageSid, MessageStatus (queued|sending|sent|delivered|
 *         undelivered|failed), ErrorCode?
 *
 * Maps the Twilio status onto our `messages` (guest) and `cleaning_messages`
 * (teammate) rows by external_id. Only ever advances status; never
 * resurrects a delivered/failed row.
 *
 * Note: needs a public URL — in local dev Twilio can't reach localhost, so
 * this endpoint simply never fires and rows stay at "sent".
 */
export const twilioWebhook = new Hono();

twilioWebhook.post('/:secret', async (c) => {
  const secret = c.req.param('secret');
  if (!env.TWILIO_STATUS_SECRET || !safeEqual(secret, env.TWILIO_STATUS_SECRET)) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const form = await c.req.parseBody();
  const sid = typeof form.MessageSid === 'string' ? form.MessageSid : null;
  const twStatus =
    typeof form.MessageStatus === 'string' ? form.MessageStatus : null;
  const errorCode =
    typeof form.ErrorCode === 'string' ? form.ErrorCode : null;
  if (!sid || !twStatus) return c.json({ received: true });

  let next: 'delivered' | 'failed' | null = null;
  if (twStatus === 'delivered') next = 'delivered';
  else if (twStatus === 'undelivered' || twStatus === 'failed') next = 'failed';
  if (!next) return c.json({ received: true }); // queued/sending/sent → ignore

  const db = createDb(env.DATABASE_URL);
  const patch =
    next === 'delivered'
      ? { status: 'delivered' as const, deliveredAt: new Date() }
      : {
          status: 'failed' as const,
          error: `twilio_${twStatus}${errorCode ? `:${errorCode}` : ''}`,
        };
  // The SID belongs to exactly one of the two tables; the other no-ops.
  await db.update(messages).set(patch).where(eq(messages.externalId, sid));
  await db
    .update(cleaningMessages)
    .set(patch)
    .where(eq(cleaningMessages.externalId, sid));

  return c.json({ received: true });
});
