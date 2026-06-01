import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';

import { RootLayout } from './routes/__root';
import { LoginPage } from './routes/login';
import { LandingPage } from './routes/landing';
import { OnboardingPage } from './routes/onboarding';
import { PublicCleaningCalendarPage } from './routes/cleaning-public';
import { ImpressumPage } from './routes/impressum';
import { DatenschutzPage } from './routes/datenschutz';
import { DashboardLayout } from './routes/_dashboard';
import { OverviewPage } from './routes/overview';
import { ApartmentsPage } from './routes/apartments';
import { ChannelsPage } from './routes/channels';
import { CalendarPage } from './routes/calendar';
import { MessagesPage } from './routes/messages';
import { CleaningPage } from './routes/cleaning';
import { MenuPage } from './routes/menu';
import { SettingsPage } from './routes/settings';
import { NotificationsPage } from './routes/notifications';
import { TeammatesPage } from './routes/teammates';
import { ReviewsPage } from './routes/reviews';
import { ListingLinksPage } from './routes/listing-links';

const rootRoute = createRootRoute({
  component: () => (
    <RootLayout>
      <Outlet />
    </RootLayout>
  ),
});

/** Public marketing landing page. Signed-in users get auto-redirected
 *  to /calendar from inside the LandingPage component, so a bookmark to
 *  `rentaro.cloud` keeps working as the operator's app entry point. */
const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

/** First-time setup wizard. Outside the dashboard layout (no sidebar). */
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingPage,
});

/** Public read-only cleaning calendar share. No auth required.
 *  Operator generates an opaque slug under /cleaning > Kalender-Links; the
 *  cleaning staff opens this URL on their phone. NOT_FOUND if the calendar
 *  was rotated, toggled off, or deleted. */
const publicCleaningCalendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cal/$slug',
  component: PublicCleaningCalendarPage,
});

/** Public — legal notice, reachable without authentication. */
const impressumRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/impressum',
  component: ImpressumPage,
});

/** Public — privacy policy, reachable without authentication. */
const datenschutzRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/datenschutz',
  component: DatenschutzPage,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'dashboard',
  component: DashboardLayout,
});

const overviewRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/overview',
  component: OverviewPage,
});

const apartmentsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/apartments',
  component: ApartmentsPage,
});

const channelsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/channels',
  component: ChannelsPage,
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

const settingsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/settings',
  component: SettingsPage,
});

const notificationsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/notifications',
  component: NotificationsPage,
});

const teammatesRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/teammates',
  component: TeammatesPage,
});

const reviewsRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/reviews',
  component: ReviewsPage,
});

const listingLinksRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/listing-links',
  component: ListingLinksPage,
});

const routeTree = rootRoute.addChildren([
  landingRoute,
  loginRoute,
  onboardingRoute,
  publicCleaningCalendarRoute,
  impressumRoute,
  datenschutzRoute,
  dashboardRoute.addChildren([
    overviewRoute,
    apartmentsRoute,
    channelsRoute,
    calendarRoute,
    messagesRoute,
    cleaningRoute,
    menuRoute,
    settingsRoute,
    notificationsRoute,
    teammatesRoute,
    reviewsRoute,
    listingLinksRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
