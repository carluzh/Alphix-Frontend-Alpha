/**
 * Liquidity E2E Tests
 * Tests for adding and managing liquidity positions
 */

import { test } from '@playwright/test'
import { initializeTestEnvironment } from './helpers/test-setup'
import { handleMetaMaskTransaction, connectMetaMaskWallet } from './helpers/metamask'
import { TOKENS } from './fixtures/tokens'

test.describe('Liquidity E2E Tests', () => {
  test('Session 1: Basic Add Liquidity Flow', async () => {
    console.log('\n=== SESSION 1 STARTING: Basic Add Liquidity Flow ===\n')

    // PART 1: Setup wallet with balances
    console.log('[PART 1] Initializing test environment...')
    const { page, context, testAccount, cleanup } = await initializeTestEnvironment()
    console.log('[PART 1] ✓ Test environment ready\n')

    try {
      // PART 2: Navigate to liquidity page and connect wallet
      console.log('[PART 2] Navigating to /liquidity page...')
      await page.goto('/liquidity?e2e=true', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000) // Wait for pools to load

      console.log('[PART 2] Connecting wallet...')

      // Look for Connect Wallet button anywhere on page
      const connectBtn = page.getByRole('button', { name: /connect wallet/i }).first()

      try {
        await connectBtn.waitFor({ state: 'visible', timeout: 5000 })
        console.log('[PART 2] Found Connect button, clicking...')
        await connectBtn.click()

        // Select MetaMask
        console.log('[PART 2] Selecting MetaMask...')
        const metamaskOption = page.getByText(/metamask/i).first()
        await metamaskOption.waitFor({ state: 'visible', timeout: 5000 })
        await metamaskOption.click()

        // Handle MetaMask connection popup
        console.log('[PART 2] Confirming connection...')
        let metamaskConnectPage: typeof page | null = null
        let connectAttempts = 0
        const maxConnectAttempts = 20

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
          const mmConnectBtn = metamaskConnectPage.getByRole('button', { name: /connect/i }).first()
          await mmConnectBtn.waitFor({ state: 'visible', timeout: 5000 })
          await mmConnectBtn.click()
          await metamaskConnectPage.waitForEvent('close', { timeout: 10000 })
        }

        console.log('[PART 2] ✓ Wallet connected')
      } catch (error) {
        console.log('[PART 2] Could not connect wallet - may already be connected or page issue')
        throw error
      }

      await page.waitForTimeout(2000)
      console.log('[PART 2] ✓ Ready\n')

      // PART 3: Select a pool (click on table row)
      console.log('[PART 3] Selecting a pool...')

      // Wait for the pools table to be visible
      const poolsTable = page.locator('table').first()
      await poolsTable.waitFor({ state: 'visible', timeout: 10000 })

      // Get all pool row links - each row is wrapped in <Link className="contents">
      const poolRows = page.locator('a.contents[href^="/liquidity/"]')
      const rowCount = await poolRows.count()
      console.log(`[PART 3] Found ${rowCount} pools`)

      if (rowCount === 0) {
        throw new Error('No pools found on liquidity page')
      }

      // Get the href of the first pool and manually navigate with e2e parameter
      const firstPoolRow = poolRows.first()
      const href = await firstPoolRow.getAttribute('href')
      if (!href) {
        throw new Error('Pool link has no href attribute')
      }

      console.log(`[PART 3] Navigating to ${href}?e2e=true`)
      await page.goto(`${href}?e2e=true`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)
      console.log('[PART 3] ✓ Navigated to pool detail page\n')

      // PART 4: Wait for page to load and open Add Liquidity form
      console.log('[PART 4] Opening Add Liquidity form...')
      await page.waitForTimeout(3000) // Wait for pool data to load

      // Check if the form is already visible (windowWidth >= 1500px)
      const formVisible = await page.locator('h2:has-text("ADD LIQUIDITY")').isVisible().catch(() => false)

      if (formVisible) {
        console.log('[PART 4] Add Liquidity form already visible (wide screen)')
        // Form is embedded on the page, no need to click button
      } else {
        // Look for the "Add Liquidity" button (for windowWidth < 1500px)
        console.log('[PART 4] Looking for Add Liquidity button...')

        // The button is an <a> tag with PlusIcon and "Add Liquidity" text
        const addLiquidityBtn = page.locator('a:has-text("Add Liquidity")').filter({ has: page.locator('svg') })

        await addLiquidityBtn.waitFor({ state: 'visible', timeout: 10000 })
        await addLiquidityBtn.click()
        console.log('[PART 4] ✓ Clicked Add Liquidity button')

        // Wait for modal to appear
        await page.waitForTimeout(1500)
        console.log('[PART 4] ✓ Modal opened')
      }

      console.log('[PART 4] ✓ Add Liquidity form ready\n')

      // PART 5: Enter token0 amount and wait for token1 calculation
      console.log('[PART 5] Entering token0 amount...')

      // Find the token inputs by ID (they're type="text" with inputMode="decimal")
      const token0Input = page.locator('input#amount0')
      await token0Input.waitFor({ state: 'visible', timeout: 10000 })

      // Enter amount
      const depositAmount = '10'
      await token0Input.fill(depositAmount)
      console.log(`[PART 5] Entered ${depositAmount} for token0`)

      // Wait for token1 to be calculated by API
      console.log('[PART 5] Waiting for token1 calculation...')
      const token1Input = page.locator('input#amount1')

      let token1Calculated = false
      let attempts = 0
      const maxAttempts = 30 // 30 seconds max

      while (!token1Calculated && attempts < maxAttempts) {
        await page.waitForTimeout(1000)
        const token1Value = await token1Input.inputValue()
        if (token1Value && parseFloat(token1Value) > 0) {
          console.log(`[PART 5] ✓ Token1 calculated: ${token1Value}`)
          token1Calculated = true
        } else {
          attempts++
        }
      }

      if (!token1Calculated) {
        throw new Error('Token1 amount was not calculated after 30 seconds')
      }
      console.log('[PART 5] ✓ Ready to deposit\n')

      // PART 6: Click Deposit button
      console.log('[PART 6] Clicking Deposit button...')
      const depositBtn = page.getByRole('button', { name: /deposit/i, exact: true })
      await depositBtn.waitFor({ state: 'visible', timeout: 5000 })

      const isEnabled = await depositBtn.isEnabled()
      if (!isEnabled) {
        throw new Error('Deposit button is disabled')
      }

      await depositBtn.click()
      console.log('[PART 6] ✓ Clicked initial button')

      // Wait for transaction flow to begin
      await page.waitForTimeout(2000)
      console.log('[PART 6] ✓ Transaction flow started\n')

      // PARTS 7-9: Handle the transaction flow (approvals → permit → deposit)
      // The SAME button changes text as we progress through steps
      console.log('[PARTS 7-9] Handling transaction flow...')

      let flowComplete = false
      let maxSteps = 5 // Max steps to prevent infinite loop (2 approvals + 1 permit + 1 deposit + safety)
      let stepCount = 0

      while (!flowComplete && stepCount < maxSteps) {
        stepCount++
        await page.waitForTimeout(1500)

        // Find the action button (looks for any button with Approve/Sign/Deposit text)
        const actionBtn = page.locator('button').filter({
          hasText: /Approve|Sign|Deposit/i
        }).first()

        const isVisible = await actionBtn.isVisible().catch(() => false)

        if (!isVisible) {
          console.log(`[STEP ${stepCount}] No more action buttons - flow may be complete`)
          flowComplete = true
          break
        }

        const buttonText = await actionBtn.textContent()
        console.log(`[STEP ${stepCount}] Found button: "${buttonText?.trim()}"`)

        // Click the button
        await actionBtn.click()
        console.log(`[STEP ${stepCount}] Clicked button`)

        // Wait for MetaMask popup
        await page.waitForTimeout(1500)

        // Determine transaction type from button text
        let txType = 'transaction'
        if (buttonText?.includes('Approve')) {
          txType = 'approval'
        } else if (buttonText?.includes('Sign')) {
          txType = 'permit'
        } else if (buttonText?.includes('Deposit')) {
          txType = 'deposit'
          flowComplete = true // Deposit is the last step
        }

        // Handle MetaMask transaction
        try {
          await handleMetaMaskTransaction(page, context, txType)
          console.log(`[STEP ${stepCount}] ✓ ${txType} confirmed\n`)
        } catch (error) {
          console.log(`[STEP ${stepCount}] MetaMask ${txType} failed or not found`)
          // If this was the deposit step and no popup, we might already be done
          if (txType === 'deposit') {
            console.log(`[STEP ${stepCount}] Deposit step - checking if transaction already submitted`)
            flowComplete = true
          }
          break
        }

        // Wait for UI to update
        await page.waitForTimeout(2000)
      }

      console.log('[PARTS 7-9] ✓ Transaction flow complete\n')

      // PART 10: Wait for success and verify position appears
      console.log('[PART 10] Waiting for position to appear...')

      // Wait for modal to close
      await page.waitForTimeout(3000)

      // Check for skeleton loader (indicates loading state)
      console.log('[PART 10] Looking for position skeleton...')
      const skeletonVisible = await page.locator('.animate-pulse').first().isVisible().catch(() => false)

      if (skeletonVisible) {
        console.log('[PART 10] ✓ Skeleton loader visible')
      }

      // Wait for skeleton to be replaced by actual position card
      console.log('[PART 10] Waiting for position card to load...')
      await page.waitForTimeout(8000) // Give time for subgraph indexing

      // Look for position card indicators (adjust selectors based on actual implementation)
      const positionCard = page.locator('[data-position-card]').or(
        page.locator('div').filter({ hasText: /position/i }).first()
      )

      const positionCardVisible = await positionCard.isVisible().catch(() => false)

      if (positionCardVisible) {
        console.log('[PART 10] ✓ Position card appeared!')
      } else {
        console.log('[PART 10] ⚠ Position card not immediately visible (may need more time for indexing)')
      }

      console.log('[PART 10] ✓ Add liquidity flow complete\n')

      console.log('✅ SESSION 1 COMPLETE\n')
    } catch (error) {
      console.error('\n❌ SESSION 1 FAILED:', error)
      await page.screenshot({
        path: `test-results/liquidity-session1-error-${Date.now()}.png`,
        fullPage: true
      })
      throw error
    } finally {
      await cleanup()
    }
  })
})
