import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import type { RouterHistory } from '@tanstack/history';
import { App } from '@/App';

const rootRoute = createRootRoute();

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: App,
});

const sectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$section',
  component: App,
});

const routeTree = rootRoute.addChildren([homeRoute, sectionRoute]);

export function createAdminRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    basepath: '/admin',
    history,
  });
}

export const router = createAdminRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function AdminRouter() {
  return <RouterProvider router={router} />;
}

/** In-memory router for tests. The address is the real browser path, including /admin. */
export function createMemoryAdmin(entry: string) {
  const history = createMemoryHistory({ initialEntries: [entry] });
  const memoryRouter = createAdminRouter(history);
  return { history, router: memoryRouter, element: <RouterProvider router={memoryRouter} /> };
}
