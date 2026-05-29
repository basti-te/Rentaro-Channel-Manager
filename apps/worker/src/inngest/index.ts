export { inngest } from './client';
export type { Events } from './events';

import { ariFlush, ariFlushCron } from './functions/ari-flush';
import { ingestBookings } from './functions/ingest-bookings';
import { messagesDispatch } from './functions/messages-dispatch';
import { cleaningDispatch } from './functions/cleaning-dispatch';
import { stripeEvent } from './functions/stripe-event';
import { billingReconcile } from './functions/billing-reconcile';
import { channexFullSync } from './functions/channex-full-sync';
import { outboundReviewsDispatch } from './functions/outbound-reviews-dispatch';

/**
 * All functions Inngest should serve. Add new ones here.
 *
 * Outbound ARI no longer fans out one function per property — every change
 * lands in the `ari_pending` outbox and the single global `ariFlush`
 * (debounced + throttled) batches it into ~2 Channex calls. `ariFlushCron`
 * is the 5-min safety drain.
 */
export const inngestFunctions = [
  ariFlush,
  ariFlushCron,
  ingestBookings,
  messagesDispatch,
  cleaningDispatch,
  stripeEvent,
  billingReconcile,
  channexFullSync,
  outboundReviewsDispatch,
];
