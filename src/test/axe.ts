import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * The standard the console targets (R13.1): WCAG 2.2 level AA, which includes levels A and
 * 2.0/2.1 AA, plus axe's own best practices. The end-to-end helper (e2e/support.ts) uses the
 * same list; src/test/axe.test.tsx checks that every tag names real rules.
 */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * Fails the test if axe finds an accessibility violation in the rendered DOM.
 * Every component test calls this (requirement R13.7).
 *
 * jsdom has no layout engine, so the rules that need real rendering (colour contrast,
 * for example) are switched off here; the end-to-end tests run them in a real browser.
 */
export async function expectNoAccessibilityViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: AXE_TAGS },
    rules: { 'color-contrast': { enabled: false } },
  });
  const report = results.violations
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)
    .join('\n');
  expect(report, 'accessibility violations').toBe('');
}
