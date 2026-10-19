import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTransaction } from '../../api/endpoints';
import { expectNoAccessibilityViolations } from '../../test/axe';
import { createLedgerSim, type LedgerSim } from '../../test/ledgerSim';
import { mockReadiness } from '../../test/readiness';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';
import { useReconciliation } from './hooks';
import { reportStore } from './store';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

let sim: LedgerSim;
let bank: string;
let wallet: string;
let depositPostings: { id: number; account_id: string }[];

beforeEach(async () => {
  mockReadiness('ready');
  reportStore.clear();
  sim = createLedgerSim();
  bank = sim.addAccount({ code: 'bank', allow_negative: true }).id;
  wallet = sim.addAccount({ code: 'wallet', normal_balance: 'CREDIT', type: 'LIABILITY' }).id;
  sim.install();
  const { data } = await createTransaction(
    {
      postings: [
        { account_id: bank, direction: 'DEBIT', amount: '10000', currency: 'USD' },
        { account_id: wallet, direction: 'CREDIT', amount: '10000', currency: 'USD' },
      ],
    },
    'seed',
  );
  depositPostings = data.postings;
});

async function open() {
  const app = renderApp('/reconciliation');
  await screen.findByRole('heading', { level: 1, name: 'Reconciliation' });
  return app;
}
type User = ReturnType<typeof userEvent.setup>;
const runIt = (user: User) =>
  user.click(screen.getByRole('button', { name: 'Run reconciliation' }));
/** A row of a table (0 is the header), or an error if there is none. */
function rowOf(table: HTMLElement, index: number): HTMLElement {
  const row = within(table).getAllByRole('row')[index];
  if (row === undefined) throw new Error(`no row ${String(index)}`);
  return row;
}
const report = () => screen.findByRole('region', { name: /^Report \d+$/ });

describe('what the page explains (R10.6)', () => {
  it('says what a reconciliation checks, and that it only reports and never repairs', async () => {
    const { container } = await open();
    expect(screen.getByText(/adds up the postings of every account/)).toBeInTheDocument();
    expect(
      screen.getByText(/in each currency, total debits equal total credits/),
    ).toBeInTheDocument();
    expect(screen.getByText(/never repairs anything/)).toBeInTheDocument();
    expect(screen.getByText(/can take minutes/)).toBeInTheDocument();
    expect(screen.getByTestId('no-report')).toHaveTextContent('No report yet');
    await expectNoAccessibilityViolations(container);
  });
});

describe('running (R10.1)', () => {
  it('runs a standard check by default, and shows the report with the time it took', async () => {
    const user = userEvent.setup();
    const { container } = await open();
    await runIt(user);
    const section = await report();
    expect(sim.reconciliations).toEqual([false]);
    expect(within(section).getByRole('status')).toHaveTextContent('Consistent: nothing to report');
    expect(section).toHaveTextContent('Standard');
    expect(section).toHaveTextContent('Accounts checked2');
    expect(section).toHaveTextContent(/Took\d+\.\d s/);
    expect(section).toHaveTextContent('2026-10-13 16:00');
    await expectNoAccessibilityViolations(container);
  });

  it('runs a deep check when asked', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('radio', { name: 'Deep' }));
    await runIt(user);
    const section = await report();
    expect(sim.reconciliations).toEqual([true]);
    expect(section).toHaveTextContent('Deep');
    expect(section).toHaveTextContent("Every posting's balance follows from the previous one.");
  });

  it('says a standard run did not check the chains, and how to', async () => {
    const user = userEvent.setup();
    await open();
    await runIt(user);
    expect(
      await within(await report()).findByText(/Not checked in a standard run/),
    ).toBeInTheDocument();
  });

  it('shows progress while it runs: what is running, the seconds, and no percentage it cannot know', async () => {
    sim.reconcileDelayMs = 300;
    const user = userEvent.setup();
    await open();
    await runIt(user);
    const progress = await screen.findByText(/Running a standard reconciliation…/);
    expect(progress).toHaveTextContent('There is no percentage');
    expect(progress.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Run reconciliation' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Deep' })).toBeDisabled();
    await report();
    expect(screen.queryByText(/Running a standard/)).not.toBeInTheDocument();
  });

  it('counts the seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      sim.reconcileDelayMs = 3500;
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
      await open();
      await runIt(user);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(screen.getByText(/Running a standard reconciliation… [12] s/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not start a second run while one is going', async () => {
    // The answer is held back until the test lets it go, so the second click always comes while
    // the first run is still going, however slowly this machine clicks.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.post('*/api/v1/reconciliations', async () => {
        calls += 1;
        await gate;
        return HttpResponse.json({
          started_at: '2026-10-13T16:00:01.000000Z',
          deep: false,
          ok: true,
          accounts_checked: 2,
          mismatches: [],
          currencies: [],
          chain_breaks: [],
        });
      }),
    );
    const user = userEvent.setup();
    await open();
    await runIt(user);
    await screen.findByText(/Running a standard reconciliation/);
    await runIt(user);
    await runIt(user);
    expect(calls).toBe(1);
    release();
    await report();
    expect(calls).toBe(1);
  });

  it('the hook itself refuses a second run while one is going, whatever the buttons do', async () => {
    sim.reconcileDelayMs = 150;
    const { result } = renderHook(() => useReconciliation(), { wrapper });
    await act(async () => {
      const first = result.current.start(false);
      const second = result.current.start(true);
      await Promise.all([first, second]);
    });
    expect(sim.reconciliations).toEqual([false]);
    expect(result.current.state.status).toBe('done');
  });

  it('can be cancelled, says so, and shows no report', async () => {
    sim.reconcileDelayMs = 2000;
    const user = userEvent.setup();
    await open();
    await runIt(user);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/The reconciliation was cancelled/)).toBeInTheDocument();
    expect(screen.getByText(/it only reads, so nothing was changed/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Report/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run reconciliation' })).toBeEnabled();
  });

  it('is operated with the keyboard', async () => {
    const user = userEvent.setup();
    await open();
    screen.getByRole('radio', { name: 'Standard' }).focus();
    await user.keyboard('{ArrowDown}'); // Deep
    expect(screen.getByRole('radio', { name: 'Deep' })).toBeChecked();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Run reconciliation' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await report();
    expect(sim.reconciliations).toEqual([true]);
  });
});

