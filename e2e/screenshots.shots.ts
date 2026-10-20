import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { APIRequestContext, Locator, Page } from '@playwright/test';

import {
  createAccount,
  expect,
  newApi,
  test,
  useTheme,
  type Account,
  type AccountSeed,
} from './support';

/*
 * One screenshot per important page, taken from a real console over a real ledger. They show what
 * the README describes; the names are what the README links to. Data is created for the occasion
 * with fixed, readable codes, so run it against a fresh stack (`make screenshots` starts one).
 */

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
mkdirSync(OUT, { recursive: true });

/** A whole page (not only the part that fits the window), or just the element. */
const shot = async (
  target: Page | Locator,
  name: string,
  options: { whole?: boolean } = {},
): Promise<void> => {
  const path = join(OUT, `${name}.png`);
  if ('goto' in target)
    await target.screenshot({ path, animations: 'disabled', fullPage: options.whole ?? true });
  else await target.screenshot({ path, animations: 'disabled' });
};

let wallet = '';
let multiPosting = '';

/** Creates an account, or finds it if an earlier (failed) run already made it. */
async function ensureAccount(api: APIRequestContext, seed: AccountSeed): Promise<Account> {
  const existing = await api.get(`/api/v1/accounts?code_prefix=${seed.code}`);
  const found = (
    (await existing.json()) as { accounts: (Account & { code: string })[] }
  ).accounts.find((a) => a.code === seed.code);
  return found ?? createAccount(api, seed);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await newApi(playwright, baseURL);
  const b = await ensureAccount(api, {
    code: 'demo-bank',
    type: 'ASSET',
    normal_balance: 'DEBIT',
    allow_negative: true,
  });
  const w = await ensureAccount(api, {
    code: 'demo-wallet',
    type: 'LIABILITY',
    normal_balance: 'CREDIT',
  });
  await ensureAccount(api, { code: 'demo-savings', type: 'LIABILITY', normal_balance: 'CREDIT' });
  await ensureAccount(api, {
    code: 'demo-euro-bank',
    currency: 'EUR',
    type: 'ASSET',
    normal_balance: 'DEBIT',
    allow_negative: true,
  });
  wallet = w.id;
  // The same keys each time: a second run repeats these requests and gets the first run's answers.
  for (const [i, amount] of ['12000', '4550', '2500', '30075'].entries()) {
    await api.post('/api/v1/transactions', {
      headers: { 'X-Ledgerd-Console': '1', 'Idempotency-Key': `shots-deposit-${String(i)}` },
      data: {
        description: 'Deposit',
        postings: [
          { account_id: b.id, direction: 'DEBIT', amount, currency: 'USD' },
          { account_id: w.id, direction: 'CREDIT', amount, currency: 'USD' },
        ],
      },
    });
  }
  // One transaction that touches the wallet twice: its first posting is an intermediate step.
  const multi = await api.post('/api/v1/transactions', {
    headers: { 'X-Ledgerd-Console': '1', 'Idempotency-Key': 'shots-multi' },
    data: {
      description: 'Fee and refund in one transaction',
      postings: [
        { account_id: w.id, direction: 'DEBIT', amount: '500', currency: 'USD' },
        { account_id: w.id, direction: 'CREDIT', amount: '200', currency: 'USD' },
        { account_id: b.id, direction: 'CREDIT', amount: '300', currency: 'USD' },
      ],
    },
  });
  multiPosting = ((await multi.json()) as { id: string }).id;
  await api.dispose();
});

const settled = async (page: Page): Promise<void> => {
  await expect(page.getByText('API ready')).toBeVisible();
  await page.waitForLoadState('networkidle');
};

test('overview', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByText(/ledgerd is ready/)).toBeVisible();
  await settled(page);
  await shot(page, 'overview');
});

test('accounts', async ({ page }) => {
  await page.goto('/accounts?code=demo');
  await expect(page.getByRole('link', { name: 'demo-wallet' })).toBeVisible();
  await settled(page);
  await shot(page, 'accounts');
});

test('a transaction, with the button that reverses it', async ({ page }) => {
  await page.goto(`/transactions/${multiPosting}`);
  await expect(page.getByRole('heading', { level: 1, name: /^Transaction / })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reverse' })).toBeVisible();
  await settled(page);
  await shot(page, 'transaction');
});

test('looking a transaction up by its id', async ({ page }) => {
  await page.goto('/transactions');
  await expect(page.getByRole('heading', { level: 1, name: 'Transactions' })).toBeVisible();
  await settled(page);
  await shot(page, 'transaction-lookup');
});

test('settings', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await settled(page);
  await shot(page, 'settings');
});

test('account detail with its history', async ({ page }) => {
  await page.goto(`/accounts/${wallet}`);
  await expect(page.getByRole('table', { name: 'Postings, newest first' })).toBeVisible();
  await expect(page.getByText('Intermediate', { exact: true }).first()).toBeVisible();
  await settled(page);
  await shot(page, 'account-detail');
});

