import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../test/axe';
import { Table, Td, Th } from './Table';

function Example({ hideCaption = false }: { hideCaption?: boolean }) {
  return (
    <Table caption="Accounts" hideCaption={hideCaption}>
      <thead>
        <tr>
          <Th>Code</Th>
          <Th numeric>Balance</Th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <Td>assets:cash</Td>
          <Td numeric>100.00</Td>
        </tr>
      </tbody>
    </Table>
  );
}

describe('Table', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(<Example />);
    await expectNoAccessibilityViolations(container);
    const hidden = render(<Example hideCaption />);
    await expectNoAccessibilityViolations(hidden.container);
  });

  it('is a real table with a caption and column headers', () => {
    render(<Example />);
    const table = screen.getByRole('table', { name: 'Accounts' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Code', 'Balance']);
    expect(within(table).getByRole('cell', { name: 'assets:cash' })).toBeInTheDocument();
    expect(within(table).getAllByRole('columnheader')[0]).toHaveAttribute('scope', 'col');
  });

  it('keeps the caption for screen readers when asked', () => {
    render(<Example hideCaption />);
    expect(screen.getByRole('table', { name: 'Accounts' })).toBeInTheDocument();
    expect(screen.getByText('Accounts')).toHaveClass('sr-only');
  });

  it('scrolls inside its own container, which a keyboard user can reach and which has a name', async () => {
    const user = userEvent.setup();
    render(<Example />);
    const region = screen.getByRole('region', { name: 'Accounts' });
    expect(region).toHaveClass('overflow-x-auto');
    await user.tab();
    expect(region).toHaveFocus();
  });
});
