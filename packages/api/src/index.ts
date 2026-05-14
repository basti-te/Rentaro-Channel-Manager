import { router } from './trpc';
import { meRouter } from './routers/me';
import { propertyGroupsRouter } from './routers/property-groups';
import { propertiesRouter } from './routers/properties';
import { bookingsRouter } from './routers/bookings';

export const appRouter = router({
  me: meRouter,
  propertyGroups: propertyGroupsRouter,
  properties: propertiesRouter,
  bookings: bookingsRouter,
});

export type AppRouter = typeof appRouter;

export * from './context';
export { createContext } from './context';
