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
  type ParsedTrigger,
  type TriggerAnchor,
} from './services/triggers';
export { sendSms, isTwilioConfigured, type TwilioConfig } from './services/twilio';
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
