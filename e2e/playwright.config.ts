import { defineConfig, devices } from '@playwright/test';

/*
 * End-to-end tests: a real browser against the console and a real ledgerd (the compose stack).
 * They share one ledger and one set of accounts per test, so they run one at a time.
 *
 *   make e2e          runs them in the pinned Playwright container, on the compose network
 *   npm run e2e       runs them with browsers installed on this machine (npx playwright install chromium)
 *
 * E2E_BASE_URL says where the console is (default: the stack that `make up` starts).
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Run only the tests whose title matches, e.g. `make e2e-run E2E_GREP="deposit"`.
  ...(process.env.E2E_GREP ? { grep: new RegExp(process.env.E2E_GREP) } : {}),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  outputDir: '../test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8787',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // A container usually cannot give Chromium the kernel features its sandbox needs. The
    // browser here only opens our own console, so the container may turn the sandbox off.
    launchOptions: { args: process.env.E2E_NO_SANDBOX === undefined ? [] : ['--no-sandbox'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
