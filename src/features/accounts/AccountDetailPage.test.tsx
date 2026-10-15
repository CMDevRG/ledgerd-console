import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockAccountDetail, posting } from '../../test/accountDetailApi';
import { expectNoAccessibilityViolations } from '../../test/axe';
import { ID_A, makeAccount, makeProblem } from '../../test/factories';
import { mockReadiness } from '../../test/readiness';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { ACCOUNT_POLL_MS, refreshAfterTransaction } from './detailHooks';

beforeEach(() => {
  mockReadiness('ready');
});
afterEach(() => {
  vi.useRealTimers();
});

const account = makeAccount({
  id: ID_A,
  code: 'user:42.wallet',
  currency: 'USD',
  type: 'LIABILITY',
  normal_balance: 'CREDIT',
  allow_negative: false,
  balance: '12345',
  last_posting_at: '2026-10-13T15:03:00.000000Z',
  created_at: '2026-10-13T14:00:00.000000Z',
});

const history = [
  posting(3, { balance_after: '12345', amount: '2345', direction: 'CREDIT' }),
  posting(2, { balance_after: '10000', amount: '5000', direction: 'DEBIT' }),
  posting(1, { balance_after: '15000', amount: '15000', direction: 'CREDIT' }),
];

/** Opens the page and, unless told the account will not load, waits until it has. */
async function open(path = `/accounts/${ID_A}`, { loads = true } = {}) {
  const app = renderApp(path);
  await screen.findByRole('heading', { level: 1, name: /^Account/ });
  if (loads) await screen.findByRole('region', { name: 'Balance now' });
  return app;
}

describe('the account summary', () => {
  it('shows the attributes and the current balance, and has no accessibility violations', async () => {
    mockAccountDetail(account, history);
    const { container } = await open();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Account user:42.wallet' }),
    ).toBeInTheDocument();
    expect(document.title).toBe('Account user:42.wallet · ledgerd console');

    const summary = screen.getByRole('region', { name: 'Balance now' });
    expect(summary).toHaveTextContent('123.45 USD');
    const terms = (name: string): string => {
      const term = within(summary).getByText(name, { selector: 'dt' });
      return term.nextElementSibling?.textContent ?? '';
    };
    expect(terms('Code')).toBe('user:42.wallet');
    expect(terms('Currency')).toBe('USD');
    expect(terms('Type')).toBe('Liability');
    expect(terms('Normal balance')).toBe('Credit');
    expect(terms('May go negative')).toBe('No');
    expect(terms('Created')).toContain('2026-10-13 14:00:00');
    expect(terms('Last posting')).toContain('2026-10-13 15:03:00');
    expect(within(summary).getByRole('button', { name: 'Copy account id' })).toBeInTheDocument();
    await expectNoAccessibilityViolations(container);
  });

  it('says "None yet" for an account with no postings', async () => {
    mockAccountDetail({ ...account, balance: '0', last_posting_at: null }, []);
    await open();
    await screen.findByText('None yet');
  });

  it('has a way back to the list', async () => {
    mockAccountDetail(account, history);
    await open();
    expect(screen.getByRole('link', { name: '← All accounts' })).toHaveAttribute(
      'href',
      '/accounts',
    );
  });

  it('refreshes the balance every 10 seconds without a reload (R4.1)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = mockAccountDetail(account, history);
    await open();
    expect(api.accountRequests).toBe(1);

    api.record(posting(4, { balance_after: '20000', amount: '7655', direction: 'CREDIT' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS + 500);
    });
    expect(await screen.findByRole('region', { name: 'Balance now' })).toHaveTextContent(
      '200.00 USD',
    );
    expect(api.accountRequests).toBe(2);
  });

  it('says so when there is no such account, with a way back, and no technical noise', async () => {
    mockAccountDetail(account, history);
    const { container } = await open('/accounts/00000000-0000-4000-8000-0000000000ff', {
      loads: false,
    });
    expect(await screen.findByText('Account not found')).toBeInTheDocument();
    expect(screen.getByText(/There is no account with this id/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'list of accounts' })).toHaveAttribute(
      'href',
      '/accounts',
    );
    await expectNoAccessibilityViolations(container);
  });

  it('does not ask ledgerd about an id that is not an id', async () => {
    const api = mockAccountDetail(account, history);
    await open('/accounts/not-an-id', { loads: false });
    expect(await screen.findByText(/This is not a valid account id/)).toBeInTheDocument();
    expect(api.accountRequests).toBe(0);
  });

  it('explains a failure to load, with a retry, not an empty page', async () => {
    const user = userEvent.setup();
    server.use(http.get('*/api/v1/accounts/:id', () => HttpResponse.error()));
    await open(`/accounts/${ID_A}`, { loads: false });
    expect(await screen.findByText('Cannot reach the ledger')).toBeInTheDocument();
    mockAccountDetail(account, history);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Account user:42.wallet' }),
    ).toBeInTheDocument();
  });
});

