/**
 * Stripe event handler. Triggered by the webhook receiver
 * (apps/worker/src/webhooks/stripe.ts).
 *
 * For safety we re-fetch the event from Stripe by id rather than trusting
 * the payload stored in webhook_deliveries — protects against tampering /
 * partial-replays / out-of-order deliveries.
 *
 * Subscription lifecycle events all funnel through `syncSubscriptionFromStripe`
 * which is idempotent (keyed on `stripeSubscriptionId`).
 */
import { eq } from 'drizzle-orm';
import {
  createDb,
  webhookDeliveries,
} from '@cm/db';
import { getStripe, syncSubscriptionFromStripe } from '@cm/api';
import type Stripe from 'stripe';
import { env } from '../../env';
import { inngest } from '../client';

async function handle(eventId: string): Promise<{ type: string; handled: boolean }> {
  const stripe = getStripe(env);
  if (!stripe) throw new Error('stripe_not_configured');
  const db = createDb(env.DATABASE_URL);

  const event = await stripe.events.retrieve(eventId);

  const subscriptionIdFromEvent = (): string | null => {
    const obj = event.data.object as
      | (Stripe.Subscription & { object: 'subscription' })
      | (Stripe.Checkout.Session & { object: 'checkout.session' })
      | (Stripe.Invoice & { object: 'invoice' })
      | { object: string; subscription?: string | Stripe.Subscription };
    if (obj.object === 'subscription') return (obj as Stripe.Subscription).id;
    if ('subscription' in obj && obj.subscription) {
      return typeof obj.subscription === 'string' ? obj.subscription : obj.subscription.id;
    }
    return null;
  };

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.trial_will_end':
    case 'checkout.session.completed':
    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'invoice.payment_succeeded': {
      const subId = subscriptionIdFromEvent();
      if (subId) await syncSubscriptionFromStripe(stripe, db, subId);
      break;
    }
    default:
      // Other event types are ignored intentionally — we still ack so Stripe
      // doesn't retry them.
      break;
  }

  await db
    .update(webhookDeliveries)
    .set({ processedAt: new Date() })
    .where(eq(webhookDeliveries.externalId, event.id));

  return { type: event.type, handled: true };
}

export const stripeEvent = inngest.createFunction(
  { id: 'stripe-event', name: 'Process Stripe webhook event', retries: 3 },
  { event: 'stripe/event' },
  async ({ event, step, logger }) => {
    const { eventId } = event.data;
    const res = await step.run('handle', () => handle(eventId));
    logger.info(res, 'stripe event processed');
    return res;
  },
);
