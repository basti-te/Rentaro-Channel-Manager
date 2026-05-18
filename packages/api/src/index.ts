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
