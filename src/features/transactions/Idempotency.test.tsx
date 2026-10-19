import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../../test/axe';
import { createLedgerSim, type LedgerSim } from '../../test/ledgerSim';
import { makeProblem } from '../../test/factories';
import { mockReadiness } from '../../test/readiness';
import { renderApp } from '../../test/render';

let sim: LedgerSim;
beforeEach(() => {
  mockReadiness('ready');
  sim = createLedgerSim();
  sim.addAccount({ code: 'bank', type: 'ASSET', normal_balance: 'DEBIT', allow_negative: true });
  sim.addAccount({ code: 'wallet', type: 'LIABILITY', normal_balance: 'CREDIT' });
  sim.install();
});

type User = ReturnType<typeof userEvent.setup>;

async function open() {
  const app = renderApp('/transactions/new');
  await screen.findByRole('heading', { level: 1, name: 'New transaction' });
  await waitFor(() => {
    expect(screen.getByLabelText('Account for posting 1')).toHaveTextContent('bank (USD)');
  });
  return app;
}

/** Debit bank, credit wallet: a deposit that raises both balances. */
async function fill(user: User, amount = '100') {
  await user.selectOptions(screen.getByLabelText('Account for posting 1'), 'bank (USD)');
  await user.selectOptions(screen.getByLabelText('Account for posting 2'), 'wallet (USD)');
  for (const n of [1, 2]) {
    const input = screen.getByLabelText(`Amount of posting ${String(n)}`);
    await user.clear(input);
    await user.type(input, amount);
  }
}

const send = (user: User) => user.click(screen.getByRole('button', { name: 'Send transaction' }));
const keyField = () => screen.getByLabelText(/^Idempotency key/);
const posted = () => screen.findByRole('region', { name: /Transaction posted/ });

describe('the key', () => {
  it('is shown before sending, as a version 4 UUID, and is what is sent', async () => {
    const user = userEvent.setup();
    await open();
    const shown = (keyField() as HTMLInputElement).value;
    expect(shown).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await fill(user);
    await send(user);
    await posted();
    expect(sim.requests[0]?.key).toBe(shown);
  });

  it('has no accessibility violations, with the key field and after a post', async () => {
    const user = userEvent.setup();
    const { container } = await open();
    await expectNoAccessibilityViolations(container);
    await fill(user);
    await send(user);
    await posted();
    await expectNoAccessibilityViolations(container);
  });

  it('can be edited before sending', async () => {
    const user = userEvent.setup();
    await open();
    await fill(user);
    await user.clear(keyField());
    await user.type(keyField(), 'my-own-key-1');
    await send(user);
    await posted();
    expect(sim.requests[0]?.key).toBe('my-own-key-1');
  });

  it('can be replaced with a new one', async () => {
    const user = userEvent.setup();
    await open();
    const first = (keyField() as HTMLInputElement).value;
    await user.click(screen.getByRole('button', { name: 'New key' }));
    expect((keyField() as HTMLInputElement).value).not.toBe(first);
  });

  it.each(['', 'two words', 'x'.repeat(256)])(
    'is refused if ledgerd would refuse it (%j), with nothing sent',
    async (bad) => {
      const user = userEvent.setup();
      await open();
      await fill(user);
      await user.clear(keyField());
      if (bad !== '') {
        await user.click(keyField());
        await user.paste(bad);
      }
      await send(user);
      expect(keyField()).toHaveAccessibleDescription(/Error: Use 1 to 255 visible characters/);
      expect(screen.getByRole('alert')).toHaveTextContent('Idempotency key');
      expect(sim.requests).toHaveLength(0);
      // The summary leads to the field.
      await user.click(
        within(screen.getByRole('alert')).getByRole('button', { name: 'Idempotency key' }),
      );
      expect(keyField()).toHaveFocus();
    },
  );
});

