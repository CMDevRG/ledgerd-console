import type { Request, Response } from '@playwright/test';

import { balanceOf, createPair, deposit, expect, newApi, test, unique } from './support';

/*
 * What the security design promises, checked from where an attacker would stand: in the browser.
 */

const KEY = process.env.LEDGERD_API_KEY ?? '';

test.describe('the API key', () => {
  test.skip(KEY.length < 16, 'LEDGERD_API_KEY is not set for the tests');

  test('is in nothing the browser receives, sends or stores, through a session of real use', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const api = await newApi(playwright, baseURL);
    const name = unique('e2e-key');
    const { bank, wallet } = await createPair(api, name);
    await deposit(api, bank, wallet, '500');

    const leaks: string[] = [];
    const sentAuthorization: string[] = [];
    page.on('request', (request: Request) => {
      if (request.headers().authorization !== undefined) sentAuthorization.push(request.url());
      if (request.url().includes(KEY) || (request.postData() ?? '').includes(KEY))
        leaks.push(`request ${request.url()}`);
    });
    page.on('response', async (response: Response) => {
      const headers = JSON.stringify(response.headers());
      if (headers.includes(KEY)) leaks.push(`headers of ${response.url()}`);
      // Bodies of the pages and the API (not images, which are not text).
      const type = response.headers()['content-type'] ?? '';
      if (/json|html|javascript|css|text|map/.test(type)) {
        try {
          if ((await response.text()).includes(KEY)) leaks.push(`body of ${response.url()}`);
        } catch {
          // A response that was cancelled by navigation has no body to read.
        }
      }
    });

    // Use the console: list, open, post, reverse, reconcile, the lab's first scenario.
    await page.goto('/accounts');
    await page.getByRole('link', { name: wallet.code }).click();
    await expect(page.getByRole('region', { name: 'Balance now' })).toContainText('5.00 USD');
    await page.goto('/reconciliation');
    await page.getByRole('button', { name: 'Run reconciliation' }).click();
    await expect(page.getByRole('region', { name: 'Report 1' })).toBeVisible();
    await page.goto('/benchmark');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Benchmark');

    expect(leaks).toEqual([]);
    expect(sentAuthorization, 'the browser sent an Authorization header').toEqual([]);

    // Nor is it in the page, the cookies, or local and session storage.
    expect(await page.content()).not.toContain(KEY);
    expect(
      await page.evaluate(() =>
        JSON.stringify([
          Object.entries(localStorage),
          Object.entries(sessionStorage),
          document.cookie,
        ]),
      ),
    ).not.toContain(KEY);
    expect(JSON.stringify(await page.context().cookies())).not.toContain(KEY);
    await api.dispose();
  });
});

test('every page comes with the security headers, and the console cannot be framed', async ({
  request,
}) => {
  for (const path of ['/', '/accounts', '/api/readyz', '/no/such/file.js']) {
    const response = await request.get(path);
    const h = response.headers();
    expect(h['content-security-policy'], path).toContain("default-src 'self'");
    expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'");
    expect(h['content-security-policy'], path).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['x-frame-options'], path).toBe('DENY');
    expect(h['referrer-policy'], path).toBe('no-referrer');
  }
});

test('a page on another site cannot use the console: its requests are blocked or refused, and nothing is created', async ({
  page,
  playwright,
  baseURL,
  problems,
}) => {
  const api = await newApi(playwright, baseURL);
  const code = unique('e2e-forged');
  const target = baseURL ?? '';
  const account = JSON.stringify({
    code,
    currency: 'USD',
    type: 'ASSET',
    normal_balance: 'DEBIT',
    allow_negative: false,
  });

  // "The attacker's page": a plain page on another site, with no policy of the console's. (The
  // console itself would stop these requests first, with its own connect-src, so the test does
  // not run them from its pages.)
  await page.route('http://evil.example/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>harmless</title><p>hello</p>',
    }),
  );
  await page.goto('http://evil.example/');

  const answers: { status: number; origin: string | undefined }[] = [];
  page.on('response', (response) => {
    if (response.url().startsWith(target))
      answers.push({ status: response.status(), origin: response.request().headers().origin });
  });

  // 1. With the custom header the console demands, the browser first asks permission (a
  //    preflight), which the console never gives: the request is not sent.
  const withHeader = await page.evaluate(
    async ({ url, body }) => {
      try {
        const response = await fetch(`${url}/api/v1/accounts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Ledgerd-Console': '1' },
          body,
        });
        return `answered ${String(response.status)}`;
      } catch (error) {
        return `blocked: ${error instanceof Error ? error.name : 'error'}`;
      }
    },
    { url: target, body: account },
  );
  expect(withHeader).toMatch(/^blocked/);

  // 2. Without it, the request is "simple" and does go out, with the attacker's Origin. The page
  //    cannot read the answer; the console must refuse it.
  await page.evaluate(
    async ({ url, body }) => {
      try {
        await fetch(`${url}/api/v1/accounts`, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body,
        });
      } catch {
        // Blocked before it was sent: also fine.
      }
    },
    { url: target, body: account },
  );
  await page.waitForTimeout(500);
  const fromElsewhere = answers.filter((a) => a.origin === 'http://evil.example');
  test.info().annotations.push({
    type: 'answers to the other site',
    description: JSON.stringify(fromElsewhere),
  });
  for (const answer of fromElsewhere) {
    expect(
      answer.status,
      'what the console answered to a request from another site',
    ).toBeGreaterThanOrEqual(400);
  }

  // The browser logs what it blocked as errors: here that is the point.
  expect(problems.every((p) => /CORS|blocked|Failed to fetch|access control/i.test(p))).toBe(true);
  problems.length = 0;

  const listing = await api.get(`/api/v1/accounts?code_prefix=${code}`);
  expect(((await listing.json()) as { accounts: unknown[] }).accounts).toHaveLength(0);
  await api.dispose();
});

test('text from the ledger is shown as text: markup in a description does nothing', async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await newApi(playwright, baseURL);
  const { bank, wallet } = await createPair(api, unique('e2e-xss'));
  const payload = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
  const response = await api.post('/api/v1/transactions', {
    headers: { 'X-Ledgerd-Console': '1', 'Idempotency-Key': unique('xss') },
    data: {
      description: payload,
      postings: [
        { account_id: bank.id, direction: 'DEBIT', amount: '100', currency: 'USD' },
        { account_id: wallet.id, direction: 'CREDIT', amount: '100', currency: 'USD' },
      ],
    },
  });
  const { id } = (await response.json()) as { id: string };

  await page.goto(`/transactions/${id}`);
  await expect(page.getByRole('region', { name: 'Details', exact: true })).toContainText(payload); // seen as characters
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
  expect(await page.locator('main img, main script').count()).toBe(0);
  expect(await balanceOf(api, wallet)).toBe('100');
  await api.dispose();
});
