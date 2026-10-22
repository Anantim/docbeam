import { defineConfig } from '@playwright/test';

// Browser tests against the local Docker Compose stack (D-M3-11). Local only: not run in CI, not part of
// `npm test`. Start the stack first (`docker compose up -d --build --wait`, `docker compose run --rm seed`).
// The Vite dev server is started here unless it is already running.
export default defineConfig({
  testDir: 'tests/e2e',
  // One database, and tests that stop and start containers: one test at a time, in file order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // `chromium` runs every spec. The three width projects run only `widths.spec.ts` (the main screens, with a check that the page
  // never scrolls sideways) at the width of a phone, a tablet and a laptop (D-F1-78).
  projects: [
    { name: 'chromium', testIgnore: /widths\.spec\.ts/, use: { browserName: 'chromium' } },
    { name: 'phone-375', testMatch: /widths\.spec\.ts/, use: { browserName: 'chromium', viewport: { width: 375, height: 800 } } },
    { name: 'tablet-768', testMatch: /widths\.spec\.ts/, use: { browserName: 'chromium', viewport: { width: 768, height: 900 } } },
    { name: 'small-laptop-1024', testMatch: /widths\.spec\.ts/, use: { browserName: 'chromium', viewport: { width: 1024, height: 768 } } },
    { name: 'laptop-1440', testMatch: /widths\.spec\.ts/, use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run dev -w @docbeam/web',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  outputDir: 'test-results',
});
