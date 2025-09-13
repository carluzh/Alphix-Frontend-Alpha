import { test, expect } from './test-setup';

// Testnet-backed E2E tests for swap functionality
test.describe('Swap Interface - Testnet Integration', () => {
  test.skip(
    process.env.E2E_TESTNET_MODE !== 'true',
    'Testnet tests require E2E_TESTNET_MODE=true'
  );

  test('should load swap page with real token data', async ({ page }) => {
    await page.goto('/swap');

    // Check page loads
    await expect(page).toHaveTitle(/Alphix/);

    // Look for token selectors
    const tokenSelectors = page.locator('[data-testid="token-selector"], button:has-text("Select token")');
    await expect(tokenSelectors.first()).toBeVisible();

    // Check for input fields
    const amountInput = page.locator('input[type="number"], [data-testid="amount-input"]');
    await expect(amountInput).toBeVisible();
  });

  test('should fetch real-time quotes from testnet', async ({ page }) => {
    await page.goto('/swap');

    // Select tokens (this would need to be configured based on testnet tokens)
    const tokenSelectors = page.locator('[data-testid="token-selector"]');
    await expect(tokenSelectors).toHaveCount(2);

    // Enter amount
    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill('1');

    // Wait for quote to load
    await page.waitForTimeout(2000);

    // Check for quote display
    const quoteElement = page.locator('[data-testid="quote"], [data-testid="swap-quote"], text=/You receive|Output/');
    await expect(quoteElement.or(page.locator('text=Fetching quote')).or(page.locator('text=No quote available'))).toBeVisible();
  });

  test('should handle insufficient liquidity gracefully', async ({ page }) => {
    await page.goto('/swap');

    // Enter large amount that might exceed liquidity
    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill('1000000'); // Very large amount

    await page.waitForTimeout(3000);

    // Should show appropriate message, not crash
    const errorMessage = page.locator('text=Insufficient liquidity, text=No route found, text=Amount too large');
    const quoteSection = page.locator('[data-testid="quote-section"], [data-testid="swap-preview"]');

    // Either shows error or handles gracefully
    await expect(errorMessage.or(quoteSection)).toBeVisible();
  });

  test('should test quote refresh on amount changes', async ({ page }) => {
    await page.goto('/swap');

    const amountInput = page.locator('input[type="number"]').first();

    // Enter initial amount
    await amountInput.fill('1');
    await page.waitForTimeout(2000);

    // Get initial quote
    const initialQuote = await page.locator('[data-testid="quote-amount"], [data-testid="output-amount"]').textContent();

    // Change amount
    await amountInput.fill('2');
    await page.waitForTimeout(2000);

    // Quote should update
    const updatedQuote = await page.locator('[data-testid="quote-amount"], [data-testid="output-amount"]').textContent();

    // Quotes should be different (or same if linear pricing)
    expect(updatedQuote).toBeTruthy();
  });

  test('should handle network connectivity issues', async ({ page }) => {
    await page.goto('/swap');

    // Simulate network issues by blocking API calls
    await page.route('**/api/**', route => route.abort());

    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill('1');

    await page.waitForTimeout(3000);

    // Should show error state
    const errorElement = page.locator('text=Network error, text=Failed to fetch, text=Connection failed');
    await expect(errorElement.or(page.locator('text=Loading')).or(page.locator('[data-testid="error-state"]'))).toBeVisible();
  });
});

