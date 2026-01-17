/**
 * Unified Yield Deposit Transaction Builder
 *
 * Builds the transaction calldata for depositing into a Unified Yield Hook.
 * The Hook IS the ERC-4626 vault - users receive Hook shares directly.
 *
 * Unlike V4 positions which use V4PositionManager.mint(), Unified Yield deposits
 * go directly to the Hook contract which handles:
 * 1. Receiving user funds (wraps ETH internally if native)
 * 2. Minting shares to user (Hook IS ERC-4626)
 * 3. Depositing into underlying token vaults
 * 4. Managing Aave positions for rehypothecation yield
 *
 * Features:
 * - Both tokens deposited together
 * - Native ETH wrapped by Hook (send as msg.value)
 * - No slippage protection at contract level
 */

import { encodeFunctionData } from 'viem';
import type {
  UnifiedYieldDepositParams,
  UnifiedYieldDepositTxResult,
} from './types';
import { NATIVE_TOKEN_ADDRESS } from '@/lib/pools-config';
import { UNIFIED_YIELD_HOOK_ABI } from './abi/unifiedYieldHookABI';

/**
 * Build a Unified Yield deposit transaction
 *
 * Deposits both tokens into the Hook and receives shares in return.
 * For native ETH, send ETH as msg.value - Hook wraps internally.
 *
 * @param params - Deposit parameters
 * @returns Transaction data ready for execution
 */
export async function buildUnifiedYieldDepositTx(
  params: UnifiedYieldDepositParams
): Promise<UnifiedYieldDepositTxResult> {
  const {
    hookAddress,
    token0Address,
    token1Address,
    amount0Wei,
    amount1Wei,
    userAddress,
  } = params;

  // Calculate ETH value if either token is native
  // Hook wraps ETH internally - send native ETH as msg.value
  const isToken0Native = token0Address === NATIVE_TOKEN_ADDRESS;
  const isToken1Native = token1Address === NATIVE_TOKEN_ADDRESS;
  const value = (isToken0Native ? amount0Wei : 0n) + (isToken1Native ? amount1Wei : 0n);

  // Build calldata for Hook.deposit(token0, token1, amount0, amount1, recipient)
  const calldata = encodeFunctionData({
    abi: UNIFIED_YIELD_HOOK_ABI,
    functionName: 'deposit',
    args: [
      token0Address,
      token1Address,
      amount0Wei,
      amount1Wei,
      userAddress,
    ],
  });

  return {
    calldata,
    value,
    to: hookAddress,
    // Gas limit will be estimated by the wallet
    gasLimit: undefined,
  };
}

/**
 * Estimate gas for a Unified Yield deposit
 *
 * @param params - Deposit parameters
 * @param client - Viem public client
 * @returns Estimated gas limit
 */
export async function estimateUnifiedYieldDepositGas(
  params: UnifiedYieldDepositParams,
  client: any // PublicClient
): Promise<bigint> {
  const txData = await buildUnifiedYieldDepositTx(params);

  try {
    const gasEstimate = await client.estimateGas({
      to: txData.to,
      data: txData.calldata,
      value: txData.value,
      account: params.userAddress,
    });

    // Add 20% buffer for safety
    return (gasEstimate * 120n) / 100n;
  } catch (error) {
    // Return a reasonable default if estimation fails
    console.warn('Gas estimation failed for Unified Yield deposit:', error);
    return 300_000n;
  }
}

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