describe('the history', () => {
  it('lists postings newest first with transaction link, direction, amount, balance after and time', async () => {
    mockAccountDetail(account, history);
    const { container } = await open();
    const table = await screen.findByRole('table', { name: 'Postings, newest first' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const [first] = rows;
    if (first === undefined) throw new Error('no rows');
    expect(first).toHaveTextContent('2026-10-13 15:03:00');
    expect(first).toHaveTextContent('Credit');
    expect(first).toHaveTextContent('23.45 USD');
    expect(first).toHaveTextContent('123.45 USD');
    expect(
      within(first).getByRole('link', {
        name: /Transaction 20000000-0000-4000-8000-000000000003/,
      }),
    ).toHaveAttribute('href', '/transactions/20000000-0000-4000-8000-000000000003');
    expect(rows[1]).toHaveTextContent('Debit');
    expect(rows.map((r) => /15:0(\d)/.exec(r.textContent)?.[1])).toEqual(['3', '2', '1']);
    await expectNoAccessibilityViolations(container);
  });

  it('says "No postings yet" instead of showing an empty table (R4.5)', async () => {
    mockAccountDetail({ ...account, balance: '0', last_posting_at: null }, []);
    await open();
    expect(await screen.findByText('No postings yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('loads further pages with the cursor, appending to the ones shown (R4.2)', async () => {
    const user = userEvent.setup();
    const many = [5, 4, 3, 2, 1].map((id) => posting(id, { balance_after: String(id * 100) }));
    const api = mockAccountDetail(
      { ...account, balance: '500', last_posting_at: many[0]?.recorded_at ?? null },
      many,
      { pageSize: 2 },
    );
    await open();
    await screen.findByRole('table');
    expect(screen.getByText('2 postings loaded, more available')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more postings' }));
    await waitFor(() => {
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5);
    });
    expect(api.postingRequests[1]?.searchParams.get('cursor')).toBe('p4');
    await user.click(screen.getByRole('button', { name: 'Load more postings' }));
    await waitFor(() => {
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(6);
    });
    expect(screen.getByText('All 5 postings loaded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more postings' })).not.toBeInTheDocument();
    const ids = within(screen.getByRole('table'))
      .getAllByRole('link')
      .map((l) => l.textContent);
    expect(new Set(ids).size).toBe(5); // none repeated
  });

  describe('intermediate postings (R4.6)', () => {
    const sharedTx = '30000000-0000-4000-8000-000000000001';
    const multi = [
      posting(4, {
        transaction_id: sharedTx,
        balance_after: '300',
        amount: '200',
        direction: 'CREDIT',
      }),
      posting(3, {
        transaction_id: sharedTx,
        balance_after: '100',
        amount: '50',
        direction: 'DEBIT',
      }),
      posting(2, { balance_after: '150', amount: '150', direction: 'CREDIT' }),
    ];

    it('marks the earlier postings of a transaction that touches the account twice, and explains', async () => {
      mockAccountDetail({ ...account, balance: '300' }, multi);
      const { container } = await open();
      const table = await screen.findByRole('table');
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows[0]).not.toHaveTextContent('Intermediate'); // the last one: committed
      expect(rows[1]).toHaveTextContent('Intermediate');
      expect(rows[2]).not.toHaveTextContent('Intermediate');
      expect(screen.getByText(/never a state anyone could see/)).toBeInTheDocument();
      await expectNoAccessibilityViolations(container);
    });

    it('says nothing about it when there is none', async () => {
      mockAccountDetail(account, history);
      await open();
      await screen.findByRole('table');
      expect(screen.queryByText('Intermediate')).not.toBeInTheDocument();
      expect(screen.queryByText(/never a state anyone could see/)).not.toBeInTheDocument();
    });
  });

  it('follows a posting made by someone else: the page does not keep a history its balance contradicts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const five = [5, 4, 3, 2, 1].map((id) => posting(id, { balance_after: String(id * 100) }));
    const api = mockAccountDetail(
      { ...account, balance: '500', last_posting_at: five[0]?.recorded_at ?? null },
      five,
      { pageSize: 2 },
    );
    await open();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Load more postings' })); // two pages: 5,4 | 3,2
    await waitFor(() => {
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5);
    });

    api.record(posting(6, { balance_after: '600' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACCOUNT_POLL_MS + 500);
    });
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Balance now' })).toHaveTextContent('6.00 USD');
    });

    // Two pages again, read from the top: 6,5 | 4,3. Nothing skipped, nothing repeated.
    await waitFor(() => {
      const links = within(screen.getByRole('table'))
        .getAllByRole('link')
        .map((l) => l.textContent.slice(-3));
      expect(links).toEqual(['006', '005', '004', '003']);
    });
    await user.click(screen.getByRole('button', { name: 'Load more postings' }));
    await waitFor(() => {
      const links = within(screen.getByRole('table'))
        .getAllByRole('link')
        .map((l) => l.textContent.slice(-3));
      expect(links).toEqual(['006', '005', '004', '003', '002', '001']);
    });
  });

  it('refreshAfterTransaction brings the balance and the history up to date at once', async () => {
    const api = mockAccountDetail(account, history);
    const { client } = await open();
    await screen.findByRole('table');
    api.record(posting(4, { balance_after: '99999', amount: '87654', direction: 'CREDIT' }));
    await act(async () => {
      await refreshAfterTransaction(client, [ID_A]);
    });
    expect(await screen.findByRole('region', { name: 'Balance now' })).toHaveTextContent(
      '999.99 USD',
    );
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5);
  });

  it('explains a failure to load the history, and keeps the rest of the page', async () => {
    mockAccountDetail(account, history);
    server.use(http.get('*/api/v1/accounts/:id/postings', () => HttpResponse.error()));
    await open();
    expect(await screen.findByText('Cannot reach the ledger')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Balance now' })).toHaveTextContent('123.45 USD');
  });
});

