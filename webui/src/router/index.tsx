import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
} from '@tanstack/react-router';
import { AppLayout } from './app-layout';
import { ErrorPage, NotFoundPage } from '@/components/pages/status-screens';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const appLayoutRoute = createRoute({
  id: 'app-layout',
  getParentRoute: () => rootRoute,
  component: AppLayout,
});

const overviewRoute = createRoute({
  path: '/',
  getParentRoute: () => appLayoutRoute,
  component: lazyRouteComponent(
    () => import('@/components/pages/overview-page'),
    'OverviewPage',
  ),
});

const pluginsRoute = createRoute({
  path: '/plugins',
  getParentRoute: () => appLayoutRoute,
  component: lazyRouteComponent(
    () => import('@/components/pages/plugins-page'),
    'PluginsPage',
  ),
});

const contactsRoute = createRoute({
  path: '/contacts',
  getParentRoute: () => appLayoutRoute,
  component: lazyRouteComponent(
    () => import('@/components/pages/contacts-page'),
    'ContactsPage',
  ),
});

const logsRoute = createRoute({
  path: '/logs',
  getParentRoute: () => appLayoutRoute,
  component: lazyRouteComponent(
    () => import('@/components/pages/logs-page'),
    'LogsPage',
  ),
});

const configRoute = createRoute({
  path: '/config',
  getParentRoute: () => appLayoutRoute,
  component: lazyRouteComponent(
    () => import('@/components/pages/config-page'),
    'ConfigPage',
  ),
});

export const SETTINGS_TABS = ['appearance', 'data', 'advanced', 'account', 'system', 'storage', 'notifications', 'globalConfig', 'developer', 'about'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const settingsRoute = createRoute({
  path: '/settings',
  getParentRoute: () => appLayoutRoute,
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => {
    const t = search.tab;
    return typeof t === 'string' && (SETTINGS_TABS as readonly string[]).includes(t)
      ? { tab: t as SettingsTab }
      : {};
  },
  component: lazyRouteComponent(
    () => import('@/components/pages/settings-page'),
    'SettingsPage',
  ),
});

const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([overviewRoute, pluginsRoute, contactsRoute, logsRoute, configRoute, settingsRoute]),
]);

export const appRouter = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultNotFoundComponent: () => <NotFoundPage />,
  defaultErrorComponent: ({ error, reset }) => <ErrorPage error={error} reset={reset} />,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof appRouter;
  }
}

export type AppPath = '/' | '/plugins' | '/contacts' | '/logs' | '/config' | '/settings' | '/processes' | '/debug';
