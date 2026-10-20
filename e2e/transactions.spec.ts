import {
  balanceOf,
  createPair,
  deposit,
  expect,
  expectAccessible,
  fillTransfer,
  newApi,
  test,
  text,
  unique,
} from './support';

/*
 * Moving money, through the browser and the real ledgerd: a deposit, an overdraft that is
 * refused, a retried request that is a replay, an unbalanced transaction, a reversal.
 */

test('a deposit: the totals balance, ledgerd accepts it, and the balances move', async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await newApi(playwright, baseURL);
  const name = unique('e2e-dep');
  const { bank, wallet } = await createPair(api, name);

  await fillTransfer(page, {
    prefix: name,
    debit: bank,
    credit: wallet,
    amount: '100.50',
    description: 'e2e: a deposit',
  });
  const totals = page.getByRole('region', { name: 'Totals', exact: true });
  await expect(totals).toContainText('The transaction balances in every currency.');
  await expect(totals.getByRole('row').nth(1)).toContainText('Balanced');

  await page.getByRole('button', { name: 'Send transaction' }).click();
  const result = page.getByRole('region', { name: /Transaction posted/ });
  await expect(result).toBeVisible();
  await expect(result).toContainText('e2e: a deposit');
  // Each posting, with the balance after it.
  await expect(result.getByRole('row').nth(1)).toContainText('100.50 USD');
  await expectAccessible(page, 'the transaction result');

  expect(await balanceOf(api, bank)).toBe('10050');
  expect(await balanceOf(api, wallet)).toBe('10050');

  // The account page shows it: the balance and the posting in the history.
  await result.getByRole('link', { name: wallet.code }).click();
  await expect(page.getByRole('region', { name: 'Balance now' })).toContainText('100.50 USD');
  await expect(
    page.getByRole('table', { name: 'Postings, newest first' }).getByRole('row'),
  ).toHaveCount(2);
  await api.dispose();
});

test('an overdraft is refused, nothing changes, and the key is still free', async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await newApi(playwright, baseURL);
  const name = unique('e2e-over');
  const { bank, wallet } = await createPair(api, name);
  await deposit(api, bank, wallet, '10000'); // 100.00

  // Withdraw 101.00 from the wallet, which may not go below zero.
  await fillTransfer(page, { prefix: name, debit: wallet, credit: bank, amount: '101' });
  const key = await page.getByLabel('Idempotency key').inputValue();
  await page.getByRole('button', { name: 'Send transaction' }).click();

  const alert = page.getByRole('alert').filter({ hasText: 'Insufficient funds' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('insufficient_funds');
  await expect(page.getByText('The key was not used up')).toBeVisible();
  await expect(page.getByLabel('Idempotency key')).toHaveValue(key); // kept, to be used again
  await expect(page.getByLabel('Amount of posting 1')).toHaveValue('101'); // the form is kept

  expect(await balanceOf(api, wallet)).toBe('10000');
  expect(await balanceOf(api, bank)).toBe('10000');
  await expectAccessible(page, 'the page after a refusal');

  // Fix the amount and send again with the same key: it goes through.
  await page.getByLabel('Amount of posting 1').fill('40');
  await page.getByLabel('Amount of posting 2').fill('40');
  await page.getByRole('button', { name: 'Send transaction' }).click();
  await expect(page.getByRole('region', { name: /Transaction posted/ })).toBeVisible();
  expect(await balanceOf(api, wallet)).toBe('6000');
  await api.dispose();
});

test('sending the same request again is a replay, and the money moves once', async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await newApi(playwright, baseURL);
  const name = unique('e2e-replay');
  const { bank, wallet } = await createPair(api, name);

  await fillTransfer(page, { prefix: name, debit: bank, credit: wallet, amount: '25' });
  const key = await page.getByLabel('Idempotency key').inputValue();
  await page.getByRole('button', { name: 'Send transaction' }).click();
  const result = page.getByRole('region', { name: /Transaction posted/ });
  await expect(result).toContainText(key.slice(0, 8));

  await result.getByRole('button', { name: 'Send the same request again' }).click();
  const repeat = result.getByText(/Repeat 1: HTTP 201 with Idempotent-Replayed: true/);
  await expect(repeat).toBeVisible();
  const box = repeat.locator('..');
  await expect(box).toContainText('This was a replay');
  await expect(box.getByRole('row').nth(1)).toContainText('No, unchanged');
  await expectAccessible(page, 'the replay');

  expect(await balanceOf(api, wallet)).toBe('2500'); // 25.00, once
  await api.dispose();
});

