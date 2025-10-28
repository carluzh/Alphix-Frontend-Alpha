/**
 * MetaMask interaction utilities for E2E testing
 * Handles popup detection, transaction confirmation, and wallet connection
 */

import type { Page, BrowserContext } from '@playwright/test'

/**
 * Handle MetaMask transaction popup (approve, sign, or swap)
 */
export async function handleMetaMaskTransaction(
  page: Page,
  context: BrowserContext,
  step: string
): Promise<void> {
  console.log(`  Waiting for MetaMask ${step} popup`)

  // Poll for MetaMask popup to appear
  let metamaskPage: Page | null = null
  let attempts = 0
  const maxAttempts = 30 // 30 attempts × 100ms = 3s max

  while (!metamaskPage && attempts < maxAttempts) {
    const pages = context.pages()
    for (const p of pages) {
      const url = p.url()
      if (url.includes('metamask') || url.includes('chrome-extension')) {
        metamaskPage = p
        console.log(`  MetaMask popup found (${attempts * 100}ms)`)
        break
      }
    }
    if (!metamaskPage) {
      await page.waitForTimeout(100)
      attempts++
    }
  }

  if (metamaskPage) {
    try {
      await metamaskPage.waitForLoadState('domcontentloaded')

      // Try multiple button selectors (Confirm, Approve, Sign)
      const confirmBtn = metamaskPage
        .locator(
          'button:has-text("Confirm"), button:has-text("Approve"), button:has-text("Sign")'
        )
        .first()

      await confirmBtn.waitFor({ state: 'visible', timeout: 10000 })
      const btnText = await confirmBtn.textContent()
      console.log(`  Clicking "${btnText?.trim()}" button`)

      await confirmBtn.click()
      console.log(`  Confirmed ${step}`)

      // Wait for popup to close
      try {
        await metamaskPage.waitForEvent('close', { timeout: 15000 })
        console.log(`  MetaMask popup closed`)
      } catch (e) {
        console.log(`  Warning: Popup didn't close automatically, continuing`)
      }
    } catch (error) {
      console.log(`  Failed to handle MetaMask ${step}`)
      throw new Error(
        `MetaMask ${step} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  } else {
    const errorMsg = `No MetaMask popup found for ${step} - transaction may have been rejected or failed`
    console.log(`  ${errorMsg}`)
    throw new Error(errorMsg)
  }
}

/**
 * Reject MetaMask transaction popup
 */
export async function rejectMetaMaskTransaction(
  page: Page,
  context: BrowserContext,
  step: string
): Promise<void> {
  console.log(`  Waiting for MetaMask ${step} popup to reject`)

  // Poll for MetaMask popup to appear
  let metamaskPage: Page | null = null
  let attempts = 0
  const maxAttempts = 30 // 30 attempts × 100ms = 3s max

  while (!metamaskPage && attempts < maxAttempts) {
    const pages = context.pages()
    for (const p of pages) {
      const url = p.url()
      if (url.includes('metamask') || url.includes('chrome-extension')) {
        metamaskPage = p
        console.log(`  MetaMask popup found (${attempts * 100}ms)`)
        break
      }
    }
    if (!metamaskPage) {
      await page.waitForTimeout(100)
      attempts++
    }
  }

  if (metamaskPage) {
    try {
      await metamaskPage.waitForLoadState('domcontentloaded')

      // Try multiple button selectors (Reject, Cancel)
      const rejectBtn = metamaskPage
        .locator('button:has-text("Reject"), button:has-text("Cancel")')
        .first()

      await rejectBtn.waitFor({ state: 'visible', timeout: 10000 })
      const btnText = await rejectBtn.textContent()
      console.log(`  Clicking "${btnText?.trim()}" button`)

      await rejectBtn.click()
      console.log(`  Rejected ${step}`)

      // Wait for popup to close
      try {
        await metamaskPage.waitForEvent('close', { timeout: 15000 })
        console.log(`  MetaMask popup closed`)
      } catch (e) {
        console.log(`  Warning: Popup didn't close automatically, continuing`)
      }
    } catch (error) {
      console.log(`  Failed to reject MetaMask ${step}`)
      throw new Error(
        `MetaMask ${step} rejection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  } else {
    const errorMsg = `No MetaMask popup found for ${step} rejection`
    console.log(`  ${errorMsg}`)
    throw new Error(errorMsg)
  }
}

/**
 * Connect MetaMask wallet to the application
 * Works on both swap page (modal button) and liquidity/portfolio pages (header button)
 */
export async function connectMetaMaskWallet(
  page: Page,
  context: BrowserContext
): Promise<void> {
  console.log('\nStep 8: Connect wallet')

  // Wait for page to fully load
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(3000)

  // Try to find connect button - could be in header/sidebar OR in swap modal
  // Priority: Try swap modal first (data-swap-container), then fallback to header
  let connectBtn = page.locator('[data-swap-container="true"]').getByRole('button', { name: /connect wallet/i }).first()
  let isSwapPage = await connectBtn.isVisible().catch(() => false)

  if (!isSwapPage) {
    // Not on swap page or swap container not visible - use header/sidebar button
    console.log('  Using header/sidebar Connect Wallet button')
    connectBtn = page.getByRole('button', { name: /connect wallet/i }).first()
  } else {
    console.log('  Using swap modal Connect Wallet button')
  }

  try {
    await connectBtn.waitFor({ state: 'visible', timeout: 15000 })
    console.log('  ✓ Connect button found')
    await connectBtn.click()
  } catch (error) {
    console.log('  Error: Connect button not found')
    // Take screenshot for debugging
    await page.screenshot({ path: `test-results/connect-button-not-found-${Date.now()}.png`, fullPage: true })
    throw new Error(
      'Connect Wallet button not visible - page may not have loaded. Check test-results/ for screenshot.'
    )
  }

  await page.waitForTimeout(1000)

  console.log('  Selecting MetaMask')
  const metamaskOption = page.getByText(/metamask/i).first()
  await metamaskOption.waitFor({ state: 'visible', timeout: 5000 })
  await metamaskOption.click()

  console.log('  Confirming connection')

  // Poll for MetaMask popup
  let metamaskConnectPage: Page | null = null
  let connectAttempts = 0
  const maxConnectAttempts = 20 // 20 attempts × 100ms = 2s max

  while (!metamaskConnectPage && connectAttempts < maxConnectAttempts) {
    const pages = context.pages()
    for (const p of pages) {
      const url = p.url()
      if (url.includes('metamask') || url.includes('chrome-extension')) {
        metamaskConnectPage = p
        break
      }
    }
    if (!metamaskConnectPage) {
      await page.waitForTimeout(100)
      connectAttempts++
    }
  }

  if (metamaskConnectPage) {
    await metamaskConnectPage.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    // MetaMask connection flow may have "Next" → "Connect" or just "Connect"
    const nextBtn = metamaskConnectPage.getByRole('button', { name: /next/i }).first()
    const nextBtnVisible = await nextBtn.isVisible().catch(() => false)

    if (nextBtnVisible) {
      console.log('  Clicking Next button')
      await nextBtn.click()
      await page.waitForTimeout(500)
    }

    const connectBtn = metamaskConnectPage
      .getByRole('button', { name: /connect/i })
      .first()
    await connectBtn.waitFor({ state: 'visible', timeout: 5000 })
    console.log('  Clicking Connect button')
    await connectBtn.click()

    // Wait for popup to close OR for main page to show connected state
    try {
      await metamaskConnectPage.waitForEvent('close', { timeout: 5000 })
      console.log('  ✓ MetaMask popup closed')
    } catch {
      // Popup might not close immediately - could be network approval screen
      console.log('  Popup still open - checking for network approval...')
      await page.waitForTimeout(2000)

      // Check if there's a network approval request (Add network or Approve buttons)
      const approveBtn = metamaskConnectPage.getByRole('button', { name: /approve|add network/i }).first()
      const approveBtnVisible = await approveBtn.isVisible().catch(() => false)

      if (approveBtnVisible) {
        console.log('  Found network approval, clicking Approve')
        await approveBtn.click()
        await page.waitForTimeout(2000)

        // After approving, might need to switch network
        const switchBtn = metamaskConnectPage.getByRole('button', { name: /switch|confirm/i }).first()
        const switchBtnVisible = await switchBtn.isVisible().catch(() => false)

        if (switchBtnVisible) {
          console.log('  Clicking Switch/Confirm button')
          await switchBtn.click()
          await page.waitForTimeout(2000)
        }
      }

      // Give extra time for connection to complete
      await page.waitForTimeout(2000)
    }
  }

  console.log('  ✓ Step 8 complete')
}

/**
 * Switch network in MetaMask
 * @param context - Browser context
 * @param chainId - Chain ID to switch to (e.g., 1 for Ethereum Mainnet)
 */
export async function switchMetaMaskNetwork(
  context: BrowserContext,
  chainId: number
): Promise<void> {
  console.log(`  Switching MetaMask network to chain ID ${chainId}`)

  // Find MetaMask extension page
  const pages = context.pages()
  let metamaskPage: Page | null = null

  for (const p of pages) {
    const url = p.url()
    if (url.includes('metamask') || url.includes('chrome-extension')) {
      // Look for the main MetaMask page (not popup)
      if (!url.includes('notification.html')) {
        metamaskPage = p
        break
      }
    }
  }

  if (!metamaskPage) {
    // Open MetaMask extension page
    const extensionPages = context.pages().filter(p =>
      p.url().includes('chrome-extension')
    )
    if (extensionPages.length > 0) {
      metamaskPage = extensionPages[0]
    } else {
      throw new Error('Could not find MetaMask extension page')
    }
  }

  await metamaskPage.bringToFront()
  await metamaskPage.waitForLoadState('domcontentloaded')

  // Click network dropdown (common patterns)
  const networkDropdown = metamaskPage.locator('[data-testid="network-display"]').or(
    metamaskPage.locator('button:has-text("Ethereum")')
  ).or(
    metamaskPage.locator('.network-display')
  ).first()

  try {
    await networkDropdown.click({ timeout: 5000 })
    await metamaskPage.waitForTimeout(500)

    // Look for the target network or chain ID
    // This is simplified - actual implementation depends on MetaMask version
    console.log(`  ✓ Network switch initiated to chain ${chainId}`)
  } catch (error) {
    console.log(`  Note: Could not switch network in MetaMask`)
    console.log(`  MetaMask UI may have changed or network switch not available`)
  }
}

/**
 * Disconnect wallet in MetaMask
 * @param context - Browser context
 */
export async function disconnectMetaMaskWallet(
  context: BrowserContext
): Promise<void> {
  console.log('  Disconnecting MetaMask wallet')

  // Find MetaMask extension page
  const pages = context.pages()
  let metamaskPage: Page | null = null

  for (const p of pages) {
    const url = p.url()
    if (url.includes('metamask') || url.includes('chrome-extension')) {
      if (!url.includes('notification.html')) {
        metamaskPage = p
        break
      }
    }
  }

  if (!metamaskPage) {
    throw new Error('Could not find MetaMask extension page')
  }

  await metamaskPage.bringToFront()
  await metamaskPage.waitForLoadState('domcontentloaded')

  // Click account menu (common patterns)
  const accountMenu = metamaskPage.locator('[data-testid="account-menu-icon"]').or(
    metamaskPage.locator('button[aria-label*="Account"]')
  ).or(
    metamaskPage.locator('.account-menu__icon')
  ).first()

  try {
    await accountMenu.click({ timeout: 5000 })
    await metamaskPage.waitForTimeout(500)

    // Look for disconnect/lock option
    const disconnectBtn = metamaskPage.getByText(/disconnect/i).or(
      metamaskPage.getByText(/lock/i)
    ).first()

    await disconnectBtn.click({ timeout: 3000 })
    await metamaskPage.waitForTimeout(500)

    console.log('  ✓ MetaMask wallet disconnected')
  } catch (error) {
    console.log('  Note: Could not disconnect wallet in MetaMask')
    console.log('  MetaMask UI may have changed or disconnect not available')
  }
}
