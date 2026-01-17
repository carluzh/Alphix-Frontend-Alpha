/**
 * Unified Yield Deposit Execution Hook
 *
 * Handles the full deposit flow for Unified Yield positions:
 * 1. Check/request ERC20 approvals to Hook
 * 2. Execute deposit transaction
 * 3. Track transaction status
 *
 * Unlike V4 deposits which use Permit2, Unified Yield uses direct ERC20 approvals.
 */

import { useCallback, useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import type { Address, Hash } from 'viem';
import { parseUnits } from 'viem';

import { UNIFIED_YIELD_HOOK_ABI } from '../abi/unifiedYieldHookABI';
import { buildUnifiedYieldDepositTx, validateUnifiedYieldDepositParams } from '../buildUnifiedYieldDepositTx';
import type { UnifiedYieldDepositParams } from '../types';
import { NATIVE_TOKEN_ADDRESS } from '@/lib/pools-config';

export interface UseUnifiedYieldDepositParams {
  /** Hook contract address */
  hookAddress?: Address;
  /** Token0 address */
  token0Address?: Address;
  /** Token1 address */
  token1Address?: Address;
  /** Pool ID */
  poolId?: string;
  /** Chain ID */
  chainId?: number;
}

export interface UseUnifiedYieldDepositResult {
  /** Execute the deposit */
  deposit: (amount0: string, amount1: string, decimals0: number, decimals1: number) => Promise<Hash | undefined>;

  /** Current transaction hash (if any) */
  txHash: Hash | undefined;

  /** Whether deposit is pending */
  isPending: boolean;

  /** Whether deposit was successful */
  isSuccess: boolean;

  /** Whether deposit failed */
  isError: boolean;

  /** Error message if failed */
  error: Error | null;

  /** Reset the hook state */
  reset: () => void;

  /** Transaction receipt (if available) */
  receipt: any;

  /** Whether waiting for confirmation */
  isConfirming: boolean;
}

/**
 * Hook for executing Unified Yield deposits
 *
 * @param params - Deposit configuration
 * @returns Deposit execution controls and state
 *
 * @example
 * ```tsx
 * const { deposit, isPending, isSuccess } = useUnifiedYieldDeposit({
 *   hookAddress: '0x...',
 *   token0Address: '0x...',
 *   token1Address: '0x...',
 *   poolId: 'eth-usdc',
 *   chainId: 8453,
 * });
 *
 * // Execute deposit
 * await deposit('1.0', '1000', 18, 6); // 1 ETH + 1000 USDC
 * ```
 */
export function useUnifiedYieldDeposit(
  params?: UseUnifiedYieldDepositParams
): UseUnifiedYieldDepositResult {
  const { address: userAddress } = useAccount();
  const [error, setError] = useState<Error | null>(null);

  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    isSuccess: isWriteSuccess,
    isError: isWriteError,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess: isConfirmed,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const deposit = useCallback(
    async (
      amount0: string,
      amount1: string,
      decimals0: number,
      decimals1: number
    ): Promise<Hash | undefined> => {
      setError(null);

      if (!params?.hookAddress || !params?.token0Address || !params?.token1Address) {
        const err = new Error('Missing required deposit parameters');
        setError(err);
        return undefined;
      }

      if (!userAddress) {
        const err = new Error('Wallet not connected');
        setError(err);
        return undefined;
      }

      try {
        // Parse amounts to wei
        const amount0Wei = parseUnits(amount0 || '0', decimals0);
        const amount1Wei = parseUnits(amount1 || '0', decimals1);

        // Validate params
        const depositParams: UnifiedYieldDepositParams = {
          hookAddress: params.hookAddress,
          token0Address: params.token0Address,
          token1Address: params.token1Address,
          amount0Wei,
          amount1Wei,
          userAddress,
          poolId: params.poolId || '',
          chainId: params.chainId || 8453,
        };

        const validation = validateUnifiedYieldDepositParams(depositParams);
        if (!validation.valid) {
          const err = new Error(validation.errors.join(', '));
          setError(err);
          return undefined;
        }

        // Build transaction
        const txData = await buildUnifiedYieldDepositTx(depositParams);

        // Execute deposit
        writeContract({
          address: txData.to,
          abi: UNIFIED_YIELD_HOOK_ABI,
          functionName: 'deposit',
          args: [
            params.token0Address,
            params.token1Address,
            amount0Wei,
            amount1Wei,
            userAddress,
          ],
          value: txData.value,
        });

        return txHash;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Deposit failed');
        setError(error);
        return undefined;
      }
    },
    [params, userAddress, writeContract, txHash]
  );

  const reset = useCallback(() => {
    setError(null);
    resetWrite();
  }, [resetWrite]);

  return {
    deposit,
    txHash,
    isPending: isWritePending,
    isSuccess: isWriteSuccess && isConfirmed,
    isError: isWriteError,
    error: error || writeError || null,
    reset,
    receipt,
    isConfirming,
  };
}

/**
 * Helper to check if a token is native ETH
 */
export function isNativeToken(tokenAddress: Address): boolean {
  return tokenAddress === NATIVE_TOKEN_ADDRESS;
}
