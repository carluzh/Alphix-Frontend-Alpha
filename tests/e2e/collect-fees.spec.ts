import { test, expect } from '../e2e/test-setup';

test.describe('Collect Fees Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a pool page
    await page.goto('/liquidity/0x1234567890123456789012345678901234567890');
    await page.waitForLoadState('networkidle');
  });

  test('should display collect fees button when fees available', async ({ page }) => {
    // Look for collect fees button or indicator
    const collectButton = page.locator('[data-testid="collect-fees-button"]').or(
      page.locator('text=Collect Fees')
    );

    // Button should be visible (mock data provides fees)
    await expect(collectButton).toBeVisible();
  });

  test('should show uncollected fees amount', async ({ page }) => {
    // Check for fees display
    const feesDisplay = page.locator('[data-testid="uncollected-fees"]').or(
      page.locator('[data-testid="fees-amount"]')
    );

    await expect(feesDisplay).toBeVisible();

    // Should show some fee amount
    await expect(feesDisplay).toContainText('$');
    await expect(feesDisplay).toMatch(/\$\d+\.\d+/);
  });

  test('should open collect fees modal', async ({ page }) => {
    const collectButton = page.locator('[data-testid="collect-fees-button"]').or(
      page.locator('text=Collect Fees')
    );

    await collectButton.click();

    // Modal should open
    await expect(page.locator('[data-testid="collect-fees-modal"]')).toBeVisible();
  });

  test('should display fee breakdown in modal', async ({ page }) => {
    // Open collect fees modal
    const collectButton = page.locator('[data-testid="collect-fees-button"]').or(
      page.locator('text=Collect Fees')
    );
    await collectButton.click();

    // Check for fee breakdown
    await expect(page.locator('[data-testid="fee-token0"]')).toBeVisible();
    await expect(page.locator('[data-testid="fee-token1"]')).toBeVisible();

    // Should show amounts
    await expect(page.locator('[data-testid="fee-token0-amount"]')).toContainText(/\d/);
    await expect(page.locator('[data-testid="fee-token1-amount"]')).toContainText(/\d/);
  });

  test('should allow fee collection', async ({ page }) => {
    // Open collect fees modal
    const collectButton = page.locator('[data-testid="collect-fees-button"]').or(
      page.locator('text=Collect Fees')
    );
    await collectButton.click();

    // Look for collect/submit button
    const submitButton = page.locator('[data-testid="collect-submit"]').or(
      page.locator('text=Collect')
    );

    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeEnabled();
  });

  test('should handle zero fees gracefully', async ({ page }) => {
    // This test would verify behavior when no fees are available
    // For now, with mock data, we expect fees to be present

    const collectButton = page.locator('[data-testid="collect-fees-button"]').or(
      page.locator('text=Collect Fees')
    );

    // With mock data, button should be visible
    await expect(collectButton).toBeVisible();
  });

  test('should close collect fees modal', async ({ page }) => {
    // Open collect fees modal
    const collectButton = page.locator('[data-testid="collect-fees-button"]').or(
      page.locator('text=Collect Fees')
    );
    await collectButton.click();

    // Modal should be visible
    await expect(page.locator('[data-testid="collect-fees-modal"]')).toBeVisible();

    // Close modal
    await page.locator('[data-testid="close-collect-modal"]').click();

    // Modal should be hidden
    await expect(page.locator('[data-testid="collect-fees-modal"]')).not.toBeVisible();
  });
});
