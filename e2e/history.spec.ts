import { createPair, deposit, expect, expectAccessible, newApi, test, unique } from './support';

/*
 * An account's history: a long one is read a page at a time without skipping or repeating
 * anything, and its balance can be asked for at a moment in the past.
 */

test('reads a long history a page at a time: newest first, none missing, none twice', async ({
  page,
  playwright,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const api = await newApi(playwright, baseURL);
  const { bank, wallet } = await createPair(api, unique('e2e-page'));
  // 55 deposits of 0.01..0.55: more than the 50 a page holds.
  for (let i = 1; i <= 55; i += 1) await deposit(api, bank, wallet, String(i));

  await page.goto(`/accounts/${wallet.id}`);
  const rows = page.getByRole('table', { name: 'Postings, newest first' }).getByRole('row');
  await expect(rows).toHaveCount(51); // the header and 50 postings
  await expect(page.getByText('50 postings loaded, more available')).toBeVisible();
  // Newest first: the balance after the first row is the total of all 55 deposits.
  await expect(rows.nth(1)).toContainText('15.40 USD'); // 1+2+...+55 = 1540 minor units

  await page.getByRole('button', { name: 'Load more postings' }).click();
  await expect(rows).toHaveCount(56);
  await expect(page.getByText('All 55 postings loaded')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more postings' })).toHaveCount(0);

  // Every posting exactly once: 55 different transactions.
  const hrefs = await page
    .getByRole('table', { name: 'Postings, newest first' })
    .getByRole('link')
    .evaluateAll((links) => links.map((l) => l.getAttribute('href')));
  expect(hrefs).toHaveLength(55);
  expect(new Set(hrefs).size).toBe(55);
  // The oldest is the first deposit: 0.01.
  await expect(rows.nth(55)).toContainText('0.01 USD');
  await expectAccessible(page, 'a long history');
  await api.dispose();
});

test('asks for the balance at a past moment, and says what it is for a moment before and after', async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await newApi(playwright, baseURL);
  const { bank, wallet } = await createPair(api, unique('e2e-asof'));
  await deposit(api, bank, wallet, '1000'); // 10.00
  await page.waitForTimeout(1200);
  await deposit(api, bank, wallet, '500'); // 15.00 after
  // The moment between the two deposits, in UTC: the first posting's time plus half a second.
  const response = await api.get(`/api/v1/accounts/${wallet.id}/postings`);
  const postings = ((await response.json()) as { postings: { recorded_at: string }[] }).postings; // newest first
  const earlier = Date.parse(postings[1]?.recorded_at ?? '');
  const between = new Date(earlier + 500).toISOString().slice(0, 23).replace('T', ' ');

  await page.goto(`/accounts/${wallet.id}`);
  await expect(page.getByRole('region', { name: 'Balance now' })).toContainText('15.00 USD');
  await page.getByLabel(/^As of/).fill(between);
  await page.getByRole('button', { name: 'Show balance' }).click();
  const answer = page.getByText(/Balance as of/).locator('..');
  await expect(answer).toContainText('10.00 USD');
  await expect(page).toHaveURL(/as_of=/);
  await expect(page.getByLabel(/^As of/)).toHaveValue(/Z$/); // shows how it was understood
  await expectAccessible(page, 'a past balance');

  // Before anything happened: zero. In the future: the balance now, and it says so.
  await page.getByLabel(/^As of/).fill('2000-01-01 00:00');
  await page.getByRole('button', { name: 'Show balance' }).click();
  await expect(page.getByText(/There was no posting at or before that moment/)).toBeVisible();
  await page.getByLabel(/^As of/).fill('2999-01-01 00:00');
  await page.getByRole('button', { name: 'Show balance' }).click();
  await expect(page.getByText(/in the future, so this is the current balance/)).toBeVisible();

  // Nonsense is refused beside the field, and the old answer does not stay on screen.
  await page.getByLabel(/^As of/).fill('2026-02-30 10:00');
  await page.getByRole('button', { name: 'Show balance' }).click();
  await expect(page.getByLabel(/^As of/)).toHaveAccessibleDescription(/Use a date and time/);
  await expect(page.getByText(/Balance as of/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Back to current balance' }).click();
  await expect(page).not.toHaveURL(/as_of=/);
  await api.dispose();
});
