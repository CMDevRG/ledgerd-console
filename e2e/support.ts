import axe from 'axe-core';
import {
  expect,
  test as base,
  type APIRequestContext,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test';

/*
 * Helpers for the end-to-end tests.
 *
 * The tests use the console as a person does, through the browser; they set data up through the
 * console's own API (a request context), which needs the header the console demands of writes.
 */

/** What the browser logs when a refusal is deliberate: the network layer says so, and that is fine. */
const isExpectedNoise = (text: string): boolean => text.startsWith('Failed to load resource');

export const test = base.extend<{ problems: string[] }>({
  // Every test fails on a script error or a Content Security Policy violation, whatever it was
  // about. (A request that ledgerd refused on purpose is logged by the browser too; not an error.)
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error' && !isExpectedNoise(message.text())) {
          problems.push(`console error: ${message.text()}`);
        }
      });
      await use(problems);
      expect(problems, 'errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** A code that no other run, or test, will have used. */
export const unique = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

const CONSOLE = { 'X-Ledgerd-Console': '1' };

export interface AccountSeed {
  code: string;
  currency?: string;
  type?: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  normal_balance?: 'DEBIT' | 'CREDIT';
  allow_negative?: boolean;
}

export interface Account {
  id: string;
  code: string;
}

/** Creates an account through the console's API. */
export async function createAccount(api: APIRequestContext, seed: AccountSeed): Promise<Account> {
  const response = await api.post('/api/v1/accounts', {
    headers: CONSOLE,
    data: {
      currency: 'USD',
      type: 'ASSET',
      normal_balance: 'DEBIT',
      allow_negative: false,
      ...seed,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as Account;
}

/** A bank that may go negative and a wallet that may not: the usual pair. */
export async function createPair(
  api: APIRequestContext,
  name: string,
): Promise<{ bank: Account; wallet: Account }> {
  const bank = await createAccount(api, {
    code: unique(`${name}-bank`),
    type: 'ASSET',
    normal_balance: 'DEBIT',
    allow_negative: true,
  });
  const wallet = await createAccount(api, {
    code: unique(`${name}-wallet`),
    type: 'LIABILITY',
    normal_balance: 'CREDIT',
    allow_negative: false,
  });
  return { bank, wallet };
}

export interface Posted {
  id: string;
  postings: { id: number; account_id: string; balance_after: string }[];
}

/** Moves `amount` minor units from the bank side to the wallet (debit bank, credit wallet). */
export async function deposit(
  api: APIRequestContext,
  bank: Account,
  wallet: Account,
  amount: string,
): Promise<Posted> {
  const response = await api.post('/api/v1/transactions', {
    headers: { ...CONSOLE, 'Idempotency-Key': unique('seed') },
    data: {
      description: 'e2e deposit',
      postings: [
        { account_id: bank.id, direction: 'DEBIT', amount, currency: 'USD' },
        { account_id: wallet.id, direction: 'CREDIT', amount, currency: 'USD' },
      ],
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as Posted;
}

interface AxeViolation {
  id: string;
  help: string;
  impact?: string | null;
  nodes: { target: unknown[]; failureSummary?: string }[];
}

/**
 * Runs axe-core in the page, with every rule, colour contrast included (jsdom cannot judge
 * contrast; a real browser can). axe is handed to the page with `evaluate`, which the Content
 * Security Policy does not govern, so the policy stays as it is in production.
 */
export async function expectAccessible(page: Page, what: string): Promise<void> {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async (): Promise<AxeViolation[]> => {
    const run = (
      globalThis as unknown as {
        axe: { run: (c?: unknown) => Promise<{ violations: AxeViolation[] }> };
      }
    ).axe.run;
    return (await run(document)).violations;
  });
  const report = violations
    .map(
      (v) =>
        `${v.id} (${v.impact ?? '?'}): ${v.help}\n` +
        v.nodes
          .map(
            (n) =>
              `    ${n.target.join(' ')}\n      ${(n.failureSummary ?? '').replaceAll('\n', '\n      ')}`,
          )
          .join('\n'),
    )
    .join('\n');
  expect(report, `accessibility violations on ${what}`).toBe('');
}

/** Chooses the theme the way a person does: the setting is saved, and read before first paint. */
export async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value) => {
    localStorage.setItem(
      'ledgerd-console.settings',
      JSON.stringify({ theme: value, scales: {}, rawUnits: false }),
    );
  }, theme);
  await page.emulateMedia({ colorScheme: theme });
}

/** Whether the page scrolls sideways (it must not, from 360 px wide). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** A request context aimed at the console, for setting data up (and to be disposed of by the caller). */
export function newApi(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
): Promise<APIRequestContext> {
  if (baseURL === undefined) throw new Error('no baseURL: set E2E_BASE_URL');
  return playwright.request.newContext({ baseURL });
}

/**
 * Fills the transaction builder with a transfer: debit one account, credit another, the same
 * amount (in major units, as a person types it). The account lists are narrowed with the
 * prefix filter so the right account is the only one to choose from.
 */
export async function fillTransfer(
  page: Page,
  options: {
    prefix: string;
    debit: Account;
    credit: Account;
    amount: string;
    description?: string;
  },
): Promise<void> {
  await page.goto('/transactions/new');
  await page.getByLabel('Show accounts whose code starts with').fill(options.prefix);
  const first = page.getByLabel('Account for posting 1');
  await expect(first.locator('option', { hasText: options.debit.code })).toHaveCount(1);
  await first.selectOption({ label: `${options.debit.code} (USD)` });
  await page.getByLabel('Direction of posting 1').selectOption('DEBIT');
  await page.getByLabel('Amount of posting 1').fill(options.amount);
  await page
    .getByLabel('Account for posting 2')
    .selectOption({ label: `${options.credit.code} (USD)` });
  await page.getByLabel('Direction of posting 2').selectOption('CREDIT');
  await page.getByLabel('Amount of posting 2').fill(options.amount);
  if (options.description !== undefined)
    await page.getByLabel('Description').fill(options.description);
}

/** The text of a locator, spaces normalised (for money rendered in several elements). */
export async function text(locator: Locator): Promise<string> {
  return ((await locator.textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

/** The current balance of an account, in minor units, straight from the ledger. */
export async function balanceOf(api: APIRequestContext, account: Account): Promise<string> {
  const response = await api.get(`/api/v1/accounts/${account.id}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { balance: string }).balance;
}
