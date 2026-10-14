import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from './axe';

describe('the accessibility check', () => {
  it('accepts a labelled form control', async () => {
    const { container } = render(
      <main>
        <h1>Page</h1>
        <label htmlFor="code">Account code</label>
        <input id="code" type="text" />
      </main>,
    );
    await expectNoAccessibilityViolations(container);
  });

  it('rejects an input without a label (so the check can fail)', async () => {
    const { container } = render(
      <main>
        <h1>Page</h1>
        <input type="text" />
      </main>,
    );
    await expect(expectNoAccessibilityViolations(container)).rejects.toThrow(/label/);
  });

  it('rejects an image without a text alternative', async () => {
    const { container } = render(
      <main>
        <h1>Page</h1>
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
      </main>,
    );
    await expect(expectNoAccessibilityViolations(container)).rejects.toThrow(/image-alt/);
  });
});