test('the transaction builder, balanced', async ({ page }) => {
  await page.goto('/transactions/new');
  await page.getByLabel('Show accounts whose code starts with').fill('demo-');
  await page.getByLabel('Account for posting 1').selectOption({ label: 'demo-bank (USD)' });
  await page.getByLabel('Account for posting 2').selectOption({ label: 'demo-wallet (USD)' });
  await page.getByLabel('Amount of posting 1').fill('250.00');
  await page.getByLabel('Amount of posting 2').fill('250.00');
  await page.getByLabel('Description').fill('Top-up');
  await expect(page.getByRole('region', { name: 'Totals', exact: true })).toContainText(
    'balances in every currency',
  );
  await settled(page);
  await shot(page, 'new-transaction');
});

test('a result, and a repeat that is a replay', async ({ page }) => {
  await page.goto('/transactions/new');
  await page.getByLabel('Show accounts whose code starts with').fill('demo-');
  await page.getByLabel('Account for posting 1').selectOption({ label: 'demo-bank (USD)' });
  await page.getByLabel('Account for posting 2').selectOption({ label: 'demo-wallet (USD)' });
  await page.getByLabel('Amount of posting 1').fill('18.25');
  await page.getByLabel('Amount of posting 2').fill('18.25');
  await page.getByLabel('Description').fill('Deposit 18.25');
  await page.getByRole('button', { name: 'Send transaction' }).click();
  const result = page.getByRole('region', { name: /Transaction posted/ });
  await expect(result).toBeVisible();
  await result.getByRole('button', { name: 'Send the same request again' }).click();
  await expect(result.getByText('This was a replay')).toBeVisible();
  await settled(page);
  await shot(result, 'replay');
});

test('an overdraft, refused', async ({ page }) => {
  await page.goto('/transactions/new');
  await page.getByLabel('Show accounts whose code starts with').fill('demo-');
  await page.getByLabel('Account for posting 1').selectOption({ label: 'demo-wallet (USD)' });
  await page.getByLabel('Account for posting 2').selectOption({ label: 'demo-bank (USD)' });
  await page.getByLabel('Amount of posting 1').fill('999999');
  await page.getByLabel('Amount of posting 2').fill('999999');
  await page.getByRole('button', { name: 'Send transaction' }).click();
  await expect(page.getByText('Insufficient funds')).toBeVisible();
  await expect(page.getByText('The key was not used up')).toBeVisible();
  await settled(page);
  await shot(page, 'overdraft-refused');
});

test('the failure lab: overdraft scenario', async ({ page }) => {
  await page.goto('/lab');
  const section = page.getByRole('region', { name: 'Overdraft is refused and nothing changes' });
  await section.getByRole('button', { name: 'Run this scenario' }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Behaved as designed' })).toBeVisible({
    timeout: 60_000,
  });
  await section.locator('details').nth(2).locator('summary').click(); // the refused withdrawal
  await settled(page);
  await shot(section, 'lab-overdraft');
});

test('the failure lab: concurrency scenario', async ({ page }) => {
  await page.goto('/lab');
  const section = page.getByRole('region', { name: 'Simultaneous withdrawals never overdraw' });
  await section.getByRole('button', { name: 'Run this scenario' }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Behaved as designed' })).toBeVisible({
    timeout: 60_000,
  });
  await settled(page);
  await shot(section, 'lab-concurrency');
});

test('reconciliation', async ({ page }) => {
  await page.goto('/reconciliation');
  await page.getByRole('radio', { name: 'Deep' }).check();
  await page.getByRole('button', { name: 'Run reconciliation' }).click();
  await expect(page.getByRole('region', { name: 'Report 1' })).toBeVisible({ timeout: 60_000 });
  await settled(page);
  await shot(page, 'reconciliation');
});

test('benchmark', async ({ page }) => {
  await page.goto('/benchmark');
  await expect(page.getByRole('img', { name: 'Transfers per second' })).toBeVisible();
  await settled(page);
  await shot(page.getByRole('region', { name: 'Results', exact: true }), 'benchmark-charts');
});

test.describe('dark theme', () => {
  test('account detail', async ({ page }) => {
    await useTheme(page, 'dark');
    await page.goto(`/accounts/${wallet}`);
    await expect(page.getByRole('table', { name: 'Postings, newest first' })).toBeVisible();
    await settled(page);
    await shot(page, 'dark-account-detail');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  test('the transaction builder', async ({ page }) => {
    await page.goto('/transactions/new');
    await page.getByLabel('Show accounts whose code starts with').fill('demo-');
    await page.getByLabel('Account for posting 1').selectOption({ label: 'demo-bank (USD)' });
    await page.getByLabel('Account for posting 2').selectOption({ label: 'demo-wallet (USD)' });
    await page.getByLabel('Amount of posting 1').fill('40');
    await page.getByLabel('Amount of posting 2').fill('40');
    await settled(page);
    await shot(page, 'mobile-new-transaction', { whole: false });
  });
});
