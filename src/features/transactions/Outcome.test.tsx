import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../../test/axe';
import { Outcome } from './IdempotencyPanel';
import type { RepeatOutcome } from './repeat';

const accounts = [{ id: 'a1', code: 'bank', currency: 'USD' }];
const outcome = (overrides: Partial<RepeatOutcome>): RepeatOutcome => ({
  replayed: true,
  status: 201,
  transactionId: '40000000-0000-4000-8000-000000000001',
  requestId: undefined,
  changes: [{ accountId: 'a1', currency: 'USD', before: 10000n, after: 10000n }],
  ...overrides,
});
const show = (o: RepeatOutcome) =>
  render(
    <MemoryRouter>
      <Outcome n={1} outcome={o} accounts={accounts} />
    </MemoryRouter>,
  );

describe('Outcome', () => {
  it('a replay with unchanged balances says so, and has no accessibility violations', async () => {
    const { container } = show(outcome({}));
    expect(screen.getByText(/This was a replay/)).toBeInTheDocument();
    expect(screen.getByText('No, unchanged')).toBeInTheDocument();
    expect(screen.queryByText(/A balance did change/)).not.toBeInTheDocument();
    await expectNoAccessibilityViolations(container);
  });

  it('does not let a replay take the blame for a balance that moved for another reason', () => {
    show(
      outcome({ changes: [{ accountId: 'a1', currency: 'USD', before: 10000n, after: 10500n }] }),
    );
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(
      screen.getByText(/A balance did change, but not because of this repeat/),
    ).toBeInTheDocument();
  });

  it('a request that was not a replay is flagged, not hidden', () => {
    show(
      outcome({
        replayed: false,
        changes: [{ accountId: 'a1', currency: 'USD', before: 10000n, after: 20000n }],
      }),
    );
    expect(screen.getByText(/This was not a replay/)).toBeInTheDocument();
    expect(screen.getByText(/Repeat 1: HTTP 201 without Idempotent-Replayed/)).toBeInTheDocument();
    expect(screen.queryByText(/A balance did change/)).not.toBeInTheDocument(); // it is the repeat that moved it
  });

  it('shows an account it has no code for by its id', () => {
    show(
      outcome({
        changes: [{ accountId: '12345678-aaaa', currency: 'USD', before: 1n, after: 1n }],
      }),
    );
    expect(screen.getByRole('link', { name: '12345678' })).toBeInTheDocument();
  });
});
