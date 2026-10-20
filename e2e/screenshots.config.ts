import { defineConfig, devices } from '@playwright/test';

/*
 * Takes the screenshots in docs/screenshots for the README, from the real console and a real
 * ledgerd. Not part of the test run (that matches *.spec.ts); `make screenshots` runs it.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.shots.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: '../test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8787',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    launchOptions: { args: process.env.E2E_NO_SANDBOX === undefined ? [] : ['--no-sandbox'] },
  },
  projects: [{ name: 'screenshots' }],
});
