import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../../test/axe';
import { mockReadiness } from '../../test/readiness';
import { renderWithProviders } from '../../test/render';
import { ReadinessBadge } from './ReadinessBadge';

describe('ReadinessBadge', () => {
  it('shows a neutral state while the first check is running', () => {
    mockReadiness('neverAnswers');
    renderWithProviders(<ReadinessBadge />);
    expect(screen.getByText('Checking API…')).toBeInTheDocument();
  });

  it.each([
    ['ready', 'API ready', '✓'],
    ['notReady', 'API not ready', '!'],
    ['unreachable', 'Cannot reach the API', '✕'],
    ['gatewayDown', 'Cannot reach the API', '✕'],
    ['misconfigured', 'Console key rejected', '✕'],
    ['unexpectedBody', 'Unexpected answer from the API', '!'],
  ] as const)('with %s it says "%s" and shows %s', async (kind, label, symbol) => {
    mockReadiness(kind);
    const { container } = renderWithProviders(<ReadinessBadge />);
    const badge = await screen.findByText(label);
    expect(badge).toHaveTextContent(`${symbol}${label}`);
    // The symbol is for the eyes: a screen reader hears the words only.
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent(symbol);
    await expectNoAccessibilityViolations(container);
  });

  it('never shows "ready" for anything but a valid ready answer (R1.3)', async () => {
    for (const kind of ['notReady', 'unexpectedBody', 'misconfigured', 'unreachable'] as const) {
      mockReadiness(kind);
      const { unmount } = renderWithProviders(<ReadinessBadge />);
      await waitFor(() => {
        expect(screen.queryByText('Checking API…')).not.toBeInTheDocument();
      });
      expect(screen.queryByText('API ready')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('is not itself a live region: changes are announced once, through the page region', () => {
    mockReadiness('neverAnswers');
    renderWithProviders(<ReadinessBadge />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
