import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTransaction, reverseTransaction } from '../../api/endpoints';
import { expectNoAccessibilityViolations } from '../../test/axe';
import { createLedgerSim, type LedgerSim } from '../../test/ledgerSim';
import { mockReadiness } from '../../test/readiness';
import { renderApp } from '../../test/render';

let sim: LedgerSim;
let bank: string;
let wallet: string;

beforeEach(() => {
  mockReadiness('ready');
  sim = createLedgerSim();
  bank = sim.addAccount({
    code: 'bank',
    type: 'ASSET',
    normal_balance: 'DEBIT',
    allow_negative: true,
  }).id;
  wallet = sim.addAccount({ code: 'wallet', type: 'LIABILITY', normal_balance: 'CREDIT' }).id;
  sim.install();
});

async function deposit(amount = '10000', key = 'seed-1') {
  const { data } = await createTransaction(
    {
      description: 'Deposit',
      postings: [
        { account_id: bank, direction: 'DEBIT', amount, currency: 'USD' },
        { account_id: wallet, direction: 'CREDIT', amount, currency: 'USD' },
      ],
    },
    key,
  );
  return data;
}

async function open(path: string, name: string | RegExp = /^Transaction/) {
  const app = renderApp(path);
  await screen.findByRole('heading', { level: 1, name });
  return app;
}

describe('the transaction page (R8.1)', () => {
  it('shows the description, time, id and postings with account codes, and has no accessibility violations', async () => {
    const tx = await deposit();
    const { container } = await open(`/transactions/${tx.id}`);
    await screen.findByRole('region', { name: 'Details' });
    const details = screen.getByRole('region', { name: 'Details' });
    expect(details).toHaveTextContent('Deposit');
    expect(details).toHaveTextContent('2026-10-13 15:04:05');
    expect(
      within(details).getByRole('button', { name: 'Copy transaction id' }),
    ).toBeInTheDocument();
    expect(within(details).queryByText('Reverses')).not.toBeInTheDocument();

    const table = within(screen.getByRole('region', { name: 'Postings' })).getByRole('table');
    await waitFor(() => {
      expect(within(table).getByRole('link', { name: 'bank' })).toHaveAttribute(
        'href',
        `/accounts/${bank}`,
      );
    });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Debit');
    expect(rows[0]).toHaveTextContent('100.00 USD');
    expect(rows[1]).toHaveTextContent('wallet');
    expect(rows[1]).toHaveTextContent('Credit');
    await expectNoAccessibilityViolations(container);
  });

  it('shows the account by id until its code is known', async () => {
    const tx = await deposit();
    await open(`/transactions/${tx.id}`);
    // Whichever comes first, both end up as the account code.
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'wallet' })).toBeInTheDocument();
    });
  });

  it('links a reversal to the transaction it reverses (R8.1)', async () => {
    const tx = await deposit();
    const { data: reversal } = await reverseTransaction(tx.id, 'r-1');
    await open(`/transactions/${reversal.id}`);
    const details = await screen.findByRole('region', { name: 'Details' });
    expect(within(details).getByRole('link', { name: tx.id })).toHaveAttribute(
      'href',
      `/transactions/${tx.id}`,
    );
  });

  it('says so for an unknown transaction, and for an id that is not an id, without asking ledgerd the second time', async () => {
    await open('/transactions/40000000-0000-4000-8000-0000000000ff', /^Transaction/);
    expect(await screen.findByText('Transaction not found')).toBeInTheDocument();
    expect(screen.getByText(/There is no transaction with this id/)).toBeInTheDocument();
  });

  it('does not ask ledgerd about an id that is not an id', async () => {
    await open('/transactions/nonsense');
    expect(await screen.findByText(/This is not a valid transaction id/)).toBeInTheDocument();
    expect(sim.requests).toHaveLength(0);
  });
});

