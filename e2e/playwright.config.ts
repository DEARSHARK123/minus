import { defineConfig, devices, type ReporterDescription } from '@playwright/test';
import path from 'node:path';

/**
 * Browsers must live on D: — set PLAYWRIGHT_BROWSERS_PATH before install/run.
 * Default: D:\playwright-browsers
 */
const browsersPath =
  process.env.PLAYWRIGHT_BROWSERS_PATH || 'D:\\playwright-browsers';
process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

// Prefer localhost over 127.0.0.1 — Next 16 blocks cross-origin /_next/* from 127.0.0.1
// unless allowedDevOrigins is set (breaks client hydration / HMR in Playwright).
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const outputDir =
  process.env.E2E_OUTPUT_DIR ||
  path.join(__dirname, '../docs/exec-batches/batch-08-playwright-output');
const resultFile =
  process.env.E2E_RESULT_FILE ||
  path.join(__dirname, '../docs/exec-batches/batch-08-playwright-results.json');
const reporter: ReporterDescription[] = process.env.E2E_LIST_ONLY === '1'
  ? [['list']]
  : [['list'], ['json', { outputFile: resultFile }]];

export default defineConfig({
  testDir: path.join(__dirname),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter,
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'zh-CN',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  outputDir,
});
