import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoAccessibilityViolations } from '../test/axe';
import { ErrorSummary } from './ErrorSummary';

const items = [
  { key: 'code', label: 'Code', message: 'Enter a code' },
  { key: 'currency', label: 'Currency', message: 'Enter a currency' },
];

describe('ErrorSummary', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <ErrorSummary items={items} focusKey={1} onSelect={() => undefined} />,
    );
    await expectNoAccessibilityViolations(container);
  });

  it('is an alert that says how many problems there are, and lists them', () => {
    render(<ErrorSummary items={items} focusKey={1} onSelect={() => undefined} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('There are 2 problems to fix');
    expect(alert).toHaveTextContent('Code: Enter a code');
    expect(alert).toHaveTextContent('Currency: Enter a currency');
  });

  it('uses the singular for one problem', () => {
    render(<ErrorSummary items={items.slice(0, 1)} focusKey={1} onSelect={() => undefined} />);
    expect(screen.getByRole('alert')).toHaveTextContent('There is 1 problem to fix');
  });

  it('takes focus when the focus key changes, not before the first failed submit', () => {
    const { rerender } = render(
      <ErrorSummary items={items} focusKey={0} onSelect={() => undefined} />,
    );
    expect(screen.getByRole('alert')).not.toHaveFocus();
    rerender(<ErrorSummary items={items} focusKey={1} onSelect={() => undefined} />);
    expect(screen.getByRole('alert')).toHaveFocus();
  });

  it('takes focus again on the next failed submit', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <>
        <button type="button">elsewhere</button>
        <ErrorSummary items={items} focusKey={1} onSelect={() => undefined} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    rerender(
      <>
        <button type="button">elsewhere</button>
        <ErrorSummary items={items} focusKey={2} onSelect={() => undefined} />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveFocus();
  });

  it('hands the chosen field back, by mouse or keyboard', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ErrorSummary items={items} focusKey={0} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Code' }));
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onSelect.mock.calls).toEqual([['code'], ['currency']]);
  });
});
