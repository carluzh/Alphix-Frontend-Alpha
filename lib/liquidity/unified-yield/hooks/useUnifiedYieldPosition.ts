/**
 * Unified Yield Position Hook
 *
 * Combined hook for managing Unified Yield positions:
 * - Fetches position data (share balance, underlying amounts)
 * - Provides deposit functionality
 * - Provides withdraw functionality
 * - Handles previews for deposits and withdrawals
 *
 * This is the main hook for UI components working with Unified Yield positions.
 */

import { useCallback, useMemo } from 'react';
import { useAccount, usePublicClient, useReadContract } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatUnits, type Address } from 'viem';

import { UNIFIED_YIELD_HOOK_ABI } from '../abi/unifiedYieldHookABI';
import { fetchSingleUnifiedYieldPosition, previewDeposit, previewWithdraw } from '../fetchUnifiedYieldPositions';
import { useUnifiedYieldDeposit } from './useUnifiedYieldDeposit';
import { useUnifiedYieldWithdraw } from './useUnifiedYieldWithdraw';
import type { UnifiedYieldPosition, UnifiedYieldWithdrawPreview } from '../types';
import { useNetwork } from '@/lib/network-context';

export interface UseUnifiedYieldPositionParams {
  /** Hook contract address */
  hookAddress?: Address;
  /** Pool ID */
  poolId?: string;
  /** Token0 address (for deposits) */
  token0Address?: Address;
  /** Token1 address (for deposits) */
  token1Address?: Address;
  /** Token0 decimals */
  token0Decimals?: number;
  /** Token1 decimals */
  token1Decimals?: number;
}

export interface UseUnifiedYieldPositionResult {
  /** Current position data */
  position: UnifiedYieldPosition | null;

  /** Whether position is loading */
  isLoading: boolean;

  /** Refetch position data */
  refetch: () => Promise<void>;

  /** Share balance (raw bigint) */
  shareBalance: bigint;

  /** Share balance (formatted string) */
  shareBalanceFormatted: string;

  /** Whether user has a position */
  hasPosition: boolean;

  // Deposit operations
  /** Execute deposit */
  deposit: (amount0: string, amount1: string) => Promise<void>;
  /** Whether deposit is pending */
  isDepositing: boolean;
  /** Whether deposit succeeded */
  depositSuccess: boolean;

  // Withdraw operations
  /** Execute withdrawal with share amount */
  withdraw: (shares: bigint) => Promise<void>;
  /** Execute withdrawal by percentage */
  withdrawPercentage: (percentage: 25 | 50 | 75 | 100) => Promise<void>;
  /** Execute full withdrawal */
  withdrawAll: () => Promise<void>;
  /** Whether withdrawal is pending */
  isWithdrawing: boolean;
  /** Whether withdrawal succeeded */
  withdrawSuccess: boolean;

  // Preview operations
  /** Preview deposit to get expected shares */
  getDepositPreview: (amount0: bigint, amount1: bigint) => Promise<bigint | null>;
  /** Preview withdrawal to get expected amounts */
  getWithdrawPreview: (shares: bigint) => Promise<UnifiedYieldWithdrawPreview | null>;

  // Reset states
  /** Reset deposit state */
  resetDeposit: () => void;
  /** Reset withdraw state */
  resetWithdraw: () => void;
}

/**
 * Main hook for Unified Yield position management
 *
 * @param params - Position configuration
 * @returns Position data and CRUD operations
 *
 * @example
 * ```tsx
 * const {
 *   position,
 *   shareBalance,
 *   deposit,
 *   withdrawPercentage,
 *   isDepositing,
 *   isWithdrawing,
 * } = useUnifiedYieldPosition({
 *   hookAddress: '0x...',
 *   poolId: 'eth-usdc',
 *   token0Address: '0x...',
 *   token1Address: '0x...',
 * });
 *
 * // Deposit 1 ETH and 1000 USDC
 * await deposit('1.0', '1000');
 *
 * // Withdraw 50% of position
 * await withdrawPercentage(50);
 * ```
 */
