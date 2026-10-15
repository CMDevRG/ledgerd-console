import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { RouterProvider, createMemoryRouter, type RouteObject } from 'react-router';

import { Providers } from '../app/Providers';
import { routes } from '../app/router';
import { createSettingsStore, type SettingsStore } from '../features/settings/store';

const testQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: Infinity } },
  });

/** Renders a component with a fresh query cache that never retries or refetches in the background. */
export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(<QueryClientProvider client={testQueryClient()}>{ui}</QueryClientProvider>);
}

export interface AppRender extends RenderResult {
  client: QueryClient;
  settings: SettingsStore;
  router: ReturnType<typeof createMemoryRouter>;
}

/**
 * Renders the whole application (providers, frame and pages) at a path, with settings kept in
 * memory so tests do not touch local storage.
 */
export function renderApp(path = '/', extraRoutes: RouteObject[] = routes): AppRender {
  const settings = createSettingsStore(undefined);
  const router = createMemoryRouter(extraRoutes, { initialEntries: [path] });
  const client = testQueryClient();
  const result = render(
    <Providers client={client} settings={settings}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return Object.assign(result, { client, settings, router });
}
