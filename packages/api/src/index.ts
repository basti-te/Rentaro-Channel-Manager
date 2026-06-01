import { router } from './trpc';
import { meRouter } from './routers/me';
import { propertyGroupsRouter } from './routers/property-groups';
import { propertiesRouter } from './routers/properties';
import { bookingsRouter } from './routers/bookings';
import { syncRouter } from './routers/sync';
import { ratesRouter } from './routers/rates';
import { settingsRouter } from './routers/settings';
import { messagesRouter } from './routers/messages';
import { messageTemplatesRouter } from './routers/message-templates';
import { messageVariablesRouter } from './routers/message-variables';
import { teammatesRouter } from './routers/teammates';
import { cleaningChecklistsRouter } from './routers/cleaning-checklists';
import { cleaningRulesRouter } from './routers/cleaning-rules';
import { cleaningCalendarsRouter } from './routers/cleaning-calendars';
import { reviewTemplatesRouter } from './routers/review-templates';
import { outboundReviewsRouter } from './routers/outbound-reviews';
import { billingRouter } from './routers/billing';
import { channelsRouter } from './routers/channels';

export const appRouter = router({
  me: meRouter,
  propertyGroups: propertyGroupsRouter,
  properties: propertiesRouter,
  bookings: bookingsRouter,
  sync: syncRouter,
  rates: ratesRouter,
  settings: settingsRouter,
  messages: messagesRouter,
  messageTemplates: messageTemplatesRouter,
  messageVariables: messageVariablesRouter,
  teammates: teammatesRouter,
  cleaningChecklists: cleaningChecklistsRouter,
  cleaningRules: cleaningRulesRouter,
  cleaningCalendars: cleaningCalendarsRouter,
  reviewTemplates: reviewTemplatesRouter,
  outboundReviews: outboundReviewsRouter,
  billing: billingRouter,
  channels: channelsRouter,
});

export type AppRouter = typeof appRouter;

export * from './context';
export { createContext } from './context';

// Shared messaging helpers — reused by the worker's dispatch cron.
export {
  renderTemplate,
  buildBookingVars,
  TEMPLATE_VARS,
  SAMPLE_VARS,
  type TemplateVars,
  type BookingVarSource,
} from './services/templates';
export {
  computeDueAt,
  parseTrigger,
  dispatchDisposition,
  DISPATCH_GRACE_MS,
  type ParsedTrigger,
  type TriggerAnchor,
  type DispatchDisposition,
} from './services/triggers';
export { sendSms, isTwilioConfigured, type TwilioConfig } from './services/twilio';
export {
  sendEmail,
  isEmailConfigured,
  type EmailConfig,
  type EmailMessage,
  type EmailSendResult,
} from './services/email';
export {
  notifyBookingEvent,
  notifySyncError,
  type NotificationKind,
  type NotifyOutcome,
  type BookingNotificationContext,
} from './services/notifications';
export { isTemplateEnabledForBooking } from './services/scope';
export { resolveCustomVars, CUSTOM_VAR_KEY_RE } from './services/custom-vars';

// Shared cleaning helpers — reused by the worker's cleaning-dispatch cron.
export {
  CLEANING_VARS,
  CLEANING_SAMPLE_VARS,
  buildCleaningVars,
  findNextReservation,
  renderChecklist,
  type CleaningBookingSource,
  type NextReservation,
} from './services/cleaning';

// Shared Stripe helpers — reused by the worker's webhook + reconcile cron.
export {
  TRIAL_DAYS,
  getStripe,
  isStripeConfigured,
  verifyStripeWebhook,
  syncSubscriptionFromStripe,
  reconcileQuantity,
} from './services/stripe';
export { resolveAccess } from './services/plan-guard';

// ARI outbox enqueue — reused by the worker's booking-feed ingest so an
// inbound OTA booking/cancellation pushes availability to Channex immediately
// (same path the internal booking mutations use).
export { enqueueAri, type AriChange, type AriKind } from './services/ari';
