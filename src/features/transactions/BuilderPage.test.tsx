import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { mockAccountsApi, validationRefusal } from '../../test/accountsApi';
import { expectNoAccessibilityViolations } from '../../test/axe';
import { makeAccount, makeProblem } from '../../test/factories';
import { mockReadiness } from '../../test/readiness';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { mockTransactionsApi } from '../../test/transactionsApi';
import { DEFAULT_SETTINGS } from '../settings/store';

const CASH = makeAccount({
  id: '10000000-0000-4000-8000-000000000001',
  code: 'cash',
  currency: 'USD',
});
const WALLET = makeAccount({
  id: '10000000-0000-4000-8000-000000000002',
  code: 'wallet',
  currency: 'USD',
});
const BANK = makeAccount({
  id: '10000000-0000-4000-8000-000000000003',
  code: 'bank',
  currency: 'EUR',
});
const YEN = makeAccount({
  id: '10000000-0000-4000-8000-000000000004',
  code: 'yen',
  currency: 'JPY',
});

beforeEach(() => {
  mockReadiness('ready');
});

type User = ReturnType<typeof userEvent.setup>;

async function open(accounts = [CASH, WALLET, BANK, YEN]) {
  const accountsApi = mockAccountsApi(accounts);
  const transactions = mockTransactionsApi();
  const app = renderApp('/transactions/new');
  await screen.findByRole('heading', { level: 1, name: 'New transaction' });
  await waitFor(() => {
    expect(screen.getByLabelText('Account for posting 1')).toHaveTextContent('cash (USD)');
  });
  return { ...app, accountsApi, transactions };
}

const account = (n: number) => screen.getByLabelText(`Account for posting ${String(n)}`);
const direction = (n: number) => screen.getByLabelText(`Direction of posting ${String(n)}`);
const amount = (n: number) => screen.getByLabelText(`Amount of posting ${String(n)}`);

async function post(
  user: User,
  n: number,
  accountName: string,
  dir: 'Debit' | 'Credit',
  text: string,
) {
  await user.selectOptions(account(n), accountName);
  await user.selectOptions(direction(n), dir);
  await user.clear(amount(n));
  await user.type(amount(n), text);
}

/** A balanced 100.00 USD from wallet to cash, entered in rows 1 and 2. */
async function fillDeposit(user: User, text = '100') {
  await post(user, 1, 'cash (USD)', 'Debit', text);
  await post(user, 2, 'wallet (USD)', 'Credit', text);
}

const totals = () => screen.getByRole('region', { name: 'Totals' });

