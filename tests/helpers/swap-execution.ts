/**
 * Swap execution helper
 * Reusable functions for executing swaps in E2E tests
 */

import { Page, BrowserContext } from '@playwright/test'
import { parseUnits } from 'viem'
import { handleMetaMaskTransaction } from './metamask'
import { clickActionButton } from './test-setup'
import { readBalances, verifySwapBalances } from './balances'
import { TokenConfig } from '../fixtures/tokens'

export interface SwapExecutionParams {
  page: Page
  context: BrowserContext
  testAccount: { address: string; privateKey: string }
  fromToken: TokenConfig
  toToken: TokenConfig
  amount: number
  mode?: 'exactIn' | 'exactOut' // exactIn: enter amount in "from" field, exactOut: enter amount in "to" field
}

/**
 * Select a token in the swap interface
 * @param page Playwright page
 * @param position 'from' or 'to' - which token selector to use
 * @param tokenSymbol Symbol of the token to select (e.g., 'ETH', 'aUSDC')
 */
async function selectToken(page: Page, position: 'from' | 'to', tokenSymbol: string): Promise<void> {
  // Find all token selector buttons within the swap container
  // There are two: one for "from" token (first) and one for "to" token (second)
  const swapContainer = page.locator('[data-swap-container="true"]')
  const tokenButtons = swapContainer.getByRole('button').filter({ has: page.locator('img[alt]') })

  // Select the token
  const buttonIndex = position === 'from' ? 0 : 1
  const button = tokenButtons.nth(buttonIndex)

  console.log(`  Selecting ${tokenSymbol} for ${position}...`)

  // Make sure button is ready to click
  await button.waitFor({ state: 'visible', timeout: 5000 })
  
  // Click the token selector button with force to ensure it registers
  await button.click({ force: true })
  console.log(`  Clicked ${position} token button, waiting for modal...`)
  await page.waitForTimeout(1500)

  // Wait for the modal to appear - use specific selector for token modal
  const modal = page.locator('div.fixed.rounded-lg.shadow-2xl').first()
  const modalVisible = await modal.isVisible().catch(() => false)
  console.log(`  Modal visible after click: ${modalVisible}`)
  
  if (!modalVisible) {
    console.log(`  Modal not visible, taking screenshot...`)
    await page.screenshot({ path: `test-results/modal-not-open-${Date.now()}.png`, fullPage: true })
    // Try clicking again
    await button.click()
    await page.waitForTimeout(1500)
  }
  
  await modal.waitFor({ state: 'visible', timeout: 5000 })

  // Find the search input INSIDE the modal (not the main swap input)
  const searchInput = modal.locator('input').first()
  await searchInput.waitFor({ state: 'visible', timeout: 5000 })

  // Clear any existing text first
  await searchInput.clear()

  // Search for the token by typing in the search input
  await searchInput.fill(tokenSymbol)
  await page.waitForTimeout(1000)

  // Click the token in the results list
  // IMPORTANT: Find the button INSIDE the modal (not the selector button outside)
  // Need to find exact match, not just contains (ETH vs aETH issue)
  const allTokenRows = await modal.locator('button.w-full').all()

  let foundToken: typeof allTokenRows[0] | null = null
  for (const row of allTokenRows) {
    // Check if this row's symbol EXACTLY matches (handle word boundaries)
    const symbolSpan = await row.locator('span.text-sm.font-medium').first().textContent()
    if (symbolSpan === tokenSymbol) {
      foundToken = row
      break
    }
  }

  if (!foundToken) {
    throw new Error(`Could not find exact match for token "${tokenSymbol}" in modal`)
  }

  await foundToken.click({ force: true })
  
  // Wait for modal to close - check that search input is gone
  await searchInput.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(300)

  console.log(`  ✓ Selected ${tokenSymbol}`)
}

/**
 * Execute a complete swap flow with approval, permit, and swap
 */