describe('the report (R10.2, R10.3)', () => {
  it('says "Problems found" loudly when a stored balance is not explained by its postings, and links the account', async () => {
    sim.tamperBalance(wallet, 7n);
    const user = userEvent.setup();
    const { container } = await open();
    await runIt(user);
    const section = await report();
    const alert = within(section).getByRole('alert');
    expect(alert).toHaveTextContent('Problems found');
    expect(alert).toHaveTextContent('1 thing does not add up');
    expect(alert).toHaveTextContent('Reconciliation only reports: it changes nothing');
    expect(within(section).queryByText('Consistent: nothing to report')).not.toBeInTheDocument();

    const table = within(section).getByRole('table', { name: /stored balance differs/ });
    const row = rowOf(table, 1);
    expect(within(row).getByRole('link', { name: 'wallet' })).toHaveAttribute(
      'href',
      `/accounts/${wallet}`,
    );
    expect(row).toHaveTextContent('100.07 USD'); // stored
    expect(row).toHaveTextContent('100.00 USD'); // expected
    expect(within(row).getAllByRole('cell')[3]).toHaveTextContent(/^0\.07 USD$/); // stored minus expected, positive
    await expectNoAccessibilityViolations(container);
  });

  it('lists debits and credits per currency, and says when they do not balance', async () => {
    sim.faults.skipBalanceCheck = true;
    await createTransaction(
      {
        postings: [
          { account_id: bank, direction: 'DEBIT', amount: '500', currency: 'USD' },
          { account_id: wallet, direction: 'CREDIT', amount: '499', currency: 'USD' },
        ],
      },
      'odd',
    );
    const user = userEvent.setup();
    await open();
    await runIt(user);
    const section = await report();
    const row = within(
      within(section).getByRole('table', { name: /Total debits and credits/ }),
    ).getAllByRole('row')[1];
    expect(row).toHaveTextContent('USD');
    expect(row).toHaveTextContent('105.00 USD');
    expect(row).toHaveTextContent('104.99 USD');
    expect(row).toHaveTextContent('Does not balance');
    expect(within(section).getByRole('alert')).toHaveTextContent('Problems found');
  });

  it('counts every kind of problem in the verdict: mismatches, unbalanced currencies and chain breaks', async () => {
    sim.faults.skipBalanceCheck = true;
    await createTransaction(
      {
        postings: [
          { account_id: bank, direction: 'DEBIT', amount: '500', currency: 'USD' },
          { account_id: wallet, direction: 'CREDIT', amount: '499', currency: 'USD' },
        ],
      },
      'odd',
    );
    sim.tamperBalance(wallet, 7n); // a mismatch
    const posting = depositPostings.find((p) => p.account_id === bank);
    sim.tamperPosting(posting?.id ?? 0, 999n); // chain breaks (the tampered posting and the one after it)
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('radio', { name: 'Deep' }));
    await runIt(user);
    const section = await report();
    const chainRows =
      within(within(section).getByRole('table', { name: /does not follow/ })).getAllByRole('row')
        .length - 1;
    expect(chainRows).toBe(2);
    // 1 mismatch + 1 unbalanced currency + 2 chain breaks
    expect(within(section).getByRole('alert')).toHaveTextContent('4 things do not add up');
  });

  it('lists the breaks in a balance chain for a deep run, each linking to its account', async () => {
    const posting = depositPostings.find((p) => p.account_id === bank);
    sim.tamperPosting(posting?.id ?? 0, 999n);
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('radio', { name: 'Deep' }));
    await runIt(user);
    const section = await report();
    const table = within(section).getByRole('table', {
      name: /does not follow from the previous one/,
    });
    const row = rowOf(table, 1);
    expect(row).toHaveTextContent(String(posting?.id));
    expect(row).toHaveTextContent('999');
    expect(row).toHaveTextContent('10000');
    expect(within(row).getByRole('link')).toHaveAttribute('href', `/accounts/${bank}`);
    expect(within(section).getByRole('alert')).toHaveTextContent('Problems found');
  });

  it('does not see that break in a standard run, and does not pretend to', async () => {
    const posting = depositPostings.find((p) => p.account_id === bank);
    sim.tamperPosting(posting?.id ?? 0, 999n);
    const user = userEvent.setup();
    await open();
    await runIt(user);
    const section = await report();
    expect(within(section).getByRole('status')).toHaveTextContent('Consistent');
    expect(section).toHaveTextContent('Not checked in a standard run');
  });
});

