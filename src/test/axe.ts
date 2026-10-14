import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Fails the test if axe finds an accessibility violation in the rendered DOM.
 * Every component test calls this (requirement R13.7).
 *
 * jsdom has no layout engine, so the rules that need real rendering (colour contrast,
 * for example) are switched off here; the end-to-end tests run them in a real browser.
 */
export async function expectNoAccessibilityViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  const report = results.violations
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)
    .join('\n');
  expect(report, 'accessibility violations').toBe('');
}
