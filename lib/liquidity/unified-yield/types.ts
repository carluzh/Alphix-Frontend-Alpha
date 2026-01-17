/**
 * Unified Yield Types
 *
 * Types for the Unified Yield liquidity provision mechanism.
 * Unified Yield differs from standard V4 positions:
 * - Deposits go through a Hook contract (not PositionManager)
 * - Hook IS the ERC-4626 vault - users receive Hook shares directly
 * - Earns yield from swap fees + Aave lending (rehypothecation)
 *
 * Architecture:
 * - One Hook per pool (ETH/USDC has its own Hook, USDC/USDT has its own)
 * - Hook mints shares to users (ERC-4626 compliant)
 * - Hook internally deposits into shared underlying vaults per token
 * - Native ETH is wrapped by Hook internally
 * - No slippage protection at contract level
 * - Partial withdrawals supported
 */

import type { Address } from 'viem';

/**
 * Unified Yield position representation
 *
 * The Hook IS the ERC-4626 vault - hookAddress is the share token.
 * Designed to be compatible with ProcessedPosition for display via adapter.
 */
export interface UnifiedYieldPosition {
  /** Position identifier: `uy-${hookAddress}-${userAddress}` */
  id: string;

  /** Hook contract address - this IS the ERC-4626 vault */
  hookAddress: Address;

  /** User's share balance (Hook shares) */
  shareBalance: bigint;

  /** Formatted share balance for display */
  shareBalanceFormatted: string;

  /** Underlying token0 amount (via Hook.previewRedeem) - formatted */
  token0Amount: string;

  /** Underlying token1 amount (via Hook.previewRedeem) - formatted */
  token1Amount: string;

  /** Raw token0 amount in wei (bigint for precision) */
  token0AmountRaw: bigint;

  /** Raw token1 amount in wei (bigint for precision) */
  token1AmountRaw: bigint;

  /** Pool identifier */
  poolId: string;

  /** Token0 symbol */
  token0Symbol: string;

  /** Token1 symbol */
  token1Symbol: string;

  /** Token0 address */
  token0Address: Address;

  /** Token1 address */
  token1Address: Address;

  /** Token0 decimals */
  token0Decimals: number;

  /** Token1 decimals */
  token1Decimals: number;

  /** Share token decimals (typically 18) */
  shareDecimals: number;

  /** Discriminator - always true for Unified Yield positions */
  isUnifiedYield: true;

  /** Unified Yield always uses managed/full range */
  isFullRange: true;

  /** Status - always IN_RANGE for Unified Yield (managed position) */
  status: 'IN_RANGE';

  /** Creation timestamp (if available) */
  createdAt?: number;

  /** USD value of the position (optional, calculated client-side) */
  valueUSD?: number;
}

/**
 * @deprecated Use UnifiedYieldPosition.hookAddress instead
 * The Hook IS the vault - there's no separate vault address
 */
export type UnifiedYieldPositionLegacy = UnifiedYieldPosition & {
  vaultAddress: Address;
};

/**
 * Parameters for building a Unified Yield deposit transaction
 */
export interface UnifiedYieldDepositParams {
  /** Pool identifier */
  poolId: string;

  /** Hook contract address */
  hookAddress: Address;

  /** Token0 address */
  token0Address: Address;

  /** Token1 address */
  token1Address: Address;

  /** Amount of token0 to deposit (in wei) */
  amount0Wei: bigint;

  /** Amount of token1 to deposit (in wei) */
  amount1Wei: bigint;

  /** User's wallet address */
  userAddress: Address;

  /** Chain ID */
  chainId: number;

  /** Slippage tolerance in basis points */
  slippageBps?: number;
}

/**
 * Result of building a Unified Yield deposit transaction
 */
export interface UnifiedYieldDepositTxResult {
  /** Transaction calldata */
  calldata: `0x${string}`;

  /** ETH value to send (for native token deposits) */
  value: bigint;

  /** Target contract address (Hook) */
  to: Address;

