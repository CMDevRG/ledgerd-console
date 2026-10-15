import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../test/axe';
import { Loading, Refreshing } from './Status';

describe('Loading', () => {
  it('has no accessibility violations, and says what is loading', async () => {
    const { container } = render(<Loading what="accounts" />);
    await expectNoAccessibilityViolations(container);
    expect(screen.getByRole('status')).toHaveTextContent('Loading accounts…');
  });
});

describe('Refreshing', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(<Refreshing active />);
    await expectNoAccessibilityViolations(container);
  });

  it('is visible while refreshing and keeps its place when not (so nothing jumps)', () => {
    const { rerender } = render(<Refreshing active />);
    expect(screen.getByText('Refreshing…')).not.toHaveClass('invisible');
    rerender(<Refreshing active={false} />);
    expect(screen.getByText('Refreshing…')).toHaveClass('invisible');
  });

  it('is not announced: a poll every ten seconds would be noise', () => {
    render(<Refreshing active />);
    expect(screen.getByText('Refreshing…')).toHaveAttribute('aria-hidden', 'true');
  });
});
