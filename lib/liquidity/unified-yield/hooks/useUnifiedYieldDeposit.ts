/**
 * Unified Yield Deposit Execution Hook
 *
 * Handles the full deposit flow for Unified Yield (ReHypothecation) positions:
 * 1. Preview the deposit to get required amounts and shares
 * 2. Check/request ERC20 approvals to Hook
 * 3. Execute addReHypothecatedLiquidity(shares) transaction
 * 4. Track transaction status
 *
 * KEY CHANGE: The contract uses a share-centric flow:
 * - User enters one token amount
 * - Preview calculates the other amount and shares
 * - Transaction calls addReHypothecatedLiquidity(shares)
 *
 * Unlike V4 deposits which use Permit2, Unified Yield uses direct ERC20 approvals.
 */

import { useCallback, useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import type { Address, Hash } from 'viem';
import { parseUnits } from 'viem';

import { UNIFIED_YIELD_HOOK_ABI } from '../abi/unifiedYieldHookABI';
import {
  buildUnifiedYieldDepositTx,
  validateUnifiedYieldDepositParams,
  previewDeposit,
} from '../buildUnifiedYieldDepositTx';
import type { UnifiedYieldDepositParams, DepositPreviewResult } from '../types';
import { NATIVE_TOKEN_ADDRESS } from '@/lib/pools-config';

export interface UseUnifiedYieldDepositParams {
  /** Hook contract address */
  hookAddress?: Address;
  /** Token0 address */
  token0Address?: Address;
  /** Token1 address */
  token1Address?: Address;
  /** Token0 decimals */
  token0Decimals?: number;
  /** Token1 decimals */
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

export interface UseUnifiedYieldDepositResult {
  /**
   * Execute the deposit with a pre-calculated preview
   * Use this when you've already run the preview and have all values
   */
  depositWithPreview: (preview: DepositPreviewResult) => Promise<Hash | undefined>;

  /**
   * Execute deposit from a single token amount
   * Automatically runs preview and then deposits
   *
   * @param amount - The token amount as a string (e.g., "1.5")
   * @param inputSide - Which token the user entered ('token0' or 'token1')
   * @param decimals - Decimals for the input token
   */
  deposit: (
    amount: string,
    inputSide: 'token0' | 'token1',
    decimals: number
  ) => Promise<Hash | undefined>;

  /**
   * Preview the deposit without executing
   * Returns the calculated amounts and shares
   */
  getPreview: (
    amount: string,
    inputSide: 'token0' | 'token1',
    decimals: number
  ) => Promise<DepositPreviewResult | null>;

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

  /** Latest preview result (from getPreview or deposit) */
  lastPreview: DepositPreviewResult | null;
}

/**
 * Hook for executing Unified Yield deposits
 *
 * @param params - Deposit configuration
 * @returns Deposit execution controls and state
 *
 * @example
 * ```tsx
 * const { deposit, getPreview, isPending, isSuccess, lastPreview } = useUnifiedYieldDeposit({
 *   hookAddress: '0x...',
 *   token0Address: '0x...',
 *   token1Address: '0x...',
 *   token0Decimals: 18,
 *   token1Decimals: 6,
 *   poolId: 'eth-usdc',
 *   chainId: 84532,
 * });
 *
 * // Preview to show user the required amounts
 * const preview = await getPreview('1.0', 'token0', 18);
 * // preview = { amount0: 1e18, amount1: 3000e6, shares: ..., ... }
 *
 * // Execute deposit (will run preview again internally)
 * await deposit('1.0', 'token0', 18);
 *
 * // Or deposit with pre-calculated preview
 * await depositWithPreview(preview);
 * ```
 */
export function useUnifiedYieldDeposit(
  params?: UseUnifiedYieldDepositParams
): UseUnifiedYieldDepositResult {
  const { address: userAddress } = useAccount();
  const publicClient = usePublicClient();
  const [error, setError] = useState<Error | null>(null);
  const [lastPreview, setLastPreview] = useState<DepositPreviewResult | null>(null);

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
   * Get deposit preview
   */
  const getPreview = useCallback(
    async (
      amount: string,
      inputSide: 'token0' | 'token1',
      decimals: number
    ): Promise<DepositPreviewResult | null> => {
      if (!params?.hookAddress || !publicClient) {
        return null;
      }

      try {
        const amountWei = parseUnits(amount || '0', decimals);
        if (amountWei <= 0n) return null;

        const token0Decimals = params.token0Decimals ?? 18;
        const token1Decimals = params.token1Decimals ?? 18;
        const shareDecimals = 18; // Standard share decimals

        const preview = await previewDeposit(
          params.hookAddress,
          amountWei,
          inputSide,
          token0Decimals,
          token1Decimals,
          shareDecimals,
          publicClient
        );

        if (preview) {
          setLastPreview(preview);
        }

        return preview;
      } catch (err) {
        console.warn('Preview failed:', err);
        return null;
      }
    },
    [params, publicClient]
  );

  /**
   * Execute deposit with a pre-calculated preview
   */
  const depositWithPreview = useCallback(
    async (preview: DepositPreviewResult): Promise<Hash | undefined> => {
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

      if (preview.shares <= 0n) {
        const err = new Error('Invalid shares amount from preview');
        setError(err);
        return undefined;
      }

      try {
        // Build full deposit params
        const depositParams: UnifiedYieldDepositParams = {
          hookAddress: params.hookAddress,
          token0Address: params.token0Address,
          token1Address: params.token1Address,
          amount0Wei: preview.amount0,
          amount1Wei: preview.amount1,
          sharesToMint: preview.shares,
          userAddress,
          poolId: params.poolId || '',
          chainId: params.chainId || 84532,
        };

        // Validate
        const validation = validateUnifiedYieldDepositParams(depositParams);
        if (!validation.valid) {
          const err = new Error(validation.errors.join(', '));
          setError(err);
          return undefined;
        }

        // Build transaction data
        const txData = buildUnifiedYieldDepositTx(depositParams);

        // Parse slippage params
        const expectedSqrtPriceX96 = params.sqrtPriceX96 ? BigInt(params.sqrtPriceX96) : 0n;
        const maxPriceSlippage = params.maxPriceSlippage ?? 0;

        // Execute: addReHypothecatedLiquidity(shares, expectedSqrtPriceX96, maxPriceSlippage)
        // Use writeContractAsync to properly await the transaction submission
        const hash = await writeContractAsync({
          address: txData.to,
          abi: UNIFIED_YIELD_HOOK_ABI,
          functionName: 'addReHypothecatedLiquidity',
          args: [preview.shares, expectedSqrtPriceX96, maxPriceSlippage],
          value: txData.value,
        });

        return hash;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Deposit failed');
        setError(error);
        return undefined;
      }
    },
    [params, userAddress, writeContractAsync]
  );

  /**
   * Execute deposit from a single token amount
   * Runs preview first, then executes the deposit
   */
  const deposit = useCallback(
    async (
      amount: string,
      inputSide: 'token0' | 'token1',
      decimals: number
    ): Promise<Hash | undefined> => {
      setError(null);

      // Get preview first
      const preview = await getPreview(amount, inputSide, decimals);

      if (!preview) {
        const err = new Error('Failed to preview deposit amounts');
        setError(err);
        return undefined;
      }

      // Execute with the preview
      return depositWithPreview(preview);
    },
    [getPreview, depositWithPreview]
  );

  const reset = useCallback(() => {
    setError(null);
    setLastPreview(null);
    resetWrite();
  }, [resetWrite]);

  return {
    deposit,
    depositWithPreview,
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
