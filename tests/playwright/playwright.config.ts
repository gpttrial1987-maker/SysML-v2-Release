import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const testDir = path.join(__dirname, 'specs');
const outputDir = path.join(__dirname, 'artifacts');

export default defineConfig({
  testDir,
  outputDir,
  timeout: 5 * 60 * 1000,
  fullyParallel: false,
  expect: {
    timeout: 15_000,
  },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: path.join(outputDir, 'html-report') }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  globalSetup: path.join(__dirname, 'scripts', 'global-setup.ts'),
  globalTeardown: path.join(__dirname, 'scripts', 'global-teardown.ts'),
  webServer: {
    command: 'npm run dev:editor -- --host 127.0.0.1 --port 4173',
    port: 4173,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
