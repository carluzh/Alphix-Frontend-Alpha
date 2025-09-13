import { test, expect } from '../e2e/test-setup';

test.describe('Swap Quote Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to swap page
    await page.goto('/swap');
    await page.waitForLoadState('networkidle');
  });

  test('should load swap page successfully', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Alphix/);

    // Check for swap interface elements
    await expect(page.locator('[data-testid="swap-from-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="swap-to-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="swap-button"]')).toBeVisible();
  });

  test('should allow token selection', async ({ page }) => {
    // Click on "From" token selector
    await page.locator('[data-testid="from-token-selector"]').click();

    // Token selection modal should open
    await expect(page.locator('[data-testid="token-select-modal"]')).toBeVisible();

    // Select a token
    await page.locator('[data-testid="token-option-ETH"]').click();

    // Modal should close and token should be selected
    await expect(page.locator('[data-testid="token-select-modal"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="from-token-display"]')).toContainText('ETH');
  });

  test('should allow amount input', async ({ page }) => {
    // Enter amount in from input
    const fromInput = page.locator('[data-testid="swap-from-input"]');
    await fromInput.fill('1');

    // Value should be set
    await expect(fromInput).toHaveValue('1');

    // Should trigger quote calculation
    await expect(page.locator('[data-testid="swap-quote-loading"]')).toBeVisible();
  });

  test('should display swap quote', async ({ page }) => {
    // Enter amount
    await page.locator('[data-testid="swap-from-input"]').fill('1');

    // Wait for quote to load
    await page.waitForSelector('[data-testid="swap-quote-amount"]', { timeout: 5000 });

    // Quote amount should be visible
    const quoteAmount = page.locator('[data-testid="swap-quote-amount"]');
    await expect(quoteAmount).toBeVisible();
    await expect(quoteAmount).toContainText(/\d/);
  });

  test('should show exchange rate', async ({ page }) => {
    // Enter amount
    await page.locator('[data-testid="swap-from-input"]').fill('1');

    // Wait for quote
    await page.waitForSelector('[data-testid="swap-quote-amount"]');

    // Exchange rate should be visible
    const exchangeRate = page.locator('[data-testid="exchange-rate"]');
    await expect(exchangeRate).toBeVisible();
    await expect(exchangeRate).toMatch(/\d+\s+.*=\s+\d+/);
  });

  test('should show price impact', async ({ page }) => {
    // Enter amount
    await page.locator('[data-testid="swap-from-input"]').fill('1000');

    // Wait for quote
    await page.waitForSelector('[data-testid="swap-quote-amount"]');

    // Price impact should be visible
    const priceImpact = page.locator('[data-testid="price-impact"]');
    await expect(priceImpact).toBeVisible();
    await expect(priceImpact).toContainText('%');
  });

  test('should show fee information', async ({ page }) => {
    // Enter amount
    await page.locator('[data-testid="swap-from-input"]').fill('1');

    // Wait for quote
    await page.waitForSelector('[data-testid="swap-quote-amount"]');

    // Fee information should be visible
    const feeInfo = page.locator('[data-testid="swap-fee"]');
    await expect(feeInfo).toBeVisible();
    await expect(feeInfo).toContainText(/\d/);
  });

  test('should enable swap button when quote is ready', async ({ page }) => {
    // Enter amount
    await page.locator('[data-testid="swap-from-input"]').fill('1');

    // Wait for quote
    await page.waitForSelector('[data-testid="swap-quote-amount"]');

    // Swap button should be enabled
    const swapButton = page.locator('[data-testid="swap-button"]');
    await expect(swapButton).toBeEnabled();
  });

  test('should handle insufficient balance', async ({ page }) => {
    // Enter very large amount
    await page.locator('[data-testid="swap-from-input"]').fill('1000000');

    // Should show insufficient balance warning
    await expect(page.locator('[data-testid="insufficient-balance"]')).toBeVisible();

    // Swap button should be disabled
    await expect(page.locator('[data-testid="swap-button"]')).toBeDisabled();
  });

  test('should allow token swap direction toggle', async ({ page }) => {
    // Select tokens
    await page.locator('[data-testid="from-token-selector"]').click();
    await page.locator('[data-testid="token-option-ETH"]').click();

    await page.locator('[data-testid="to-token-selector"]').click();
    await page.locator('[data-testid="token-option-USDC"]').click();

    // Enter amount
    await page.locator('[data-testid="swap-from-input"]').fill('1');

    // Get initial quote
    await page.waitForSelector('[data-testid="swap-quote-amount"]');
    const initialQuote = await page.locator('[data-testid="swap-quote-amount"]').textContent();

    // Click swap direction button
    await page.locator('[data-testid="swap-direction"]').click();

    // Tokens should be swapped
    await expect(page.locator('[data-testid="from-token-display"]')).toContainText('USDC');
    await expect(page.locator('[data-testid="to-token-display"]')).toContainText('ETH');

    // Quote should be different
    await page.waitForSelector('[data-testid="swap-quote-amount"]');
    const newQuote = await page.locator('[data-testid="swap-quote-amount"]').textContent();
    expect(newQuote).not.toBe(initialQuote);
  });
});
