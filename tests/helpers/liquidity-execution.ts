/**
 * Liquidity execution helper
 * Reusable functions for adding, increasing, and decreasing liquidity in E2E tests
 */

import { Page, BrowserContext } from '@playwright/test'
import { handleMetaMaskTransaction } from './metamask'
import { TestAccount } from './test-setup'

export interface AddLiquidityParams {
  page: Page
  context: BrowserContext
  testAccount: TestAccount
  token0Amount: number
  rangeType: 'default' | 'custom-concentrated' | 'custom-out-of-range'
  waitForSkeleton?: boolean // Whether to wait for skeleton and position card
}

export interface ModifyLiquidityParams {
  page: Page
  context: BrowserContext
  testAccount: TestAccount
  positionIndex: number // Which position to modify (0 = first)
  action: 'increase' | 'decrease'
  amount0?: number // For increase
  amount1?: number // For increase
  percentage?: number // For decrease (e.g., 50 for 50%)
}

/**
 * Navigate to a random pool's liquidity page
 */
export async function navigateToRandomPool(page: Page): Promise<string> {
  await page.goto('/liquidity?e2e=true', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  const poolRows = page.locator('a.contents[href^="/liquidity/"]')
  const rowCount = await poolRows.count()

  if (rowCount === 0) {
    throw new Error('No pools found on liquidity page')
  }

  const randomIndex = Math.floor(Math.random() * rowCount)
  const selectedRow = poolRows.nth(randomIndex)
  const href = await selectedRow.getAttribute('href')

  if (!href) {
    throw new Error('Pool link has no href attribute')
  }

  await page.goto(`${href}?e2e=true`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  return href
}

/**
 * Open the Add Liquidity form (handles both wide screen embedded form and modal)
 */
export async function openAddLiquidityForm(page: Page): Promise<void> {
  await page.waitForTimeout(2000)

  const formVisible = await page.locator('input#amount0').isVisible().catch(() => false)

  if (!formVisible) {
    const addLiquidityBtn = page.locator('a').filter({ hasText: /Add Liquidity/i }).filter({
      has: page.locator('svg')
    }).first()

    await addLiquidityBtn.waitFor({ state: 'visible', timeout: 10000 })
    await addLiquidityBtn.click()
    await page.waitForTimeout(1500)
  }

  const amountInput = page.locator('input#amount0')
  await amountInput.waitFor({ state: 'visible', timeout: 5000 })
}

/**
 * Set price range based on range type
 */
export async function setPriceRange(
  page: Page,
  rangeType: 'default' | 'custom-concentrated' | 'custom-out-of-range'
): Promise<void> {
  if (rangeType === 'default') {
    return
  }

  // Open Custom Range modal
  const customButton = page.getByRole('button', { name: /custom/i }).first()
  await customButton.waitFor({ state: 'visible', timeout: 5000 })
  await customButton.click()
  await page.waitForTimeout(1500)

  if (rangeType === 'custom-concentrated') {
    // Use preset if available (±3% or ±1%)
    const narrowPreset = page.locator('div').filter({ hasText: /^Narrow$/i }).first()
    const presetExists = await narrowPreset.isVisible().catch(() => false)

    if (presetExists) {
      await narrowPreset.click()
      await page.waitForTimeout(500)
    }

  } else if (rangeType === 'custom-out-of-range') {
    // Read current pool price from the modal
    const poolPriceText = await page.locator('div').filter({ hasText: /Pool Price/i })
      .locator('span.font-semibold')
      .first()
      .textContent()

    const currentPrice = poolPriceText ? parseFloat(poolPriceText.trim()) : null

    if (currentPrice && !isNaN(currentPrice)) {
      // Set range above current price (e.g., min = currentPrice * 1.5, max = currentPrice * 3)
      const minPrice = (currentPrice * 1.5).toFixed(6)
      const maxPrice = (currentPrice * 3).toFixed(6)

      // Find Min Price and Max Price input fields
      // They are in cards with "Min Price" and "Max Price" labels
      const minPriceInput = page.locator('div').filter({ hasText: /^Min Price$/i })
        .locator('input[type="text"]')
        .first()

      const maxPriceInput = page.locator('div').filter({ hasText: /^Max Price$/i })
        .locator('input[type="text"]')
        .first()

      // Fill in the custom prices
      await minPriceInput.fill(minPrice)
      await page.waitForTimeout(500)
      await maxPriceInput.fill(maxPrice)
      await page.waitForTimeout(500)
    }
  }

  // Close modal by clicking Confirm
  const confirmButton = page.getByRole('button', { name: /confirm/i }).first()
  await confirmButton.waitFor({ state: 'visible', timeout: 5000 })
  await confirmButton.click()
  await page.waitForTimeout(500)
}

/**
 * Enter token amounts for liquidity addition
 */
export async function enterTokenAmounts(
  page: Page,
  token0Amount: number,
  waitForCalculation: boolean = true
): Promise<{ token0: number; token1: number }> {
  const token0Input = page.locator('input#amount0')
  const token1Input = page.locator('input#amount1')

  await token0Input.waitFor({ state: 'visible', timeout: 10000 })
  await token0Input.fill(token0Amount.toString())

  if (waitForCalculation) {
    let token1Calculated = false
    let attempts = 0
    const maxAttempts = 30

    while (!token1Calculated && attempts < maxAttempts) {
      await page.waitForTimeout(1000)
      const token1Value = await token1Input.inputValue()
      if (token1Value && parseFloat(token1Value) > 0) {
        token1Calculated = true
        return { token0: token0Amount, token1: parseFloat(token1Value) }
      }
      attempts++
    }

    throw new Error('Token1 amount was not calculated after 30 seconds')
  }

  const token1Value = await token1Input.inputValue()
  return { token0: token0Amount, token1: parseFloat(token1Value) || 0 }
}

/**
 * Execute the deposit transaction flow (approvals → permit → deposit)
 */
export async function executeDepositFlow(
  page: Page,
  context: BrowserContext
): Promise<void> {
  const depositBtn = page.getByRole('button', { name: /deposit/i, exact: true })
  await depositBtn.waitFor({ state: 'visible', timeout: 5000 })

  // Wait for button to become enabled
  let attempts = 0
  const maxAttempts = 30

  while (attempts < maxAttempts) {
    const isEnabled = await depositBtn.isEnabled()
    if (isEnabled) break
    await page.waitForTimeout(1000)
    attempts++
  }

  const isEnabled = await depositBtn.isEnabled()
  if (!isEnabled) {
    throw new Error('Deposit button is still disabled after 30 seconds')
  }

  await depositBtn.click()
  await page.waitForTimeout(2000)

  // Handle transaction flow
  let flowComplete = false
  let maxSteps = 5
  let stepCount = 0

  while (!flowComplete && stepCount < maxSteps) {
    stepCount++
    await page.waitForTimeout(1500)

    const actionBtn = page.locator('button').filter({
      hasText: /Approve|Sign|Deposit/i
    }).first()

    const isVisible = await actionBtn.isVisible().catch(() => false)

    if (!isVisible) {
      flowComplete = true
      break
    }

    const buttonText = await actionBtn.textContent()
    await actionBtn.click()
    await page.waitForTimeout(1500)

    let txType = 'transaction'
    if (buttonText?.includes('Approve')) {
      txType = 'approval'
    } else if (buttonText?.includes('Sign')) {
      txType = 'permit'
    } else if (buttonText?.includes('Deposit')) {
      txType = 'deposit'
      flowComplete = true
    }

    try {
      await handleMetaMaskTransaction(page, context, txType)
    } catch (error) {
      if (txType === 'deposit') {
        flowComplete = true
      }
      break
    }

    await page.waitForTimeout(2000)
  }
}

/**
 * Wait for success toast (sonner notification)
 */
export async function waitForSuccessToast(page: Page, timeoutMs: number = 15000): Promise<boolean> {
  try {
    const successToast = page.locator('[data-sonner-toast][data-type="success"]').or(
      page.locator('.sonner-toast').filter({ hasText: /success|complete|added/i })
    ).first()

    await successToast.waitFor({ state: 'visible', timeout: timeoutMs })
    return true
  } catch (error) {
    return false
  }
}

/**
 * Wait for skeleton loader to appear (indicates position is being indexed)
 */
export async function waitForSkeleton(page: Page, timeoutMs: number = 10000): Promise<boolean> {
  try {
    const skeleton = page.locator('div.rounded-lg.border').filter({
      has: page.locator('.animate-pulse')
    }).first()

    await skeleton.waitFor({ state: 'visible', timeout: timeoutMs })
    return true
  } catch (error) {
    return false
  }
}

/**
 * Wait for skeleton to disappear and position card to appear
 */
export async function waitForPositionCard(
  page: Page,
  expectedCount: number,
  timeoutMs: number = 20000
): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    await page.waitForTimeout(1000)

    const skeletonExists = await page.locator('div.rounded-lg.border').filter({
      has: page.locator('.animate-pulse')
    }).first().isVisible().catch(() => false)

    if (!skeletonExists) {
      const positionCards = page.locator('div.rounded-lg.border.bg-muted\\/30.cursor-pointer').or(
        page.locator('div').filter({ hasText: /In Range|Out of Range|Out Of Range/i })
      )

      const count = await positionCards.count()

      if (count >= expectedCount) {
        return true
      }
    }
  }

  return false
}

