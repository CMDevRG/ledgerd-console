import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { SETTINGS_KEY, THEMES } from '../features/settings/store';
import { isDark } from './theme';

const script = readFileSync(join(process.cwd(), 'public', 'theme.js'), 'utf8');

/** Runs public/theme.js as the browser would, with the given saved text and system theme. */
function run(saved: string | null, systemDark: boolean): boolean {
  const classes = new Set<string>();
  const root = {
    classList: {
      toggle: (name: string, force: boolean) => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
  };
  const storage = { getItem: (key: string) => (key === SETTINGS_KEY ? saved : null) };
  runInNewContext(script, {
    localStorage: storage,
    matchMedia: () => ({ matches: systemDark }),
    document: { documentElement: root },
  });
  return classes.has('dark');
}

describe('public/theme.js (runs before first paint)', () => {
  it('reads the same storage key as the settings', () => {
    expect(script).toContain(`'${SETTINGS_KEY}'`);
  });

  it.each(
    THEMES.flatMap((theme) => [true, false].map((systemDark) => [theme, systemDark] as const)),
  )('agrees with the application for theme=%s, system dark=%s', (theme, systemDark) => {
    expect(run(JSON.stringify({ theme }), systemDark)).toBe(isDark(theme, systemDark));
  });

  it.each([null, '', 'not json', '{', 'null', '[]', '{"theme":"purple"}', '{"theme":null}'])(
    'treats damaged or missing text %j as "system", and does not throw',
    (saved) => {
      expect(run(saved, true)).toBe(true);
      expect(run(saved, false)).toBe(false);
    },
  );

  it('is not inline: the page loads it as a file', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('<script src="/theme.js"></script>');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });
});
