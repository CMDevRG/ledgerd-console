import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../test/axe';
import { formatTimestamp, Time } from './Time';

describe('formatTimestamp', () => {
  it.each([
    ['2026-10-13T15:04:05.123456Z', '2026-10-13 15:04:05.123 UTC'],
    ['2026-10-13T15:04:05Z', '2026-10-13 15:04:05 UTC'],
    ['2026-10-13T15:04:05.5Z', '2026-10-13 15:04:05.5 UTC'],
    ['2026-10-13T15:04:05.000000Z', '2026-10-13 15:04:05.000 UTC'],
  ])('%s -> %s', (input, expected) => {
    expect(formatTimestamp(input)).toBe(expected);
  });

  it.each(['', 'yesterday', '2026-10-13', '2026-10-13T15:04:05+02:00', '2026-10-13 15:04:05'])(
    'leaves %j as it came, rather than guessing',
    (input) => {
      expect(formatTimestamp(input)).toBe(input);
    },
  );
});

describe('Time', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(<Time iso="2026-10-13T15:04:05.123456Z" />);
    await expectNoAccessibilityViolations(container);
  });

  it('is a <time> element with the exact timestamp for machines and for hovering', () => {
    render(<Time iso="2026-10-13T15:04:05.123456Z" />);
    const element = screen.getByText('2026-10-13 15:04:05.123 UTC');
    expect(element.tagName).toBe('TIME');
    expect(element).toHaveAttribute('datetime', '2026-10-13T15:04:05.123456Z');
    expect(element).toHaveAttribute('title', '2026-10-13T15:04:05.123456Z');
  });
});
