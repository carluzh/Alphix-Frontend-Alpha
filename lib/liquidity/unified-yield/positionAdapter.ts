/**
 * Unified Yield Position Adapter
 *
 * Converts UnifiedYieldPosition to ProcessedPosition format for display compatibility.
 * This allows Unified Yield positions to be displayed using the same components
 * as V4 positions (PositionCardCompact, etc.)
 *
 * Key differences from V4:
 * - Hook IS the ERC-4626 vault (no separate vault address)
 * - Position amounts are bigints (from Hook.previewRedeem)
 * - Always full range (managed position)
 * - Always in range
 */

import type { UnifiedYieldPosition } from './types';
import type { ProcessedPosition } from '@/pages/api/liquidity/get-positions';
import { getPoolById, type NetworkMode } from '@/lib/pools-config';
import { TickMath } from '@uniswap/v3-sdk';

/**
 * Convert a UnifiedYieldPosition to ProcessedPosition format
 *
 * This enables Unified Yield positions to be rendered using existing
 * position display components without modification.
 *
 * @param uyPosition - Unified Yield position
 * @param networkMode - Network mode for pool lookup
 * @returns ProcessedPosition compatible with V4 position display
 */
export function adaptUnifiedYieldToProcessedPosition(
  uyPosition: UnifiedYieldPosition,
  networkMode: NetworkMode
): ProcessedPosition {
  const poolConfig = getPoolById(uyPosition.poolId, networkMode);

  // For Unified Yield, we use full range ticks
  // TickMath.MIN_TICK and TickMath.MAX_TICK represent full range
  const tickSpacing = poolConfig?.tickSpacing ?? 1;
  const fullRangeTickLower = Math.ceil(TickMath.MIN_TICK / tickSpacing) * tickSpacing;
  const fullRangeTickUpper = Math.floor(TickMath.MAX_TICK / tickSpacing) * tickSpacing;

  // Generate a deterministic position ID from the Unified Yield position
  // Use the hook + user address hash to create a unique ID
  const positionId = generatePositionId(uyPosition.id);

  const now = Math.floor(Date.now() / 1000);
  const createdAt = uyPosition.createdAt ?? now;

  // Convert bigint amounts to strings for ProcessedPosition compatibility
  // token0AmountRaw and token1AmountRaw are bigints in UnifiedYieldPosition
  const token0RawString = uyPosition.token0AmountRaw.toString();
  const token1RawString = uyPosition.token1AmountRaw.toString();

  return {
    positionId,
    owner: '', // Not applicable for Unified Yield (shares are fungible)
    poolId: uyPosition.poolId,
    token0: {
      address: uyPosition.token0Address,
      symbol: uyPosition.token0Symbol,
      amount: uyPosition.token0Amount, // Already formatted string
      rawAmount: token0RawString,
    },
    token1: {
      address: uyPosition.token1Address,
      symbol: uyPosition.token1Symbol,
      amount: uyPosition.token1Amount, // Already formatted string
      rawAmount: token1RawString,
    },
    // Full range for Unified Yield
    tickLower: fullRangeTickLower,
    tickUpper: fullRangeTickUpper,
    // Liquidity represented by share balance
    liquidityRaw: uyPosition.shareBalance.toString(),
    // Timestamps
    ageSeconds: Math.max(0, now - createdAt),
    blockTimestamp: createdAt,
    lastTimestamp: now, // Unified Yield is always "fresh"
    // Always in range (managed position)
    isInRange: true,
    // Fees are auto-compounded into share value for Unified Yield
    // No separate uncollected fees
    token0UncollectedFees: '0',
    token1UncollectedFees: '0',
  };
}

/**
 * Convert multiple Unified Yield positions to ProcessedPosition format
 *
 * @param uyPositions - Array of Unified Yield positions
 * @param networkMode - Network mode
 * @returns Array of ProcessedPositions
 */
export function adaptAllUnifiedYieldPositions(
  uyPositions: UnifiedYieldPosition[],
  networkMode: NetworkMode
): ProcessedPosition[] {
  return uyPositions.map((pos) =>
    adaptUnifiedYieldToProcessedPosition(pos, networkMode)
  );
}

/**
 * Generate a deterministic position ID from Unified Yield position ID
 *
 * The ID format is: uy-{vaultAddress}-{userAddress}
 * We convert this to a numeric string for compatibility with V4 position IDs
 *
 * @param uyPositionId - Unified Yield position ID
 * @returns Numeric position ID string
 */
function generatePositionId(uyPositionId: string): string {
  // Simple hash function to convert string to number
  let hash = 0;
  for (let i = 0; i < uyPositionId.length; i++) {
    const char = uyPositionId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Make it positive and add a prefix to distinguish from V4 positions
  // Using a high number range to avoid collision with V4 tokenIds
  const positiveHash = Math.abs(hash);
  return `999${positiveHash}`;
}

/**
 * Check if a ProcessedPosition was adapted from a Unified Yield position
 *
 * Uses the position ID prefix to detect Unified Yield positions
 *
 * @param position - ProcessedPosition to check
 * @returns True if this is an adapted Unified Yield position
 */
export function isAdaptedUnifiedYieldPosition(position: ProcessedPosition): boolean {
  // Unified Yield positions have IDs starting with '999'
  return position.positionId.startsWith('999');
}

/**
 * Merge V4 positions with Unified Yield positions
 *
 * Combines both position types into a single array for display.
 * Unified Yield positions are adapted to ProcessedPosition format.
 *
 * @param v4Positions - Standard V4 positions
 * @param uyPositions - Unified Yield positions
 * @param networkMode - Network mode
 * @returns Combined array of ProcessedPositions
 */
export function mergePositions(
  v4Positions: ProcessedPosition[],
  uyPositions: UnifiedYieldPosition[],
  networkMode: NetworkMode
): ProcessedPosition[] {
  const adaptedUyPositions = adaptAllUnifiedYieldPositions(uyPositions, networkMode);

  // Sort by timestamp (newest first)
  const allPositions = [...v4Positions, ...adaptedUyPositions];
  allPositions.sort((a, b) => b.blockTimestamp - a.blockTimestamp);

  return allPositions;
}

/**
 * Create a ProcessedPosition marker for Unified Yield positions
 *
 * This adds metadata that can be used by display components to
 * show Unified Yield-specific UI elements (like "Managed Range" badge)
 *
 * @param position - Base ProcessedPosition
 * @returns ProcessedPosition with Unified Yield markers
 */
export function markAsUnifiedYield(
  position: ProcessedPosition
): ProcessedPosition & { _isUnifiedYield: true } {
  return {
    ...position,
    _isUnifiedYield: true as const,
  };
}
