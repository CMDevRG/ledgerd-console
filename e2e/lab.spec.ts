import { expect, expectAccessible, test } from './support';

/*
 * The Failure Lab against the real ledgerd. Until now the scenarios had run only against a fake
 * ledger written for the tests; here is where each promise is put to the service that makes it.
 */

const SCENARIOS = [
  'Overdraft is refused and nothing changes',
  'A retried request is a replay, not a second effect',
  'The same key with a different request is refused',
  'An unbalanced transaction is refused',
  'An amount sent as a JSON number is refused',
  'Huge amounts are exact, and the limit is enforced',
  'A transaction cannot be reversed twice',
  'Simultaneous withdrawals never overdraw',
] as const;

for (const title of SCENARIOS) {
  test(`${title}: behaves as designed`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/lab');
    const section = page.getByRole('region', { name: title });
    await section.getByRole('button', { name: 'Run this scenario' }).click();

    await expect(
      section.getByRole('status').filter({ hasText: 'Behaved as designed' }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(section.getByText('UNEXPECTED')).toHaveCount(0);
    await expect(section.getByText('Could not run')).toHaveCount(0);
    // Every check passed, and there were checks.
    await expect(section.getByRole('cell', { name: 'Failed', exact: true })).toHaveCount(0);
    expect(
      await section.getByRole('cell', { name: 'Passed', exact: true }).count(),
    ).toBeGreaterThanOrEqual(4);
  });
}

test('a run adds its lab accounts to the count, and shows the requests it made', async ({
  page,
}) => {
  await page.goto('/lab');
  const note = page.getByRole('note');
  await expect(note).toContainText(/This ledger has (at least )?\d+ lab accounts?\./);
  const before = Number(/has (?:at least )?(\d+) lab/.exec((await note.textContent()) ?? '')?.[1]);

  const section = page.getByRole('region', { name: SCENARIOS[0] });
  await section.getByRole('button', { name: 'Run this scenario' }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Behaved as designed' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(note).toContainText(`This ledger has ${String(before + 2)} lab accounts.`);

  // The withdrawal that was refused, as the ledger said it.
  const step = section.getByRole('region', { name: /Step 3/ });
  const exchange = step.locator('details').first();
  await exchange.locator('summary').click();
  await expect(exchange).toContainText('POST /v1/transactions');
  await expect(exchange.getByLabel('Body sent in request 1')).toContainText('"amount": "10100"');
  await expect(exchange.getByLabel('Body received in request 1')).toContainText(
    '"code": "insufficient_funds"',
  );
  await expect(exchange.getByLabel('Body received in request 1')).toContainText('"request_id"');
  // And nothing in it that is the key.
  expect(await section.textContent()).not.toMatch(/Bearer|Authorization/i);
  await expectAccessible(page, 'a finished scenario');
});

test('the concurrency scenario: thirty requests started together, ten accepted, and the browser says how many ran at once', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/lab');
  const section = page.getByRole('region', { name: SCENARIOS[7] });
  await section.getByRole('button', { name: 'Run this scenario' }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Behaved as designed' })).toBeVisible({
    timeout: 60_000,
  });

  const observed = section.getByRole('heading', { name: 'Observed' }).locator('..');
  await expect(observed).toContainText(
    'Requests started together: 30. Accepted: 10. Refused for insufficient funds: 20.',
  );
  // The browser measured it (Resource Timing): a number, no more than a browser sends to one host at once.
  const peakLine = (await observed.textContent())?.match(/as the browser reported: (\d+)\./);
  expect(peakLine, 'the browser did not report timings').not.toBeNull();
  const peak = Number(peakLine?.[1]);
  expect(peak).toBeGreaterThanOrEqual(2);
  expect(peak).toBeLessThanOrEqual(6);
  test
    .info()
    .annotations.push({ type: 'requests on the network at once', description: String(peak) });

  await expect(
    section.getByText(/30 requests \(10 answered with success, 20 with a refusal\)/),
  ).toBeVisible();
  await expectAccessible(page, 'the concurrency scenario result');
});

test('running them one after another leaves the ledger consistent: a deep reconciliation finds nothing wrong', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/lab');
  for (const title of SCENARIOS.slice(0, 3)) {
    const section = page.getByRole('region', { name: title });
    await section.getByRole('button', { name: /^Run/ }).click();
    await expect(
      section.getByRole('status').filter({ hasText: 'Behaved as designed' }),
    ).toBeVisible({ timeout: 60_000 });
  }
  await page.goto('/reconciliation');
  await page.getByRole('radio', { name: 'Deep' }).check();
  await page.getByRole('button', { name: 'Run reconciliation' }).click();
  await expect(page.getByRole('region', { name: 'Report 1' }).getByRole('status')).toContainText(
    'Consistent',
    { timeout: 60_000 },
  );
});
