import { expect, test } from './support';

/*
 * Colour theme: it follows the system, can be chosen, is remembered, and is applied before the page
 * is first drawn (no white flash for a person who chose dark).
 */

test('follows the system theme when nothing has been chosen', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('a chosen theme is saved, and applied before the first paint on the next visit', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/settings');
  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('html')).toHaveClass(/dark/);
  const saved = await page.evaluate(() => localStorage.getItem('ledgerd-console.settings'));
  expect(JSON.parse(saved ?? '{}')).toMatchObject({ theme: 'dark' });

  // Record, as the browser reads the page, whether the dark class was already there when the body began.
  await page.addInitScript(() => {
    // The page has no <html> yet when this runs, so watch the whole document.
    new MutationObserver((_records, observer) => {
      const body = document.querySelector('body');
      if (body) {
        (window as unknown as { darkWhenBodyBegan: boolean }).darkWhenBodyBegan =
          document.documentElement.classList.contains('dark');
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  expect(
    await page.evaluate(
      () => (window as unknown as { darkWhenBodyBegan: boolean }).darkWhenBodyBegan,
    ),
  ).toBe(true);

  // The system says light, the person said dark: dark wins, and "match the system" gives it back.
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('radio', { name: 'Match the system' }).check();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('display decimals changed in settings change how amounts are written, and only that', async ({
  page,
}) => {
  await page.goto('/settings');
  const usd = page.getByRole('textbox', { name: 'Decimal places for USD', exact: true });
  await usd.fill('4');
  await usd.press('Enter');
  await expect(page.getByRole('row', { name: /USD/ }).first()).toContainText('12,345.6789 USD');
  await page.getByRole('button', { name: 'Reset USD to the default' }).click();
  await expect(usd).toHaveValue('2');
});

test('reduced motion: the spinner does not spin and no animation lasts, for a person who asked for less motion', async ({
  page,
}) => {
  // The spinner is on screen only while a request is in flight, so give the page one the same way
  // the application does: an element with the class the spinner has.
  const motion = async (): Promise<{ name: string; duration: string; transition: string }> =>
    page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'motion-safe:animate-spin';
      el.style.transition = 'opacity 1s';
      document.body.append(el);
      const style = getComputedStyle(el);
      const result = {
        name: style.animationName,
        duration: style.animationDuration,
        transition: style.transitionDuration,
      };
      el.remove();
      return result;
    });

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.getByText('API ready')).toBeVisible();
  // The check can fail: with no preference the spinner does spin (so the next result means something).
  expect(await motion()).toEqual({ name: 'spin', duration: '1s', transition: '1s' });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await motion();
  expect(reduced.name).toBe('none');
  expect(Number.parseFloat(reduced.transition)).toBeLessThan(0.001);
});
