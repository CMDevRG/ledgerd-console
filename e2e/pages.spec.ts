import {
  createAccount,
  createPair,
  deposit,
  expect,
  expectAccessible,
  horizontalOverflow,
  newApi,
  test,
  unique,
  useTheme,
} from './support';

/*
 * Every page, in a real browser: its title and heading, no accessibility violations (colour
 * contrast included, in both themes), no sideways scrolling on a phone, and no script error or
 * Content Security Policy violation while it loads.
 */

let accountPath = '';
let transactionPath = '';

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await newApi(playwright, baseURL);
  const { bank, wallet } = await createPair(api, 'pages');
  await createAccount(api, { code: unique('pages-eur'), currency: 'EUR' });
  const posted = await deposit(api, bank, wallet, '123456');
  accountPath = `/accounts/${wallet.id}`;
  transactionPath = `/transactions/${posted.id}`;
  await api.dispose();
});

const pages: { name: string; path: () => string; heading: string | RegExp }[] = [
  { name: 'overview', path: () => '/', heading: 'Overview' },
  { name: 'accounts', path: () => '/accounts', heading: 'Accounts' },
  { name: 'account detail', path: () => accountPath, heading: /^Account / },
  { name: 'new transaction', path: () => '/transactions/new', heading: 'New transaction' },
  { name: 'transaction lookup', path: () => '/transactions', heading: 'Transactions' },
  { name: 'transaction', path: () => transactionPath, heading: /^Transaction / },
  { name: 'failure lab', path: () => '/lab', heading: 'Failure Lab' },
  { name: 'reconciliation', path: () => '/reconciliation', heading: 'Reconciliation' },
  { name: 'benchmark', path: () => '/benchmark', heading: 'Benchmark' },
  { name: 'settings', path: () => '/settings', heading: 'Settings' },
  { name: 'a page that does not exist', path: () => '/no/such/page', heading: 'Page not found' },
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    for (const p of pages) {
      test(`${p.name}: one heading, a title, no accessibility violations`, async ({ page }) => {
        await useTheme(page, theme);
        await page.goto(p.path());
        const heading = page.getByRole('heading', { level: 1 });
        await expect(heading).toHaveCount(1);
        await expect(heading).toHaveText(p.heading);
        await expect(page).toHaveTitle(/ · ledgerd console$/);
        // Let what loads asynchronously settle: the connection badge, tables, balances.
        await expect(page.getByText('API ready')).toBeVisible();
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
        await expectAccessible(page, `${p.name} (${theme})`);
      });
    }
  });
}

test.describe('on a phone, 360 px wide', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  for (const p of pages) {
    test(`${p.name} does not scroll sideways`, async ({ page }) => {
      await page.goto(p.path());
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.heading);
      await expect(page.getByText('API ready')).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});