export async function executeSwapFlow(params: SwapExecutionParams): Promise<void> {
  const { page, context, fromToken, toToken, amount, testAccount } = params

  console.log(`[SWAP] ${amount} ${fromToken.symbol} → ${toToken.symbol}`)

  // Read initial balances
  const fromBalancesBefore = await readBalances(fromToken.address, testAccount.address)
  const toBalancesBefore = await readBalances(toToken.address, testAccount.address)

  // Wait for swap interface to be ready
  const swapContainer = page.locator('[data-swap-container="true"]')
  await swapContainer.waitFor({ state: 'visible', timeout: 5000 })

  // Check current token selections
  const tokenButtons = swapContainer.getByRole('button').filter({ has: page.locator('img[alt]') })
  const fromButton = tokenButtons.nth(0)
  const toButton = tokenButtons.nth(1)

  // Wait for buttons to be visible and have actual content
  await fromButton.waitFor({ state: 'visible', timeout: 5000 })
  await toButton.waitFor({ state: 'visible', timeout: 5000 })

  // Get current token text directly
  let currentFromText = await fromButton.textContent()
  let currentToText = await toButton.textContent()

  console.log(`  Current: ${currentFromText?.trim()} → ${currentToText?.trim()}`)
  console.log(`  Wanted: ${fromToken.symbol} → ${toToken.symbol}`)

  // Helper to check if token matches (handles ETH vs aETH)
  const tokenMatches = (text: string | null | undefined, symbol: string): boolean => {
    if (!text) return false
    // ETH and aETH are interchangeable in UI display
    if (symbol === 'ETH' && (text.includes('ETH') || text.includes('aETH'))) return true
    if (symbol === 'aETH' && (text.includes('ETH') || text.includes('aETH'))) return true
    return text.includes(symbol)
  }

  // Check if we need to flip tokens using the swap arrow button
  if (tokenMatches(currentFromText, toToken.symbol) && tokenMatches(currentToText, fromToken.symbol)) {
    console.log(`  Tokens reversed, flipping...`)
    // Find the swap arrow button (between the two input fields)
    const swapArrowBtn = swapContainer.locator('button').filter({
      has: page.locator('svg')
    }).nth(1) // Usually the second button with SVG is the swap arrow
    await swapArrowBtn.click()
    await page.waitForTimeout(800)
    console.log(`  ✓ Flipped`)
  } else if (tokenMatches(currentToText, fromToken.symbol)) {
    // If fromToken is in "to" position, flip first
    console.log(`  ${fromToken.symbol} in wrong position, flipping...`)
    const swapArrowBtn = swapContainer.locator('button').filter({
      has: page.locator('svg')
    }).nth(1)
    await swapArrowBtn.click()
    await page.waitForTimeout(800)

    // Re-read current state after flip
    currentFromText = await fromButton.textContent()
    currentToText = await toButton.textContent()
    console.log(`  After flip: ${currentFromText?.trim()} → ${currentToText?.trim()}`)

    // Now select tokens as needed (after flip)
    if (!tokenMatches(currentFromText, fromToken.symbol)) {
      await selectToken(page, 'from', fromToken.symbol)
    } else {
      console.log(`  ${fromToken.symbol} already in "from" position ✓`)
    }

    if (!tokenMatches(currentToText, toToken.symbol)) {
      await selectToken(page, 'to', toToken.symbol)
    } else {
      console.log(`  ${toToken.symbol} already in "to" position ✓`)
    }
  } else {
    // Normal token selection
    if (!tokenMatches(currentFromText, fromToken.symbol)) {
      await selectToken(page, 'from', fromToken.symbol)
    } else {
      console.log(`  ${fromToken.symbol} already in "from" position ✓`)
    }

    if (!tokenMatches(currentToText, toToken.symbol)) {
      await selectToken(page, 'to', toToken.symbol)
    } else {
      console.log(`  ${toToken.symbol} already in "to" position ✓`)
    }
  }

  const mode = params.mode || 'exactIn'
  const fromTokenInput = page.locator('[data-swap-container="true"] input[type="number"], [data-swap-container="true"] input[placeholder*="0"]').first()
  const toTokenInput = page.locator('[data-swap-container="true"] input[type="number"], [data-swap-container="true"] input[placeholder*="0"]').nth(1)

  if (mode === 'exactOut') {
    // Exact Out: User specifies desired output amount (enters in "To" field)
    console.log(`  Entering desired output: ${amount} ${toToken.symbol}`)
    await toTokenInput.click() // Focus the input field first
    await toTokenInput.fill(amount.toString())

    // Wait for quote to appear in "From" field (calculated required input)
    let quoteReceived = false
    let attempts = 0
    let calculatedInput = 0

    while (!quoteReceived && attempts < 30) {
      await page.waitForTimeout(1000)
      const fromTokenValue = await fromTokenInput.inputValue()
      if (fromTokenValue && parseFloat(fromTokenValue) > 0) {
        calculatedInput = parseFloat(fromTokenValue)
        console.log(`  Quote: ${calculatedInput} ${fromToken.symbol} required for ${amount} ${toToken.symbol}`)
        quoteReceived = true
      } else {
        attempts++
      }
    }

    if (!quoteReceived) {
      console.log('\n[ERROR] Quote did not load after 30 seconds (Exact Out mode)')
      await page.screenshot({ path: `test-results/quote-failed-exactout-${Date.now()}.png`, fullPage: true })
      throw new Error('Quote did not load after 30 seconds (Exact Out mode)')
    }
  } else {
    // Exact In: User specifies input amount (enters in "From" field) - default behavior
    console.log(`  Entering amount: ${amount} ${fromToken.symbol}`)
    await fromTokenInput.fill(amount.toString())

    // Wait for quote to appear in "To" field
    let quoteReceived = false
    let attempts = 0

    while (!quoteReceived && attempts < 30) {
      await page.waitForTimeout(1000)
      const toTokenValue = await toTokenInput.inputValue()
      if (toTokenValue && parseFloat(toTokenValue) > 0) {
        console.log(`  Quote: ${toTokenValue} ${toToken.symbol}`)
        quoteReceived = true
      } else {
        attempts++
      }
    }

    if (!quoteReceived) {
      console.log('\n[ERROR] Quote did not load after 30 seconds')
      await page.screenshot({ path: `test-results/quote-failed-${Date.now()}.png`, fullPage: true })

      // Log what tokens are actually selected
      const actualFrom = await fromButton.textContent()
      const actualTo = await toButton.textContent()
      console.log(`[ERROR] Actual tokens on screen: ${actualFrom?.trim()} → ${actualTo?.trim()}`)
      console.log(`[ERROR] Expected: ${fromToken.symbol} → ${toToken.symbol}`)

      // Check if there's an error message
      const errorMsg = await page.locator('text=/error|failed|invalid|no.*route/i').first().textContent().catch(() => null)
      if (errorMsg) {
        console.log(`[ERROR] Error message found: ${errorMsg}`)
      }

      throw new Error('Quote did not load after 30 seconds')
    }
  }

  // Click swap button and enter review
  const swapBtn = page
    .locator('[data-swap-container="true"]')
    .getByRole('button', { name: 'Swap', exact: true })
  await swapBtn.waitFor({ state: 'visible', timeout: 5000 })

  const isEnabled = await swapBtn.isEnabled()
  if (!isEnabled) {
    throw new Error('Swap button is disabled')
  }

  await swapBtn.click()

  const changeBtn = page.getByRole('button', { name: 'Change' })
  await changeBtn.waitFor({ state: 'visible', timeout: 5000 })

  // Handle approval if needed
  const firstActionText = await clickActionButton(page)
  if (firstActionText === 'Approve') {
    await handleMetaMaskTransaction(page, context, 'approval')
    console.log('  ✓ Approved')
  }

  // Handle permit signature if needed
  let nextActionText = firstActionText === 'Approve' ? await clickActionButton(page) : firstActionText
  if (nextActionText === 'Sign') {
    await handleMetaMaskTransaction(page, context, 'permit')
    console.log('  ✓ Signed')
    nextActionText = await clickActionButton(page)
  }

  // Confirm swap
  if (nextActionText === 'Confirm Swap') {
    await handleMetaMaskTransaction(page, context, 'swap')
    console.log('  ✓ Confirmed')
  }

  // Wait for success
  const swapAgainBtn = page.getByRole('button', { name: 'Swap again' })
  await swapAgainBtn.waitFor({ state: 'visible', timeout: 10000 })

  // Look for transaction hash or error messages
  const errorPatterns = [
    page.getByText(/error/i),
    page.getByText(/failed/i),
    page.getByText(/reverted/i),
  ]

  for (const pattern of errorPatterns) {
    const isVisible = await pattern.isVisible().catch(() => false)
    if (isVisible) {
      const errorText = await pattern.textContent()
      console.log(`  Warning: Error detected: ${errorText}`)
    }
  }

  // Wait longer for transaction to be fully mined and state to settle
  console.log('  Waiting for transaction to finalize...')
  await page.waitForTimeout(5000)

  // Verify on-chain state (reads directly from blockchain via RPC)
  const fromBalancesAfter = await readBalances(fromToken.address, testAccount.address)
  const toBalancesAfter = await readBalances(toToken.address, testAccount.address)

  if (mode === 'exactOut') {
    // For exactOut, verify that we received EXACTLY the amount we requested
    const toTokenIncrease = toBalancesAfter.token - toBalancesBefore.token
    const expectedToIncrease = parseUnits(amount.toString(), toToken.decimals)

    console.log(`  Verifying exactOut: expected ${amount} ${toToken.symbol}`)

    if (toTokenIncrease === expectedToIncrease) {
      console.log(`  ✓ Received exactly ${amount} ${toToken.symbol}`)
    } else {
      const actualReceived = Number(toTokenIncrease) / (10 ** toToken.decimals)
      console.log(`  ✗ ERROR: Expected ${amount} ${toToken.symbol}, got ${actualReceived}`)
      throw new Error(`ExactOut failed: expected ${amount} ${toToken.symbol}, got ${actualReceived}`)
    }

    // Verify fromToken decreased (we don't care about the exact amount for exactOut, just that it decreased)
    const fromTokenDecrease = fromBalancesBefore.token - fromBalancesAfter.token
    if (fromTokenDecrease > BigInt(0)) {
      const actualSpent = Number(fromTokenDecrease) / (10 ** fromToken.decimals)
      console.log(`  ✓ Spent ${actualSpent} ${fromToken.symbol}`)
    } else {
      throw new Error('From token balance did not decrease')
    }

    console.log(`  ✓ Complete (exactOut verified)\n`)
  } else {
    // For exactIn, use standard verification
    const verification = verifySwapBalances({
      fromToken,
      toToken,
      fromBalanceBefore: fromBalancesBefore.token,
      toBalanceBefore: toBalancesBefore.token,
      ethBalanceBefore: fromBalancesBefore.eth,
      fromBalanceAfter: fromBalancesAfter.token,
      toBalanceAfter: toBalancesAfter.token,
      ethBalanceAfter: fromBalancesAfter.eth,
      expectedFromDecrease: parseUnits(amount.toString(), fromToken.decimals),
    })

    if (!verification.success) {
      console.log('  Balance verification failed:')
      verification.messages.forEach(msg => console.log(msg))
      throw new Error('Balance verification failed')
    }

    console.log(`  ✓ Complete (balances verified)\n`)
  }
}
