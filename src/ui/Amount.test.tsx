import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SettingsProvider } from '../features/settings/SettingsProvider';
import { createSettingsStore, DEFAULT_SETTINGS, type Settings } from '../features/settings/store';
import { expectNoAccessibilityViolations } from '../test/axe';
import { Amount } from './Amount';

function renderAmount(ui: React.ReactElement, settings: Partial<Settings> = {}) {
  const store = createSettingsStore(undefined);
  store.set({ ...DEFAULT_SETTINGS, ...settings });
  return render(<SettingsProvider store={store}>{ui}</SettingsProvider>);
}

/** The text of a rendered amount as a reader would take it in, spaces normalised. */
const text = (container: HTMLElement): string => container.textContent.replace(/\s+/g, ' ').trim();

describe('Amount', () => {
  it('has no accessibility violations', async () => {
    const { container } = renderAmount(
      <p>
        <Amount minor={123456n} currency="USD" /> <Amount minor={-5n} currency="USD" />
      </p>,
    );
    await expectNoAccessibilityViolations(container);
  });

  it('shows exact digits with the scale of the currency', () => {
    expect(text(renderAmount(<Amount minor="123456" currency="USD" />).container)).toBe(
      '1,234.56 USD',
    );
    expect(text(renderAmount(<Amount minor="1500" currency="JPY" />).container)).toBe('1,500 JPY');
    expect(text(renderAmount(<Amount minor="1" currency="BTC" />).container)).toBe(
      '0.00000001 BTC',
    );
    expect(text(renderAmount(<Amount minor="5" currency="XYZ" />).container)).toBe('0.05 XYZ'); // unknown: 2
  });

  it('is exact beyond what a floating-point number can hold', () => {
    // 10^30 + 1 minor units: a double would print 1e+28 and lose the last digits.
    const { container } = renderAmount(
      <Amount minor="1000000000000000000000000000001" currency="USD" />,
    );
    expect(text(container)).toBe('10,000,000,000,000,000,000,000,000,000.01 USD');
  });

  it("uses the user's scale for the currency", () => {
    const { container } = renderAmount(<Amount minor="123456" currency="USD" />, {
      scales: { USD: 4 },
    });
    expect(text(container)).toBe('12.3456 USD');
  });

  it('lets a scale given by the caller win', () => {
    const { container } = renderAmount(<Amount minor="123456" currency="USD" scale={0} />, {
      scales: { USD: 4 },
    });
    expect(text(container)).toBe('123,456 USD');
  });

  it('shows a negative amount with a minus sign that is read as "minus"', () => {
    const { container } = renderAmount(<Amount minor={-1250n} currency="USD" />);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('-');
    expect(screen.getByText(/minus/)).toHaveClass('sr-only');
    // A screen reader hears: "minus 12.50 USD"; the sighted see: "-12.50 USD".
    expect(text(container)).toBe('-minus 12.50 USD');
  });

  it('shows no sign for zero or positive amounts', () => {
    const { container } = renderAmount(<Amount minor={0n} currency="USD" />);
    expect(text(container)).toBe('0.00 USD');
  });

  it('shows the whole minor units when the raw-units setting is on', () => {
    const { container } = renderAmount(<Amount minor="123456" currency="USD" />, {
      rawUnits: true,
    });
    expect(text(container)).toBe('123,456 USD (minor units)');
  });

  it('works without a settings provider, with the defaults', () => {
    const { container } = render(<Amount minor="100" currency="EUR" />);
    expect(text(container)).toBe('1.00 EUR');
  });
});