describe('the editor', () => {
  it('starts with a debit and a credit, and no accessibility violations', async () => {
    const { container } = await open();
    expect(direction(1)).toHaveValue('DEBIT');
    expect(direction(2)).toHaveValue('CREDIT');
    expect(screen.queryByLabelText('Account for posting 3')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove posting 1' })).toBeDisabled(); // two is the least
    await expectNoAccessibilityViolations(container);
  });

  it('offers the accounts, loading them all', async () => {
    await open();
    expect(
      within(account(1))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose an account…', 'cash (USD)', 'wallet (USD)', 'bank (EUR)', 'yen (JPY)']);
  });

  it('takes the currency of a posting from its account, and says how many decimals it reads', async () => {
    const user = userEvent.setup();
    await open();
    await user.selectOptions(account(1), 'cash (USD)');
    await user.selectOptions(account(2), 'yen (JPY)');
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('USD');
    expect(rows[1]).toHaveTextContent('2 decimal places');
    expect(rows[2]).toHaveTextContent('JPY');
    expect(rows[2]).toHaveTextContent('0 decimal places');
  });

  it('reads amounts with the scale from the settings', async () => {
    const user = userEvent.setup();
    const { settings } = await open();
    act(() => {
      settings.set({ ...DEFAULT_SETTINGS, scales: { USD: 4 } });
    });
    await post(user, 1, 'cash (USD)', 'Debit', '1.2345');
    expect(totals()).toHaveTextContent('1.2345 USD');
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('4 decimal places');
  });

  it('adds and removes postings, up to 100 and down to 2, keeping the others as they are', async () => {
    const user = userEvent.setup();
    await open();
    await post(user, 1, 'cash (USD)', 'Debit', '5');
    await user.click(screen.getByRole('button', { name: 'Add posting' }));
    expect(account(3)).toBeInTheDocument();
    await post(user, 3, 'bank (EUR)', 'Credit', '7');
    await user.click(screen.getByRole('button', { name: 'Remove posting 2' }));
    expect(screen.queryByLabelText('Account for posting 3')).not.toBeInTheDocument();
    expect(account(1)).toHaveValue(CASH.id);
    expect(amount(1)).toHaveValue('5');
    expect(account(2)).toHaveValue(BANK.id); // the old third posting is now second
    expect(amount(2)).toHaveValue('7');
  });

  it('cannot go past 100 postings, and says so', async () => {
    await open();
    const add = screen.getByRole('button', { name: 'Add posting' });
    // Counted straight from the DOM, and added without typing: with a hundred rows, testing
    // library's label queries and simulated clicks take minutes in jsdom (the page itself does not).
    const rows = (): number => document.querySelectorAll('[data-field$="-account"]').length;
    for (let i = 0; i < 98; i += 1) fireEvent.click(add);
    expect(rows()).toBe(100);
    expect(add).toBeDisabled();
    expect(
      screen.getByText('The most a transaction can have is 100 postings.'),
    ).toBeInTheDocument();
    fireEvent.click(add); // a click on the disabled button does not make a 101st row
    expect(rows()).toBe(100);
  });

  it('"Simple transfer" leaves one debit and one credit of the same amount', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Add posting' }));
    await post(user, 1, 'cash (USD)', 'Debit', '12.50');
    await user.selectOptions(account(2), 'wallet (USD)');
    await user.click(screen.getByRole('button', { name: 'Simple transfer' }));
    expect(screen.queryByLabelText('Account for posting 3')).not.toBeInTheDocument();
    expect(amount(1)).toHaveValue('12.50');
    expect(amount(2)).toHaveValue('12.50');
    expect(direction(1)).toHaveValue('DEBIT');
    expect(direction(2)).toHaveValue('CREDIT');
    expect(account(2)).toHaveValue(WALLET.id);
  });

  it('narrows the lists by code prefix without losing a chosen account', async () => {
    const user = userEvent.setup();
    const { accountsApi } = await open();
    await user.selectOptions(account(1), 'bank (EUR)');
    await user.type(screen.getByLabelText(/^Show accounts whose code starts with/), 'wal');
    await waitFor(() => {
      expect(
        within(account(2))
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Choose an account…', 'wallet (USD)']);
    });
    expect(accountsApi.lists.at(-1)?.searchParams.get('code_prefix')).toBe('wal');
    // bank no longer matches the filter, but posting 1 keeps it.
    expect(account(1)).toHaveValue(BANK.id);
    expect(within(account(1)).getByRole('option', { name: 'bank (EUR)' })).toBeInTheDocument();
  });

  it('does not ask for accounts with a filter ledgerd would refuse', async () => {
    const user = userEvent.setup();
    const { accountsApi } = await open();
    const before = accountsApi.lists.length;
    await user.type(screen.getByLabelText(/^Show accounts whose code starts with/), '-x');
    expect(screen.getByLabelText(/^Show accounts whose code starts with/)).toBeInvalid();
    await new Promise((r) => setTimeout(r, 50));
    expect(accountsApi.lists).toHaveLength(before);
  });

  it('explains when there are no accounts yet, with the way to make them', async () => {
    mockAccountsApi([]);
    mockTransactionsApi();
    renderApp('/transactions/new');
    expect(await screen.findByText(/There are no accounts to use yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create accounts first' })).toHaveAttribute(
      'href',
      '/accounts',
    );
  });

  it('explains when the accounts cannot be loaded, and can try again', async () => {
    const user = userEvent.setup();
    server.use(http.get('*/api/v1/accounts', () => HttpResponse.error()));
    renderApp('/transactions/new');
    expect(await screen.findByText('Cannot reach the ledger')).toBeInTheDocument();
    mockAccountsApi([CASH]);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(within(account(1)).getByRole('option', { name: 'cash (USD)' })).toBeInTheDocument();
    });
  });
});

describe('the totals', () => {
  it('say what is missing until every posting is complete', async () => {
    await open();
    expect(totals()).toHaveTextContent('Choose an account and an amount for every posting');
    expect(within(totals()).queryByRole('table')).not.toBeInTheDocument();
  });

  it('show debits, credits and the difference per currency, and say that it balances', async () => {
    const user = userEvent.setup();
    const { container } = await open();
    await fillDeposit(user);
    expect(totals()).toHaveTextContent('The transaction balances in every currency.');
    const row = within(within(totals()).getByRole('table')).getAllByRole('row')[1];
    expect(row).toHaveTextContent('USD');
    expect(row).toHaveTextContent('100.00 USD'); // debits and credits
    expect(row).toHaveTextContent('0.00 USD'); // difference
    expect(row).toHaveTextContent('Balanced');
    await expectNoAccessibilityViolations(container);
  });

  it('say by how much, and which side is larger, when it does not balance', async () => {
    const user = userEvent.setup();
    await open();
    await fillDeposit(user, '100');
    await user.clear(amount(2));
    await user.type(amount(2), '99.99');
    expect(totals()).toHaveTextContent('The transaction does not balance. ledgerd will refuse it.');
    const row = within(within(totals()).getByRole('table')).getAllByRole('row')[1];
    expect(row).toHaveTextContent('Debits exceed credits');
    expect(row).toHaveTextContent('0.01 USD');
    await user.clear(amount(2));
    await user.type(amount(2), '101');
    expect(within(totals()).getByRole('table')).toHaveTextContent('Credits exceed debits');
    expect(within(totals()).getByRole('table')).toHaveTextContent('minus 1.00 USD');
  });

  it('balance each currency on its own', async () => {
    const user = userEvent.setup();
    await open();
    await post(user, 1, 'cash (USD)', 'Debit', '100');
    await post(user, 2, 'bank (EUR)', 'Credit', '100');
    const rows = within(within(totals()).getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('EUR'),
      expect.stringContaining('USD'),
    ]);
    expect(totals()).toHaveTextContent('does not balance');
  });

  it('announce when the verdict changes, not on every key', async () => {
    const user = userEvent.setup();
    await open();
    await fillDeposit(user);
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('status')
          .some((s) => s.textContent.includes('The transaction now balances')),
      ).toBe(true);
    });
    await user.clear(amount(2));
    await user.type(amount(2), '1');
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('status')
          .some((s) => s.textContent.includes('The transaction does not balance')),
      ).toBe(true);
    });
  });
});

