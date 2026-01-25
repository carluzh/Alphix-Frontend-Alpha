/**
 * Unified Yield Approval Hook
 *
 * Checks ERC20 allowances to the Hook contract for Unified Yield deposits.
 * Unlike V4 positions, Unified Yield does NOT use Permit2 - direct ERC20 approvals only.
 *
 * Flow: ERC20 Token → Hook Contract (direct approval)
 */

import { useMemo } from 'react';
import { useReadContract } from 'wagmi';
import { type Address } from 'viem';
import { ERC20_ABI } from '@/lib/abis/erc20';
import { NATIVE_TOKEN_ADDRESS } from '@/lib/pools-config';
import type {
  UnifiedYieldApprovalParams,
  UnifiedYieldApprovalStatus,
} from './types';

export interface UseUnifiedYieldApprovalsParams {
  /** User's wallet address */
  userAddress?: Address;

  /** Token0 address */
  token0Address?: Address;

  /** Token1 address */
  token1Address?: Address;

  /** Amount of token0 needed (in wei) */
  amount0Wei?: bigint;

  /** Amount of token1 needed (in wei) */
  amount1Wei?: bigint;

  /** Hook contract address (approval target) */
  hookAddress?: Address;

  /** Chain ID */
  chainId?: number;
}

export interface UseUnifiedYieldApprovalsOptions {
  /** Enable/disable the hook */
  enabled?: boolean;

  /** Stale time for cache */
  staleTime?: number;
}

export interface UseUnifiedYieldApprovalsResult {
  /** Approval status data */
  data: UnifiedYieldApprovalStatus | null;

  /** Whether approvals are being checked */
  isLoading: boolean;

  /**
   * Refetch approvals and return fresh status
   * @param overrideAmounts - Optional amounts to use instead of hook params (for fresh preview data)
   */
  refetch: (overrideAmounts?: { amount0Wei: bigint; amount1Wei: bigint }) => Promise<UnifiedYieldApprovalStatus | null>;
}

/**
 * Hook to check ERC20 approvals for Unified Yield deposits
 *
 * @param params - Approval check parameters
 * @param options - Hook options
 * @returns Approval status and loading state
 */
export function useUnifiedYieldApprovals(
  params?: UseUnifiedYieldApprovalsParams,
  options?: UseUnifiedYieldApprovalsOptions
): UseUnifiedYieldApprovalsResult {
  const {
    userAddress,
    token0Address,
    token1Address,
    amount0Wei = 0n,
    amount1Wei = 0n,
    hookAddress,
  } = params ?? {};

  const enabled = options?.enabled !== false;
  const staleTime = options?.staleTime ?? 1000;

  // Check if tokens are native (no approval needed)
  const isToken0Native = token0Address === NATIVE_TOKEN_ADDRESS;
  const isToken1Native = token1Address === NATIVE_TOKEN_ADDRESS;

  // Check token0 allowance to Hook
  const {
    data: token0Allowance,
    isLoading: isLoadingToken0,
    refetch: refetchToken0,
  } = useReadContract({
    address: token0Address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [userAddress as `0x${string}`, hookAddress as `0x${string}`],
    query: {
      enabled:
        enabled &&
        !isToken0Native &&
        Boolean(userAddress && token0Address && hookAddress),
      staleTime,
      gcTime: 0,
    },
  });

  // Check token1 allowance to Hook
  const {
    data: token1Allowance,
    isLoading: isLoadingToken1,
    refetch: refetchToken1,
  } = useReadContract({
    address: token1Address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [userAddress as `0x${string}`, hookAddress as `0x${string}`],
    query: {
      enabled:
        enabled &&
        !isToken1Native &&
        Boolean(userAddress && token1Address && hookAddress),
      staleTime,
      gcTime: 0,
    },
  });

  // Build approval status
  const data = useMemo((): UnifiedYieldApprovalStatus | null => {
    if (!params || !hookAddress) return null;

    const t0Allowance = (token0Allowance as bigint) ?? 0n;
    const t1Allowance = (token1Allowance as bigint) ?? 0n;

    const token0NeedsApproval =
      !isToken0Native && amount0Wei > 0n && t0Allowance < amount0Wei;

    const token1NeedsApproval =
      !isToken1Native && amount1Wei > 0n && t1Allowance < amount1Wei;

    return {
      token0NeedsApproval,
      token1NeedsApproval,
      token0Allowance: t0Allowance,
      token1Allowance: t1Allowance,
      token0Required: amount0Wei,
      token1Required: amount1Wei,
    };
  }, [
    params,
    hookAddress,
    token0Allowance,
    token1Allowance,
    isToken0Native,
    isToken1Native,
    amount0Wei,
    amount1Wei,
  ]);

  /**
   * Refetch approvals and return fresh status
   * @param overrideAmounts - Optional amounts to use instead of hook params (for fresh preview data)
   * Returns the updated approval status after refetching
   */
  const refetch = async (overrideAmounts?: { amount0Wei: bigint; amount1Wei: bigint }): Promise<UnifiedYieldApprovalStatus | null> => {
    const [result0, result1] = await Promise.all([refetchToken0(), refetchToken1()]);

    // Build fresh approval status from refetch results
    if (!params || !hookAddress) return null;

    const t0Allowance = (result0.data as bigint) ?? 0n;
    const t1Allowance = (result1.data as bigint) ?? 0n;

    // Use override amounts if provided (for fresh preview data), otherwise use hook params
    const checkAmount0 = overrideAmounts?.amount0Wei ?? amount0Wei;
    const checkAmount1 = overrideAmounts?.amount1Wei ?? amount1Wei;

    const token0NeedsApproval =
      !isToken0Native && checkAmount0 > 0n && t0Allowance < checkAmount0;
    const token1NeedsApproval =
      !isToken1Native && checkAmount1 > 0n && t1Allowance < checkAmount1;

    return {
      token0NeedsApproval,
      token1NeedsApproval,
      token0Allowance: t0Allowance,
      token1Allowance: t1Allowance,
      token0Required: checkAmount0,
      token1Required: checkAmount1,
    };
  };

  return {
    data,
    isLoading: isLoadingToken0 || isLoadingToken1,
    refetch,
  };
}
