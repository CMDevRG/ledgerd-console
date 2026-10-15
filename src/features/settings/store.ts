import { isValidScale } from '../../money';

/** Where the settings live in local storage. public/theme.js reads the same key. */
export const SETTINGS_KEY = 'ledgerd-console.settings';

export type ThemePreference = 'system' | 'light' | 'dark';
export const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export interface Settings {
  theme: ThemePreference;
  /** Decimal places per currency, overriding the defaults. A presentation choice only. */
  scales: Readonly<Record<string, number>>;
  /** Show amounts as the raw whole minor units ledgerd stores. */
  rawUnits: boolean;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'system', scales: {}, rawUnits: false };

/** ledgerd's rule for an asset code: 2 to 10 uppercase letters or digits. */
export const isCurrencyCode = (text: string): boolean => /^[A-Z0-9]{2,10}$/.test(text);

/**
 * Reads settings from stored text. Whatever is wrong with it (missing, not JSON, wrong
 * shape, a bad entry) falls back to the default for that part, never to an error: a console
 * must start even if its saved preferences were damaged.
 */
export function parseSettings(text: string | null): Settings {
  let raw: unknown;
  try {
    raw = text === null ? undefined : JSON.parse(text);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SETTINGS;
  const object = raw as Record<string, unknown>;

  const theme = THEMES.find((t) => t === object.theme) ?? DEFAULT_SETTINGS.theme;
  const rawUnits = object.rawUnits === true;

  const scales: Record<string, number> = {};
  if (typeof object.scales === 'object' && object.scales !== null) {
    for (const [currency, scale] of Object.entries(object.scales)) {
      if (isCurrencyCode(currency) && typeof scale === 'number' && isValidScale(scale)) {
        scales[currency] = scale;
      }
    }
  }
  return { theme, scales, rawUnits };
}

/** The part of the Storage interface the store needs. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SettingsStore {
  get: () => Settings;
  set: (next: Settings) => void;
  /** Re-reads storage, for when another tab changed it. */
  reload: () => void;
  subscribe: (listener: () => void) => () => void;
}

/** A store with the shape React's useSyncExternalStore wants. Storage may be absent or throw. */
export function createSettingsStore(storage: StorageLike | undefined): SettingsStore {
  const read = (): Settings => {
    try {
      return parseSettings(storage?.getItem(SETTINGS_KEY) ?? null);
    } catch {
      return DEFAULT_SETTINGS;
    }
  };
  let current = read();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    get: () => current,
    set(next) {
      current = next;
      try {
        storage?.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // Private mode or a full disk: the setting still applies until the page is closed.
      }
      notify();
    },
    reload() {
      current = read();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