/** The box with the answer for the moment asked (found by its label). */
async function answerPanel(): Promise<HTMLElement> {
  const label = await screen.findByText(/Balance as of/);
  const panel = label.parentElement;
  if (panel === null) throw new Error('the answer has no panel');
  return panel;
}

describe('the balance at a past moment (R4.3)', () => {
  const typeMoment = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    const input = screen.getByLabelText(/^As of/);
    await user.clear(input);
    await user.type(input, text);
    await user.click(screen.getByRole('button', { name: 'Show balance' }));
  };

  it('asks for the moment in UTC RFC 3339, puts it in the address, and labels the answer', async () => {
    const api = mockAccountDetail(account, history);
    const user = userEvent.setup();
    const { router, container } = await open();
    await typeMoment(user, '2026-10-13 15:02:30');

    const answer = await screen.findByText(/Balance as of/);
    const panel = answer.parentElement;
    if (panel === null) throw new Error('no panel');
    expect(panel).toHaveTextContent('Balance as of 2026-10-13 15:02:30 UTC');
    expect(panel).toHaveTextContent('100.00 USD'); // after posting 2
    expect(panel).toHaveTextContent('recorded at 2026-10-13 15:02:00');
    expect(router.state.location.search).toBe('?as_of=2026-10-13T15%3A02%3A30Z');
    expect(api.balanceRequests.at(-1)?.searchParams.get('as_of')).toBe('2026-10-13T15:02:30Z');
    expect(screen.getByLabelText(/^As of/)).toHaveValue('2026-10-13T15:02:30Z'); // shows how it was understood
    await expectNoAccessibilityViolations(container);
  });

  it('converts another zone to UTC', async () => {
    const api = mockAccountDetail(account, history);
    const user = userEvent.setup();
    await open();
    await typeMoment(user, '2026-10-13 17:02:30+02:00');
    await screen.findByText(/Balance as of/);
    expect(api.balanceRequests.at(-1)?.searchParams.get('as_of')).toBe('2026-10-13T15:02:30Z');
  });

  it('opens with the moment in the address, field filled in', async () => {
    const api = mockAccountDetail(account, history);
    await open(`/accounts/${ID_A}?as_of=2026-10-13T15%3A01%3A30Z`);
    expect(await answerPanel()).toHaveTextContent('150.00 USD');
    expect(screen.getByLabelText(/^As of/)).toHaveValue('2026-10-13T15:01:30Z');
    expect(api.balanceRequests).toHaveLength(1);
  });

  it('says the balance was zero before the first posting', async () => {
    mockAccountDetail(account, history);
    const user = userEvent.setup();
    await open();
    await typeMoment(user, '2026-10-13 14:00');
    const panel = await answerPanel();
    expect(panel).toHaveTextContent(
      'There was no posting at or before that moment, so the balance was zero',
    );
    expect(panel).toHaveTextContent('0.00 USD');
  });

  it('says so when the moment is in the future and the answer is the current balance', async () => {
    mockAccountDetail(account, history);
    const user = userEvent.setup();
    await open();
    await typeMoment(user, '2026-12-01 10:00');
    const panel = await answerPanel();
    expect(panel).toHaveTextContent('in the future, so this is the current balance');
    expect(panel).toHaveTextContent('123.45 USD');
  });

  it('goes back to the current balance', async () => {
    mockAccountDetail(account, history);
    const user = userEvent.setup();
    const { router } = await open();
    expect(screen.getByRole('button', { name: 'Back to current balance' })).toBeDisabled();
    await typeMoment(user, '2026-10-13 15:02:30');
    await screen.findByText(/Balance as of/);
    await user.click(screen.getByRole('button', { name: 'Back to current balance' }));
    await waitFor(() => {
      expect(screen.queryByText(/Balance as of/)).not.toBeInTheDocument();
    });
    expect(router.state.location.search).toBe('');
    expect(screen.getByLabelText(/^As of/)).toHaveValue('');
  });

  it('follows the back button', async () => {
    mockAccountDetail(account, history);
    const user = userEvent.setup();
    const { router } = await open();
    await typeMoment(user, '2026-10-13 15:02:30');
    await screen.findByText(/Balance as of/);
    await router.navigate(-1);
    await waitFor(() => {
      expect(screen.queryByText(/Balance as of/)).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText(/^As of/)).toHaveValue('');
  });

  it.each(['', 'yesterday', '2026-02-30 10:00', '2026-10-13'])(
    'refuses %j with the rule, asks ledgerd nothing, and keeps focus in the field',
    async (text) => {
      const api = mockAccountDetail(account, history);
      const user = userEvent.setup();
      const { container } = await open();
      const input = screen.getByLabelText(/^As of/);
      await user.clear(input);
      if (text !== '') await user.type(input, text);
      await user.click(screen.getByRole('button', { name: 'Show balance' }));
      expect(input).toHaveAccessibleDescription(
        /Error: Use a date and time such as 2026-10-01 10:00/,
      );
      expect(input).toBeInvalid();
      expect(input).toHaveFocus();
      expect(api.balanceRequests).toHaveLength(0);
      await expectNoAccessibilityViolations(container);
    },
  );

  it('shows the error in place of an earlier answer, not beside a stale one', async () => {
    mockAccountDetail(account, history);
    const user = userEvent.setup();
    await open();
    await typeMoment(user, '2026-10-13 15:02:30');
    await screen.findByText(/Balance as of/);
    await typeMoment(user, 'not a moment');
    expect(screen.queryByText(/Balance as of/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^As of/)).toBeInvalid();
  });

  it("shows the server's field error for the moment instead of an answer", async () => {
    mockAccountDetail(account, history);
    server.use(
      http.get('*/api/v1/accounts/:id/balance', () =>
        HttpResponse.json(
          makeProblem({ errors: [{ field: 'as_of', message: 'must be before the year 3000' }] }),
          {
            status: 422,
            headers: { 'Content-Type': 'application/problem+json' },
          },
        ),
      ),
    );
    const user = userEvent.setup();
    await open();
    await typeMoment(user, '2999-01-01 00:00');
    await waitFor(() => {
      expect(screen.getByLabelText(/^As of/)).toHaveAccessibleDescription(
        /Error: must be before the year 3000/,
      );
    });
    expect(screen.queryByText(/Balance as of/)).not.toBeInTheDocument();
  });

  it('explains a failure that is not about the moment, and can retry', async () => {
    mockAccountDetail(account, history);
    server.use(http.get('*/api/v1/accounts/:id/balance', () => HttpResponse.error()));
    const user = userEvent.setup();
    await open();
    await typeMoment(user, '2026-10-13 15:02:30');
    expect(await screen.findAllByText('Cannot reach the ledger')).not.toHaveLength(0);
    expect(screen.getByLabelText(/^As of/)).not.toHaveAttribute('aria-invalid');
  });

  it('is operated with the keyboard: Enter in the field shows the balance', async () => {
    const api = mockAccountDetail(account, history);
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByLabelText(/^As of/));
    await user.keyboard('2026-10-13 15:02:30{Enter}');
    await screen.findByText(/Balance as of/);
    expect(api.balanceRequests).toHaveLength(1);
  });
});
