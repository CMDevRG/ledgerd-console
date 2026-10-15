import { describe, expect, it, vi } from 'vitest';

import { applyTheme, isDark } from '../../app/theme';
import {
  createSettingsStore,
  DEFAULT_SETTINGS,
  isCurrencyCode,
  parseSettings,
  SETTINGS_KEY,
  type StorageLike,
} from './store';

function memoryStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(initial === undefined ? [] : [[SETTINGS_KEY, initial]]);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

describe('parseSettings', () => {
  it('uses the defaults when nothing is stored', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('reads a valid value', () => {
    const text = JSON.stringify({ theme: 'dark', scales: { USD: 4, JPY: 0 }, rawUnits: true });
    expect(parseSettings(text)).toEqual({
      theme: 'dark',
      scales: { USD: 4, JPY: 0 },
      rawUnits: true,
    });
  });

  it.each(['', 'not json', '{', 'null', '42', '"dark"', '[]', 'true'])(
    'survives damaged text %j',
    (text) => {
      expect(parseSettings(text)).toEqual(DEFAULT_SETTINGS);
    },
  );

  it('replaces only the bad parts', () => {
    const text = JSON.stringify({
      theme: 'purple',
      rawUnits: 'yes',
      scales: {
        USD: 3,
        eur: 2,
        BTC: 31,
        ETH: -1,
        JPY: 1.5,
        A: 2,
        DOGE: '2',
        LONGCURRENCYCODE: 2,
        USDT: 6,
      },
    });
    expect(parseSettings(text)).toEqual({
      theme: 'system',
      rawUnits: false,
      scales: { USD: 3, USDT: 6 },
    });
  });

  it('keeps nothing from a scales value of the wrong type', () => {
    expect(parseSettings('{"scales": [2, 3]}').scales).toEqual({});
    expect(parseSettings('{"scales": "USD"}').scales).toEqual({});
  });

  it('accepts the currency codes ledgerd accepts, and no others', () => {
    for (const ok of ['US', 'USD', 'USDT', 'ABCDEFGHIJ', 'A1', 'B2B2'])
      expect(isCurrencyCode(ok), ok).toBe(true);
    for (const bad of ['', 'U', 'usd', 'ABCDEFGHIJK', 'US D', 'US-D', 'ÜSD'])
      expect(isCurrencyCode(bad), bad).toBe(false);
  });
});

describe('createSettingsStore', () => {
  it('starts from what is stored', () => {
    const store = createSettingsStore(memoryStorage('{"theme":"light"}'));
    expect(store.get().theme).toBe('light');
  });

  it('saves, and a new store sees it', () => {
    const storage = memoryStorage();
    createSettingsStore(storage).set({ theme: 'dark', scales: { USD: 3 }, rawUnits: true });
    expect(createSettingsStore(storage).get()).toEqual({
      theme: 'dark',
      scales: { USD: 3 },
      rawUnits: true,
    });
  });

  it('tells subscribers, and stops when they unsubscribe', () => {
    const store = createSettingsStore(memoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set({ ...DEFAULT_SETTINGS, rawUnits: true });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.set(DEFAULT_SETTINGS);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('works without storage, and when storage throws', () => {
    const none = createSettingsStore(undefined);
    none.set({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect(none.get().theme).toBe('dark');

    const broken: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    const store = createSettingsStore(broken);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(() => {
      store.set({ ...DEFAULT_SETTINGS, rawUnits: true });
    }).not.toThrow();
    expect(store.get().rawUnits).toBe(true);
  });

  it('re-reads storage when another tab changed it', () => {
    const storage = memoryStorage();
    const store = createSettingsStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);
    storage.data.set(SETTINGS_KEY, '{"theme":"dark"}');
    store.reload();
    expect(store.get().theme).toBe('dark');
    expect(listener).toHaveBeenCalled();
  });
});

describe('theme', () => {
  it.each([
    ['system', false, false],
    ['system', true, true],
    ['light', true, false],
    ['dark', false, true],
  ] as const)('%s with the system dark=%s gives dark=%s', (preference, systemDark, expected) => {
    expect(isDark(preference, systemDark)).toBe(expected);
    const root = document.createElement('html');
    applyTheme(preference, systemDark, root);
    expect(root.classList.contains('dark')).toBe(expected);
  });
});