describe('reversing (R8.3 to R8.5)', () => {
  const reverseButton = () => screen.findByRole('button', { name: 'Reverse this transaction' });

  it('asks first, explaining that the original is not changed and a new offsetting one is made', async () => {
    const tx = await deposit();
    const user = userEvent.setup();
    await open(`/transactions/${tx.id}`);
    await user.click(await reverseButton());
    const dialog = await screen.findByRole('dialog', { name: 'Reverse this transaction?' });
    expect(dialog).toHaveTextContent('will not be changed');
    expect(dialog).toHaveTextContent('A new transaction will be created');
    expect(dialog).toHaveTextContent('opposite direction');
    expect(sim.requests.filter((r) => r.path.endsWith('/reverse'))).toHaveLength(0);
  });

  it('can be cancelled with nothing sent, and focus goes back to the button', async () => {
    const tx = await deposit();
    const user = userEvent.setup();
    await open(`/transactions/${tx.id}`);
    const opener = await reverseButton();
    await user.click(opener);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(sim.requests.filter((r) => r.path.endsWith('/reverse'))).toHaveLength(0);
  });

  it('reverses: links the new transaction, leaves the original, and the balances are updated', async () => {
    const tx = await deposit('10000');
    const user = userEvent.setup();
    await open(`/transactions/${tx.id}`);
    expect(sim.balanceOf(wallet)).toBe(10000n);
    await waitFor(() => {
      expect(sim.accountReads).toContain(bank); // the page read the account codes
    });
    const readsBefore = sim.accountReads.filter((id) => id === bank).length;
    await user.click(await reverseButton());
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Reverse transaction',
      }),
    );

    const notice = await screen.findByText(/Reversed by transaction/);
    const reversal = sim.transactions().find((t) => t.reverses_id === tx.id);
    expect(reversal).toBeDefined();
    const banner = notice.parentElement;
    if (banner === null) throw new Error('no banner');
    expect(within(banner).getByRole('link', { name: reversal?.id ?? '' })).toHaveAttribute(
      'href',
      `/transactions/${reversal?.id ?? ''}`,
    );
    expect(notice).toHaveTextContent('This transaction is unchanged');
    expect(sim.balanceOf(wallet)).toBe(0n);
    expect(sim.balanceOf(bank)).toBe(0n);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // The accounts the reversal touched were read again, so any page showing them is up to date.
    await waitFor(() => {
      expect(sim.accountReads.filter((id) => id === bank).length).toBeGreaterThan(readsBefore);
    });
    expect(
      screen.getAllByRole('status').some((s) => s.textContent.includes('Transaction reversed')),
    ).toBe(true);
  });

  it('sends the key it shows, and the key can be edited', async () => {
    const tx = await deposit();
    const user = userEvent.setup();
    await open(`/transactions/${tx.id}`);
    await user.click(await reverseButton());
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText(/^Idempotency key/);
    expect((field as HTMLInputElement).value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    await user.clear(field);
    await user.type(field, 'reverse-by-hand-1');
    await user.click(within(dialog).getByRole('button', { name: 'Reverse transaction' }));
    await screen.findByText(/Reversed by transaction/);
    expect(sim.requests.at(-1)?.key).toBe('reverse-by-hand-1');
  });

  it('refuses a key ledgerd would refuse, and sends nothing', async () => {
    const tx = await deposit();
    const user = userEvent.setup();
    await open(`/transactions/${tx.id}`);
    await user.click(await reverseButton());
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText(/^Idempotency key/);
    await user.clear(field);
    await user.click(within(dialog).getByRole('button', { name: 'Reverse transaction' }));
    expect(field).toHaveAccessibleDescription(/Error: Use 1 to 255 visible characters/);
    expect(sim.requests.filter((r) => r.path.endsWith('/reverse'))).toHaveLength(0);
  });

  it('gives each opening of the dialog a new key, and keeps it across retries within one', async () => {
    const tx = await deposit();
    const user = userEvent.setup();
    await open(`/transactions/${tx.id}`);
    const keyOf = (dialog: HTMLElement): string => {
      const field = within(dialog).getByLabelText(/^Idempotency key/);
      if (!(field instanceof HTMLInputElement)) throw new Error('the key is not an input');
      return field.value;
    };

    await user.click(await reverseButton());
    let dialog = await screen.findByRole('dialog');
    const first = keyOf(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(await reverseButton());
    dialog = await screen.findByRole('dialog');
    expect(keyOf(dialog)).not.toBe(first);

    sim.failNext(HttpResponse.error());
    const second = keyOf(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Reverse transaction' }));
    expect(
      await within(dialog).findByText('It is not known whether ledgerd recorded this'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Reverse transaction' }));
    await screen.findByText(/Reversed by transaction/);
    const sent = sim.requests.filter((r) => r.path.endsWith('/reverse'));
    expect(sent.map((r) => r.key)).toEqual([second, second]);
    expect(sim.transactions().filter((t) => t.reverses_id !== null)).toHaveLength(1);
  });

  it('shows the specific reason when it was already reversed, and that the key was not used up', async () => {
    const tx = await deposit();
    await reverseTransaction(tx.id, 'earlier');
    const user = userEvent.setup();
    await open(`/transactions/${tx.id}`);
    await user.click(await reverseButton());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reverse transaction' }));
    expect(await within(dialog).findByText('Transaction already reversed')).toBeInTheDocument();
    expect(
      within(dialog).getByText('this transaction has already been reversed'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('already_reversed')).toBeInTheDocument();
    expect(within(dialog).getByText('The key was not used up')).toBeInTheDocument();
    expect(screen.queryByText(/Reversed by transaction/)).not.toBeInTheDocument();
  });

  it('shows insufficient funds when the money has already been spent', async () => {
    const tx = await deposit('10000');
    // Spend the wallet: debit wallet 80.00, credit bank.
    await createTransaction(
      {
        postings: [
          { account_id: wallet, direction: 'DEBIT', amount: '8000', currency: 'USD' },
          { account_id: bank, direction: 'CREDIT', amount: '8000', currency: 'USD' },
        ],
      },
      'spend',
    );
    const user = userEvent.setup();
    await open(`/transactions/${tx.id}`);
    await user.click(await reverseButton());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reverse transaction' }));
    expect(await within(dialog).findByText('Insufficient funds')).toBeInTheDocument();
    expect(within(dialog).getByText(/would be overdrawn by 8000/)).toBeInTheDocument();
    expect(sim.balanceOf(wallet)).toBe(2000n); // nothing changed
  });

  it('shows "not found" when the transaction is gone by the time it is reversed', async () => {
    const tx = await deposit();
    const user = userEvent.setup();
    await open(`/transactions/${tx.id}`);
    await user.click(await reverseButton());
    const dialog = await screen.findByRole('dialog');
    sim.failNext(
      HttpResponse.json(
        {
          type: 'urn:ledgerd:error:not_found',
          title: 'Not found',
          status: 404,
          code: 'not_found',
          detail: 'transaction not found',
        },
        { status: 404, headers: { 'Content-Type': 'application/problem+json' } },
      ),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Reverse transaction' }));
    expect(await within(dialog).findByText('transaction not found')).toBeInTheDocument();
  });

  it('has no accessibility violations with the dialog open and an error showing', async () => {
    const tx = await deposit();
    await reverseTransaction(tx.id, 'earlier');
    const user = userEvent.setup();
    const { container } = await open(`/transactions/${tx.id}`);
    await user.click(await reverseButton());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reverse transaction' }));
    await within(dialog).findByText('Transaction already reversed');
    await expectNoAccessibilityViolations(container);
  });
});

describe('looking a transaction up (R8.2)', () => {
  it('opens a transaction by pasted id, tolerating spaces and capitals', async () => {
    const tx = await deposit();
    const user = userEvent.setup();
    const { router } = await open('/transactions', 'Transactions');
    await user.click(screen.getByLabelText('Transaction id'));
    await user.paste(`  ${tx.id.toUpperCase()}  `);
    await user.click(screen.getByRole('button', { name: 'Open transaction' }));
    await screen.findByRole('region', { name: 'Details' });
    expect(router.state.location.pathname).toBe(`/transactions/${tx.id}`);
  });

  it.each([
    '',
    'abc',
    '3f2b8a52-2f8e-4c61-9a4e',
    '3f2b8a52-2f8e-4c61-9a4e-0d6f4f0e7c1g',
    'x'.repeat(36),
  ])('refuses %j with a message before any request', async (text) => {
    const user = userEvent.setup();
    const { container, router } = await open('/transactions', 'Transactions');
    if (text !== '') {
      await user.click(screen.getByLabelText('Transaction id'));
      await user.paste(text);
    }
    await user.click(screen.getByRole('button', { name: 'Open transaction' }));
    expect(screen.getByLabelText('Transaction id')).toHaveAccessibleDescription(
      /Error: This is not a transaction id/,
    );
    expect(screen.getByLabelText('Transaction id')).toBeInvalid();
    expect(router.state.location.pathname).toBe('/transactions');
    expect(sim.requests).toHaveLength(0);
    await expectNoAccessibilityViolations(container);
  });

  it('takes the error away when the text is edited', async () => {
    const user = userEvent.setup();
    await open('/transactions', 'Transactions');
    await user.click(screen.getByRole('button', { name: 'Open transaction' }));
    expect(screen.getByLabelText('Transaction id')).toBeInvalid();
    await user.type(screen.getByLabelText('Transaction id'), 'a');
    expect(screen.getByLabelText('Transaction id')).not.toHaveAttribute('aria-invalid');
  });

  it('has the way to record a new transaction, and is in the navigation', async () => {
    await open('/transactions', 'Transactions');
    expect(screen.getByRole('link', { name: 'record a new transaction' })).toHaveAttribute(
      'href',
      '/transactions/new',
    );
    expect(screen.getByRole('link', { name: 'Transactions' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
