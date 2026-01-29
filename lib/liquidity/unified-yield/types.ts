/**
 * Unified Yield Types
 *
 * Types for the Unified Yield (ReHypothecation) liquidity provision mechanism.
 * Unified Yield differs from standard V4 positions:
 * - Deposits go through a Hook contract (not PositionManager)
 * - Hook IS the ERC20 share token - users receive Hook shares directly
 * - Earns yield from swap fees + Aave lending (rehypothecation)
 *
 * Architecture:
 * - One Hook per pool (ETH/USDC has its own Hook, USDC/USDT has its own)
 * - Hook mints shares to users (extends IERC20)
 * - Liquidity is deposited into a managed tick range (rehypo range)
 * - Underlying assets are rehypothecated into yield sources (e.g., Aave)
 * - Native ETH is wrapped by Hook internally (send as msg.value)
 * - Partial withdrawals supported (any share amount)
 *
 * Deposit Flow:
 * 1. User enters amount0 or amount1
 * 2. Call previewAddFromAmount0(amount0) → (amount1, shares)
 * 3. Approve both tokens to Hook
 * 4. Call addReHypothecatedLiquidity(shares) with msg.value if native ETH
 *
 * Withdraw Flow:
 * 1. User has shares from balanceOf(user)
 * 2. Call previewRemoveReHypothecatedLiquidity(shares) → (amount0, amount1)
 * 3. Call removeReHypothecatedLiquidity(shares)
 */

import type { Address } from 'viem';

/**
 * Unified Yield position representation
 *
 * The Hook IS the ERC-4626 vault - hookAddress is the share token.
 * Designed to be compatible with ProcessedPosition for display via adapter.
 */
export interface UnifiedYieldPosition {
  /** Type discriminator for union type */
  type: 'unified-yield';

  /** Position identifier: `uy-${hookAddress}-${userAddress}` */
  id: string;

  /**
   * Alias for `id` to maintain compatibility with V4ProcessedPosition interface.
   * Both V4 and UY positions can be identified via `position.positionId`.
   */
  positionId: string;

  /** Hook contract address - this IS the ERC-4626 vault */
  hookAddress: Address;

  /** User's wallet address (owner of this position) */
  userAddress: Address;

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
 * Parameters for building a Unified Yield deposit transaction
 *
 * The new contract uses a share-centric flow:
 * - User specifies one token amount
 * - Preview function returns the other amount + shares
 * - Transaction is called with shares to mint
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

  /**
   * Amount of token0 to deposit (in wei)
   * Used for preview calculation and approval
   */
  amount0Wei: bigint;

  /**
   * Amount of token1 to deposit (in wei)
   * Used for preview calculation and approval
   */
  amount1Wei: bigint;

  /**
   * Number of shares to mint
   * This is the actual parameter passed to addReHypothecatedLiquidity()
   * Obtained from previewAddFromAmount0/1
   */
  sharesToMint: bigint;

  /** User's wallet address */
  userAddress: Address;

  /** Chain ID */
  chainId: number;

  /**
   * Expected sqrt price for slippage protection
   * Pass 0n to skip slippage check at contract level
   * Obtained from pool state (sqrtPriceX96)
   */
  expectedSqrtPriceX96?: bigint;

  /**
   * Max price slippage tolerance
   * Same scale as LP fee: 1000000 = 100%, 10000 = 1%
   * Pass 0 to skip slippage check at contract level
   */
  maxPriceSlippage?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// PREVIEW TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result of previewAddFromAmount0 or previewAddFromAmount1
 *
 * Used to calculate the deposit amounts and shares before executing
 */
export interface PreviewAddResult {
  /** The amount of the OTHER token required (amount1 if input was amount0, vice versa) */
  otherAmount: bigint;

  /** The number of shares that will be minted */
  shares: bigint;
}

/**
 * Full preview result with both amounts for display
 */
export interface DepositPreviewResult {
  /** Amount of token0 required */
  amount0: bigint;

  /** Amount of token1 required */
  amount1: bigint;

  /** Shares that will be minted */
  shares: bigint;

  /** Formatted amount0 for display */
  amount0Formatted: string;

  /** Formatted amount1 for display */
  amount1Formatted: string;

  /** Formatted shares for display */
  sharesFormatted: string;

  /** Which token the user originally entered */
  inputSide: 'token0' | 'token1';
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
 * Type guard to check if a position is a Unified Yield position
 */
export function isUnifiedYieldPosition(
  position: unknown
): position is UnifiedYieldPosition {
  return (
    typeof position === 'object' &&
    position !== null &&
    'type' in position &&
    (position as UnifiedYieldPosition).type === 'unified-yield'
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
   * Expected sqrt price for slippage protection
   * Pass 0n to skip slippage check at contract level
   * Obtained from pool state (sqrtPriceX96)
   */
  expectedSqrtPriceX96?: bigint;

  /**
   * Max price slippage tolerance
   * Same scale as LP fee: 1000000 = 100%, 10000 = 1%
   * Pass 0 to skip slippage check at contract level
   */
  maxPriceSlippage?: number;
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

// ═══════════════════════════════════════════════════════════════════════════
// POSITION ID UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parsed Unified Yield position ID components
 */
export interface ParsedUnifiedYieldPositionId {
  hookAddress: Address;
  userAddress: Address;
}

/**
 * Parse Unified Yield position ID format: uy-{hookAddress}-{userAddress}
 *
 * @param positionId - The position ID string (e.g., "uy-0x123...abc-0x456...def")
 * @returns Parsed addresses or null if not a valid Unified Yield position ID
 *
 * @example
 * ```tsx
 * const parsed = parseUnifiedYieldPositionId("uy-0xabc...123-0xdef...456");
 * if (parsed) {
 *   console.log(parsed.hookAddress); // "0xabc...123"
 *   console.log(parsed.userAddress); // "0xdef...456"
 * }
 * ```
 */
export function parseUnifiedYieldPositionId(
  positionId: string
): ParsedUnifiedYieldPositionId | null {
  if (!positionId || !positionId.startsWith('uy-')) return null;

  const parts = positionId.split('-');
  if (parts.length !== 3) return null;

  const hookAddress = parts[1];
  const userAddress = parts[2];

  // Validate addresses (basic check for 0x prefix and length)
  if (!hookAddress.startsWith('0x') || hookAddress.length !== 42) return null;
  if (!userAddress.startsWith('0x') || userAddress.length !== 42) return null;

  return {
    hookAddress: hookAddress as Address,
    userAddress: userAddress as Address,
  };
}

/**
 * Check if a position ID is a Unified Yield position ID
 *
 * @param positionId - The position ID to check
 * @returns true if the ID follows the uy-{hookAddress}-{userAddress} format
 */
export function isUnifiedYieldPositionId(positionId: string): boolean {
  return parseUnifiedYieldPositionId(positionId) !== null;
}

/**
 * Create a Unified Yield position ID from addresses
 *
 * @param hookAddress - The hook contract address
 * @param userAddress - The user's wallet address
 * @returns Position ID in format "uy-{hookAddress}-{userAddress}"
 */
export function createUnifiedYieldPositionId(
  hookAddress: Address,
  userAddress: Address
): string {
  return `uy-${hookAddress}-${userAddress}`;
}
