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
import { CalendarPage } from './routes/calendar';
import { MessagesPage } from './routes/messages';
import { CleaningPage } from './routes/cleaning';
import { MenuPage } from './routes/menu';

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

const calendarRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/calendar',
  component: CalendarPage,
});

const messagesRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/messages',
  component: MessagesPage,
});

const cleaningRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/cleaning',
  component: CleaningPage,
});

const menuRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/menu',
  component: MenuPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  dashboardRoute.addChildren([
    overviewRoute,
    apartmentsRoute,
    calendarRoute,
    messagesRoute,
    cleaningRoute,
    menuRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