describe('sending the same request again (R7.2, R7.3)', () => {
  it('shows the key used, and a repeat is a replay: the first transaction comes back and nothing moves', async () => {
    const user = userEvent.setup();
    await open();
    await fill(user, '100');
    const key = (keyField() as HTMLInputElement).value;
    await send(user);
    const result = await posted();
    expect(within(result).getByText(key, { selector: '.sr-only' })).toBeInTheDocument();

    await user.click(within(result).getByRole('button', { name: 'Send the same request again' }));
    const outcome = await within(result).findByText(
      /Repeat 1: HTTP 201 with Idempotent-Replayed: true/,
    );
    const box = outcome.parentElement;
    if (box === null) throw new Error('no box');
    expect(box).toHaveTextContent('This was a replay');
    expect(box).toHaveTextContent('recorded nothing new');
    const original = sim.transactions()[0];
    expect(within(box).getByRole('link', { name: /^40000000/ })).toHaveAttribute(
      'href',
      `/transactions/${original?.id ?? ''}`,
    );

    // Same key, same body; one transaction in the ledger; the balances are what they were.
    expect(sim.requests).toHaveLength(2);
    expect(sim.requests[1]?.key).toBe(key);
    expect(sim.requests[1]?.body).toEqual(sim.requests[0]?.body);
    expect(sim.transactions()).toHaveLength(1);
    expect(sim.balanceOf(sim.byCode('wallet').id)).toBe(10000n);
    const rows = within(box).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toHaveTextContent('100.00 USD');
      expect(row).toHaveTextContent('No, unchanged');
    }
  });

  it('can be repeated again, and each repeat is reported', async () => {
    const user = userEvent.setup();
    await open();
    await fill(user);
    await send(user);
    const result = await posted();
    const again = within(result).getByRole('button', { name: 'Send the same request again' });
    await user.click(again);
    await within(result).findByText(/Repeat 1:/);
    await user.click(again);
    await within(result).findByText(/Repeat 2:/);
    expect(sim.transactions()).toHaveLength(1);
  });

  it('announces what happened', async () => {
    const user = userEvent.setup();
    await open();
    await fill(user);
    await send(user);
    const result = await posted();
    await user.click(within(result).getByRole('button', { name: 'Send the same request again' }));
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('status')
          .some((s) => s.textContent.includes('Replay: ledgerd returned the first result')),
      ).toBe(true);
    });
  });

  it('says honestly when it was NOT a replay (the key was forgotten), and that money moved again', async () => {
    const user = userEvent.setup();
    await open();
    await fill(user, '100');
    await send(user);
    const result = await posted();
    sim.forgetKeys(); // ledgerd keeps keys only for a while
    await user.click(within(result).getByRole('button', { name: 'Send the same request again' }));
    const outcome = await within(result).findByText(
      /Repeat 1: HTTP 201 without Idempotent-Replayed/,
    );
    const box = outcome.parentElement;
    if (box === null) throw new Error('no box');
    expect(box).toHaveTextContent('This was not a replay');
    expect(box).toHaveTextContent('keeps keys only for a limited time');
    expect(sim.transactions()).toHaveLength(2);
    expect(within(box).getAllByRole('row').slice(1)[0]).toHaveTextContent('Yes');
  });

  it('shows a failure of the repeat, with what it means for the key', async () => {
    const user = userEvent.setup();
    await open();
    await fill(user);
    await send(user);
    const result = await posted();
    sim.failNext(HttpResponse.error());
    await user.click(within(result).getByRole('button', { name: 'Send the same request again' }));
    expect(await within(result).findByText('Cannot reach the ledger')).toBeInTheDocument();
    expect(
      within(result).getByText('It is not known whether ledgerd recorded this'),
    ).toBeInTheDocument();
  });
});

