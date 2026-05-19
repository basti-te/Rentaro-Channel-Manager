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
export { computeDueAt, parseTrigger, type ParsedTrigger } from './services/triggers';
export { sendSms, isTwilioConfigured, type TwilioConfig } from './services/twilio';
