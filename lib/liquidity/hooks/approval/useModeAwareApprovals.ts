/**
 * Mode-Aware Approval Hook
 *
 * Selects the appropriate approval checking logic based on LP mode:
 * - 'rehypo' (Unified Yield): Check ERC20 approvals to Hook contract
 * - 'concentrated' (V4 Standard): Check ERC20 approvals to Permit2 + Permit2 allowances
 *
 * This hook abstracts away the approval differences between the two modes,
 * providing a consistent interface for the UI layer.
 */

import { useMemo } from 'react';
import type { Address } from 'viem';
import type { LPMode } from '@/components/liquidity/wizard/types';
import type { TokenSymbol } from '@/lib/pools-config';
import { getPoolById } from '@/lib/pools-config';
import { useNetwork } from '@/lib/network-context';
import { LiquidityTransactionType } from '../../types';

// V4 Standard approval hook
import { useLiquidityApprovals, type UseApprovalsParams } from './useApprovals';

// Unified Yield approval hook
import {
  useUnifiedYieldApprovals,
  type UseUnifiedYieldApprovalsParams,
} from '../../unified-yield/useUnifiedYieldApprovals';

/**
 * Parameters for mode-aware approval checking
 */
export interface UseModeAwareApprovalsParams {
  /** LP mode - determines which approval flow to use */
  mode: LPMode;

  /** User's wallet address */
  userAddress?: string;

  /** Pool identifier (for getting Hook address) */
  poolId?: string;

  /** Token0 symbol */
  token0Symbol?: TokenSymbol;

  /** Token1 symbol */
  token1Symbol?: TokenSymbol;

  /** Token0 address (for Unified Yield) */
  token0Address?: Address;

  /** Token1 address (for Unified Yield) */
  token1Address?: Address;

  /** Amount of token0 */
  amount0: string;

  /** Amount of token1 */
  amount1: string;

  /** Amount of token0 in wei (for Unified Yield) */
  amount0Wei?: bigint;

  /** Amount of token1 in wei (for Unified Yield) */
  amount1Wei?: bigint;

  /** Chain ID */
  chainId?: number;

  /** Operation type (create, increase, etc.) */
  operationType?: LiquidityTransactionType;
}

export interface UseModeAwareApprovalsOptions {
  /** Enable/disable the hook */
  enabled?: boolean;

  /** Stale time for cache */
  staleTime?: number;
}

/**
 * Unified approval result format
 * Compatible with both V4 and Unified Yield flows
 */
export interface ModeAwareApprovalResult {
  /** Whether token0 needs ERC20 approval */
  needsToken0ERC20Approval: boolean;

  /** Whether token1 needs ERC20 approval */
  needsToken1ERC20Approval: boolean;

  /** Whether Permit2 signature is needed (V4 only, always false for Unified Yield) */
  needsPermit2Signature: boolean;

  /** Whether any ERC20 approvals are needed */
  needsAnyApproval: boolean;

  /** The approval target address (Permit2 for V4, Hook for Unified Yield) */
  approvalTarget: Address | null;

  /** Whether this is a Unified Yield flow */
  isUnifiedYield: boolean;
}

export interface UseModeAwareApprovalsResult {
  /** Approval check result */
  data: ModeAwareApprovalResult;

  /** Whether approvals are being checked */
  isLoading: boolean;

  /** Refetch approvals */
  refetch: () => Promise<void>;
}

/**
 * Hook that checks approvals based on LP mode
 *
 * @param params - Approval check parameters including mode
 * @param options - Hook options
 * @returns Unified approval result regardless of mode
 */
