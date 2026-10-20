import { expect, expectAccessible, test } from './support';

test('runs a standard and a deep reconciliation on the real ledger, and compares the reports', async ({
  page,
}) => {
  await page.goto('/reconciliation');
  await expect(page.getByTestId('no-report')).toContainText('No report yet');

  await page.getByRole('button', { name: 'Run reconciliation' }).click();
  const first = page.getByRole('region', { name: 'Report 1' });
  await expect(first).toBeVisible();
  await expect(first.getByRole('status')).toContainText('Consistent: nothing to report');
  await expect(first).toContainText('Not checked in a standard run');
  await expectAccessible(page, 'a standard report');

  await page.getByRole('radio', { name: 'Deep' }).check();
  await page.getByRole('button', { name: 'Run reconciliation' }).click();
  const second = page.getByRole('region', { name: 'Report 2' });
  await expect(second).toBeVisible();
  await expect(second.getByRole('status')).toContainText('Consistent');
  await expect(second).toContainText("Every posting's balance follows from the previous one.");
  await expect(second).toContainText('Deep');

  await page.getByLabel('First report').selectOption({ label: 'Report 1 (standard)' });
  await page.getByLabel('Second report').selectOption({ label: 'Report 2 (deep)' });
  const comparison = page.getByRole('region', { name: 'Report 1 compared with report 2' });
  await expect(comparison).toBeVisible();
  await expect(comparison).toContainText('Balance chains: not compared');
  await expectAccessible(page, 'the comparison');

  // Going elsewhere and back keeps the reports of the session, but shows none as current.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Reconciliation' }).click();
  await expect(page.getByRole('table', { name: /Reports of this session/ })).toBeVisible();
  await expect(page.getByTestId('no-report')).toContainText('There is no current report');
});
