import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../test/axe';
import { LiveRegionProvider, useAnnounce } from './LiveRegion';

function Announcer({ message }: { message: string }) {
  const announce = useAnnounce();
  return (
    <button
      type="button"
      onClick={() => {
        announce(message);
      }}
    >
      say
    </button>
  );
}

describe('LiveRegion', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <LiveRegionProvider>
        <Announcer message="hello" />
      </LiveRegionProvider>,
    );
    await expectNoAccessibilityViolations(container);
  });

  it('is a polite, atomic status region that sighted users do not see', () => {
    render(<LiveRegionProvider>content</LiveRegionProvider>);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveClass('sr-only');
    expect(region).toBeEmptyDOMElement();
  });

  it('announces a message', () => {
    render(
      <LiveRegionProvider>
        <Announcer message="Transaction posted" />
      </LiveRegionProvider>,
    );
    act(() => {
      screen.getByRole('button').click();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Transaction posted');
  });

  it('changes the region even when the same message is announced twice, so it is read twice', () => {
    render(
      <LiveRegionProvider>
        <Announcer message="Copied" />
      </LiveRegionProvider>,
    );
    const region = screen.getByRole('status');
    act(() => {
      screen.getByRole('button').click();
    });
    const first = region.textContent;
    act(() => {
      screen.getByRole('button').click();
    });
    expect(region.textContent).not.toBe(first);
    expect(region.textContent.trim()).toBe('Copied');
  });

  it('does nothing, and does not fail, without a provider', () => {
    render(<Announcer message="x" />);
    expect(() => {
      act(() => {
        screen.getByRole('button').click();
      });
    }).not.toThrow();
  });
});