describe('a run that fails (R10.5)', () => {
  it('shows the failure and no report, even when an earlier run produced one', async () => {
    const user = userEvent.setup();
    await open();
    await runIt(user);
    await report();

    server.use(http.post('*/api/v1/reconciliations', () => HttpResponse.error()));
    await runIt(user);
    expect(await screen.findByText('Cannot reach the ledger')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Report \d+$/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('no-report')).toHaveTextContent('There is no current report');
    expect(screen.getByText(/This run produced no report/)).toBeInTheDocument();
  });

  it('takes the previous report off the screen as soon as a new run starts', async () => {
    const user = userEvent.setup();
    await open();
    await runIt(user);
    await report();
    sim.reconcileDelayMs = 500;
    await runIt(user);
    await screen.findByText(/Running a standard reconciliation/);
    expect(screen.queryByRole('region', { name: /^Report \d+$/ })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Report 2' })).toBeInTheDocument();
    });
  });

  it('keeps earlier reports in the history, and labels one chosen from there as not current', async () => {
    const user = userEvent.setup();
    await open();
    await runIt(user);
    await report();
    server.use(http.post('*/api/v1/reconciliations', () => HttpResponse.error()));
    await runIt(user);
    await screen.findByText('Cannot reach the ledger');

    await user.click(screen.getByRole('button', { name: 'Show report 1' }));
    const section = await report();
    expect(within(section).getByRole('note')).toHaveTextContent('This is an earlier report');
    expect(within(section).getByRole('note')).toHaveTextContent('not the result of the latest run');
  });

  it('can try again from the error', async () => {
    server.use(http.post('*/api/v1/reconciliations', () => HttpResponse.error(), { once: true }));
    const user = userEvent.setup();
    await open();
    await runIt(user);
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await report();
    expect(sim.reconciliations).toEqual([false]); // the first never reached the sim
  });

  it('explains a refusal with its code', async () => {
    server.use(
      http.post('*/api/v1/reconciliations', () =>
        HttpResponse.json(
          {
            type: 'urn:ledgerd:error:temporarily_unavailable',
            title: 'Temporarily unavailable',
            status: 503,
            code: 'temporarily_unavailable',
          },
          {
            status: 503,
            headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '2' },
          },
        ),
      ),
    );
    const user = userEvent.setup();
    await open();
    await runIt(user);
    expect(await screen.findByText('The ledger is busy')).toBeInTheDocument();
    expect(screen.getByText(/in 2 seconds/)).toBeInTheDocument();
  });
});