describe('failures and the key (R7.4, R7.5)', () => {
  it("refusing the same key with a different request shows the server's refusal, and offers a new key", async () => {
    const user = userEvent.setup();
    await open();
    await fill(user, '100');
    await send(user);
    await posted();
    // Take the first key back, change the amount, send.
    const used = sim.requests[0]?.key ?? '';
    await fill(user, '250');
    await user.clear(keyField());
    await user.type(keyField(), used);
    await send(user);

    const alert = await screen.findByText('Idempotency key reused with a different request');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('idempotency_key_reuse')).toBeInTheDocument();
    expect(screen.getByText('This key is already used by a different request')).toBeInTheDocument();
    expect(sim.transactions()).toHaveLength(1); // nothing new was recorded
    expect(sim.balanceOf(sim.byCode('wallet').id)).toBe(10000n);

    await user.click(screen.getByRole('button', { name: 'Use a new key' }));
    expect((keyField() as HTMLInputElement).value).not.toBe(used);
    await send(user);
    await posted();
    expect(sim.transactions()).toHaveLength(2);
  });

  it('a refusal does not use the key up: the same key works once the cause is fixed', async () => {
    const user = userEvent.setup();
    await open();
    // Withdrawing from wallet (which may not go negative) while it is empty: insufficient funds.
    await user.selectOptions(screen.getByLabelText('Account for posting 1'), 'wallet (USD)');
    await user.selectOptions(screen.getByLabelText('Direction of posting 1'), 'Debit');
    await user.selectOptions(screen.getByLabelText('Account for posting 2'), 'bank (USD)');
    await user.selectOptions(screen.getByLabelText('Direction of posting 2'), 'Credit');
    for (const n of [1, 2])
      await user.type(screen.getByLabelText(`Amount of posting ${String(n)}`), '40');
    const key = (keyField() as HTMLInputElement).value;
    await send(user);

    expect(await screen.findByText('Insufficient funds')).toBeInTheDocument();
    expect(screen.getByText('The key was not used up')).toBeInTheDocument();
    expect(sim.balanceOf(sim.byCode('wallet').id)).toBe(0n);
    expect((keyField() as HTMLInputElement).value).toBe(key); // the key stays

    // Fund the wallet by another request, then send this one again with the same key.
    sim.addAccount({ code: 'tmp', allow_negative: true });
    await fetch('/api/v1/transactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'fund',
        'X-Ledgerd-Console': '1',
      },
      body: JSON.stringify({
        postings: [
          {
            account_id: sim.byCode('bank').id,
            direction: 'DEBIT',
            amount: '10000',
            currency: 'USD',
          },
          {
            account_id: sim.byCode('wallet').id,
            direction: 'CREDIT',
            amount: '10000',
            currency: 'USD',
          },
        ],
      }),
    });
    await send(user);
    await posted();
    expect(sim.requests.at(-1)?.key).toBe(key);
    expect(sim.balanceOf(sim.byCode('wallet').id)).toBe(10000n - 4000n);
  });

  it('after the answer never arrived, says the outcome is unknown and that the same key is safe', async () => {
    const user = userEvent.setup();
    await open();
    await fill(user);
    sim.failNext(HttpResponse.error());
    await send(user);
    expect(
      await screen.findByText('It is not known whether ledgerd recorded this'),
    ).toBeInTheDocument();
    await send(user);
    await posted();
    expect(sim.requests).toHaveLength(2);
    expect(sim.requests[1]?.key).toBe(sim.requests[0]?.key);
    expect(sim.transactions()).toHaveLength(1);
  });

  it('after "busy" (503), says nothing was changed and the key is free', async () => {
    const user = userEvent.setup();
    await open();
    await fill(user);
    sim.failNext(
      HttpResponse.json(
        makeProblem({
          status: 503,
          code: 'temporarily_unavailable',
          title: 'Temporarily unavailable',
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '1' },
        },
      ),
    );
    await send(user);
    expect(await screen.findByText('The ledger is busy')).toBeInTheDocument();
    expect(screen.getByText('The key was not used up')).toBeInTheDocument();
  });
});
