import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../../test/axe';
import { createLedgerSim, type LedgerSim } from '../../test/ledgerSim';
import { mockReadiness } from '../../test/readiness';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

let sim: LedgerSim;
beforeEach(() => {
  mockReadiness('ready');
  sim = createLedgerSim();
  sim.install();
});

async function open() {
  const app = renderApp('/lab');
  await screen.findByRole('heading', { level: 1, name: 'Failure Lab' });
  return app;
}

const overdraftSection = () =>
  screen.getByRole('region', { name: 'Overdraft is refused and nothing changes' });
const runOverdraft = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(within(overdraftSection()).getByRole('button', { name: /^Run/ }));
  await within(overdraftSection()).findByText(/Behaved as designed|UNEXPECTED|Could not run/);
};

describe('the Failure Lab page', () => {
  it('warns that scenarios write real data, and counts the lab accounts (R9.6)', async () => {
    sim.addAccount({ code: 'lab-old-wallet' });
    sim.addAccount({ code: 'lab-old-bank' });
    sim.addAccount({ code: 'mine' });
    const { container } = await open();
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('These scenarios write real data');
    expect(note).toHaveTextContent('lab-');
    expect(note).toHaveTextContent('append-only');
    expect(await within(note).findByText('This ledger has 2 lab accounts.')).toBeInTheDocument();
    await expectNoAccessibilityViolations(container);
  });

  it('counts one lab account in the singular, and none', async () => {
    sim.addAccount({ code: 'lab-x-wallet' });
    const first = await open();
    expect(await screen.findByText('This ledger has 1 lab account.')).toBeInTheDocument();
    first.unmount();
    const empty = createLedgerSim();
    empty.install();
    await open();
    expect(await screen.findByText('This ledger has 0 lab accounts.')).toBeInTheDocument();
  });

  it('says when the lab accounts cannot be counted, without hiding the scenarios', async () => {
    server.use(http.get('*/api/v1/accounts', () => HttpResponse.error()));
    await open();
    expect(await screen.findByText('The lab accounts could not be counted.')).toBeInTheDocument();
    expect(overdraftSection()).toBeInTheDocument();
  });

  it('lists the scenarios with what each one tries', async () => {
    await open();
    expect(overdraftSection()).toHaveTextContent('Funds a wallet that may not go negative');
    expect(
      within(overdraftSection()).getByRole('button', { name: 'Run this scenario' }),
    ).toBeEnabled();
  });
});

describe('running a scenario (R9.2 to R9.4)', () => {
  it('shows the steps in order, each with its explanation, requests and checks, and the verdict', async () => {
    const user = userEvent.setup();
    const { container } = await open();
    await runOverdraft(user);
    const section = overdraftSection();

    expect(within(section).getByRole('status')).toHaveTextContent('Behaved as designed');
    const steps = within(section)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(steps).toEqual([
      'Step 1: Create two lab accounts',
      'Step 2: Fund the wallet with 100.00',
      'Step 3: Try to withdraw 101.00',
      'Step 4: Check that nothing changed',
    ]);
    expect(section).toHaveTextContent(
      'a wallet may not go negative, so ledgerd refuses the whole transaction',
    );
    const withdrawal = within(section).getByRole('region', { name: /Step 3/ });
    const checks = within(within(withdrawal).getByRole('table')).getAllByRole('row').slice(1);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toHaveTextContent('Withdrawal refused');
    expect(checks[0]).toHaveTextContent('422 insufficient_funds');
    expect(checks[0]).toHaveTextContent('Passed');
    expect(sim.transactions()).toHaveLength(1); // the funding; the withdrawal was refused
    await expectNoAccessibilityViolations(container);
  });

  it('shows what was sent and what came back for each request, and never the API key', async () => {
    const user = userEvent.setup();
    await open();
    await runOverdraft(user);
    const withdrawal = within(overdraftSection()).getByRole('region', { name: /Step 3/ });
    const exchange = within(withdrawal)
      .getByText(/Request 1:/)
      .closest('details');
    if (exchange === null) throw new Error('no exchange');
    expect(exchange).toHaveTextContent('POST /v1/transactions');
    expect(exchange).toHaveTextContent('422');
    expect(exchange).toHaveTextContent('insufficient_funds');
    // Closed until opened, then readable.
    expect(exchange).not.toHaveAttribute('open');
    await user.click(within(exchange).getByText(/Request 1:/));
    expect(exchange).toHaveAttribute('open');
    expect(within(exchange).getByLabelText('Body sent in request 1')).toHaveTextContent(
      '"amount": "10100"',
    );
    expect(within(exchange).getByLabelText('Body received in request 1')).toHaveTextContent(
      '"code": "insufficient_funds"',
    );
    expect(within(exchange).getByText('idempotency-key:')).toBeInTheDocument();
    expect(document.body.textContent.toLowerCase()).not.toContain('authorization');
    expect(document.body.textContent).not.toContain('Bearer');
  });

  it('announces the verdict without moving focus', async () => {
    const user = userEvent.setup();
    await open();
    await runOverdraft(user);
    expect(
      screen
        .getAllByRole('status')
        .some((s) =>
          s.textContent.includes('Overdraft is refused and nothing changes: behaved as designed'),
        ),
    ).toBe(true);
  });

  it('shows an unexpected outcome prominently, with the failed checks marked', async () => {
    sim.faults.allowOverdraft = true;
    const user = userEvent.setup();
    const { container } = await open();
    await runOverdraft(user);
    const section = overdraftSection();
    const alert = within(section).getByRole('alert');
    expect(alert).toHaveTextContent('UNEXPECTED');
    expect(alert).toHaveTextContent('did not do what its design promises');
    expect(within(section).queryByText('Behaved as designed')).not.toBeInTheDocument();
    expect(within(section).getAllByText('Failed').length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByRole('status').some((s) => s.textContent.includes('UNEXPECTED result')),
    ).toBe(true);
    await expectNoAccessibilityViolations(container);
  });

  it('says it could not run, and why, when ledgerd cannot be reached, and never claims success', async () => {
    server.use(http.post('*/api/v1/accounts', () => HttpResponse.error()));
    const user = userEvent.setup();
    await open();
    await runOverdraft(user);
    const alert = within(overdraftSection()).getByRole('alert');
    expect(alert).toHaveTextContent('Could not run');
    expect(alert).toHaveTextContent(
      'A scenario that cannot reach the ledger proves nothing either way',
    );
    expect(within(overdraftSection()).queryByText('Behaved as designed')).not.toBeInTheDocument();
  });

  it('re-reads the lab account count when a run finishes', async () => {
    const user = userEvent.setup();
    await open();
    expect(await screen.findByText('This ledger has 0 lab accounts.')).toBeInTheDocument();
    await runOverdraft(user);
    expect(await screen.findByText('This ledger has 2 lab accounts.')).toBeInTheDocument();
  });

  it('can be run again, with fresh accounts', async () => {
    const user = userEvent.setup();
    await open();
    await runOverdraft(user);
    await user.click(within(overdraftSection()).getByRole('button', { name: 'Run again' }));
    await waitFor(() => {
      expect(within(overdraftSection()).getByRole('button', { name: 'Run again' })).toBeEnabled();
    });
    await waitFor(() => {
      expect(screen.getByText('This ledger has 4 lab accounts.')).toBeInTheDocument();
    });
  });

  it('is operated with the keyboard', async () => {
    const user = userEvent.setup();
    await open();
    within(overdraftSection()).getByRole('button', { name: 'Run this scenario' }).focus();
    await user.keyboard('{Enter}');
    await within(overdraftSection()).findByText('Behaved as designed');
  });
});