export function useUnifiedYieldPosition(
  params?: UseUnifiedYieldPositionParams
): UseUnifiedYieldPositionResult {
  const { address: userAddress } = useAccount();
  const client = usePublicClient();
  const queryClient = useQueryClient();
  const { networkMode, chainId } = useNetwork();

  const hookAddress = params?.hookAddress;

  // Fetch share balance directly from Hook
  const {
    data: rawShareBalance,
    isLoading: isLoadingBalance,
    refetch: refetchBalance,
  } = useReadContract({
    address: hookAddress,
    abi: UNIFIED_YIELD_HOOK_ABI,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!hookAddress && !!userAddress,
      staleTime: 10_000, // 10 seconds
    },
  });

  const shareBalance = (rawShareBalance as bigint) ?? 0n;
  const shareBalanceFormatted = formatUnits(shareBalance, 18);
  const hasPosition = shareBalance > 0n;

  // Fetch full position data
  const {
    data: position,
    isLoading: isLoadingPosition,
    refetch: refetchPositionQuery,
  } = useQuery({
    queryKey: ['unified-yield-position', hookAddress, userAddress, networkMode],
    queryFn: async () => {
      if (!hookAddress || !userAddress || !client) return null;
      return fetchSingleUnifiedYieldPosition(hookAddress, userAddress, client, networkMode);
    },
    enabled: !!hookAddress && !!userAddress && !!client && hasPosition,
    staleTime: 30_000, // 30 seconds
  });

  // Deposit hook
  const depositHook = useUnifiedYieldDeposit({
    hookAddress,
    token0Address: params?.token0Address,
    token1Address: params?.token1Address,
    poolId: params?.poolId,
    chainId,
  });

  // Withdraw hook
  const withdrawHook = useUnifiedYieldWithdraw({
    hookAddress,
    poolId: params?.poolId,
    chainId,
  });

  // Refetch all position data
  const refetch = useCallback(async () => {
    await Promise.all([
      refetchBalance(),
      refetchPositionQuery(),
    ]);
    // Invalidate related queries
    queryClient.invalidateQueries({
      queryKey: ['unified-yield-position'],
    });
  }, [refetchBalance, refetchPositionQuery, queryClient]);

  // Deposit wrapper
  const deposit = useCallback(
    async (amount0: string, amount1: string) => {
      const decimals0 = params?.token0Decimals ?? 18;
      const decimals1 = params?.token1Decimals ?? 18;
      await depositHook.deposit(amount0, amount1, decimals0, decimals1);
      // Refetch position after deposit
      setTimeout(() => refetch(), 2000);
    },
    [depositHook, params?.token0Decimals, params?.token1Decimals, refetch]
  );

  // Withdraw wrappers
  const withdraw = useCallback(
    async (shares: bigint) => {
      await withdrawHook.withdraw(shares);
      // Refetch position after withdrawal
      setTimeout(() => refetch(), 2000);
    },
    [withdrawHook, refetch]
  );

  const withdrawPercentage = useCallback(
    async (percentage: 25 | 50 | 75 | 100) => {
      await withdrawHook.withdrawPercentage(shareBalance, percentage);
      setTimeout(() => refetch(), 2000);
    },
    [withdrawHook, shareBalance, refetch]
  );

  const withdrawAll = useCallback(async () => {
    await withdrawHook.withdrawAll(shareBalance);
    setTimeout(() => refetch(), 2000);
  }, [withdrawHook, shareBalance, refetch]);

  // Preview helpers
  const getDepositPreview = useCallback(
    async (amount0: bigint, amount1: bigint): Promise<bigint | null> => {
      if (!hookAddress || !client) return null;
      return previewDeposit(hookAddress, amount0, amount1, client);
    },
    [hookAddress, client]
  );

  const getWithdrawPreview = useCallback(
    async (shares: bigint): Promise<UnifiedYieldWithdrawPreview | null> => {
      if (!hookAddress || !client) return null;
      const result = await previewWithdraw(hookAddress, shares, client);
      if (!result) return null;

      const [amount0, amount1] = result;
      const decimals0 = params?.token0Decimals ?? 18;
      const decimals1 = params?.token1Decimals ?? 18;

      return {
        shares,
        amount0,
        amount1,
        amount0Formatted: formatUnits(amount0, decimals0),
        amount1Formatted: formatUnits(amount1, decimals1),
      };
    },
    [hookAddress, client, params?.token0Decimals, params?.token1Decimals]
  );

  return {
    position: position ?? null,
    isLoading: isLoadingBalance || isLoadingPosition,
    refetch,
    shareBalance,
    shareBalanceFormatted,
    hasPosition,

    // Deposit
    deposit,
    isDepositing: depositHook.isPending || depositHook.isConfirming,
    depositSuccess: depositHook.isSuccess,

    // Withdraw
    withdraw,
    withdrawPercentage,
    withdrawAll,
    isWithdrawing: withdrawHook.isPending || withdrawHook.isConfirming,
    withdrawSuccess: withdrawHook.isSuccess,

    // Previews
    getDepositPreview,
    getWithdrawPreview,

    // Reset
    resetDeposit: depositHook.reset,
    resetWithdraw: withdrawHook.reset,
  };
}
