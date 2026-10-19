import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../../test/axe';
import { renderApp } from '../../test/render';
import { mockReadiness } from '../../test/readiness';
import data from '../../../data/benchmark.json';
import BenchmarkPage, { BenchmarkContent } from './BenchmarkPage';

const show = (raw: unknown) =>
  render(
    <MemoryRouter>
      <BenchmarkContent raw={raw} />
    </MemoryRouter>,
  );

describe('the benchmark page with the real data file', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <MemoryRouter>
        <BenchmarkPage />
      </MemoryRouter>,
    );
    await expectNoAccessibilityViolations(container);
  });

  it("says first that these are one machine's numbers and not promises (R11.3)", () => {
    show(data);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('One machine, not a promise');
    expect(note).toHaveTextContent('not guarantees or capacity claims');
    expect(note).toHaveTextContent('make bench');
  });

  it('explains spread and hot account in plain words (R11.3)', () => {
    show(data);
    const what = screen.getByRole('region', { name: 'What was measured' });
    expect(within(what).getByText('Spread')).toBeInTheDocument();
    expect(what).toHaveTextContent('rarely need the same account');
    expect(within(what).getByText('Hot account')).toBeInTheDocument();
    expect(what).toHaveTextContent('every transfer credits the same account');
    expect(what).toHaveTextContent('split it into several sub-accounts');
    expect(what).toHaveTextContent('saturation');
  });

  it('works out the hot-account share from the data, not from a number typed into the page', () => {
    show(data);
    expect(screen.getByRole('region', { name: 'What was measured' })).toHaveTextContent(
      'With 40 virtual users the hot account reached 29% of the spread rate.',
    );
  });

  it('draws the two charts, each a titled image with a description and its own table of numbers (R11.6)', () => {
    show(data);
    const throughput = screen.getByRole('img', { name: 'Transfers per second' });
    expect(throughput).toHaveAccessibleDescription(
      /at 10, 20, 40 virtual users\. Spread scenario: 210, 216, 274\. Hot account scenario: 69, 75, 80\./,
    );
    const latency = screen.getByRole('img', { name: 'Latency at the 95th percentile' });
    expect(latency).toHaveAccessibleDescription(
      /Spread scenario: 85, 173, 215\. Hot account scenario: 312, 571, 709\./,
    );
    expect(
      screen.getByRole('table', { name: 'Transfers per second: the numbers' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: 'Latency at the 95th percentile: the numbers' }),
    ).toBeInTheDocument();
  });

  it('lists every run with the percentiles, and says "not recorded" for what was not measured (R11.1)', () => {
    show(data);
    const table = screen.getByRole('table', { name: 'Every measured run' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(7);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      'Virtual users',
      'Scenario',
      'Transfers/s',
      'p50',
      'p90',
      'p95',
      'p99',
      'Max',
      'Failed',
    ]);
    expect(rows[1]).toHaveTextContent('10Spread21041 msnot recorded85 ms145 msnot recorded0%');
    expect(rows[5]).toHaveTextContent('40Spread274137 ms190 ms215 ms295 ms486 ms0%');
    expect(rows[6]).toHaveTextContent('40Hot account80511 ms632 ms709 ms856 ms1185 ms0%');
  });

  it('shows the conditions: commit as a link, date, load, hardware, software and configuration (R11.2)', () => {
    show(data);
    const conditions = screen.getByRole('region', { name: 'Conditions' });
    expect(within(conditions).getByRole('link', { name: '7389ee7' })).toHaveAttribute(
      'href',
      'https://github.com/CMDevRG/ledgerd/commit/7389ee7',
    );
    expect(conditions).toHaveTextContent('2026-10-14 14:55:32 UTC');
    expect(conditions).toHaveTextContent(
      'k6 2.3.0, 40 virtual users per scenario, 20 s per scenario',
    );
    expect(conditions).toHaveTextContent('AMD Ryzen 5 3500U');
    expect(conditions).toHaveTextContent('Docker 29.7.2');
    expect(conditions).toHaveTextContent('PostgreSQL 16.15');
    expect(conditions).toHaveTextContent('LEDGERD_DB_MAX_CONNS=20');
    expect(conditions).toHaveTextContent('Docker named volume');
  });

  it('shows the notes that say where the figures came from', () => {
    show(data);
    expect(
      screen.getByText(/The 10 and 20 virtual-user rows are the figures published/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Run-to-run variation is about 15 percent/)).toBeInTheDocument();
  });

  it('is reached from the navigation, with its own title', async () => {
    mockReadiness('ready');
    renderApp('/benchmark');
    expect(await screen.findByRole('heading', { level: 1, name: 'Benchmark' })).toBeInTheDocument();
    expect(document.title).toBe('Benchmark · ledgerd console');
    expect(screen.getByRole('link', { name: 'Benchmark' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('data that is not valid (R11.4)', () => {
  it.each([
    ['not an object', 'text'],
    ['empty', {}],
    ['without runs', { ...data, runs: [] }],
    [
      'with a percentile out of order',
      { ...data, runs: data.runs.map((r, i) => (i === 0 ? { ...r, p95: 1 } : r)) },
    ],
  ])('shows no numbers, only a message, for a file that is %s', async (_name, raw) => {
    const { container } = show(raw);
    expect(screen.getByRole('alert')).toHaveTextContent('The benchmark data cannot be shown');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await expectNoAccessibilityViolations(container);
  });
});
