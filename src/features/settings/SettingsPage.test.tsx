import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { expectNoAccessibilityViolations } from '../../test/axe';
import { renderApp } from '../../test/render';
import { server } from '../../test/server';

beforeEach(() => {
  server.use(http.get('*/api/readyz', () => HttpResponse.json({ status: 'ready' })));
  document.documentElement.classList.remove('dark');
});

/** The row of a currency (the name of a row would also match USDC and USDT). */
const rowOf = (currency: string): HTMLElement => {
  const row = screen.getByRole('textbox', { name: `Decimal places for ${currency}` }).closest('tr');
  if (row === null) throw new Error(`no row for ${currency}`);
  return row;
};

async function openSettings() {
  const app = renderApp('/settings');
  await screen.findByRole('heading', { level: 1, name: 'Settings' });
  return app;
}

describe('Settings: appearance', () => {
  it('has no accessibility violations', async () => {
    const { container } = await openSettings();
    await expectNoAccessibilityViolations(container);
  });

  it('offers the three themes in a labelled group, "match the system" selected by default', async () => {
    await openSettings();
    const group = screen.getByRole('group', { name: 'Theme' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => (r as HTMLInputElement).value),
    ).toEqual(['system', 'light', 'dark']);
    expect(within(group).getByRole('radio', { name: 'Match the system' })).toBeChecked();
  });

  it('switching to dark saves the choice and darkens the page at once', async () => {
    const user = userEvent.setup();
    const { settings } = await openSettings();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(settings.get().theme).toBe('dark');
    await waitFor(() => {
      expect(document.documentElement).toHaveClass('dark');
    });
    await user.click(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => {
      expect(document.documentElement).not.toHaveClass('dark');
    });
  });

  it('is chosen with the keyboard alone: arrow keys move through the radios', async () => {
    const user = userEvent.setup();
    const { settings } = await openSettings();
    screen.getByRole('radio', { name: 'Match the system' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(settings.get().theme).toBe('light');
    await user.keyboard('{ArrowDown}');
    expect(settings.get().theme).toBe('dark');
  });
});

describe('Settings: amounts', () => {
  it('lists the known currencies with their default decimal places', async () => {
    await openSettings();
    const table = screen.getByRole('table', { name: 'Decimal places per currency' });
    for (const [currency, scale] of [
      ['USD', '2'],
      ['JPY', '0'],
      ['BTC', '8'],
      ['ETH', '18'],
    ]) {
      expect(
        within(table).getByRole('textbox', { name: `Decimal places for ${currency}` }),
      ).toHaveValue(scale);
    }
  });

  it('shows an example that follows the setting', async () => {
    const user = userEvent.setup();
    await openSettings();
    const row = rowOf('USD');
    expect(row).toHaveTextContent('1,234,567.89 USD');
    const input = within(row).getByRole('textbox');
    await user.clear(input);
    await user.type(input, '4');
    expect(row).toHaveTextContent('12,345.6789 USD'); // while typing, before anything is saved
  });

  it('saves a valid number of decimals as an override', async () => {
    const user = userEvent.setup();
    const { settings } = await openSettings();
    const input = screen.getByRole('textbox', { name: 'Decimal places for USD' });
    await user.clear(input);
    await user.type(input, '3');
    expect(settings.get().scales).toEqual({}); // not yet: the person may still be typing
    await user.tab();
    expect(settings.get().scales).toEqual({ USD: 3 });
  });

  it('saves with Enter, and keeps focus in the field', async () => {
    const user = userEvent.setup();
    const { settings } = await openSettings();
    const input = screen.getByRole('textbox', { name: 'Decimal places for USD' });
    await user.clear(input);
    await user.type(input, '5{Enter}');
    expect(settings.get().scales).toEqual({ USD: 5 });
    expect(input).toHaveFocus();
  });

  it.each(['', 'x', '2.5', '-1', '31', '100', '1e1', ' ', '٣'])(
    'refuses %j, says why, and saves nothing',
    async (text) => {
      const user = userEvent.setup();
      const { settings } = await openSettings();
      const input = screen.getByRole('textbox', { name: 'Decimal places for USD' });
      await user.clear(input);
      if (text !== '') await user.type(input, text);
      expect(settings.get().scales).toEqual({});
      expect(input).toBeInvalid();
      expect(input).toHaveAccessibleDescription('Error: Use a whole number from 0 to 30');
    },
  );

  it('puts the saved number back when the person leaves a bad entry', async () => {
    const user = userEvent.setup();
    await openSettings();
    const input = screen.getByRole('textbox', { name: 'Decimal places for USD' });
    await user.clear(input);
    await user.type(input, 'abc');
    await user.tab();
    expect(input).toHaveValue('2');
    expect(input).toBeValid();
  });

  it('accepts the whole range, 0 and 30 included', async () => {
    const user = userEvent.setup();
    const { settings } = await openSettings();
    const input = screen.getByRole('textbox', { name: 'Decimal places for USD' });
    await user.clear(input);
    await user.type(input, '0');
    await user.tab();
    expect(settings.get().scales).toEqual({ USD: 0 });
    await user.clear(input);
    await user.type(input, '30');
    await user.tab();
    expect(settings.get().scales).toEqual({ USD: 30 });
  });

  it('forgets the override when a known currency is set back to its default', async () => {
    const user = userEvent.setup();
    const { settings } = await openSettings();
    const input = screen.getByRole('textbox', { name: 'Decimal places for USD' });
    await user.clear(input);
    await user.type(input, '4');
    await user.tab();
    expect(settings.get().scales).toEqual({ USD: 4 });
    await user.clear(input);
    await user.type(input, '2');
    await user.tab();
    expect(settings.get().scales).toEqual({});
  });

  it('resets one currency, and says so', async () => {
    const user = userEvent.setup();
    const { settings } = await openSettings();
    const input = screen.getByRole('textbox', { name: 'Decimal places for USD' });
    await user.clear(input);
    await user.type(input, '4');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Reset USD to the default' }));
    expect(settings.get().scales).toEqual({});
    expect(screen.getByRole('textbox', { name: 'Decimal places for USD' })).toHaveValue('2');
    expect(
      screen
        .getAllByRole('status')
        .some((s) => s.textContent.includes('USD reset to 2 decimal places')),
    ).toBe(true);
  });

  it('resets everything, and the button is off when there is nothing to reset', async () => {
    const user = userEvent.setup();
    const { settings } = await openSettings();
    const reset = screen.getByRole('button', { name: 'Reset all to the defaults' });
    expect(reset).toBeDisabled();
    const input = screen.getByRole('textbox', { name: 'Decimal places for USD' });
    await user.clear(input);
    await user.type(input, '4');
    await user.tab();
    expect(reset).toBeEnabled();
    await user.click(reset);
    expect(settings.get().scales).toEqual({});
  });

  it('shows whole minor units when asked', async () => {
    const user = userEvent.setup();
    const { settings } = await openSettings();
    await user.click(screen.getByRole('checkbox', { name: /whole minor units/ }));
    expect(settings.get().rawUnits).toBe(true);
    expect(rowOf('USD')).toHaveTextContent('123,456,789 USD (minor units)');
  });
});

describe('Settings: adding a currency', () => {
  async function fill(code: string, scale?: string) {
    const user = userEvent.setup();
    const app = await openSettings();
    const codeInput = screen.getByRole('textbox', { name: /Currency code/ });
    const scaleInput = screen.getByRole('textbox', {
      name: /^Decimal places/,
      description: /0 to 30/,
    });
    if (code !== '') await user.type(codeInput, code);
    if (scale !== undefined) {
      await user.clear(scaleInput);
      if (scale !== '') await user.type(scaleInput, scale);
    }
    await user.click(screen.getByRole('button', { name: 'Add currency' }));
    return { user, codeInput, scaleInput, ...app };
  }

  it('adds it with its decimals, as an override, and announces it', async () => {
    const { settings, codeInput } = await fill('eurc', '6');
    expect(settings.get().scales).toEqual({ EURC: 6 });
    expect(screen.getByRole('textbox', { name: 'Decimal places for EURC' })).toHaveValue('6');
    expect(
      screen
        .getAllByRole('status')
        .some((s) => s.textContent.includes('EURC added with 6 decimal places')),
    ).toBe(true);
    expect(codeInput).toHaveValue('');
    expect(codeInput).toHaveFocus(); // ready for the next one
  });

  it('writes the code in capitals as it is typed', async () => {
    const { codeInput } = await fill('ab');
    expect(codeInput).toHaveValue('');
    const user = userEvent.setup();
    await user.type(codeInput, 'usdc');
    expect(codeInput).toHaveValue('USDC');
  });

  it.each(['', 'A', 'TOOLONGCODE1', 'US D', 'US-D'])(
    'refuses the code %j, says why, and puts focus on it',
    async (code) => {
      const { settings, codeInput } = await fill(code, '2');
      expect(codeInput).toBeInvalid();
      expect(codeInput).toHaveAccessibleDescription(/Error: Use 2 to 10 capital letters or digits/);
      expect(codeInput).toHaveFocus();
      expect(settings.get().scales).toEqual({});
    },
  );

  it('refuses a currency that is already listed and points to the row', async () => {
    const { codeInput, settings } = await fill('USD', '4');
    expect(codeInput).toHaveAccessibleDescription(/USD is already in the list; change it there/);
    expect(settings.get().scales).toEqual({});
  });

  it.each(['', 'x', '31', '-1', '2.5'])(
    'refuses the decimals %j, says why, and puts focus on them',
    async (scale) => {
      const { scaleInput, settings } = await fill('EURC', scale);
      expect(scaleInput).toBeInvalid();
      expect(scaleInput).toHaveAccessibleDescription(/Error: Use a whole number from 0 to 30/);
      expect(scaleInput).toHaveFocus();
      expect(settings.get().scales).toEqual({});
    },
  );

  it('a custom currency keeps its row even when set to the fallback number of decimals', async () => {
    const user = userEvent.setup();
    const { settings } = await fill('EURC', '6');
    const input = screen.getByRole('textbox', { name: 'Decimal places for EURC' });
    await user.clear(input);
    await user.type(input, '2');
    await user.tab();
    expect(settings.get().scales).toEqual({ EURC: 2 });
    expect(screen.getByRole('textbox', { name: 'Decimal places for EURC' })).toBeInTheDocument();
  });

  it('has no accessibility violations with errors showing', async () => {
    const { container } = await fill('x', 'y');
    await expectNoAccessibilityViolations(container);
  });
});
