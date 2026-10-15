import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/problem';
import { makeConsoleProblem } from '../test/factories';
import { expectNoAccessibilityViolations } from '../test/axe';
import { ApiErrorView } from './ApiErrorView';

const REQUEST_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const refused = new ApiError('refused', 'Transaction is not balanced', {
  status: 422,
  problem: {
    type: 'urn:ledgerd:error:unbalanced_transaction',
    title: 'Transaction is not balanced',
    status: 422,
    code: 'unbalanced_transaction',
    detail: 'debits and credits differ in USD by 5',
    request_id: REQUEST_ID,
    errors: [{ field: 'postings[1].amount', message: 'must balance' }],
  },
});

describe('ApiErrorView', () => {
  it('has no accessibility violations for any kind of failure', async () => {
    const all = [
      refused,
      new ApiError('busy', 'Service not ready', { status: 503, retryAfterSeconds: 3 }),
      new ApiError('network', 'The console could not reach the server.'),
      new ApiError('unexpected', 'bad body', { requestId: REQUEST_ID }),
      new Error('boom'),
    ];
    for (const error of all) {
      const { container, unmount } = render(
        <ApiErrorView error={error} onRetry={() => undefined} />,
      );
      await expectNoAccessibilityViolations(container);
      unmount();
    }
  });

  describe('a refusal', () => {
    it("shows the problem's title, detail and code, and the request id to copy", () => {
      render(<ApiErrorView error={refused} />);
      const alert = screen.getByRole('alert');
      expect(within(alert).getByText('Transaction is not balanced')).toBeInTheDocument();
      expect(within(alert).getByText('debits and credits differ in USD by 5')).toBeInTheDocument();
      expect(within(alert).getByText('unbalanced_transaction')).toBeInTheDocument();
      expect(within(alert).getByText(REQUEST_ID)).toBeInTheDocument(); // in full, for screen readers
      expect(within(alert).getByRole('button', { name: 'Copy request id' })).toBeInTheDocument();
    });

    it('lists the field errors, unless the form shows them itself', () => {
      const { rerender } = render(<ApiErrorView error={refused} />);
      expect(screen.getByText('postings[1].amount')).toBeInTheDocument();
      expect(screen.getByText(/must balance/)).toBeInTheDocument();
      rerender(<ApiErrorView error={refused} hideFieldErrors />);
      expect(screen.queryByText('postings[1].amount')).not.toBeInTheDocument();
    });

    it('does not offer to try again, because the same request would be refused again', () => {
      render(<ApiErrorView error={refused} onRetry={() => undefined} />);
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });

    it('says what to do next, not just that something went wrong', () => {
      render(<ApiErrorView error={refused} />);
      expect(screen.getByText(/Change it and send it again/)).toBeInTheDocument();
    });
  });

  describe('a busy service', () => {
    it('says how long to wait, and offers to try again', async () => {
      const onRetry = vi.fn();
      render(
        <ApiErrorView
          error={new ApiError('busy', 'Service not ready', { retryAfterSeconds: 3 })}
          onRetry={onRetry}
        />,
      );
      expect(screen.getByText('The ledger is busy')).toBeInTheDocument();
      expect(screen.getByText(/in 3 seconds/)).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('uses the singular for one second, and copes with no suggested wait', () => {
      const { rerender } = render(
        <ApiErrorView error={new ApiError('busy', 'x', { retryAfterSeconds: 1 })} />,
      );
      expect(screen.getByText(/in 1 second\./)).toBeInTheDocument();
      rerender(<ApiErrorView error={new ApiError('busy', 'x')} />);
      expect(screen.getByText(/tried again shortly/)).toBeInTheDocument();
    });
  });

  describe('a network failure', () => {
    it('says that the ledger cannot be reached, what to check, and offers to try again', async () => {
      const onRetry = vi.fn();
      render(
        <ApiErrorView
          error={new ApiError('network', 'The console could not reach the server.')}
          onRetry={onRetry}
        />,
      );
      expect(screen.getByText('Cannot reach the ledger')).toBeInTheDocument();
      expect(screen.getByText(/Check that ledgerd is running/)).toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
      expect(onRetry).toHaveBeenCalled();
    });

    it('includes the reason when a request timed out', () => {
      render(
        <ApiErrorView
          error={
            new ApiError('network', 'The request took longer than 30 seconds and was cancelled.')
          }
        />,
      );
      expect(screen.getByText(/took longer than 30 seconds/)).toBeInTheDocument();
    });

    it('does not offer to try again when no handler is given', () => {
      render(<ApiErrorView error={new ApiError('network', 'x')} />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('an answer that is not understood', () => {
    it('suggests a version mismatch and shows the request id', () => {
      render(
        <ApiErrorView
          error={new ApiError('unexpected', 'bad body', { requestId: REQUEST_ID })}
          onRetry={() => undefined}
        />,
      );
      expect(screen.getByText('The answer was not understood')).toBeInTheDocument();
      expect(screen.getByText(/different versions/)).toBeInTheDocument();
      expect(screen.getByText(REQUEST_ID)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
  });

  describe('the console server not being authorised', () => {
    it('points at the server configuration, not at the user', () => {
      const error = new ApiError('network', 'The console is misconfigured', {
        status: 502,
        problem: makeConsoleProblem('console_misconfigured', 502),
      });
      render(<ApiErrorView error={error} onRetry={() => undefined} />);
      expect(
        screen.getByText('The console is not authorised to use the ledger'),
      ).toBeInTheDocument();
      expect(screen.getByText(/LEDGERD_API_KEY/)).toBeInTheDocument();
      expect(screen.getByText('console_misconfigured')).toBeInTheDocument();
    });
  });

  describe('anything else', () => {
    it('shows no message, stack or data from the error, only what to do', () => {
      const secret = new Error(
        'TypeError: cannot read properties of undefined (reading "balance") at Foo.tsx:12',
      );
      const { container } = render(<ApiErrorView error={secret} />);
      expect(container).not.toHaveTextContent(/TypeError|Foo\.tsx|balance/);
      expect(screen.getByText('The console hit an unexpected problem')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
    });

    it.each([undefined, null, 'text', 42, { not: 'an error' }])(
      'copes with a thrown %j',
      (value) => {
        render(<ApiErrorView error={value} />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
      },
    );
  });

  it('never shows a raw JSON dump', () => {
    const { container } = render(<ApiErrorView error={refused} />);
    expect(container.textContent).not.toMatch(/[{}]|"type"|urn:ledgerd/);
  });
});
