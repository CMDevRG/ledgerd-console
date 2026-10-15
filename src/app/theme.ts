import type { ThemePreference } from '../features/settings/store';

/** Whether the page should be dark for a preference, given the system's preference. */
export function isDark(preference: ThemePreference, systemDark: boolean): boolean {
  return preference === 'dark' || (preference === 'system' && systemDark);
}

/** Puts the `dark` class on <html> (see the dark variant in index.css). */
export function applyTheme(
  preference: ThemePreference,
  systemDark: boolean,
  root: HTMLElement,
): void {
  root.classList.toggle('dark', isDark(preference, systemDark));
}
