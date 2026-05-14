import { router } from './trpc';
import { meRouter } from './routers/me';
import { propertyGroupsRouter } from './routers/property-groups';
import { propertiesRouter } from './routers/properties';

export const appRouter = router({
  me: meRouter,
  propertyGroups: propertyGroupsRouter,
  properties: propertiesRouter,
});

export type AppRouter = typeof appRouter;

export * from './context';
export { createContext } from './context';
