import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';

import { RootLayout } from './routes/__root';
import { LoginPage } from './routes/login';
import { DashboardLayout } from './routes/_dashboard';
import { OverviewPage } from './routes/overview';
import { ApartmentsPage } from './routes/apartments';

const rootRoute = createRootRoute({
  component: () => (
    <RootLayout>
      <Outlet />
    </RootLayout>
  ),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'dashboard',
  component: DashboardLayout,
});

const overviewRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/',
  component: OverviewPage,
});

const apartmentsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/apartments',
  component: ApartmentsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  dashboardRoute.addChildren([overviewRoute, apartmentsRoute]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
