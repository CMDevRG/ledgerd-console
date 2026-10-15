import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectNoAccessibilityViolations } from '../test/axe';
import { CopyText, truncateMiddle } from './CopyText';
import { LiveRegionProvider } from './LiveRegion';

const ID = '3f2b8a52-2f8e-4c61-9a4e-0d6f4f0e7c11';

describe('truncateMiddle', () => {
  it('keeps the start and the end of a long value', () => {
    expect(truncateMiddle(ID)).toBe('3f2b8a52…7c11');
    expect(truncateMiddle(ID, 4, 2)).toBe('3f2b…11');
  });
  it('leaves a short value whole', () => {
    expect(truncateMiddle('assets:cash')).toBe('assets:cash');
    expect(truncateMiddle('123456789012')).toBe('123456789012'); // head + tail
    expect(truncateMiddle('1234567890123')).toBe('1234567890123'); // head + tail + 1: no gain
    expect(truncateMiddle('12345678901234')).toBe('12345678…1234');
  });
});

describe('CopyText', () => {
  // user-event installs its own clipboard when it is set up, so each test sets it up first
  // and then watches (or removes) the clipboard it left.
  function setup(writeText: () => Promise<void> = () => Promise.resolve()) {
    const user = userEvent.setup();
    const spy = vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText);
    return { user, spy };
  }
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<CopyText value={ID} label="account id" />);
    await expectNoAccessibilityViolations(container);
  });

  it('shows the value truncated, and gives screen readers the whole of it', () => {
    render(<CopyText value={ID} label="account id" />);
    expect(screen.getByText('3f2b8a52…7c11')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(ID)).toHaveClass('sr-only');
  });

  it('copies the full value, and says so to everyone', async () => {
    const { user, spy } = setup();
    render(
      <LiveRegionProvider>
        <CopyText value={ID} label="account id" />
      </LiveRegionProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Copy account id' }));
    expect(spy).toHaveBeenCalledWith(ID);
    expect(await screen.findByRole('button', { name: 'Copy account id' })).toHaveTextContent(
      'Copied',
    );
    expect(screen.getByRole('status')).toHaveTextContent('account id copied');
  });

  it('is operated with the keyboard', async () => {
    const { user, spy } = setup();
    render(<CopyText value={ID} label="request id" />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Copy request id' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(spy).toHaveBeenCalledWith(ID);
  });

  it('goes back to "Copy" after a moment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = setup();
    render(<CopyText value={ID} label="account id" />);
    await user.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('Copied');
    });
    vi.advanceTimersByTime(2100);
    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent(/^Copy$/);
    });
  });

  it('says so when the browser refuses to copy', async () => {
    const { user } = setup(() => Promise.reject(new Error('denied')));
    render(
      <LiveRegionProvider>
        <CopyText value={ID} label="account id" />
      </LiveRegionProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Copy account id' }));
    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Could not copy the account id');
  });

  it('says so when there is no clipboard (not a secure context)', async () => {
    const { user } = setup();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<CopyText value={ID} label="account id" />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('Copy failed');
  });
});