test('an unbalanced transaction asks first; Escape closes the dialog and returns focus; sending shows the refusal', async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await newApi(playwright, baseURL);
  const name = unique('e2e-unbal');
  const { bank, wallet } = await createPair(api, name);

  await fillTransfer(page, { prefix: name, debit: bank, credit: wallet, amount: '10' });
  await page.getByLabel('Amount of posting 2').fill('9.99');
  await expect(page.getByRole('region', { name: 'Totals', exact: true })).toContainText(
    'The transaction does not balance',
  );

  const send = page.getByRole('button', { name: 'Send transaction' });
  await send.click();
  const dialog = page.getByRole('dialog', { name: 'This transaction does not balance' });
  await expect(dialog).toBeVisible();
  await expectAccessible(page, 'the unbalanced-transaction dialog');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(send).toBeFocused(); // back where the person was

  await send.click();
  await dialog.getByRole('button', { name: 'Send anyway' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Transaction is not balanced' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('unbalanced_transaction');
  expect(await balanceOf(api, bank)).toBe('0');
  await api.dispose();
});

test('reversing: asks first, makes an offsetting transaction, updates the balances; a second reversal is refused', async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await newApi(playwright, baseURL);
  const name = unique('e2e-rev');
  const { bank, wallet } = await createPair(api, name);
  const posted = await deposit(api, bank, wallet, '7000');

  await page.goto(`/transactions/${posted.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Transaction /);
  const reverse = page.getByRole('button', { name: 'Reverse this transaction' });
  await reverse.click();
  const dialog = page.getByRole('dialog', { name: 'Reverse this transaction?' });
  await expect(dialog).toContainText('will not be changed');
  await expectAccessible(page, 'the reversal dialog');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(reverse).toBeFocused();
  expect(await balanceOf(api, wallet)).toBe('7000'); // nothing was sent

  await reverse.click();
  await dialog.getByRole('button', { name: 'Reverse transaction' }).click();
  const notice = page.getByText(/Reversed by transaction/);
  await expect(notice).toBeVisible();
  await expect(notice.locator('..')).toContainText('This transaction is unchanged');
  expect(await balanceOf(api, wallet)).toBe('0');
  expect(await balanceOf(api, bank)).toBe('0');

  // A second reversal is refused by ledgerd, with the reason.
  await reverse.click();
  await dialog.getByRole('button', { name: 'Reverse transaction' }).click();
  await expect(dialog.getByText('Transaction already reversed')).toBeVisible();
  await expect(dialog.getByText('already_reversed')).toBeVisible();
  await expect(dialog.getByText('The key was not used up')).toBeVisible();
  await api.dispose();
});

test('looks a transaction up by its pasted id, and refuses a malformed one without asking ledgerd', async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await newApi(playwright, baseURL);
  const { bank, wallet } = await createPair(api, unique('e2e-find'));
  const posted = await deposit(api, bank, wallet, '100');

  await page.goto('/transactions');
  await page.getByLabel('Transaction id').fill('not an id');
  await page.getByRole('button', { name: 'Open transaction' }).click();
  await expect(page.getByLabel('Transaction id')).toHaveAccessibleDescription(
    /This is not a transaction id/,
  );
  await expect(page).toHaveURL(/\/transactions$/);

  await page.getByLabel('Transaction id').fill(`  ${posted.id.toUpperCase()} `);
  await page.getByRole('button', { name: 'Open transaction' }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions/${posted.id}$`));
  await expect(page.getByRole('region', { name: 'Details', exact: true })).toContainText(
    'e2e deposit',
  );
  expect(await text(page.getByRole('region', { name: 'Postings', exact: true }))).toContain(
    '1.00 USD',
  );
  await api.dispose();
});
