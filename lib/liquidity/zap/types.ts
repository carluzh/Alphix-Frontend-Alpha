/**
 * Zap Types
 *
 * Type definitions for the Zap feature (single-token deposits into the
 * USDC/USDT Unified Yield pool).
 */

import type { Address } from 'viem';

// =============================================================================
// TOKEN TYPES
// =============================================================================

export type ZapToken = 'USDC' | 'ETH' | 'USDT';

// =============================================================================
// ROUTE TYPES
// =============================================================================

/**
 * Route details surfaced to the UI. The live zap pool only ever uses
 * Kyberswap, but we keep `type` so the UI can label it and `priceImpact`
 * so the UI can show a warning when Kyberswap reports a bad rate.
 */
export interface KyberswapRouteDetails {
  type: 'kyberswap';
  priceImpact: number;
  outputAmount: bigint;
}

export type RouteDetails = KyberswapRouteDetails;

// =============================================================================
// CALCULATION RESULT
// =============================================================================

/** Result of a zap calculation, fed into `generateZapSteps`. */
export interface ZapCalculationResult {
  swapAmount: bigint;
  swapOutputAmount: bigint;
  remainingInputAmount: bigint;
  route: RouteDetails;
  expectedShares: bigint;
}

/** Preview result returned by `useZapPreview` for UI display. */
export interface ZapPreviewResult extends ZapCalculationResult {
  formatted: {
    inputAmount: string;
    swapAmount: string;
    expectedShares: string;
  };
  inputTokenInfo: {
    symbol: ZapToken;
    decimals: number;
    address: Address;
  };
  outputTokenInfo: {
    symbol: ZapToken;
    decimals: number;
    address: Address;
  };
  /** What the minted shares are worth (from on-chain previewRemove…). */
  shareValue?: {
    amount0: bigint;
    amount1: bigint;
    formatted0: string;
    formatted1: string;
  };
  timestamp: number;
}

// =============================================================================
// APPROVAL TYPES
// =============================================================================

export interface ZapApprovalStatus {
  inputTokenApprovedForSwap: boolean;
  token0ApprovedForHook: boolean;
  token1ApprovedForHook: boolean;
  allowances: {
    inputTokenForSwap: bigint;
    token0ForHook: bigint;
    token1ForHook: bigint;
  };
  required: {
    inputTokenForSwap: bigint;
    token0ForHook: bigint;
    token1ForHook: bigint;
  };
}

// =============================================================================
// HOOK PARAMS
// =============================================================================

export interface UseZapPreviewParams {
  inputToken: ZapToken | null;
  inputAmount: string;
  hookAddress: Address;
  enabled?: boolean;
  /** Disable auto-refetch during execution. */
  refetchEnabled?: boolean;
  networkMode?: import('@/lib/network-mode').NetworkMode;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export enum ZapErrorCode {
  POOL_LIQUIDITY_LOW = 'POOL_LIQUIDITY_LOW',
  INVALID_INPUT = 'INVALID_INPUT',
}

export class ZapError extends Error {
  constructor(
    public readonly code: ZapErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ZapError';
  }
}
