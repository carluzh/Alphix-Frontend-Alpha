import { test as baseTest } from '@playwright/test';
import { createWorkerFixture } from 'msw';
import { handlers } from '../mocks/handlers';

// Environment-based test configuration
const isTestnetMode = process.env.E2E_TESTNET_MODE === 'true';
const testnetRpcUrl = process.env.NEXT_PUBLIC_RPC_URL;

// Create a worker fixture for MSW (only when not in testnet mode)
const workerFixture = isTestnetMode ? undefined : createWorkerFixture(handlers);

// Extend the base test with conditional MSW worker
export const test = baseTest.extend({
  ...(workerFixture && { worker: workerFixture }),
  page: async ({ page, worker }, use) => {
    // Set up testnet environment if enabled
    if (isTestnetMode && testnetRpcUrl) {
      await page.addInitScript(() => {
        // Override environment variables in browser context
        window.localStorage.setItem('E2E_TESTNET_MODE', 'true');
        window.localStorage.setItem('NEXT_PUBLIC_RPC_URL', testnetRpcUrl);
      });
    }

    await use(page);
  },
});

// Export expect for convenience
export { expect } from '@playwright/test';

