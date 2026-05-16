import { router } from './trpc';
import { meRouter } from './routers/me';
import { propertyGroupsRouter } from './routers/property-groups';
import { propertiesRouter } from './routers/properties';
import { bookingsRouter } from './routers/bookings';
import { syncRouter } from './routers/sync';
import { ratesRouter } from './routers/rates';

export const appRouter = router({
  me: meRouter,
  propertyGroups: propertyGroupsRouter,
  properties: propertiesRouter,
  bookings: bookingsRouter,
  sync: syncRouter,
  rates: ratesRouter,
});

export type AppRouter = typeof appRouter;

export * from './context';
export { createContext } from './context';
