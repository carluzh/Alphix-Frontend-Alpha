/**
 * Unified Yield Deposit Transaction Builder
 *
 * Builds the transaction calldata for depositing into a Unified Yield Hook.
 * The Hook IS the ERC20 share token - users receive Hook shares directly.
 *
 * KEY CHANGE: The contract now uses a share-centric flow:
 * 1. User specifies one token amount (e.g., 1 ETH)
 * 2. Call previewAddFromAmount0(amount0) → (required_amount1, shares_to_mint)
 * 3. Approve both tokens to Hook
 * 4. Call addReHypothecatedLiquidity(shares) with msg.value if native ETH
 *
 * The contract function:
 *   addReHypothecatedLiquidity(uint256 shares) external payable returns (BalanceDelta)
 *
 * Features:
 * - Native ETH sent as msg.value, Hook wraps internally
 * - Both tokens deposited together (proportionally based on current pool state)
 * - No slippage protection at contract level
 */

import { encodeFunctionData, type PublicClient, type Address, formatUnits } from 'viem';
import type {
  UnifiedYieldDepositParams,
  UnifiedYieldDepositTxResult,
  PreviewAddResult,
  DepositPreviewResult,
} from './types';
import { NATIVE_TOKEN_ADDRESS } from '@/lib/pools-config';
import { UNIFIED_YIELD_HOOK_ABI } from './abi/unifiedYieldHookABI';

/**
 * Build a Unified Yield deposit transaction
 *
 * Calls addReHypothecatedLiquidity(shares) on the Hook contract.
 * Native ETH should be sent as msg.value.
 *
 * @param params - Deposit parameters (must include sharesToMint from preview)
 * @returns Transaction data ready for execution
 */
