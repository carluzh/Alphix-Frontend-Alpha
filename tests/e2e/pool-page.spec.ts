import { test, expect } from '../e2e/test-setup';

test.describe('Pool Page Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a pool page
    await page.goto('/liquidity/0x1234567890123456789012345678901234567890');
  });

  test('should load pool page successfully', async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Check that the page title contains pool information
    await expect(page).toHaveTitle(/Alphix/);

    // Verify that key elements are present
    await expect(page.locator('text=Pool Details')).toBeVisible();

    // Check for pool data display
    await expect(page.locator('[data-testid="pool-price"]')).toBeVisible();
    await expect(page.locator('[data-testid="pool-tvl"]')).toBeVisible();
  });

  test('should display pool statistics', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check for TVL display
    const tvlElement = page.locator('[data-testid="pool-tvl"]');
    await expect(tvlElement).toBeVisible();
    await expect(tvlElement).toContainText('$');

    // Check for volume display
    const volumeElement = page.locator('[data-testid="pool-volume"]');
    await expect(volumeElement).toBeVisible();

    // Check for fee display
    const feeElement = page.locator('[data-testid="pool-fee"]');
    await expect(feeElement).toBeVisible();
  });

  test('should have working navigation', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Check that navigation elements are present
    await expect(page.locator('nav')).toBeVisible();

    // Test navigation to portfolio
    await page.click('text=Portfolio');
    await expect(page).toHaveURL(/.*portfolio/);

    // Navigate back to pool page
    await page.goBack();
    await expect(page).toHaveURL(/.*liquidity/);
  });

  test('should handle invalid pool ID gracefully', async ({ page }) => {
    // Navigate to invalid pool
    await page.goto('/liquidity/invalid-pool-id');

    // Should still load the page (with error handling)
    await page.waitForLoadState('networkidle');

    // Should show some indication of error or fallback
    await expect(page.locator('text=Pool Details')).toBeVisible();
  });
});
