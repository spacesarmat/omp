import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
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

export const router = createRouter({
  routeTree,
  basepath: '/admin',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function AdminRouter() {
  return <RouterProvider router={router} />;
}
