import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../../test/axe';
import { makeAccount, makeProblem } from '../../test/factories';
import { mockAccountsApi, validationRefusal } from '../../test/accountsApi';
import { mockReadiness } from '../../test/readiness';
import { renderApp } from '../../test/render';

beforeEach(() => {
  mockReadiness('ready');
});

const account = (n: number, overrides = {}) =>
  makeAccount({
    id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    code: `acct-${String(n).padStart(2, '0')}`,
    ...overrides,
  });

async function open(path = '/accounts') {
  const app = renderApp(path);
  await screen.findByRole('heading', { level: 1, name: 'Accounts' });
  return app;
}

describe('the account list', () => {
  it('shows each account with what it is and its balance, and has no accessibility violations', async () => {
    mockAccountsApi([
      account(1, {
        code: 'user:1.wallet',
        currency: 'USD',
        type: 'LIABILITY',
        normal_balance: 'CREDIT',
        allow_negative: false,
        balance: '123456',
      }),
      account(2, {
        code: 'bank',
        currency: 'EUR',
        type: 'ASSET',
        normal_balance: 'DEBIT',
        allow_negative: true,
        balance: '-250',
      }),
    ]);
    const { container } = await open();
    const table = await screen.findByRole('table', { name: 'Accounts, newest first' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + 2
    const row = (index: number): HTMLElement => {
      const found = rows[index];
      if (found === undefined) throw new Error(`no row ${String(index)}`);
      return found;
    };

    const first = within(row(1));
    expect(first.getByRole('link', { name: 'user:1.wallet' })).toHaveAttribute(
      'href',
      '/accounts/10000000-0000-4000-8000-000000000001',
    );
    expect(row(1)).toHaveTextContent('USD');
    expect(row(1)).toHaveTextContent('Liability');
    expect(row(1)).toHaveTextContent('Credit');
    expect(row(1)).toHaveTextContent('No');
    expect(row(1)).toHaveTextContent('1,234.56 USD');

    expect(row(2)).toHaveTextContent('Asset');
    expect(row(2)).toHaveTextContent('Debit');
    expect(row(2)).toHaveTextContent('Yes');
    expect(row(2)).toHaveTextContent('minus 2.50 EUR'); // a negative balance is a word, not a colour
    await expectNoAccessibilityViolations(container);
  });

  it('asks for the first page without filters', async () => {
    const api = mockAccountsApi([account(1)]);
    await open();
    await screen.findByRole('table');
    expect(api.lists).toHaveLength(1);
    expect(api.lists[0]?.searchParams.get('limit')).toBe('50');
    expect(api.lists[0]?.searchParams.has('code_prefix')).toBe(false);
    expect(api.lists[0]?.searchParams.has('currency')).toBe(false);
  });

  it('with no accounts, explains what an account is and offers to create one', async () => {
    mockAccountsApi([]);
    const user = userEvent.setup();
    const { container } = await open();
    expect(await screen.findByText('There are no accounts yet')).toBeInTheDocument();
    expect(screen.getByText(/named place where money of one currency is kept/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await expectNoAccessibilityViolations(container);

    await user.click(screen.getByRole('button', { name: 'Create the first account' }));
    expect(screen.getByLabelText(/^Code \(required\)/)).toHaveFocus();
  });

  it('loads further pages on request, keeping the ones already shown', async () => {
    const api = mockAccountsApi([account(1), account(2), account(3), account(4), account(5)], {
      pageSize: 2,
    });
    const user = userEvent.setup();
    await open();
    await screen.findByRole('table');
    expect(screen.getAllByRole('link', { name: /acct-/ })).toHaveLength(2);
    expect(screen.getByText('2 accounts loaded, more available')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more accounts' }));
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /acct-/ })).toHaveLength(4);
    });
    expect(api.lists[1]?.searchParams.get('cursor')).toBe('c2'); // the cursor from the first page
    expect(screen.getAllByRole('link', { name: /acct-/ }).map((l) => l.textContent)).toEqual([
      'acct-01',
      'acct-02',
      'acct-03',
      'acct-04',
    ]);
    expect(
      screen
        .getAllByRole('status')
        .some((s) => s.textContent.includes('2 more accounts loaded, 4 in all')),
    ).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Load more accounts' }));
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /acct-/ })).toHaveLength(5);
    });
    expect(screen.getByText('All 5 accounts loaded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more accounts' })).not.toBeInTheDocument();
  });

  it('says "All 1 account loaded" in the singular', async () => {
    mockAccountsApi([account(1)]);
    await open();
    expect(await screen.findByText('All 1 account loaded')).toBeInTheDocument();
  });

  it('shows an explanation and a retry when the list cannot be loaded, not an empty list', async () => {
    const api = mockAccountsApi([account(1)]);
    const user = userEvent.setup();
    const { server } = await import('../../test/server');
    const { http } = await import('msw');
    server.use(http.get('*/api/v1/accounts', () => HttpResponse.error()));
    await open();
    expect(await screen.findByText('Cannot reach the ledger')).toBeInTheDocument();
    expect(screen.queryByText('There are no accounts yet')).not.toBeInTheDocument();

    mockAccountsApi([account(1)]);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'acct-01' })).toBeInTheDocument();
    expect(api.accounts).toHaveLength(1);
  });
});

