import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { SettingsProvider } from '../features/settings/SettingsProvider';
import type { SettingsStore } from '../features/settings/store';
import { LiveRegionProvider } from '../ui/LiveRegion';

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // Money data should not be silently stale for long, but refetching on every
        // window focus is noisy for a console; keep the default off and poll where it matters.
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

interface ProvidersProps {
  client: QueryClient;
  /** For tests; the application keeps its settings in local storage. */
  settings?: SettingsStore;
  children: ReactNode;
}

export function Providers({ client, settings, children }: ProvidersProps) {
  return (
    <QueryClientProvider client={client}>
      <SettingsProvider {...(settings ? { store: settings } : {})}>
        <LiveRegionProvider>{children}</LiveRegionProvider>
      </SettingsProvider>
    </QueryClientProvider>
  );
}
