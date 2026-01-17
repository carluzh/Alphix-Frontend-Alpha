/**
 * Unified Yield Withdraw Execution Hook
 *
 * Handles withdrawals from Unified Yield positions:
 * 1. Burn shares from Hook
 * 2. Receive underlying tokens (token0 + token1)
 * 3. Track transaction status
 *
 * Supports partial withdrawals - user can withdraw any number of shares.
 */

import { useCallback, useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import type { Address, Hash } from 'viem';

import { UNIFIED_YIELD_HOOK_ABI } from '../abi/unifiedYieldHookABI';
import { buildUnifiedYieldWithdrawTx, validateUnifiedYieldWithdrawParams } from '../buildUnifiedYieldWithdrawTx';
import type { UnifiedYieldWithdrawParams, WithdrawPercentage } from '../types';
import { calculateWithdrawShares } from '../types';

export interface UseUnifiedYieldWithdrawParams {
  /** Hook contract address */
  hookAddress?: Address;
  /** Pool ID */
  poolId?: string;
  /** Chain ID */
  chainId?: number;
}

export interface UseUnifiedYieldWithdrawResult {
  /** Execute withdrawal with specific share amount */
  withdraw: (shares: bigint) => Promise<Hash | undefined>;

  /** Execute withdrawal by percentage of total position */
  withdrawPercentage: (totalShares: bigint, percentage: WithdrawPercentage) => Promise<Hash | undefined>;

  /** Execute full withdrawal (100% of shares) */
  withdrawAll: (totalShares: bigint) => Promise<Hash | undefined>;

  /** Current transaction hash (if any) */
  txHash: Hash | undefined;

  /** Whether withdrawal is pending */
  isPending: boolean;

  /** Whether withdrawal was successful */
  isSuccess: boolean;

  /** Whether withdrawal failed */
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
 * Hook for executing Unified Yield withdrawals
 *
 * @param params - Withdraw configuration
 * @returns Withdraw execution controls and state
 *
 * @example
 * ```tsx
 * const { withdraw, withdrawPercentage, isPending } = useUnifiedYieldWithdraw({
 *   hookAddress: '0x...',
 *   poolId: 'eth-usdc',
 *   chainId: 8453,
 * });
 *
 * // Withdraw 50% of position
 * await withdrawPercentage(totalShares, 50);
 *
 * // Withdraw specific amount
 * await withdraw(sharesToBurn);
 * ```
 */
export function useUnifiedYieldWithdraw(
  params?: UseUnifiedYieldWithdrawParams
): UseUnifiedYieldWithdrawResult {
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

  const withdraw = useCallback(
    async (shares: bigint): Promise<Hash | undefined> => {
      setError(null);

      if (!params?.hookAddress) {
        const err = new Error('Hook address is required');
        setError(err);
        return undefined;
      }

      if (!userAddress) {
        const err = new Error('Wallet not connected');
        setError(err);
        return undefined;
      }

      if (shares <= 0n) {
        const err = new Error('Share amount must be greater than zero');
        setError(err);
        return undefined;
      }

      try {
        const withdrawParams: UnifiedYieldWithdrawParams = {
          hookAddress: params.hookAddress,
          shares,
          userAddress,
          poolId: params.poolId || '',
          chainId: params.chainId || 8453,
        };

        const validation = validateUnifiedYieldWithdrawParams(withdrawParams);
        if (!validation.valid) {
          const err = new Error(validation.errors.join(', '));
          setError(err);
          return undefined;
        }

        // Build transaction
        const txData = buildUnifiedYieldWithdrawTx(withdrawParams);

        // Execute withdrawal
        writeContract({
          address: txData.to,
          abi: UNIFIED_YIELD_HOOK_ABI,
          functionName: 'withdraw',
          args: [shares, userAddress],
        });

        return txHash;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Withdrawal failed');
        setError(error);
        return undefined;
      }
    },
    [params, userAddress, writeContract, txHash]
  );

  const withdrawPercentage = useCallback(
    async (totalShares: bigint, percentage: WithdrawPercentage): Promise<Hash | undefined> => {
      const sharesToWithdraw = calculateWithdrawShares(totalShares, percentage);
      return withdraw(sharesToWithdraw);
    },
    [withdraw]
  );

  const withdrawAll = useCallback(
    async (totalShares: bigint): Promise<Hash | undefined> => {
      return withdraw(totalShares);
    },
    [withdraw]
  );

  const reset = useCallback(() => {
    setError(null);
    resetWrite();
  }, [resetWrite]);

  return {
    withdraw,
    withdrawPercentage,
    withdrawAll,
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
