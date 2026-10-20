import { expect, expectAccessible, test } from './support';

/*
 * The checks in these tests are only worth something if they can fail. This shows that the
 * accessibility check does, in the real browser, on the things it is there to catch.
 */
test('the accessibility check fails on a page that has real problems', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
  await expectAccessible(page, 'the settings page, as it is'); // clean

  await page.evaluate(() => {
    const low = document.createElement('p');
    low.textContent = 'Pale grey text on white: unreadable';
    low.style.color = '#cccccc'; // set through the DOM, which the Content Security Policy allows
    low.style.backgroundColor = '#ffffff';
    const image = document.createElement('img');
    image.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    const main = document.querySelector('main');
    main?.append(low, image);
  });

  let report = '';
  try {
    await expectAccessible(page, 'the settings page with problems added');
  } catch (error) {
    report = error instanceof Error ? error.message : String(error);
  }
  expect(report).toContain('color-contrast');
  expect(report).toContain('image-alt');
});
