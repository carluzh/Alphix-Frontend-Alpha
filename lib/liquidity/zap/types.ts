/**
 * Unified Yield Zap Types
 *
 * Type definitions for the Zap feature that enables single-token deposits
 * into the USDS/USDC Unified Yield pool.
 */

import type { Address } from 'viem';
import type { ValidatedTransactionRequest } from '../types';

// =============================================================================
// TOKEN TYPES
// =============================================================================

/**
 * Supported tokens for zap deposits
 */
export type ZapToken = 'USDS' | 'USDC';

/**
 * Token position in pool (matches Uniswap convention)
 */
export type TokenPosition = 'token0' | 'token1';

// =============================================================================
// SWAP ROUTE TYPES
// =============================================================================

/**
 * Available swap routes for zap
 */
export type ZapSwapRoute = 'psm' | 'pool';

/**
 * PSM route details (1:1 swap)
 */
export interface PSMRouteDetails {
  type: 'psm';
  /** PSM always has 0 price impact (for stablecoins) */
  priceImpact: number;
  /** Fee in basis points (typically 0 for PSM) */
  feeBps: number;
}

/**
 * Pool route details (AMM swap)
 */
export interface PoolRouteDetails {
  type: 'pool';
  /** Price impact as percentage (e.g., 0.005 = 0.005%) */
  priceImpact: number;
  /** Dynamic fee in basis points */
  feeBps: number;
  /** Current pool sqrt price */
  sqrtPriceX96: bigint;
}

/**
 * Union of route details
 */
export type RouteDetails = PSMRouteDetails | PoolRouteDetails;

// =============================================================================
// CALCULATION TYPES
// =============================================================================

/**
 * Input for zap calculation
 */
export interface ZapCalculationInput {
  /** Which token the user is depositing */
  inputToken: ZapToken;
  /** Amount of input token (in wei) */
  inputAmount: bigint;
  /** Current pool ratio (token1/token0 from preview) */
  poolRatio: number;
  /** User's slippage tolerance (percentage, e.g., 0.5 = 0.5%) */
  slippageTolerance: number;
}

/**
 * Result of zap calculation
 */
export interface ZapCalculationResult {
  /** Amount to swap (in wei of input token) */
  swapAmount: bigint;
  /** Expected output from swap (in wei of other token) */
  swapOutputAmount: bigint;
  /** Remaining input token after swap (for deposit) */
  remainingInputAmount: bigint;
  /** Selected swap route */
  route: RouteDetails;
  /** Expected shares to receive from deposit */
  expectedShares: bigint;
  /** Estimated leftover amounts (dust) */
  estimatedLeftover: {
    token0: bigint;
    token1: bigint;
  };
  /** Total value of leftover as percentage of input */
  leftoverPercent: number;
}

/**
 * Zap preview result for UI display
 */
export interface ZapPreviewResult extends ZapCalculationResult {
  /** Formatted amounts for display */
  formatted: {
    inputAmount: string;
    swapAmount: string;
    swapOutputAmount: string;
    remainingInputAmount: string;
    expectedShares: string;
    leftoverToken0: string;
    leftoverToken1: string;
  };
  /** Input token metadata */
  inputTokenInfo: {
    symbol: ZapToken;
    decimals: number;
    address: Address;
  };
  /** Output token metadata (the one we swap to) */
  outputTokenInfo: {
    symbol: ZapToken;
    decimals: number;
    address: Address;
  };
  /** Share valuation from on-chain preview (what shares are worth) */
  shareValue?: {
    /** Amount of token0 (USDS) the shares represent */
    amount0: bigint;
    /** Amount of token1 (USDC) the shares represent */
    amount1: bigint;
    /** Formatted amount0 */
    formatted0: string;
    /** Formatted amount1 */
    formatted1: string;
  };
  /** Timestamp of preview calculation */
  timestamp: number;
}

// =============================================================================
// APPROVAL TYPES
// =============================================================================

/**
 * Approval status for zap operations
 */
export interface ZapApprovalStatus {
  /** Input token approved for swap (to PSM or Permit2) */
  inputTokenApprovedForSwap: boolean;
  /** Token0 approved for Hook deposit */
  token0ApprovedForHook: boolean;
  /** Token1 approved for Hook deposit */
  token1ApprovedForHook: boolean;
  /** Current allowances */
  allowances: {
    inputTokenForSwap: bigint;
    token0ForHook: bigint;
    token1ForHook: bigint;
  };
  /** Required amounts */
  required: {
    inputTokenForSwap: bigint;
    token0ForHook: bigint;
    token1ForHook: bigint;
  };
}