describe('sending', () => {
  it('sends the minor units, the currency of each account and the key, then shows what was posted', async () => {
    const user = userEvent.setup();
    const { transactions, accountsApi } = await open();
    await user.type(screen.getByLabelText(/^Description/), 'Deposit 100.50');
    await fillDeposit(user, '100.50');
    const listsBefore = accountsApi.lists.length;
    await user.click(screen.getByRole('button', { name: 'Send transaction' }));

    const result = await screen.findByRole('region', { name: /Transaction posted/ });
    expect(transactions.posts).toHaveLength(1);
    expect(transactions.posts[0]?.body).toEqual({
      description: 'Deposit 100.50',
      postings: [
        { account_id: CASH.id, direction: 'DEBIT', amount: '10050', currency: 'USD' },
        { account_id: WALLET.id, direction: 'CREDIT', amount: '10050', currency: 'USD' },
      ],
    });
    expect(transactions.posts[0]?.key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    expect(result).toHaveTextContent('“Deposit 100.50”');
    const rows = within(within(result).getByRole('table')).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('cash');
    expect(rows[0]).toHaveTextContent('Debit');
    expect(rows[0]).toHaveTextContent('100.50 USD'); // amount, and the balance after
    expect(
      within(result).getByRole('link', { name: /^40000000-0000-4000-8000-000000000001$/ }),
    ).toHaveAttribute('href', '/transactions/40000000-0000-4000-8000-000000000001');
    expect(within(result).getByRole('link', { name: 'cash' })).toHaveAttribute(
      'href',
      `/accounts/${CASH.id}`,
    );

    // The form is ready for the next one, and the accounts were re-read.
    expect(account(1)).toHaveValue('');
    expect(amount(1)).toHaveValue('');
    await waitFor(() => {
      expect(accountsApi.lists.length).toBeGreaterThan(listsBefore);
    });
  });

  it('uses a new key for the next transaction', async () => {
    const user = userEvent.setup();
    const { transactions } = await open();
    await fillDeposit(user);
    await user.click(screen.getByRole('button', { name: 'Send transaction' }));
    await screen.findByRole('region', { name: /Transaction posted/ });
    await fillDeposit(user, '5');
    await user.click(screen.getByRole('button', { name: 'Send transaction' }));
    await waitFor(() => {
      expect(transactions.posts).toHaveLength(2);
    });
    expect(transactions.posts[0]?.key).not.toBe(transactions.posts[1]?.key);
  });

  it('sends once even if the button is pressed twice, and Enter in a field sends it', async () => {
    const user = userEvent.setup();
    const accountsApi = mockAccountsApi([CASH, WALLET]);
    const transactions = mockTransactionsApi({ delayMs: 100 });
    renderApp('/transactions/new');
    await screen.findByRole('heading', { level: 1, name: 'New transaction' });
    await waitFor(() => {
      expect(account(1)).toHaveTextContent('cash');
    });
    await fillDeposit(user);
    const send = screen.getByRole('button', { name: 'Send transaction' });
    await user.click(send);
    await user.click(send);
    await user.type(amount(1), '{Enter}');
    await screen.findByRole('region', { name: /Transaction posted/ });
    expect(transactions.posts).toHaveLength(1);
    expect(accountsApi.accounts).toHaveLength(2);
  });

  it('checks the form first: every problem at once, a summary with focus, nothing sent', async () => {
    const user = userEvent.setup();
    const { transactions, container } = await open();
    await user.click(screen.getByRole('button', { name: 'Send transaction' }));
    const summary = screen.getByRole('alert');
    expect(summary).toHaveFocus();
    expect(summary).toHaveTextContent('There are 4 problems to fix');
    expect(account(1)).toHaveAccessibleDescription(/Error: Choose an account/);
    expect(amount(2)).toHaveAccessibleDescription(/Error: Enter an amount/);
    expect(transactions.posts).toHaveLength(0);
    await expectNoAccessibilityViolations(container);

    await user.click(within(summary).getByRole('button', { name: 'Posting 2 amount' }));
    expect(amount(2)).toHaveFocus();
  });

  it('takes an error away when the field is edited', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Send transaction' }));
    await user.selectOptions(account(1), 'cash (USD)');
    expect(account(1)).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('alert')).toHaveTextContent('There are 2 problems to fix'); // posting 2: account, amount
  });

  it('refuses a description over 500 characters', async () => {
    const user = userEvent.setup();
    const { transactions } = await open();
    await fillDeposit(user);
    await user.click(screen.getByLabelText(/^Description/));
    await user.paste('x'.repeat(501));
    await user.click(screen.getByRole('button', { name: 'Send transaction' }));
    expect(screen.getByLabelText(/^Description/)).toHaveAccessibleDescription(
      /Error: Use at most 500 characters/,
    );
    expect(transactions.posts).toHaveLength(0);
  });

  describe('an unbalanced transaction', () => {
    async function unbalanced(user: User) {
      await fillDeposit(user, '100');
      await user.clear(amount(2));
      await user.type(amount(2), '90');
      await user.click(screen.getByRole('button', { name: 'Send transaction' }));
    }

    it('warns first, and nothing is sent if the person cancels', async () => {
      const user = userEvent.setup();
      const { transactions } = await open();
      await unbalanced(user);
      const dialog = await screen.findByRole('dialog', {
        name: 'This transaction does not balance',
      });
      expect(dialog).toHaveTextContent('ledgerd will refuse it');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(transactions.posts).toHaveLength(0);
      expect(amount(2)).toHaveValue('90'); // the form is as it was
    });

    it('can be sent anyway, to see the refusal: code, title, detail and request id, with the form kept', async () => {
      const user = userEvent.setup();
      const { transactions } = await open();
      await unbalanced(user);
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send anyway' }),
      );

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Transaction is not balanced');
      expect(alert).toHaveTextContent('debits and credits differ in USD by 1000');
      expect(alert).toHaveTextContent('unbalanced_transaction');
      expect(within(alert).getByRole('button', { name: 'Copy request id' })).toBeInTheDocument();
      expect(transactions.posts).toHaveLength(1);
      expect(amount(1)).toHaveValue('100');
      expect(amount(2)).toHaveValue('90');
    });

    it('keeps the same key when it is sent again after a refusal', async () => {
      const user = userEvent.setup();
      const { transactions } = await open();
      await unbalanced(user);
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send anyway' }),
      );
      await screen.findByText('Transaction is not balanced');
      await user.clear(amount(2));
      await user.type(amount(2), '100');
      await user.click(screen.getByRole('button', { name: 'Send transaction' }));
      await screen.findByRole('region', { name: /Transaction posted/ });
      expect(transactions.posts).toHaveLength(2);
      expect(transactions.posts[1]?.key).toBe(transactions.posts[0]?.key);
    });
  });

  describe('when ledgerd refuses', () => {
    it('puts each field error on the posting row it refers to, and keeps the form', async () => {
      const user = userEvent.setup();
      const { transactions, container } = await open();
      transactions.rejectNext(
        validationRefusal([
          { field: 'postings[1].amount', message: 'is required and must be between 1 and 10^30' },
          { field: 'postings[0].account_id', message: 'does not exist' },
        ]),
      );
      await fillDeposit(user);
      await user.click(screen.getByRole('button', { name: 'Send transaction' }));

      await waitFor(() => {
        expect(amount(2)).toHaveAccessibleDescription(
          /Error: is required and must be between 1 and 10\^30/,
        );
      });
      expect(account(1)).toHaveAccessibleDescription(/Error: does not exist/);
      expect(screen.getAllByRole('alert')[0]).toHaveFocus();
      expect(amount(1)).toHaveValue('100'); // kept
      expect(account(2)).toHaveValue(WALLET.id);
      await expectNoAccessibilityViolations(container);
    });

    it('explains a refusal that is not about a field, such as insufficient funds', async () => {
      const user = userEvent.setup();
      const { transactions } = await open();
      transactions.rejectNext(
        HttpResponse.json(
          makeProblem({
            type: 'urn:ledgerd:error:insufficient_funds',
            title: 'Insufficient funds',
            status: 422,
            code: 'insufficient_funds',
            detail: 'account wallet would go below zero',
            request_id: 'req-funds-0001',
          }),
          { status: 422, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      );
      await fillDeposit(user);
      await user.click(screen.getByRole('button', { name: 'Send transaction' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Insufficient funds');
      expect(alert).toHaveTextContent('account wallet would go below zero');
      expect(alert).toHaveTextContent('insufficient_funds');
      expect(amount(1)).toHaveValue('100');
    });

    it('keeps the key when the answer never arrived: whether it was recorded is unknown, so a retry must repeat it', async () => {
      const user = userEvent.setup();
      const { transactions } = await open();
      transactions.rejectNext(HttpResponse.error());
      await fillDeposit(user);
      await user.click(screen.getByRole('button', { name: 'Send transaction' }));
      await screen.findByText('Cannot reach the ledger');
      await user.click(screen.getByRole('button', { name: 'Send transaction' }));
      await screen.findByRole('region', { name: /Transaction posted/ });
      expect(transactions.posts).toHaveLength(2);
      expect(transactions.posts[1]?.key).toBe(transactions.posts[0]?.key);
      expect(transactions.posts[1]?.body).toEqual(transactions.posts[0]?.body);
    });

    it('explains a failure to reach ledgerd, and keeps the form', async () => {
      const user = userEvent.setup();
      const { transactions } = await open();
      transactions.rejectNext(HttpResponse.error());
      await fillDeposit(user);
      await user.click(screen.getByRole('button', { name: 'Send transaction' }));
      expect(await screen.findByText('Cannot reach the ledger')).toBeInTheDocument();
      expect(amount(1)).toHaveValue('100');
      expect(screen.queryByRole('region', { name: /Transaction posted/ })).not.toBeInTheDocument();
    });
  });

  it('lets the person dismiss the result', async () => {
    const user = userEvent.setup();
    await open();
    await fillDeposit(user);
    await user.click(screen.getByRole('button', { name: 'Send transaction' }));
    await screen.findByRole('region', { name: /Transaction posted/ });
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: /Transaction posted/ })).not.toBeInTheDocument();
  });
});