  /** Estimated gas limit */
  gasLimit?: bigint;
}

/**
 * Approval status for Unified Yield deposits
 * Simpler than V4 - no Permit2 involved
 */
export interface UnifiedYieldApprovalStatus {
  /** Whether token0 needs ERC20 approval to Hook */
  token0NeedsApproval: boolean;

  /** Whether token1 needs ERC20 approval to Hook */
  token1NeedsApproval: boolean;

  /** Current token0 allowance to Hook */
  token0Allowance: bigint;

  /** Current token1 allowance to Hook */
  token1Allowance: bigint;

  /** Required token0 amount */
  token0Required: bigint;

  /** Required token1 amount */
  token1Required: bigint;
}

/**
 * Parameters for checking Unified Yield approvals
 */
export interface UnifiedYieldApprovalParams {
  /** User's wallet address */
  userAddress: Address;

  /** Token0 address */
  token0Address: Address;

  /** Token1 address */
  token1Address: Address;

  /** Amount of token0 needed (in wei) */
  amount0Wei: bigint;

  /** Amount of token1 needed (in wei) */
  amount1Wei: bigint;

  /** Hook contract address (approval target) */
  hookAddress: Address;

  /** Chain ID */
  chainId: number;
}

/**
 * Vault information for a Unified Yield pool
 */
export interface UnifiedYieldVaultInfo {
  /** Vault contract address */
  vaultAddress: Address;

  /** Hook contract address */
  hookAddress: Address;

  /** Pool identifier */
  poolId: string;

  /** Total shares in the vault */
  totalShares: bigint;

  /** Total assets in the vault */
  totalAssets: bigint;

  /** Current share price (assets per share) */
  sharePrice: bigint;
}

/**
 * Type guard to check if a position is a Unified Yield position
 */
export function isUnifiedYieldPosition(
  position: unknown
): position is UnifiedYieldPosition {
  return (
    typeof position === 'object' &&
    position !== null &&
    'isUnifiedYield' in position &&
    (position as UnifiedYieldPosition).isUnifiedYield === true
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WITHDRAW TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parameters for building a Unified Yield withdraw transaction
 *
 * Supports partial withdrawals - user can withdraw any number of shares
 */
export interface UnifiedYieldWithdrawParams {
  /** Pool identifier */
  poolId: string;

  /** Hook contract address */
  hookAddress: Address;

  /** Number of shares to burn */
  shares: bigint;

  /** User's wallet address (recipient of tokens) */
  userAddress: Address;

  /** Chain ID */
  chainId: number;

  /**
   * Slippage tolerance in basis points
   * Note: Current Hook doesn't support slippage at contract level,
   * but this can be used for UI warnings
   */
  slippageBps?: number;
}

/**
 * Result of building a Unified Yield withdraw transaction
 */
export interface UnifiedYieldWithdrawTxResult {
  /** Transaction calldata */
  calldata: `0x${string}`;

  /** ETH value to send (always 0 for withdrawals) */
  value: bigint;

  /** Target contract address (Hook) */
  to: Address;

  /** Estimated gas limit */
  gasLimit?: bigint;
}

/**
 * Preview of withdraw amounts
 * Returned by Hook.previewRedeem()
 */
export interface UnifiedYieldWithdrawPreview {
  /** Shares to be burned */
  shares: bigint;

  /** Amount of token0 to receive */
  amount0: bigint;

  /** Amount of token1 to receive */
  amount1: bigint;

  /** Formatted amount0 */
  amount0Formatted: string;

  /** Formatted amount1 */
  amount1Formatted: string;
}

/**
 * Withdrawal percentage options for UI
 */
export type WithdrawPercentage = 25 | 50 | 75 | 100;

/**
 * Calculate shares for a given withdrawal percentage
 */
export function calculateWithdrawShares(
  totalShares: bigint,
  percentage: WithdrawPercentage
): bigint {
  if (percentage === 100) return totalShares;
  return (totalShares * BigInt(percentage)) / 100n;
}
