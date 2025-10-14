import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  retries: 0, // Fail fast - no retries
  workers: 1, // Run tests sequentially to avoid resource conflicts
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:3000',
    headless: false,
    viewport: { width: 1900, height: 1000 },
    ignoreHTTPSErrors: true,
    video: 'off',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [
    ['list'],
    ['line']
  ],
  timeout: 180000, // 3 minutes per test (increased from 2)
})


