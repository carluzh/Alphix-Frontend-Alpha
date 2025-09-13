import { test, expect } from '../e2e/test-setup';

test.describe('Add Liquidity Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a pool page
    await page.goto('/liquidity/0x1234567890123456789012345678901234567890');
    await page.waitForLoadState('networkidle');
  });

  test('should open add liquidity modal', async ({ page }) => {
    // Look for add liquidity button
    const addLiquidityButton = page.locator('[data-testid="add-liquidity-button"]').or(
      page.locator('text=Add Liquidity')
    );

    await expect(addLiquidityButton).toBeVisible();
    await addLiquidityButton.click();

    // Modal should open
    await expect(page.locator('[data-testid="add-liquidity-modal"]')).toBeVisible();
  });

  test('should display liquidity form', async ({ page }) => {
    // Open add liquidity modal
    const addLiquidityButton = page.locator('[data-testid="add-liquidity-button"]').or(
      page.locator('text=Add Liquidity')
    );
    await addLiquidityButton.click();

    // Check for form elements
    await expect(page.locator('[data-testid="token0-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="token1-input"]')).toBeVisible();

    // Check for range selector
    await expect(page.locator('[data-testid="price-range"]')).toBeVisible();

    // Check for liquidity depth chart
    await expect(page.locator('[data-testid="liquidity-chart"]')).toBeVisible();
  });

  test('should allow token amount input', async ({ page }) => {
    // Open add liquidity modal
    const addLiquidityButton = page.locator('[data-testid="add-liquidity-button"]').or(
      page.locator('text=Add Liquidity')
    );
    await addLiquidityButton.click();

    // Enter amounts
    const token0Input = page.locator('[data-testid="token0-input"]');
    const token1Input = page.locator('[data-testid="token1-input"]');

    await token0Input.fill('100');
    await token1Input.fill('100');

    // Values should be set
    await expect(token0Input).toHaveValue('100');
    await expect(token1Input).toHaveValue('100');
  });

  test('should show liquidity calculation', async ({ page }) => {
    // Open add liquidity modal
    const addLiquidityButton = page.locator('[data-testid="add-liquidity-button"]').or(
      page.locator('text=Add Liquidity')
    );
    await addLiquidityButton.click();

    // Enter amounts
    await page.locator('[data-testid="token0-input"]').fill('100');
    await page.locator('[data-testid="token1-input"]').fill('100');

    // Should show calculated liquidity amount
    await expect(page.locator('[data-testid="liquidity-amount"]')).toBeVisible();
    await expect(page.locator('[data-testid="liquidity-amount"]')).toContainText(/\d/);
  });

  test('should validate input ranges', async ({ page }) => {
    // Open add liquidity modal
    const addLiquidityButton = page.locator('[data-testid="add-liquidity-button"]').or(
      page.locator('text=Add Liquidity')
    );
    await addLiquidityButton.click();

    // Try to enter invalid amounts
    await page.locator('[data-testid="token0-input"]').fill('0');
    await page.locator('[data-testid="token1-input"]').fill('0');

    // Should show validation error or disable submit
    const submitButton = page.locator('[data-testid="submit-liquidity"]');
    await expect(submitButton).toBeDisabled();
  });

  test('should close modal', async ({ page }) => {
    // Open add liquidity modal
    const addLiquidityButton = page.locator('[data-testid="add-liquidity-button"]').or(
      page.locator('text=Add Liquidity')
    );
    await addLiquidityButton.click();

    // Modal should be visible
    await expect(page.locator('[data-testid="add-liquidity-modal"]')).toBeVisible();

    // Close modal
    await page.locator('[data-testid="close-modal"]').click();

    // Modal should be hidden
    await expect(page.locator('[data-testid="add-liquidity-modal"]')).not.toBeVisible();
  });
});