describe('filters', () => {
  const many = [
    account(1, { code: 'assets:cash', currency: 'USD' }),
    account(2, { code: 'assets:bank', currency: 'EUR' }),
    account(3, { code: 'user:1', currency: 'USD' }),
  ];

  it('filter by code prefix and currency, in the address, using the server', async () => {
    const api = mockAccountsApi(many);
    const user = userEvent.setup();
    const { router } = await open();
    await screen.findByRole('table');

    await user.type(screen.getByRole('textbox', { name: 'Code starts with' }), 'assets');
    await user.type(screen.getByRole('textbox', { name: 'Currency' }), 'usd');
    await user.click(screen.getByRole('button', { name: 'Filter' }));

    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: /assets|user/ })).toHaveLength(1);
    });
    expect(screen.getByRole('link', { name: 'assets:cash' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?code=assets&currency=USD');
    const last = api.lists.at(-1);
    expect(last?.searchParams.get('code_prefix')).toBe('assets');
    expect(last?.searchParams.get('currency')).toBe('USD');
  });

  it('starts from the filters in the address, with the fields filled in', async () => {
    const api = mockAccountsApi(many);
    await open('/accounts?code=assets&currency=EUR');
    expect(await screen.findByRole('link', { name: 'assets:bank' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'assets:cash' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Code starts with' })).toHaveValue('assets');
    expect(screen.getByRole('textbox', { name: 'Currency' })).toHaveValue('EUR');
    expect(api.lists[0]?.searchParams.get('currency')).toBe('EUR');
  });

  it('follows the back button', async () => {
    mockAccountsApi(many);
    const user = userEvent.setup();
    const { router } = await open();
    await screen.findByRole('table');
    await user.type(screen.getByRole('textbox', { name: 'Currency' }), 'EUR');
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'user:1' })).not.toBeInTheDocument();
    });

    await router.navigate(-1);
    expect(await screen.findByRole('link', { name: 'user:1' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Currency' })).toHaveValue('');
  });

  it('clears the filters', async () => {
    mockAccountsApi(many);
    const user = userEvent.setup();
    const { router } = await open('/accounts?currency=EUR');
    await screen.findByRole('link', { name: 'assets:bank' });
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findByRole('link', { name: 'user:1' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
  });

  it('says so when nothing matches, and offers to clear the filters', async () => {
    mockAccountsApi(many);
    const user = userEvent.setup();
    await open('/accounts?code=nothing');
    expect(await screen.findByText('No account matches these filters')).toBeInTheDocument();
    expect(screen.queryByText('There are no accounts yet')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear the filters' }));
    expect(await screen.findByRole('link', { name: 'user:1' })).toBeInTheDocument();
  });

  it('does not ask ledgerd with a filter it would refuse, and says what is wrong', async () => {
    const api = mockAccountsApi(many);
    const { container } = await open('/accounts?currency=usd&code=has%20space');
    expect(
      await screen.findByText('Fix the filters above to see the accounts.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Currency' })).toHaveAccessibleDescription(
      /Error: Use 2 to 10 capital letters/,
    );
    expect(screen.getByRole('textbox', { name: 'Code starts with' })).toBeInvalid();
    expect(api.lists).toHaveLength(0);
    await expectNoAccessibilityViolations(container);
  });
});

async function fillValid(user: ReturnType<typeof userEvent.setup>, code = 'user:42.wallet') {
  await user.type(screen.getByLabelText(/^Code \(required\)/), code);
  await user.type(screen.getByLabelText(/^Currency \(required\)/), 'usd');
  await user.selectOptions(screen.getByLabelText(/^Type/), 'LIABILITY');
}

describe('the account form', () => {
  it('has no accessibility violations', async () => {
    mockAccountsApi([account(1)]);
    const { container } = await open();
    await screen.findByRole('table');
    await expectNoAccessibilityViolations(container);
  });

  it.each([
    ['ASSET', 'DEBIT', 'debit'],
    ['EXPENSE', 'DEBIT', 'debit'],
    ['LIABILITY', 'CREDIT', 'credit'],
    ['EQUITY', 'CREDIT', 'credit'],
    ['INCOME', 'CREDIT', 'credit'],
  ])('suggests %s -> %s, and says so', async (type, side, word) => {
    mockAccountsApi([account(1)]);
    const user = userEvent.setup();
    await open();
    await user.selectOptions(screen.getByLabelText(/^Type/), type);
    expect(screen.getByLabelText(/^Normal balance/)).toHaveValue(side);
    expect(screen.getByLabelText(/^Normal balance/)).toHaveAccessibleDescription(
      new RegExp(`Conventional for .* accounts: ${word}\\.`),
    );
  });

  it('suggests, but does not force: the person can choose the other side, and it is noted', async () => {
    mockAccountsApi([account(1)]);
    const user = userEvent.setup();
    await open();
    await user.selectOptions(screen.getByLabelText(/^Type/), 'ASSET');
    await user.selectOptions(screen.getByLabelText(/^Normal balance/), 'CREDIT');
    expect(screen.getByLabelText(/^Normal balance/)).toHaveValue('CREDIT');
    expect(screen.getByLabelText(/^Normal balance/)).toHaveAccessibleDescription(
      /allowed but unusual/,
    );

    // A later change of type does not overwrite a side the person chose.
    await user.selectOptions(screen.getByLabelText(/^Type/), 'EXPENSE');
    expect(screen.getByLabelText(/^Normal balance/)).toHaveValue('CREDIT');
  });

  it('follows the suggestion while the person has not chosen a side', async () => {
    mockAccountsApi([account(1)]);
    const user = userEvent.setup();
    await open();
    await user.selectOptions(screen.getByLabelText(/^Type/), 'ASSET');
    await user.selectOptions(screen.getByLabelText(/^Type/), 'INCOME');
    expect(screen.getByLabelText(/^Normal balance/)).toHaveValue('CREDIT');
  });

  it('writes the currency in capitals as it is typed', async () => {
    mockAccountsApi([account(1)]);
    const user = userEvent.setup();
    await open();
    await user.type(screen.getByLabelText(/^Currency \(required\)/), 'usdt');
    expect(screen.getByLabelText(/^Currency \(required\)/)).toHaveValue('USDT');
  });

  describe('checking before sending', () => {
    it('shows every problem beside its field and in a summary that takes focus, and sends nothing', async () => {
      const api = mockAccountsApi([account(1)]);
      const user = userEvent.setup();
      const { container } = await open();
      await screen.findByRole('table');
      await user.click(screen.getByRole('button', { name: 'Create account' }));

      const summary = screen.getByRole('alert');
      expect(summary).toHaveFocus();
      expect(summary).toHaveTextContent('There are 4 problems to fix');
      expect(screen.getByLabelText(/^Code \(required\)/)).toHaveAccessibleDescription(
        /Error: Enter a code/,
      );
      expect(screen.getByLabelText(/^Currency \(required\)/)).toHaveAccessibleDescription(
        /Error: Enter a currency/,
      );
      expect(screen.getByLabelText(/^Type/)).toHaveAccessibleDescription(/Error: Choose a type/);
      expect(screen.getByLabelText(/^Normal balance/)).toHaveAccessibleDescription(
        /Error: Choose a side/,
      );
      expect(api.posts).toHaveLength(0);
      await expectNoAccessibilityViolations(container);
    });

    it('lets the person jump from the summary to a field', async () => {
      mockAccountsApi([account(1)]);
      const user = userEvent.setup();
      await open();
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Currency' }));
      expect(screen.getByLabelText(/^Currency \(required\)/)).toHaveFocus();
    });

    it('takes an error away when its field is edited, and the summary with the last one', async () => {
      mockAccountsApi([account(1)]);
      const user = userEvent.setup();
      await open();
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      await user.type(screen.getByLabelText(/^Code \(required\)/), 'a');
      expect(screen.getByRole('alert')).toHaveTextContent('There are 3 problems to fix');
      await user.type(screen.getByLabelText(/^Currency \(required\)/), 'US');
      await user.selectOptions(screen.getByLabelText(/^Type/), 'ASSET');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('checks a field when the person leaves it, once something was typed', async () => {
      mockAccountsApi([account(1)]);
      const user = userEvent.setup();
      await open();
      const code = screen.getByLabelText(/^Code \(required\)/);
      await user.click(code);
      await user.tab(); // left empty: no complaint yet
      expect(code).not.toHaveAttribute('aria-invalid');
      await user.type(code, 'bad code');
      await user.tab();
      expect(code).toBeInvalid();
      expect(code).toHaveAccessibleDescription(/1 to 64 letters, digits/);
    });
  });

  describe('creating', () => {
    it('sends exactly what was entered, then shows the account, and offers to open it', async () => {
      const api = mockAccountsApi([account(1)]);
      const user = userEvent.setup();
      await open();
      await screen.findByRole('table');
      await fillValid(user);
      await user.click(screen.getByRole('checkbox', { name: 'Allow negative balance' }));
      await user.click(screen.getByRole('button', { name: 'Create account' }));

      expect(await screen.findByRole('link', { name: 'Open user:42.wallet' })).toHaveAttribute(
        'href',
        '/accounts/00000000-0000-4000-8000-000000000001',
      );
      expect(api.posts).toEqual([
        {
          code: 'user:42.wallet',
          currency: 'USD',
          type: 'LIABILITY',
          normal_balance: 'CREDIT',
          allow_negative: true,
        },
      ]);

      // It is at the top of the list, and the form is ready for the next one.
      await waitFor(() => {
        expect(screen.getAllByRole('link', { name: /acct-01|user:42/ })[0]).toHaveTextContent(
          'user:42.wallet',
        );
      });
      expect(screen.getByLabelText(/^Code \(required\)/)).toHaveValue('');
      expect(screen.getByLabelText(/^Type/)).toHaveValue('');
      expect(
        screen
          .getAllByRole('status')
          .some((s) => s.textContent.includes('Account user:42.wallet created')),
      ).toBe(true);
    });

    it('sends allow_negative false by default', async () => {
      const api = mockAccountsApi([]);
      const user = userEvent.setup();
      await open();
      await fillValid(user);
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      await screen.findByRole('link', { name: /^Open/ });
      expect(api.posts[0]).toMatchObject({ allow_negative: false });
    });

    it('sends the request once even if the button is pressed twice', async () => {
      const api = mockAccountsApi([], { postDelayMs: 100 });
      const user = userEvent.setup();
      await open();
      await fillValid(user);
      const button = screen.getByRole('button', { name: 'Create account' });
      await user.click(button);
      await user.click(button);
      await screen.findByRole('link', { name: /^Open/ });
      expect(api.posts).toHaveLength(1);
    });

    it('can be completed with the keyboard: fields in order, and Enter in a text field sends it', async () => {
      const api = mockAccountsApi([]);
      const user = userEvent.setup();
      await open();
      await screen.findByText('There are no accounts yet');
      screen.getByLabelText(/^Code \(required\)/).focus();
      await user.keyboard('cash');
      await user.tab();
      expect(screen.getByLabelText(/^Currency \(required\)/)).toHaveFocus();
      await user.keyboard('eur');
      await user.tab();
      expect(screen.getByLabelText(/^Type/)).toHaveFocus();
      await user.selectOptions(screen.getByLabelText(/^Type/), 'ASSET');
      await user.tab();
      expect(screen.getByLabelText(/^Normal balance/)).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('checkbox', { name: 'Allow negative balance' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Create account' })).toHaveFocus();

      screen.getByLabelText(/^Code \(required\)/).focus();
      await user.keyboard('{Enter}');
      expect(await screen.findByRole('link', { name: 'Open cash' })).toBeInTheDocument();
      expect(api.posts).toEqual([
        {
          code: 'cash',
          currency: 'EUR',
          type: 'ASSET',
          normal_balance: 'DEBIT',
          allow_negative: false,
        },
      ]);
    });

    it('tells the person when the new account is hidden by the filters', async () => {
      mockAccountsApi([account(1, { currency: 'EUR' })]);
      const user = userEvent.setup();
      await open('/accounts?currency=EUR');
      await screen.findByRole('table');
      await fillValid(user);
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      expect(
        await screen.findByText(/not in the list below because of the current filters/),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Clear the filters' }));
      expect(await screen.findByRole('link', { name: 'user:42.wallet' })).toBeInTheDocument();
    });

    it('does not say that, when the account does match the filters', async () => {
      mockAccountsApi([]);
      const user = userEvent.setup();
      await open('/accounts?currency=USD&code=user');
      await fillValid(user);
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      await screen.findByRole('link', { name: /^Open/ });
      expect(screen.queryByText(/because of the current filters/)).not.toBeInTheDocument();
    });
  });

  describe('when ledgerd refuses', () => {
    it('shows each field error beside its field and in the summary, and keeps what was typed', async () => {
      const api = mockAccountsApi([]);
      api.rejectNextPost(
        validationRefusal([
          { field: 'currency', message: 'unsupported asset' },
          { field: 'code', message: 'reserved prefix' },
        ]),
      );
      const user = userEvent.setup();
      const { container } = await open();
      await fillValid(user);
      await user.click(screen.getByRole('button', { name: 'Create account' }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveFocus();
      });
      expect(screen.getByRole('alert')).toHaveTextContent('There are 2 problems to fix');
      expect(screen.getByLabelText(/^Currency \(required\)/)).toHaveAccessibleDescription(
        /Error: unsupported asset/,
      );
      expect(screen.getByLabelText(/^Code \(required\)/)).toHaveAccessibleDescription(
        /Error: reserved prefix/,
      );
      // The input is kept.
      expect(screen.getByLabelText(/^Code \(required\)/)).toHaveValue('user:42.wallet');
      expect(screen.getByLabelText(/^Currency \(required\)/)).toHaveValue('USD');
      expect(screen.getByLabelText(/^Type/)).toHaveValue('LIABILITY');
      await expectNoAccessibilityViolations(container);

      // Fix and send again.
      await user.clear(screen.getByLabelText(/^Currency \(required\)/));
      await user.type(screen.getByLabelText(/^Currency \(required\)/), 'EUR');
      await user.clear(screen.getByLabelText(/^Code \(required\)/));
      await user.type(screen.getByLabelText(/^Code \(required\)/), 'user:43');
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      expect(await screen.findByRole('link', { name: 'Open user:43' })).toBeInTheDocument();
      expect(api.posts).toHaveLength(2);
    });

    it('puts a duplicate code on the code field', async () => {
      const api = mockAccountsApi([account(1, { code: 'taken' })]);
      const user = userEvent.setup();
      await open();
      await screen.findByRole('table');
      await fillValid(user, 'taken');
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      await waitFor(() => {
        expect(screen.getByLabelText(/^Code \(required\)/)).toHaveAccessibleDescription(
          /An account with this code already exists/,
        );
      });
      expect(screen.getByLabelText(/^Code \(required\)/)).toHaveValue('taken');
      expect(api.accounts).toHaveLength(1);
    });

    it('shows an error it cannot place on a field, rather than dropping it', async () => {
      const api = mockAccountsApi([]);
      api.rejectNextPost(validationRefusal([{ field: 'postings[0].amount', message: 'odd one' }]));
      const user = userEvent.setup();
      await open();
      await fillValid(user);
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      expect(await screen.findByText('postings[0].amount: odd one')).toBeInTheDocument();
    });

    it('explains a failure that is not about a field, keeps the input, and retries the same request', async () => {
      const api = mockAccountsApi([]);
      api.rejectNextPost(HttpResponse.error());
      const user = userEvent.setup();
      await open();
      await fillValid(user);
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      expect(await screen.findByText('Cannot reach the ledger')).toBeInTheDocument();
      expect(screen.getByLabelText(/^Code \(required\)/)).toHaveValue('user:42.wallet');

      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('link', { name: /^Open/ })).toBeInTheDocument();
      expect(api.posts).toHaveLength(2);
      expect(api.posts[1]).toEqual(api.posts[0]);
    });

    it('explains a server error that is not a validation problem', async () => {
      const api = mockAccountsApi([]);
      api.rejectNextPost(
        HttpResponse.json(
          makeProblem({
            status: 500,
            code: 'internal_error',
            title: 'Internal error',
            request_id: 'req-123456789',
          }),
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      );
      const user = userEvent.setup();
      await open();
      await fillValid(user);
      await user.click(screen.getByRole('button', { name: 'Create account' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Internal error');
      expect(alert).toHaveTextContent('internal_error');
      expect(within(alert).getByRole('button', { name: 'Copy request id' })).toBeInTheDocument();
    });
  });
});
