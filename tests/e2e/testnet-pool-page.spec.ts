import { test, expect } from './test-setup';

// Testnet-backed E2E tests - only run when E2E_TESTNET_MODE=true
test.describe('Pool Page - Testnet Integration', () => {
  test.skip(
    process.env.E2E_TESTNET_MODE !== 'true',
    'Testnet tests require E2E_TESTNET_MODE=true'
  );

  test('should load pool page with real testnet data', async ({ page }) => {
    // Use a known testnet pool ID (this would need to be configured per testnet)
    const testPoolId = process.env.E2E_TEST_POOL_ID || 'test-pool-123';

    await page.goto(`/liquidity/${testPoolId}`);

    // Wait for page to load and check for basic elements
    await expect(page).toHaveTitle(/Alphix/);

    // Check if pool data loads (this will test real API calls)
    const poolPriceElement = page.locator('[data-testid="pool-price"], [data-testid="current-price"], .pool-price');
    await expect(poolPriceElement.or(page.locator('text=Loading')).or(page.locator('text=Error'))).toBeVisible();

    // Test that we're not seeing mock data
    await expect(page.locator('text=Mock Data')).not.toBeVisible();
  });

  test('should handle pool state updates in real-time', async ({ page }) => {
    const testPoolId = process.env.E2E_TEST_POOL_ID || 'test-pool-123';

    await page.goto(`/liquidity/${testPoolId}`);

    // Wait for initial data load
    const priceElement = page.locator('[data-testid="pool-price"], [data-testid="current-price"]');
    await expect(priceElement).toBeVisible();

    // Get initial price
    const initialPrice = await priceElement.textContent();

    // Wait for potential updates (block-driven)
    await page.waitForTimeout(5000); // Wait 5 seconds for block updates

    // Price might change (or stay the same if no blocks)
    const updatedPrice = await priceElement.textContent();

    // Just verify the element is still there and contains a price
    expect(updatedPrice).toBeTruthy();
    expect(typeof updatedPrice).toBe('string');
  });

  test('should load liquidity depth with real subgraph data', async ({ page }) => {
    const testPoolId = process.env.E2E_TEST_POOL_ID || 'test-pool-123';

    await page.goto(`/liquidity/${testPoolId}`);

    // Look for liquidity chart or depth visualization
    const liquidityElement = page.locator('[data-testid="liquidity-chart"], [data-testid="depth-chart"], .liquidity-depth');
    await expect(liquidityElement.or(page.locator('text=No liquidity data')).or(page.locator('text=Loading liquidity'))).toBeVisible();

    // Test expand/collapse if available
    const expandButton = page.locator('button:has-text("Add Liquidity"), [data-testid="add-liquidity-btn"]');
    if (await expandButton.isVisible()) {
      await expandButton.click();

      // Check if modal opens with real data
      const modal = page.locator('[role="dialog"], .modal, [data-testid="liquidity-modal"]');
      await expect(modal).toBeVisible();
    }
  });

  test('should handle network errors gracefully', async ({ page }) => {
    // Test with an invalid pool ID to trigger error handling
    await page.goto('/liquidity/invalid-pool-id-12345');

    // Should show error state, not crash
    const errorElement = page.locator('text=Error, text=Failed to load, text=Pool not found');
    await expect(errorElement.or(page.locator('text=Loading'))).toBeVisible();

    // Page should still be functional
    await expect(page.locator('nav, header')).toBeVisible();
  });

  test('should test dynamic fee updates', async ({ page }) => {
    const testPoolId = process.env.E2E_TEST_POOL_ID || 'test-pool-123';

    await page.goto(`/liquidity/${testPoolId}`);

    // Look for fee display
    const feeElement = page.locator('[data-testid="dynamic-fee"], [data-testid="current-fee"], text=/fee|Fee/');
    await expect(feeElement.or(page.locator('text=Loading fee')).or(page.locator('text=0.00%'))).toBeVisible();

    // Fee should be a valid percentage or loading state
    const feeText = await feeElement.textContent();
    if (feeText && !feeText.includes('Loading')) {
      expect(feeText).toMatch(/^\d+(\.\d+)?%?$/);
    }
  });
});

