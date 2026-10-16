import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../api/problem';
import { makeConsoleProblem } from '../../test/factories';
import { expectNoAccessibilityViolations } from '../../test/axe';
import { KeyNotice, keyStatus } from './KeyNotice';

const refusal = (code: string, status: number) =>
  new ApiError('refused', 'x', {
    status,
    problem: makeConsoleProblem(code, status),
  });

describe('keyStatus', () => {
  it.each<[string, unknown, ReturnType<typeof keyStatus>]>([
    ['insufficient funds', refusal('insufficient_funds', 422), 'not_used'],
    ['a validation error', refusal('validation_error', 422), 'not_used'],
    ['an unbalanced transaction', refusal('unbalanced_transaction', 422), 'not_used'],
    ['already reversed', refusal('already_reversed', 409), 'not_used'],
    ['busy (503)', new ApiError('busy', 'x', { status: 503 }), 'not_used'],
    ['the key reused', refusal('idempotency_key_reuse', 422), 'reused'],
    ['no answer', new ApiError('network', 'x'), 'unknown'],
    [
      'a gateway failure',
      new ApiError('network', 'x', {
        status: 504,
        problem: makeConsoleProblem('upstream_unavailable', 504),
      }),
      'unknown',
    ],
    ['an answer not understood', new ApiError('unexpected', 'x'), 'unknown'],
    ['a bug', new TypeError('x'), undefined],
    ['nothing', undefined, undefined],
  ])('%s', (_name, error, expected) => {
    expect(keyStatus(error)).toBe(expected);
  });
});

describe('KeyNotice', () => {
  it('says the key was not used up after a refusal, and that it may be reused', async () => {
    const { container } = render(<KeyNotice error={refusal('insufficient_funds', 422)} />);
    expect(screen.getByText('The key was not used up')).toBeInTheDocument();
    expect(
      screen.getByText(/recorded nothing, so the same key may be used again/),
    ).toBeInTheDocument();
    await expectNoAccessibilityViolations(container);
  });

  it('says that nothing is known after a failure to get an answer, and to keep the key', () => {
    render(<KeyNotice error={new ApiError('network', 'x')} />);
    expect(screen.getByText('It is not known whether ledgerd recorded this')).toBeInTheDocument();
    expect(screen.getByText(/Send it again with the same key/)).toBeInTheDocument();
    expect(screen.getByText(/Do not take a new key/)).toBeInTheDocument();
  });

  it('says the key belongs to another request, and offers a new key', async () => {
    const onNewKey = vi.fn();
    render(<KeyNotice error={refusal('idempotency_key_reuse', 422)} onNewKey={onNewKey} />);
    expect(screen.getByText('This key is already used by a different request')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Use a new key' }));
    expect(onNewKey).toHaveBeenCalledTimes(1);
  });

  it('offers no new key where it would not help', () => {
    render(<KeyNotice error={refusal('insufficient_funds', 422)} onNewKey={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Use a new key' })).not.toBeInTheDocument();
  });

  it('shows nothing for an error that has nothing to do with keys', () => {
    const { container } = render(<KeyNotice error={new TypeError('x')} />);
    expect(container).toBeEmptyDOMElement();
  });
});
