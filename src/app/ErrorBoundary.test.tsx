import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoAccessibilityViolations } from '../test/axe';
import { ErrorBoundary } from './ErrorBoundary';

let shouldThrow = true;
function Fragile() {
  if (shouldThrow) throw new Error('secret internal detail at Fragile.tsx:7');
  return <p>All good</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = true;
    // React reports a caught render error to the console; that is expected here.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows its children when nothing is wrong', () => {
    shouldThrow = false;
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('catches a render error: the page around it survives, and the message is safe', async () => {
    const { container } = render(
      <div>
        <nav aria-label="Main">navigation still here</nav>
        <ErrorBoundary>
          <Fragile />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('This part of the page could not be shown');
    expect(screen.getByText('navigation still here')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/secret internal detail|Fragile\.tsx/);
    await expectNoAccessibilityViolations(container);
  });

  it('logs the error for the developer', () => {
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalledWith(
      'A part of the console failed to render:',
      expect.objectContaining({
        message: expect.stringContaining('secret internal detail') as string,
      }),
      expect.any(String),
    );
  });

  it('"Try again" renders the children again, and recovers if the cause is gone', async () => {
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );
    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('"Try again" shows the message again if the cause is still there', async () => {
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('"Reload the page" reloads', async () => {
    const reload = vi.fn();
    render(
      <ErrorBoundary reload={reload}>
        <Fragile />
      </ErrorBoundary>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload the page' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('clears a shown error when the reset key changes, as it does when the route changes', async () => {
    function Harness() {
      const [route, setRoute] = useState('/broken');
      return (
        <>
          <button
            type="button"
            onClick={() => {
              shouldThrow = false;
              setRoute('/fine');
            }}
          >
            go
          </button>
          <ErrorBoundary resetKey={route}>
            <Fragile />
          </ErrorBoundary>
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'go' }));
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('does not clear an error when the reset key stays the same', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="a">
        <Fragile />
      </ErrorBoundary>,
    );
    shouldThrow = false;
    rerender(
      <ErrorBoundary resetKey="a">
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