// =============================================================================
// TRANSACTION STEP TYPES
// =============================================================================

/**
 * Step type enum values for zap operations
 * These extend the existing TransactionStepType enum
 */
export enum ZapTransactionStepType {
  /** Approve input token for swap (to PSM or Permit2) */
  ZapSwapApproval = 'ZapSwapApproval',
  /** Execute PSM swap (1:1) */
  ZapPSMSwap = 'ZapPSMSwap',
  /** Execute pool swap via Universal Router */
  ZapPoolSwap = 'ZapPoolSwap',
}

/**
 * Base step interface
 */
interface BaseZapStep {
  txRequest: ValidatedTransactionRequest;
}

/**
 * Swap approval step
 */
export interface ZapSwapApprovalStep extends BaseZapStep {
  type: ZapTransactionStepType.ZapSwapApproval;
  /** Token being approved */
  tokenAddress: Address;
  tokenSymbol: ZapToken;
  /** Spender (PSM address or Permit2 address) */
  spender: Address;
  /** Amount to approve */
  amount: bigint;
}

/**
 * PSM swap step
 */
export interface ZapPSMSwapStep extends BaseZapStep {
  type: ZapTransactionStepType.ZapPSMSwap;
  /** Direction of swap */
  direction: 'USDS_TO_USDC' | 'USDC_TO_USDS';
  /** Input amount (in wei) */
  inputAmount: bigint;
  /** Expected output amount (in wei) */
  expectedOutputAmount: bigint;
  /** Input token address */
  inputTokenAddress: Address;
  /** Output token address */
  outputTokenAddress: Address;
}

/**
 * Pool swap step
 */
export interface ZapPoolSwapStep extends BaseZapStep {
  type: ZapTransactionStepType.ZapPoolSwap;
  /** Input token */
  inputToken: ZapToken;
  inputTokenAddress: Address;
  /** Output token */
  outputToken: ZapToken;
  outputTokenAddress: Address;
  /** Input amount (in wei) */
  inputAmount: bigint;
  /** Minimum output amount after slippage (in wei) */
  minOutputAmount: bigint;
  /** Transaction deadline */
  deadline: bigint;
}

/**
 * Union of all zap-specific steps
 */
export type ZapStep = ZapSwapApprovalStep | ZapPSMSwapStep | ZapPoolSwapStep;

// =============================================================================
// HOOK TYPES
// =============================================================================

/**
 * Parameters for useZapDeposit hook
 */
export interface UseZapDepositParams {
  /** Pool ID */
  poolId: string;
  /** Hook contract address */
  hookAddress: Address;
  /** Token0 address (USDS) */
  token0Address: Address;
  /** Token1 address (USDC) */
  token1Address: Address;
}

/**
 * Return type for useZapDeposit hook
 */
export interface UseZapDepositReturn {
  /** Get preview for zap deposit */
  getPreview: (inputToken: ZapToken, inputAmount: string) => Promise<ZapPreviewResult | null>;
  /** Execute zap deposit */
  executeZap: (preview: ZapPreviewResult) => Promise<void>;
  /** Current preview result */
  preview: ZapPreviewResult | null;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Transaction hash (after execution) */
  txHash: string | null;
  /** Reset state */
  reset: () => void;
}

/**
 * Parameters for useZapPreview hook
 */
export interface UseZapPreviewParams {
  /** Which token user is depositing */
  inputToken: ZapToken | null;
  /** Amount as string (user input) */
  inputAmount: string;
  /** Hook contract address */
  hookAddress: Address;
  /** Whether to enable the query */
  enabled?: boolean;
  /** Whether to enable auto-refetch (disable during execution) */
  refetchEnabled?: boolean;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * Zap-specific error codes
 */
export enum ZapErrorCode {
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  SLIPPAGE_EXCEEDED = 'SLIPPAGE_EXCEEDED',
  PRICE_IMPACT_TOO_HIGH = 'PRICE_IMPACT_TOO_HIGH',
  PSM_UNAVAILABLE = 'PSM_UNAVAILABLE',
  POOL_LIQUIDITY_LOW = 'POOL_LIQUIDITY_LOW',
  APPROVAL_FAILED = 'APPROVAL_FAILED',
  SWAP_FAILED = 'SWAP_FAILED',
  DEPOSIT_FAILED = 'DEPOSIT_FAILED',
  USER_REJECTED = 'USER_REJECTED',
  STALE_PREVIEW = 'STALE_PREVIEW',
  INVALID_INPUT = 'INVALID_INPUT',
}

/**
 * Zap error with code and details
 */
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