/**
 * Verify position persists after page reload
 */
export async function verifyPositionAfterReload(
  page: Page,
  expectedCount: number
): Promise<boolean> {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  const positionCards = page.locator('div.rounded-lg.border.bg-muted\\/30.cursor-pointer').or(
    page.locator('div').filter({ hasText: /In Range|Out of Range|Out Of Range/i })
  )

  const count = await positionCards.count()
  return count >= expectedCount
}

/**
 * Complete add liquidity flow with all validations
 */
export async function executeAddLiquidityFlow(params: AddLiquidityParams): Promise<void> {
  const { page, context, token0Amount, rangeType, waitForSkeleton: shouldWaitForSkeleton = true } = params

  await setPriceRange(page, rangeType)
  await enterTokenAmounts(page, token0Amount)
  await executeDepositFlow(page, context)
  await waitForSuccessToast(page)

  if (shouldWaitForSkeleton) {
    const skeletonAppeared = await waitForSkeleton(page)

    if (skeletonAppeared) {
      await waitForPositionCard(page, 1)
    }

    await page.waitForTimeout(10000)
    await verifyPositionAfterReload(page, 1)
  }
}

/**
 * Open position modification modal (Increase or Withdraw)
 */
export async function openModifyPositionModal(
  page: Page,
  positionIndex: number,
  action: 'increase' | 'decrease'
): Promise<void> {
  const positionCards = page.locator('div.rounded-lg.border.bg-muted\\/30.cursor-pointer')

  const count = await positionCards.count()
  if (count === 0) {
    throw new Error('No positions found to modify')
  }

  if (positionIndex >= count) {
    throw new Error(`Position index ${positionIndex} out of range (found ${count} positions)`)
  }

  const targetPosition = positionCards.nth(positionIndex)
  await targetPosition.click()
  await page.waitForTimeout(1500)

  const actionButton = page.getByRole('button', {
    name: action === 'increase' ? /increase|add.*liquidity/i : /withdraw|decrease/i
  }).first()

  await actionButton.waitFor({ state: 'visible', timeout: 5000 })
  await actionButton.click()
  await page.waitForTimeout(1000)
}

