import { test } from '@playwright/test'
import { initializeTestEnvironment, navigateAndConnectWallet } from './helpers/test-setup'

test('Manual Testing - Connect wallet', async () => {
  const { page, context, cleanup } = await initializeTestEnvironment()

  try {
    await navigateAndConnectWallet(page, context)
    console.log('\n✅ Wallet connected! Press Ctrl+C to close.\n')
    await page.waitForTimeout(10 * 60 * 60 * 1000)
  } finally {
    await cleanup()
  }
})
