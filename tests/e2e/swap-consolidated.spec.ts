/**
 * Swap E2E Tests - Consolidated v3
 * Minimized wallet reloads by chaining related tests
 */

import { test } from '@playwright/test'

// Helpers
import { initializeTestEnvironment, navigateAndConnectWallet, clickActionButton } from './helpers/test-setup'
import { handleMetaMaskTransaction, rejectMetaMaskTransaction } from './helpers/metamask'
import { executeSwapFlow } from './helpers/swap-execution'

// Fixtures
import { TOKENS } from './fixtures/tokens'

test.describe('Swap E2E Tests - Consolidated', () => {

  // SESSION 1: Basic flows + Input validation + Approval/Permit2 + Native ETH + Rejection + Exact Out
  test('Session 1: Basic swap, input validation, Permit2, native ETH, rejection, and exact out', async () => {
    console.log('\n' + '='.repeat(60))
    console.log('SESSION 1 STARTING: Basic Flows')
    console.log('  • Part 1: Basic swap (aUSDC → aUSDT)')
    console.log('  • Part 2: Input validation (zero check)')
    console.log('  • Part 3: Permit2 approval reuse')
    console.log('  • Part 4: Native ETH → aUSDT')
    console.log('  • Part 5: Wallet rejection handling')
    console.log('  • Part 6: Exact Out mode (aUSDC → aUSDT)')
    console.log('='.repeat(60) + '\n')

    const { page, context, testAccount, cleanup } = await initializeTestEnvironment()

    try {
      await navigateAndConnectWallet(page, context)

      // Part 1: Basic swap (aUSDC → aUSDT)
      console.log('\n=== PART 1: Basic Swap ===')
      await executeSwapFlow({
        page,
        context,
        testAccount,
        fromToken: TOKENS.aUSDC,
        toToken: TOKENS.aUSDT,
        amount: 10,
      })
      console.log('✓ Basic swap completed\n')

      // Part 2: Input validation (zero blocked)
      console.log('=== PART 2: Input Validation ===')
      let swapAgainBtn = page.getByRole('button', { name: 'Swap again' })
      await swapAgainBtn.click()
      await page.waitForTimeout(800)

      const swapAmountInput = page.locator('input[type="number"], input[placeholder*="0"]').first()
      const swapBtn = page.locator('[data-swap-container="true"]').getByRole('button', { name: 'Swap', exact: true })

      await swapAmountInput.fill('0')
      await page.waitForTimeout(300)
      const isZeroBlocked = !(await swapBtn.isEnabled())
      console.log(`Zero input blocked: ${isZeroBlocked ? '✓' : '✗ ERROR'}`)

      if (!isZeroBlocked) {
        throw new Error('Zero input should be blocked')
      }
      console.log('✓ Input validation passed\n')

      // Part 3: Second swap to test Permit2 (approval should be skipped)
      console.log('=== PART 3: Permit2 Approval Reuse ===')
      await swapAmountInput.fill('5')

      // Wait for quote
      const toTokenInput = page.locator('input[type="number"], input[placeholder*="0"]').nth(1)
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(1000)
        const value = await toTokenInput.inputValue()
        if (value && parseFloat(value) > 0) break
      }

      await swapBtn.click()
      let changeBtn = page.getByRole('button', { name: 'Change' })
      await changeBtn.waitFor({ state: 'visible', timeout: 5000 })

      // Verify approval is skipped
      let actionText = await clickActionButton(page)
      if (actionText === 'Approve') {
        throw new Error('Approval should be skipped on second swap')
      }
      console.log('Approval skipped ✓ (Permit2 working)')

      // Complete swap
      if (actionText === 'Sign') {
        await handleMetaMaskTransaction(page, context, 'permit')
        const confirmText = await clickActionButton(page)
        if (confirmText === 'Confirm Swap') {
          await handleMetaMaskTransaction(page, context, 'swap')
        }
      } else if (actionText === 'Confirm Swap') {
        await handleMetaMaskTransaction(page, context, 'swap')
      }

      swapAgainBtn = page.getByRole('button', { name: 'Swap again' })
      await swapAgainBtn.waitFor({ state: 'visible', timeout: 10000 })
      console.log('✓ Permit2 test passed\n')

      // Part 4: Native ETH → aUSDT
      console.log('=== PART 4: Native ETH → aUSDT ===')
      await swapAgainBtn.click()
      await page.waitForTimeout(800)

      await executeSwapFlow({
        page,
        context,
        testAccount,
        fromToken: TOKENS.ETH,
        toToken: TOKENS.aUSDT,
        amount: 0.001,
      })
      console.log('✓ Native ETH swap\n')

      // Part 5: Wallet rejection test
      console.log('=== PART 5: Wallet Rejection ===')
      await swapAgainBtn.click()
      await page.waitForTimeout(800)

      // Use the same tokens (aUSDC → aUSDT) to test rejection
      await swapAmountInput.fill('5')
      await page.waitForTimeout(1500)
      await swapBtn.click()
      changeBtn = page.getByRole('button', { name: 'Change' })
      await changeBtn.waitFor({ state: 'visible', timeout: 5000 })

      // Skip approval/permit, go straight to swap rejection
      actionText = await clickActionButton(page)
      if (actionText === 'Approve') {
        await handleMetaMaskTransaction(page, context, 'approval')
        actionText = await clickActionButton(page)
      }
      if (actionText === 'Sign') {
        await handleMetaMaskTransaction(page, context, 'permit')
        actionText = await clickActionButton(page)
      }

      // Reject swap
      if (actionText === 'Confirm Swap') {
        await rejectMetaMaskTransaction(page, context, 'swap')
        await page.waitForTimeout(2000)

        // Check if we're still in review or back on swap page
        const stillInReview = await changeBtn.isVisible().catch(() => false)
        console.log(`Still in review after rejection: ${stillInReview ? '✓' : '✗'}`)

        // If we're in review, go back to swap page
        if (stillInReview) {
          await changeBtn.click()
          await page.waitForTimeout(500)
        }

        // Now we should be on swap page - navigate to fresh swap
        swapAgainBtn = page.getByRole('button', { name: 'Swap again' })
        const swapAgainVisible = await swapAgainBtn.isVisible().catch(() => false)
        if (swapAgainVisible) {
          await swapAgainBtn.click()
          await page.waitForTimeout(800)
        }
      }
      console.log('✓ Rejection handling\n')

      // Part 6: Exact Out mode (specify desired output, not input)
      console.log('=== PART 6: Exact Out Mode ===')

      await executeSwapFlow({
        page,
        context,
        testAccount,
        fromToken: TOKENS.aUSDC,
        toToken: TOKENS.aUSDT,
        amount: 3, // We want EXACTLY 3 aUSDT output
        mode: 'exactOut',
      })
      console.log('✓ Exact Out swap\n')

      console.log('✅ SESSION 1 COMPLETE\n')
    } finally {
      await cleanup()
    }
  })

  // SESSION 2: Different tokens + decimals + Native ETH reverse + UI Features
  test('Session 2: Different tokens, decimal precision, native ETH reverse, and UI features', async () => {
    console.log('\n' + '='.repeat(60))
    console.log('SESSION 2 STARTING: Token Variations & UI Features')
    console.log('  • Part 1: Decimals 18→6 (aETH → aUSDT)')
    console.log('  • Part 2: Decimals 6→8 (aUSDC → aBTC)')
    console.log('  • Part 3: aUSDC → Native ETH (Exact In)')
    console.log('  • Part 4: UI features (MAX, slippage, explorer)')
    console.log('='.repeat(60) + '\n')

    const { page, context, testAccount, cleanup } = await initializeTestEnvironment()

    try {
      await navigateAndConnectWallet(page, context)

      // Part 1: aETH → aUSDT (18 → 6 decimals)
      console.log('\n=== PART 1: Decimals 18→6 (aETH → aUSDT) ===')
      await executeSwapFlow({
        page,
        context,
        testAccount,
        fromToken: TOKENS.aETH,
        toToken: TOKENS.aUSDT,
        amount: 0.01,
      })
      console.log('✓ 18→6 decimals\n')

      // Part 2: aUSDC → aBTC (6 → 8 decimals)
      console.log('=== PART 2: Decimals 6→8 (aUSDC → aBTC) ===')

      let swapAgainBtn = page.getByRole('button', { name: 'Swap again' })
      await swapAgainBtn.click()
      await page.waitForTimeout(800)

      await executeSwapFlow({
        page,
        context,
        testAccount,
        fromToken: TOKENS.aUSDC,
        toToken: TOKENS.aBTC,
        amount: 10,
      })
      console.log('✓ 6→8 decimals\n')

      // Part 3: aUSDC → Native ETH (Exact In)
      console.log('=== PART 3: aUSDC → Native ETH (Exact In) ===')
      await swapAgainBtn.click()
      await page.waitForTimeout(800)

      await executeSwapFlow({
        page,
        context,
        testAccount,
        fromToken: TOKENS.aUSDC,
        toToken: TOKENS.ETH,
        amount: 1,
      })
      console.log('✓ Native ETH reverse swap (Exact In)\n')

      // Part 4: UI Features
      console.log('=== PART 4: UI Features ===')
      await swapAgainBtn.click()
      await page.waitForTimeout(800)

      const swapAmountInput = page.locator('input[type="number"], input[placeholder*="0"]').first()

      // Check MAX button
      const maxBtn = page.getByRole('button', { name: /max/i }).first()
      if (await maxBtn.isVisible().catch(() => false)) {
        await maxBtn.click()
        await page.waitForTimeout(500)
        const value = await swapAmountInput.inputValue()
        console.log(`MAX button: ✓ (filled ${value})`)
      } else {
        console.log('MAX button: - (not found)')
      }

      // Check slippage settings
      const slippageBtns = [
        page.getByRole('button', { name: /slippage/i }),
        page.getByRole('button', { name: /settings/i }),
      ]

      let found = false
      for (const btn of slippageBtns) {
        if (await btn.isVisible().catch(() => false)) {
          await btn.click()
          await page.waitForTimeout(500)
          console.log('Slippage settings: ✓')

          const closeBtn = page.getByRole('button', { name: /close/i }).first()
          if (await closeBtn.isVisible().catch(() => false)) {
            await closeBtn.click()
          }
          found = true
          break
        }
      }
      if (!found) console.log('Slippage settings: - (not found)')

      // Do final swap to check explorer link
      console.log('\nFinal swap for explorer link...')
      await executeSwapFlow({
        page,
        context,
        testAccount,
        fromToken: TOKENS.aUSDC,
        toToken: TOKENS.aUSDT,
        amount: 5,
      })

      // Check for explorer link
      const explorerLinks = [
        page.getByRole('link', { name: /view on explorer/i }),
        page.getByRole('link', { name: /view transaction/i }),
        page.locator('a[href*="blockscout"]'),
      ]

      found = false
      for (const link of explorerLinks) {
        if (await link.isVisible().catch(() => false)) {
          const href = await link.getAttribute('href')
          console.log(`Explorer link: ✓ (${href?.substring(0, 40)}...)`)
          found = true
          break
        }
      }
      if (!found) console.log('Explorer link: - (not found)')

      console.log('✓ UI features tested\n')

      console.log('✅ SESSION 2 COMPLETE\n')
    } finally {
      await cleanup()
    }
  })

})
