import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { applyTheme } from '../../app/theme';
import { resolveScale } from '../../money';
import { createSettingsStore, type Settings, type SettingsStore } from './store';

// Without a provider (small component tests) the settings are the defaults and are not saved.
const SettingsContext = createContext<SettingsStore>(createSettingsStore(undefined));

interface SettingsProviderProps {
  /** For tests; the application uses local storage. */
  store?: SettingsStore;
  children: ReactNode;
}

const browserStore = (): SettingsStore => {
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined; // blocked by the browser
  }
  return createSettingsStore(storage);
};

/**
 * Holds the display settings, applies the theme to the page, and follows changes made in
 * another tab. The theme is first applied by /theme.js before the page paints; this keeps it
 * in step afterwards.
 */
export function SettingsProvider({ store, children }: SettingsProviderProps) {
  const value = useMemo(() => store ?? browserStore(), [store]);
  const { theme } = useSyncExternalStore(value.subscribe, value.get);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      applyTheme(theme, media.matches, document.documentElement);
    };
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
    };
  }, [theme]);

  useEffect(() => {
    const onStorage = (): void => {
      value.reload();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, [value]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/** The settings, and a function that changes some of them. */
export function useSettings(): [Settings, (change: Partial<Settings>) => void] {
  const store = useContext(SettingsContext);
  const settings = useSyncExternalStore(store.subscribe, store.get);
  const update = (change: Partial<Settings>): void => {
    store.set({ ...store.get(), ...change });
  };
  return [settings, update];
}

/** How many decimals to show for a currency. */
export function useScale(currency: string): number {
  const store = useContext(SettingsContext);
  const settings = useSyncExternalStore(store.subscribe, store.get);
  return resolveScale(currency, settings.scales);
}
