import { createPair, deposit, expect, newApi, test, unique } from './support';

/*
 * Using the console without a mouse. jsdom cannot do most of this: it has no real focus, no
 * top layer for dialogs and no style, so these are the tests that show it in a browser.
 */

test('the first Tab reaches a link that skips the navigation, and it works', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  // It was hidden until focused; now it can be seen (it has a size on screen).
  const box = await skip.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(40);
  expect(box?.height ?? 0).toBeGreaterThan(10);

  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

test('every control that takes focus shows where the focus is', async ({ page }) => {
  await page.goto('/accounts');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Accounts');
  const seen: string[] = [];
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth),
      };
    });
    if (outline === null) continue;
    seen.push(outline.tag);
    expect(outline.style, `the ${outline.tag} focused after ${String(i + 1)} tabs`).not.toBe(
      'none',
    );
    expect(outline.width).toBeGreaterThanOrEqual(2);
  }
  expect(seen.length).toBeGreaterThan(8);
});

test('moving to another page puts the focus on its heading, and the order of the tab key is the order on the page', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeFocused();
  await expect(page).toHaveTitle(/^Accounts · /);

  // After the heading, the next stop is the first thing below it: the filter, not the menu.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Code starts with' })).toBeFocused();
});

test('a dialog holds the focus, and Escape closes it and gives the focus back', async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await newApi(playwright, baseURL);
  const { bank, wallet } = await createPair(api, unique('e2e-key'));
  const posted = await deposit(api, bank, wallet, '100');

  await page.goto(`/transactions/${posted.id}`);
  const opener = page.getByRole('button', { name: 'Reverse this transaction' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Reverse this transaction?' });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('dialog') !== null))
    .toBe(true);

  // Tab forwards and backwards for longer than the dialog has controls. A native modal dialog
  // lets the focus go out to the browser's own controls (then it comes back in), as the
  // platform does; what it must never do is land on the page behind, which is inert.
  const where = (): Promise<'dialog' | 'browser' | 'page behind'> =>
    page.evaluate(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) return 'browser';
      return active.closest('dialog') !== null ? 'dialog' : 'page behind';
    });
  let insideAtLeastOnce = false;
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press(key);
      const place = await where();
      expect(place, `after ${String(i + 1)} presses of ${key}`).not.toBe('page behind');
      if (place === 'dialog') insideAtLeastOnce = true;
    }
  }
  expect(insideAtLeastOnce).toBe(true);

  // The links of the navigation behind it cannot be reached or clicked.
  expect(await page.getByRole('link', { name: 'Accounts', exact: true }).isEnabled()).toBe(true);
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveJSProperty('inert', false); // not marked...
  expect(
    await page.evaluate(() => document.querySelector('nav a')?.matches(':modal *') ?? false),
  ).toBe(false);
  await expect(
    page.getByRole('link', { name: 'Accounts', exact: true }).click({ timeout: 1000, trial: true }),
  ).rejects.toThrow(/intercepts pointer events|not receive pointer events|timeout/i);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await api.dispose();
});

test('the unbalanced-transaction dialog starts on the safe choice', async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await newApi(playwright, baseURL);
  const name = unique('e2e-safe');
  const { bank, wallet } = await createPair(api, name);
  await page.goto('/transactions/new');
  await page.getByLabel('Show accounts whose code starts with').fill(name);
  await page.getByLabel('Account for posting 1').selectOption({ label: `${bank.code} (USD)` });
  await page.getByLabel('Account for posting 2').selectOption({ label: `${wallet.code} (USD)` });
  await page.getByLabel('Amount of posting 1').fill('5');
  await page.getByLabel('Amount of posting 2').fill('4');
  await page.getByRole('button', { name: 'Send transaction' }).click();

  const dialog = page.getByRole('dialog', { name: 'This transaction does not balance' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused(); // not "Send anyway"
  await api.dispose();
});
