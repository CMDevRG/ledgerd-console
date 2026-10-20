import { createAccount, expect, expectAccessible, test, unique } from './support';

test('creates an account from the form, finds it in the list, and opens it', async ({ page }) => {
  const code = unique('e2e-acct');
  await page.goto('/accounts');
  await page.getByLabel(/^Code \(required\)/).fill(code);
  await page.getByLabel(/^Currency \(required\)/).fill('usd'); // typed in lower case: written in capitals
  await expect(page.getByLabel(/^Currency \(required\)/)).toHaveValue('USD');
  await page.getByLabel(/^Type/).selectOption('LIABILITY');
  // The conventional side is suggested for a liability.
  await expect(page.getByLabel(/^Normal balance/)).toHaveValue('CREDIT');
  await page.getByRole('button', { name: 'Create account' }).click();

  const notice = page.getByText(`was created`).locator('..');
  await expect(notice).toContainText(code);
  await expect(page.getByRole('link', { name: code, exact: true })).toBeVisible(); // in the list
  await expectAccessible(page, 'the accounts page after creating one');

  await page.getByRole('link', { name: `Open ${code}` }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Account ${code}`);
  await expect(page.getByRole('region', { name: 'Balance now' })).toContainText('0.00 USD');
  await expect(page.getByText('No postings yet.')).toBeVisible();
});

test('checks the form first: every problem at once, in a summary that takes focus', async ({
  page,
}) => {
  await page.goto('/accounts');
  await page.getByRole('button', { name: 'Create account' }).click();
  const summary = page.getByRole('alert');
  await expect(summary).toContainText('There are 4 problems to fix');
  await expect(summary).toBeFocused();
  await expect(page.getByLabel(/^Code \(required\)/)).toHaveAccessibleDescription(/Enter a code/);
  await expectAccessible(page, 'the account form with errors');

  // A summary line leads to its field.
  await summary.getByRole('button', { name: 'Currency' }).click();
  await expect(page.getByLabel(/^Currency \(required\)/)).toBeFocused();
});

test('shows the refusal of a duplicate code from the real ledgerd, beside the field, and keeps the input', async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const taken = await createAccount(api, { code: unique('e2e-dup') });
  await api.dispose();

  await page.goto('/accounts');
  await page.getByLabel(/^Code \(required\)/).fill(taken.code);
  await page.getByLabel(/^Currency \(required\)/).fill('USD');
  await page.getByLabel(/^Type/).selectOption('ASSET');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByLabel(/^Code \(required\)/)).toHaveAccessibleDescription(
    /An account with this code already exists/,
  );
  await expect(page.getByLabel(/^Code \(required\)/)).toHaveValue(taken.code);
  await expect(page.getByLabel(/^Currency \(required\)/)).toHaveValue('USD');
  await expect(page.getByRole('alert')).toBeFocused();
});

test('filters the list by code prefix and currency, in the address', async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const prefix = unique('e2e-filter');
  const usd = await createAccount(api, { code: `${prefix}-usd` });
  const eur = await createAccount(api, { code: `${prefix}-eur`, currency: 'EUR' });
  await api.dispose();

  await page.goto(`/accounts?code=${prefix}`);
  await expect(page.getByRole('link', { name: usd.code })).toBeVisible();
  await expect(page.getByRole('link', { name: eur.code })).toBeVisible();

  const filters = page.getByRole('search', { name: 'Filter accounts' });
  await filters.getByRole('textbox', { name: 'Currency' }).fill('eur');
  await filters.getByRole('button', { name: 'Filter' }).click();
  await expect(page).toHaveURL(new RegExp(`code=${prefix}&currency=EUR`));
  await expect(page.getByRole('link', { name: eur.code })).toBeVisible();
  await expect(page.getByRole('link', { name: usd.code })).toHaveCount(0);

  await page.goBack(); // the back button restores the earlier filter
  await expect(page.getByRole('link', { name: usd.code })).toBeVisible();
});
