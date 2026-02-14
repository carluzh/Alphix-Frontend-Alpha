/**
 * Unified Yield Withdraw Execution Hook
 *
 * Handles withdrawals from Unified Yield (ReHypothecation) positions:
 * 1. Preview to show expected token amounts
 * 2. Execute removeReHypothecatedLiquidity(shares) to burn shares
 * 3. Receive underlying tokens (token0 + token1)
 * 4. Track transaction status
 *
 * The contract function:
 *   removeReHypothecatedLiquidity(uint256 shares) external returns (BalanceDelta)
 *
 * Supports partial withdrawals - user can withdraw any number of shares.
 */

import { useCallback, useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import type { Address, Hash } from 'viem';
import * as Sentry from '@sentry/nextjs';

import { isUserRejectionError } from '../../utils/validation/errorHandling';

import { UNIFIED_YIELD_HOOK_ABI } from '../abi/unifiedYieldHookABI';
import {
  buildUnifiedYieldWithdrawTx,
  validateUnifiedYieldWithdrawParams,
  previewWithdraw,
  calculateSharesFromPercentage,
} from '../buildUnifiedYieldWithdrawTx';
import type { UnifiedYieldWithdrawParams, UnifiedYieldWithdrawPreview, WithdrawPercentage } from '../types';
import { calculateWithdrawShares } from '../types';

export interface UseUnifiedYieldWithdrawParams {
  /** Hook contract address */
  hookAddress?: Address;
  /** Token0 decimals (for preview formatting) */
  token0Decimals?: number;
  /** Token1 decimals (for preview formatting) */
  token1Decimals?: number;
  /** Pool ID */
  poolId?: string;
  /** Chain ID */
  chainId?: number;
  /**
   * Current pool sqrtPriceX96 for slippage protection
   * Pass undefined or '0' to skip slippage check
   */
  sqrtPriceX96?: string;
  /**
   * Max price slippage tolerance
   * Same scale as LP fee: 1000000 = 100%, 10000 = 1%
   * Default: 10000 (1%)
   */
  maxPriceSlippage?: number;
}

export interface UseUnifiedYieldWithdrawResult {
  /** Execute withdrawal with specific share amount */
  withdraw: (shares: bigint) => Promise<Hash | undefined>;

  /** Execute withdrawal by percentage of total position */
  withdrawPercentage: (totalShares: bigint, percentage: WithdrawPercentage) => Promise<Hash | undefined>;

  /** Execute full withdrawal (100% of shares) */
  withdrawAll: (totalShares: bigint) => Promise<Hash | undefined>;

  /** Preview withdrawal amounts without executing */
  getPreview: (shares: bigint) => Promise<UnifiedYieldWithdrawPreview | null>;

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

  /** Latest preview result */
  lastPreview: UnifiedYieldWithdrawPreview | null;
}

/**
 * Hook for executing Unified Yield withdrawals
 *
 * @param params - Withdraw configuration
 * @returns Withdraw execution controls and state
 *
 * @example
 * ```tsx
 * const { withdraw, withdrawPercentage, getPreview, isPending } = useUnifiedYieldWithdraw({
 *   hookAddress: '0x...',
 *   token0Decimals: 18,
 *   token1Decimals: 6,
 *   poolId: 'eth-usdc',
 *   chainId: 84532,
 * });
 *
 * // Preview to show user expected amounts
 * const preview = await getPreview(sharesToBurn);
 * // preview = { shares, amount0, amount1, amount0Formatted, amount1Formatted }
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
  const publicClient = usePublicClient();
  const [error, setError] = useState<Error | null>(null);
  const [lastPreview, setLastPreview] = useState<UnifiedYieldWithdrawPreview | null>(null);

  const {
    writeContractAsync,
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

  /**
   * Get withdrawal preview
   */
  const getPreview = useCallback(
    async (shares: bigint): Promise<UnifiedYieldWithdrawPreview | null> => {
      if (!params?.hookAddress || !publicClient || shares <= 0n) {
        return null;
      }

      try {
        const token0Decimals = params.token0Decimals ?? 18;
        const token1Decimals = params.token1Decimals ?? 18;

        const preview = await previewWithdraw(
          params.hookAddress,
          shares,
          token0Decimals,
          token1Decimals,
          publicClient
        );

        if (preview) {
          setLastPreview(preview);
        }

        return preview;
      } catch (err) {
        console.warn('Preview failed:', err);
        // Capture preview failures to Sentry for debugging
        Sentry.captureException(err, {
          tags: { component: 'useUnifiedYieldWithdraw', operation: 'getPreview' },
          extra: {
            hookAddress: params.hookAddress,
            shares: shares.toString(),
            token0Decimals: params.token0Decimals,
            token1Decimals: params.token1Decimals,
            poolId: params.poolId,
          },
        });
        return null;
      }
    },
    [params, publicClient]
  );

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
          chainId: params.chainId || 84532,
        };

        const validation = validateUnifiedYieldWithdrawParams(withdrawParams);
        if (!validation.valid) {
          const err = new Error(validation.errors.join(', '));
          setError(err);
          return undefined;
        }

        // Build transaction
        const txData = buildUnifiedYieldWithdrawTx(withdrawParams);

        // Parse slippage params
        const expectedSqrtPriceX96 = params.sqrtPriceX96 ? BigInt(params.sqrtPriceX96) : 0n;
        const maxPriceSlippage = params.maxPriceSlippage ?? 0;

        // Execute withdrawal: removeReHypothecatedLiquidity(shares, expectedSqrtPriceX96, maxPriceSlippage)
        // Use writeContractAsync to properly await the transaction submission
        const hash = await writeContractAsync({
          address: txData.to,
          abi: UNIFIED_YIELD_HOOK_ABI,
          functionName: 'removeReHypothecatedLiquidity',
          args: [shares, expectedSqrtPriceX96, maxPriceSlippage],
        });

        return hash;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Withdrawal failed');
        setError(error);

        // Capture non-rejection errors to Sentry
        if (!isUserRejectionError(err)) {
          Sentry.captureException(error, {
            tags: { component: 'useUnifiedYieldWithdraw', operation: 'withdraw' },
            extra: {
              hookAddress: params.hookAddress,
              shares: shares.toString(),
              userAddress,
              poolId: params.poolId,
              chainId: params.chainId,
              sqrtPriceX96: params.sqrtPriceX96,
              maxPriceSlippage: params.maxPriceSlippage,
            },
          });
        }

        return undefined;
      }
    },
    [params, userAddress, writeContractAsync]
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
    setLastPreview(null);
    resetWrite();
  }, [resetWrite]);

  return {
    withdraw,
    withdrawPercentage,
    withdrawAll,
    getPreview,
    txHash,
    isPending: isWritePending,
    isSuccess: isWriteSuccess && isConfirmed,
    isError: isWriteError,
    error: error || writeError || null,
    reset,
    receipt,
    isConfirming,
    lastPreview,
  };
}
