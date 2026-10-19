import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../../test/axe';
import { SvgBarChart } from './SvgBarChart';

const props = {
  title: 'Throughput',
  description: 'Transfers per second for 10, 20 and 40 virtual users. Spread is higher than hot.',
  categories: ['10 virtual users', '20 virtual users', '40 virtual users'],
  series: [
    { name: 'Spread', values: [210, 216, 274] },
    { name: 'Hot account', values: [69, null, 80] },
  ],
  unit: 'Transfers per second',
};

describe('SvgBarChart', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(<SvgBarChart {...props} />);
    await expectNoAccessibilityViolations(container);
  });

  it('is one image with a title and a description (not a pile of shapes)', () => {
    render(<SvgBarChart {...props} />);
    const image = screen.getByRole('img', { name: 'Throughput' });
    expect(image).toHaveAccessibleDescription(props.description);
  });

  it('carries the same numbers in a table, which is the accessible equivalent (R11.6)', () => {
    render(<SvgBarChart {...props} />);
    const table = screen.getByRole('table', { name: 'Throughput: the numbers' });
    const rows = within(table).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Transfers per secondSpreadHot account',
      '10 virtual users21069',
      '20 virtual users216not recorded',
      '40 virtual users27480',
    ]);
    expect(within(rows[1] ?? table).getByRole('rowheader')).toHaveTextContent('10 virtual users');
  });

  it('writes the value on each bar, and draws no bar where there is no value', () => {
    const { container } = render(<SvgBarChart {...props} />);
    expect(container.querySelectorAll('svg[role="img"] rect.fill-blue-800')).toHaveLength(3);
    expect(container.querySelectorAll('svg[role="img"] rect.fill-orange-700')).toHaveLength(2); // one is missing
    const labels = [...container.querySelectorAll('svg[role="img"] text')].map(
      (t) => t.textContent,
    );
    for (const value of ['210', '216', '274', '69', '80']) expect(labels).toContain(value);
  });

  it('names the series in a legend and tells them apart without colour (a pattern)', () => {
    const { container } = render(<SvgBarChart {...props} />);
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Spread', 'Hot account']);
    expect(container.querySelector('pattern')).not.toBeNull();
    expect(container.querySelectorAll('rect[fill^="url(#"]').length).toBeGreaterThanOrEqual(2);
  });

  it('draws an axis that reaches the largest value, with the unit', () => {
    const { container } = render(<SvgBarChart {...props} />);
    const texts = [...container.querySelectorAll('svg[role="img"] text')].map((t) => t.textContent);
    expect(texts).toContain('300'); // the top of an axis for 274
    expect(texts).toContain('0');
    expect(texts).toContain('Transfers per second');
  });

  it("gives two charts on one page different ids, so neither draws with the other's pattern", async () => {
    const { container } = render(
      <>
        <SvgBarChart {...props} />
        <SvgBarChart {...props} title="Latency" />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    await expectNoAccessibilityViolations(container);
  });

  it('shows a chart of nothing without breaking', async () => {
    const { container } = render(
      <SvgBarChart {...props} series={[{ name: 'Spread', values: [null, null, null] }]} />,
    );
    expect(container.querySelectorAll('svg[role="img"] rect')).toHaveLength(0);
    await expectNoAccessibilityViolations(container);
  });

  it('formats values the way it is told', () => {
    render(<SvgBarChart {...props} format={(v) => `${String(v)} ms`} />);
    expect(within(screen.getByRole('table')).getByText('216 ms')).toBeInTheDocument();
  });
});