export function buildUnifiedYieldDepositTx(
  params: UnifiedYieldDepositParams
): UnifiedYieldDepositTxResult {
  const {
    hookAddress,
    token0Address,
    token1Address,
    amount0Wei,
    amount1Wei,
    sharesToMint,
  } = params;

  // Calculate ETH value if either token is native
  // Hook wraps ETH internally - send native ETH as msg.value
  const isToken0Native = token0Address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
  const isToken1Native = token1Address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
  const value = (isToken0Native ? amount0Wei : 0n) + (isToken1Native ? amount1Wei : 0n);

  // Build calldata for Hook.addReHypothecatedLiquidity(shares)
  const calldata = encodeFunctionData({
    abi: UNIFIED_YIELD_HOOK_ABI,
    functionName: 'addReHypothecatedLiquidity',
    args: [sharesToMint],
  });

  return {
    calldata,
    value,
    to: hookAddress,
    gasLimit: undefined, // Let wallet estimate
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PREVIEW FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Preview deposit by specifying amount0
 *
 * Call this when user enters the token0 amount.
 * Returns the required token1 amount and shares that will be minted.
 *
 * @param hookAddress - Hook contract address
 * @param amount0 - Amount of token0 user wants to deposit (in wei)
 * @param client - Viem public client
 * @returns Preview result with amount1 and shares, or null on error
 */
export async function previewAddFromAmount0(
  hookAddress: Address,
  amount0: bigint,
  client: PublicClient
): Promise<PreviewAddResult | null> {
  try {
    const result = await client.readContract({
      address: hookAddress,
      abi: UNIFIED_YIELD_HOOK_ABI,
      functionName: 'previewAddFromAmount0',
      args: [amount0],
    });

    const [amount1, shares] = result as [bigint, bigint];
    return {
      otherAmount: amount1,
      shares,
    };
  } catch (error) {
    console.warn(`Failed to preview add from amount0 for hook ${hookAddress}:`, error);
    return null;
  }
}

/**
 * Preview deposit by specifying amount1
 *
 * Call this when user enters the token1 amount.
 * Returns the required token0 amount and shares that will be minted.
 *
 * @param hookAddress - Hook contract address
 * @param amount1 - Amount of token1 user wants to deposit (in wei)
 * @param client - Viem public client
 * @returns Preview result with amount0 and shares, or null on error
 */
export async function previewAddFromAmount1(
  hookAddress: Address,
  amount1: bigint,
  client: PublicClient
): Promise<PreviewAddResult | null> {
  try {
    const result = await client.readContract({
      address: hookAddress,
      abi: UNIFIED_YIELD_HOOK_ABI,
      functionName: 'previewAddFromAmount1',
      args: [amount1],
    });

    const [amount0, shares] = result as [bigint, bigint];
    return {
      otherAmount: amount0,
      shares,
    };
  } catch (error) {
    console.warn(`Failed to preview add from amount1 for hook ${hookAddress}:`, error);
    return null;
  }
}

/**
 * Preview deposit and get full formatted result
 *
 * Convenience function that handles both input sides and formats the result.
 *
 * @param hookAddress - Hook contract address
 * @param inputAmount - Amount user entered (in wei)
 * @param inputSide - Which token the user entered ('token0' or 'token1')
 * @param token0Decimals - Decimals for token0
 * @param token1Decimals - Decimals for token1
 * @param shareDecimals - Decimals for shares (typically 18)
 * @param client - Viem public client
 * @returns Full preview result with all amounts and formatted strings
 */
export async function previewDeposit(
  hookAddress: Address,
  inputAmount: bigint,
  inputSide: 'token0' | 'token1',
  token0Decimals: number,
  token1Decimals: number,
  shareDecimals: number,
  client: PublicClient
): Promise<DepositPreviewResult | null> {
  let amount0: bigint;
  let amount1: bigint;
  let shares: bigint;

  if (inputSide === 'token0') {
    const preview = await previewAddFromAmount0(hookAddress, inputAmount, client);
    if (!preview) return null;

    amount0 = inputAmount;
    amount1 = preview.otherAmount;
    shares = preview.shares;
  } else {
    const preview = await previewAddFromAmount1(hookAddress, inputAmount, client);
    if (!preview) return null;

    amount0 = preview.otherAmount;
    amount1 = inputAmount;
    shares = preview.shares;
  }

  return {
    amount0,
    amount1,
    shares,
    amount0Formatted: formatUnits(amount0, token0Decimals),
    amount1Formatted: formatUnits(amount1, token1Decimals),
    sharesFormatted: formatUnits(shares, shareDecimals),
    inputSide,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate Unified Yield deposit parameters
 *
 * @param params - Deposit parameters to validate
 * @returns Validation result with any error messages
 */
export function validateUnifiedYieldDepositParams(
  params: Partial<UnifiedYieldDepositParams>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!params.hookAddress) {
    errors.push('Hook address is required');
  }

  if (!params.userAddress) {
    errors.push('User address is required');
  }

  if (!params.token0Address || !params.token1Address) {
    errors.push('Token addresses are required');
  }

  if (params.sharesToMint === undefined || params.sharesToMint <= 0n) {
    errors.push('Shares to mint must be greater than zero (run preview first)');
  }

  if (
    (params.amount0Wei === undefined || params.amount0Wei <= 0n) &&
    (params.amount1Wei === undefined || params.amount1Wei <= 0n)
  ) {
    errors.push('At least one token amount must be greater than zero');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Build deposit params from preview result
 *
 * Helper to construct full deposit params after running a preview.
 *
 * @param preview - Result from previewDeposit
 * @param hookAddress - Hook contract address
 * @param token0Address - Token0 address
 * @param token1Address - Token1 address
 * @param userAddress - User's wallet address
 * @param poolId - Pool identifier
 * @param chainId - Chain ID
 * @returns Complete deposit params ready for buildUnifiedYieldDepositTx
 */
export function buildDepositParamsFromPreview(
  preview: DepositPreviewResult,
  hookAddress: Address,
  token0Address: Address,
  token1Address: Address,
  userAddress: Address,
  poolId: string,
  chainId: number
): UnifiedYieldDepositParams {
  return {
    poolId,
    hookAddress,
    token0Address,
    token1Address,
    amount0Wei: preview.amount0,
    amount1Wei: preview.amount1,
    sharesToMint: preview.shares,
    userAddress,
    chainId,
  };
}