describe('the session history and comparison (R10.4)', () => {
  async function twoRuns(user: User, between?: () => Promise<void> | void) {
    await runIt(user);
    await screen.findByRole('region', { name: 'Report 1' });
    await between?.();
    await runIt(user);
    await screen.findByRole('region', { name: 'Report 2' });
  }

  it('lists the reports of the session, newest first, and shows any of them on request', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('radio', { name: 'Deep' }));
    await twoRuns(user);
    const rows = within(screen.getByRole('table', { name: /Reports of this session/ }))
      .getAllByRole('row')
      .slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^2Deep/),
      expect.stringMatching(/^1Deep/),
    ]);
    expect(rows[0]).toHaveTextContent('Consistent');
    await user.click(screen.getByRole('button', { name: 'Show report 1' }));
    expect(screen.getByRole('region', { name: 'Report 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show report 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Show report 2' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('tells the person that the reports are forgotten on reload', async () => {
    const user = userEvent.setup();
    await open();
    await runIt(user);
    await report();
    expect(screen.getByText(/Reloading forgets them/)).toBeInTheDocument();
  });

  it('keeps the reports when the person goes to another page and back', async () => {
    const user = userEvent.setup();
    await open();
    await runIt(user);
    await report();
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await user.click(screen.getByRole('link', { name: 'Reconciliation' }));
    await screen.findByRole('heading', { level: 1, name: 'Reconciliation' });
    expect(screen.getByRole('table', { name: /Reports of this session/ })).toBeInTheDocument();
    expect(screen.getByTestId('no-report')).toHaveTextContent('There is no current report'); // not the old one, as current
  });

  it('compares two reports: a problem that appeared between them', async () => {
    const user = userEvent.setup();
    await open();
    await twoRuns(user, () => {
      sim.tamperBalance(wallet, 7n);
    });
    await user.selectOptions(screen.getByLabelText('First report'), 'Report 1 (standard)');
    await user.selectOptions(screen.getByLabelText('Second report'), 'Report 2 (standard)');
    const cmp = await screen.findByRole('region', { name: 'Report 1 compared with report 2' });
    expect(cmp).toHaveTextContent('Worse: problems appeared and none went away.');
    expect(cmp).toHaveTextContent('Balance mismatches: 1 new, 0 resolved, 0 changed, 0 the same.');
    const row = within(cmp).getAllByRole('row')[1];
    expect(row).toHaveTextContent('wallet');
    expect(row).toHaveTextContent('New mismatch');
    expect(row).toHaveTextContent('100.07 USD');
  });

  it('compares in time order whichever way round they are chosen', async () => {
    const user = userEvent.setup();
    await open();
    await twoRuns(user, () => {
      sim.tamperBalance(wallet, 7n);
    });
    await user.selectOptions(screen.getByLabelText('First report'), 'Report 2 (standard)');
    await user.selectOptions(screen.getByLabelText('Second report'), 'Report 1 (standard)');
    expect(
      await screen.findByRole('region', { name: 'Report 1 compared with report 2' }),
    ).toHaveTextContent('Worse');
  });

  it('says a problem was resolved when it is gone in the later report', async () => {
    sim.tamperBalance(wallet, 7n);
    const user = userEvent.setup();
    await open();
    await twoRuns(user, () => {
      sim.tamperBalance(wallet, -7n);
    });
    await user.selectOptions(screen.getByLabelText('First report'), 'Report 1 (standard)');
    await user.selectOptions(screen.getByLabelText('Second report'), 'Report 2 (standard)');
    const cmp = await screen.findByRole('region', { name: 'Report 1 compared with report 2' });
    expect(cmp).toHaveTextContent('Better: problems went away and none appeared.');
    expect(within(cmp).getAllByRole('row')[1]).toHaveTextContent('Resolved');
  });

  it('does not compare chains when one report was standard, and says why', async () => {
    const user = userEvent.setup();
    await open();
    await runIt(user);
    await screen.findByRole('region', { name: 'Report 1' });
    await user.click(screen.getByRole('radio', { name: 'Deep' }));
    await runIt(user);
    await screen.findByRole('region', { name: 'Report 2' });
    await user.selectOptions(screen.getByLabelText('First report'), 'Report 1 (standard)');
    await user.selectOptions(screen.getByLabelText('Second report'), 'Report 2 (deep)');
    expect(await screen.findByText(/Balance chains: not compared/)).toBeInTheDocument();
  });

  it('asks for two different reports, and offers a comparison only once there are two', async () => {
    const user = userEvent.setup();
    await open();
    await runIt(user);
    await screen.findByRole('region', { name: 'Report 1' });
    expect(screen.queryByText('Compare two reports')).not.toBeInTheDocument();
    await runIt(user);
    await screen.findByRole('region', { name: 'Report 2' });
    await user.selectOptions(screen.getByLabelText('First report'), 'Report 1 (standard)');
    await user.selectOptions(screen.getByLabelText('Second report'), 'Report 1 (standard)');
    expect(screen.getByText('Choose two different reports.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /compared with/ })).not.toBeInTheDocument();
  });

  it('has no accessibility violations with a comparison showing', async () => {
    const user = userEvent.setup();
    const { container } = await open();
    await twoRuns(user, () => {
      sim.tamperBalance(wallet, 7n);
    });
    await user.selectOptions(screen.getByLabelText('First report'), 'Report 1 (standard)');
    await user.selectOptions(screen.getByLabelText('Second report'), 'Report 2 (standard)');
    await screen.findByRole('region', { name: 'Report 1 compared with report 2' });
    await expectNoAccessibilityViolations(container);
  });
});
