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
 * Extended ProcessedPosition type that includes Unified Yield metadata
 */
export interface UnifiedYieldProcessedPosition extends ProcessedPosition {
  isUnifiedYield: true;
  hookAddress: string;
  /** Share balance for withdrawals (formatted string, 18 decimals) */
  shareBalance: string;
}

/**
 * Convert a UnifiedYieldPosition to ProcessedPosition format
 *
 * This enables Unified Yield positions to be rendered using existing
 * position display components without modification.
 *
 * @param uyPosition - Unified Yield position
 * @param networkMode - Network mode for pool lookup
 * @returns ProcessedPosition compatible with V4 position display (with UY metadata)
 */
export function adaptUnifiedYieldToProcessedPosition(
  uyPosition: UnifiedYieldPosition,
  networkMode: NetworkMode
): UnifiedYieldProcessedPosition {
  const poolConfig = getPoolById(uyPosition.poolId, networkMode);

  // For Unified Yield, we use full range ticks
  // TickMath.MIN_TICK and TickMath.MAX_TICK represent full range
  const tickSpacing = poolConfig?.tickSpacing ?? 1;
  const fullRangeTickLower = Math.ceil(TickMath.MIN_TICK / tickSpacing) * tickSpacing;
  const fullRangeTickUpper = Math.floor(TickMath.MAX_TICK / tickSpacing) * tickSpacing;

  // Keep the original UY position ID format for proper routing
  // Format: uy-{hookAddress}-{userAddress}
  const positionId = uyPosition.positionId;

  const now = Math.floor(Date.now() / 1000);
  const createdAt = uyPosition.createdAt ?? now;

  // Convert bigint amounts to strings for ProcessedPosition compatibility
  // token0AmountRaw and token1AmountRaw are bigints in UnifiedYieldPosition
  const token0RawString = uyPosition.token0AmountRaw.toString();
  const token1RawString = uyPosition.token1AmountRaw.toString();

  return {
    // V4 ProcessedPosition fields
    type: 'v4', // For compatibility with type guards
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
    // Unified Yield specific metadata - used by modals and other components
    isUnifiedYield: true,
    hookAddress: uyPosition.hookAddress,
    // Share balance for withdrawals (formatted string, parseable by parseUnits)
    shareBalance: uyPosition.shareBalanceFormatted,
  };
}
