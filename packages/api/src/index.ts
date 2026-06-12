import { router } from './trpc';
import { meRouter } from './routers/me';
import { propertyGroupsRouter } from './routers/property-groups';
import { propertiesRouter } from './routers/properties';
import { bookingsRouter } from './routers/bookings';
import { syncRouter } from './routers/sync';
import { ratesRouter } from './routers/rates';
import { settingsRouter } from './routers/settings';
import { smsRouter } from './routers/sms';
import { analyticsRouter } from './routers/analytics';
import { guestMessagesRouter } from './routers/guest-messages';
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
import { invoicesRouter } from './routers/invoices';

export const appRouter = router({
  me: meRouter,
  propertyGroups: propertyGroupsRouter,
  properties: propertiesRouter,
  bookings: bookingsRouter,
  sync: syncRouter,
  rates: ratesRouter,
  settings: settingsRouter,
  sms: smsRouter,
  analytics: analyticsRouter,
  guestMessages: guestMessagesRouter,
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
  invoices: invoicesRouter,
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
export {
  sendSms,
  smsSegments,
  resolveSmsCountry,
  isTwilioConfigured,
  type TwilioConfig,
} from './services/twilio';
export {
  SMS_RATES,
  SMS_MARKUP,
  SMS_FX_USD_EUR,
  smsCustomerPriceMinor,
  type SmsRate,
} from './services/sms-rates';
export {
  loadAllowedSmsCountries,
  checkSmsCountry,
} from './services/sms-allowlist';
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
  notifyOwnerNewSignup,
  type NotificationKind,
  type NotifyOutcome,
  type BookingNotificationContext,
} from './services/notifications';
export { isTemplateEnabledForBooking, isChannelApplicableToSource } from './services/scope';
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
  ensureSmsMeteredItem,
  reportSmsMeterEvent,
  ensureAiMeteredItem,
  reportAiMeterEvent,
} from './services/stripe';
export { resolveAccess } from './services/plan-guard';

// Booking money resolution (gross vs. payout vs. OTA commission) — used by the
// booking detail sheet and the guest-invoice engine.
export {
  resolveBookingAmounts,
  daysSumCents,
  type ResolvedAmounts,
  type BookingAmountInput,
} from './services/booking-amounts';

// Guest-invoice money engine — tax decomposition + formatting.
export {
  computeInvoiceBreakdown,
  invoiceBasisForBooking,
  formatInvoiceMoney,
  formatInvoiceDate,
  type InvoiceConfig,
  type InvoiceBreakdown,
  type InvoiceBasis,
} from './services/invoices';

// Guest-invoice issuing (numbering + snapshot) — used by the API + worker.
export {
  previewInvoice,
  issueInvoiceForBooking,
  InvoiceIssueError,
  type InvoiceRecipient,
  type InvoicePreview,
  type IssuerSnapshot,
} from './services/invoice-issue';

// ARI outbox enqueue — reused by the worker's booking-feed ingest so an
// inbound OTA booking/cancellation pushes availability to Channex immediately
// (same path the internal booking mutations use).
export { enqueueAri, type AriChange, type AriKind } from './services/ari';