export function useModeAwareApprovals(
  params?: UseModeAwareApprovalsParams,
  options?: UseModeAwareApprovalsOptions
): UseModeAwareApprovalsResult {
  const { networkMode } = useNetwork();

  const mode = params?.mode ?? 'rehypo';
  const isUnifiedYield = mode === 'rehypo';

  // Get Hook address from pool config
  const hookAddress = useMemo(() => {
    if (!params?.poolId) return undefined;
    const poolConfig = getPoolById(params.poolId, networkMode);
    return poolConfig?.hooks as Address | undefined;
  }, [params?.poolId, networkMode]);

  // V4 Standard approval params
  const v4Params: UseApprovalsParams | undefined = useMemo(() => {
    if (isUnifiedYield || !params) return undefined;
    if (!params.token0Symbol || !params.token1Symbol) return undefined;

    return {
      userAddress: params.userAddress,
      token0Symbol: params.token0Symbol,
      token1Symbol: params.token1Symbol,
      amount0: params.amount0,
      amount1: params.amount1,
      chainId: params.chainId,
      operationType: params.operationType ?? LiquidityTransactionType.Create,
    };
  }, [isUnifiedYield, params]);

  // Unified Yield approval params
  const uyParams: UseUnifiedYieldApprovalsParams | undefined = useMemo(() => {
    if (!isUnifiedYield || !params) return undefined;
    if (!params.token0Address || !params.token1Address || !hookAddress) return undefined;

    return {
      userAddress: params.userAddress as Address | undefined,
      token0Address: params.token0Address,
      token1Address: params.token1Address,
      amount0Wei: params.amount0Wei ?? 0n,
      amount1Wei: params.amount1Wei ?? 0n,
      hookAddress,
      chainId: params.chainId,
    };
  }, [isUnifiedYield, params, hookAddress]);

  // Call appropriate approval hook
  const v4Result = useLiquidityApprovals(
    v4Params,
    {
      enabled: options?.enabled !== false && !isUnifiedYield && !!v4Params,
      staleTime: options?.staleTime,
    }
  );

  const uyResult = useUnifiedYieldApprovals(
    uyParams,
    {
      enabled: options?.enabled !== false && isUnifiedYield && !!uyParams,
      staleTime: options?.staleTime,
    }
  );

  // Build unified result
  const data = useMemo((): ModeAwareApprovalResult => {
    if (isUnifiedYield) {
      // Unified Yield result
      return {
        needsToken0ERC20Approval: uyResult.data?.token0NeedsApproval ?? false,
        needsToken1ERC20Approval: uyResult.data?.token1NeedsApproval ?? false,
        needsPermit2Signature: false, // Never needed for Unified Yield
        needsAnyApproval:
          (uyResult.data?.token0NeedsApproval ?? false) ||
          (uyResult.data?.token1NeedsApproval ?? false),
        approvalTarget: hookAddress ?? null,
        isUnifiedYield: true,
      };
    } else {
      // V4 Standard result
      return {
        needsToken0ERC20Approval: v4Result.data.token0?.needsERC20Approval ?? false,
        needsToken1ERC20Approval: v4Result.data.token1?.needsERC20Approval ?? false,
        needsPermit2Signature: v4Result.data.needsPermit2Signature,
        needsAnyApproval: v4Result.data.needsERC20Approvals || v4Result.data.needsPermit2Signature,
        approvalTarget: null, // Permit2 address handled internally
        isUnifiedYield: false,
      };
    }
  }, [isUnifiedYield, uyResult.data, v4Result.data, hookAddress]);

  const isLoading = isUnifiedYield ? uyResult.isLoading : v4Result.isLoading;

  const refetch = async () => {
    if (isUnifiedYield) {
      await uyResult.refetch();
    } else {
      await v4Result.refetch();
    }
  };

  return {
    data,
    isLoading,
    refetch,
  };
}

/**
 * Convenience hook for mint operations with mode awareness
 */
export function useCheckMintApprovalsWithMode(
  params?: Omit<UseModeAwareApprovalsParams, 'operationType'>,
  options?: UseModeAwareApprovalsOptions
) {
  return useModeAwareApprovals(
    params
      ? {
          ...params,
          operationType: LiquidityTransactionType.Create,
        }
      : undefined,
    options
  );
}