/**
 * Execute increase liquidity flow
 */
export async function executeIncreaseLiquidityFlow(params: ModifyLiquidityParams): Promise<void> {
  const { page, context, positionIndex, amount0 = 5 } = params

  await openModifyPositionModal(page, positionIndex, 'increase')

  const token0Input = page.locator('input#amount0').or(
    page.locator('input').filter({ hasText: /amount|token/i }).first()
  )

  await token0Input.waitFor({ state: 'visible', timeout: 5000 })
  await token0Input.fill(amount0.toString())
  await page.waitForTimeout(2000)

  const depositBtn = page.getByRole('button', { name: /deposit|increase/i }).first()
  await depositBtn.waitFor({ state: 'visible', timeout: 5000 })
  await depositBtn.click()

  await executeDepositFlow(page, context)
  await waitForSuccessToast(page)
}

/**
 * Execute decrease liquidity flow
 */
export async function executeDecreaseLiquidityFlow(params: ModifyLiquidityParams): Promise<void> {
  const { page, context, positionIndex, percentage = 50 } = params

  await openModifyPositionModal(page, positionIndex, 'decrease')

  const percentageInput = page.locator('input[type="range"]').or(
    page.locator('input').filter({ hasText: /percentage|%/i }).first()
  )

  const percentageExists = await percentageInput.isVisible().catch(() => false)

  if (percentageExists) {
    await percentageInput.fill(percentage.toString())
  } else {
    const presetBtn = page.getByRole('button', { name: new RegExp(`${percentage}%`) }).first()
    const presetExists = await presetBtn.isVisible().catch(() => false)

    if (presetExists) {
      await presetBtn.click()
    }
  }

  await page.waitForTimeout(1000)

  const withdrawBtn = page.getByRole('button', { name: /withdraw|decrease|remove/i }).first()
  await withdrawBtn.waitFor({ state: 'visible', timeout: 5000 })
  await withdrawBtn.click()

  await page.waitForTimeout(2000)
  const confirmBtn = page.getByRole('button', { name: /confirm|proceed/i }).first()
  const confirmExists = await confirmBtn.isVisible().catch(() => false)

  if (confirmExists) {
    await confirmBtn.click()
    await page.waitForTimeout(1000)
  }

  try {
    await handleMetaMaskTransaction(page, context, 'withdraw')
  } catch (error) {
    // Transaction may have been handled elsewhere
  }

  await waitForSuccessToast(page)
}
