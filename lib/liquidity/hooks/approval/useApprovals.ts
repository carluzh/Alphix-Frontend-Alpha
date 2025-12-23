/**
 * Unified Approval Hook
 *
 * Checks ERC20 and Permit2 allowances. Does NOT generate permit data.
 * Permit data comes from the backend API (single source of truth).
 */

import { useMemo } from 'react';
import { useReadContract } from 'wagmi';
import { parseUnits, getAddress, type Address } from 'viem';
import type { TokenSymbol } from '@/lib/pools-config';
import { getTokenDefinitions, getPositionManagerAddress, NATIVE_TOKEN_ADDRESS } from '@/lib/pools-config';
import { PERMIT2_ADDRESS } from '@/lib/swap-constants';
import { ERC20_ABI } from '@/lib/abis/erc20';
import { iallowance_transfer_abi } from '@/lib/abis/IAllowanceTransfer_abi';
import { useNetwork } from '@/lib/network-context';
import { LiquidityTransactionType } from '../../types';

// =============================================================================
// TYPES
// =============================================================================

export interface UseApprovalsParams {
  userAddress?: string;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  amount0: string;
  amount1: string;
  chainId?: number;
  operationType: LiquidityTransactionType;
  tokenId?: bigint;
}

export interface UseApprovalsOptions {
  enabled?: boolean;
  staleTime?: number;
}

export interface TokenApprovalStatus {
  tokenSymbol: TokenSymbol;
  tokenAddress: Address;
  needsERC20Approval: boolean;
  needsPermit2Signature: boolean;
  currentAllowance: bigint;
  requiredAmount: bigint;
}

export interface ApprovalCheckResult {
  token0: TokenApprovalStatus | null;
  token1: TokenApprovalStatus | null;
  needsERC20Approvals: boolean;
  needsPermit2Signature: boolean;
  isLoading: boolean;
}

export interface UseApprovalsResult {
  data: ApprovalCheckResult;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

// =============================================================================
// MAIN HOOK
// =============================================================================

export function useLiquidityApprovals(
  params: UseApprovalsParams | undefined,
  options?: UseApprovalsOptions
): UseApprovalsResult {
  const { networkMode } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  const token0Config = params ? tokenDefinitions[params.token0Symbol] : undefined;
  const token1Config = params ? tokenDefinitions[params.token1Symbol] : undefined;

  const isToken0Native = token0Config?.address === NATIVE_TOKEN_ADDRESS;
  const isToken1Native = token1Config?.address === NATIVE_TOKEN_ADDRESS;

  // Parse amounts to wei
  const { amount0Wei, amount1Wei } = useMemo(() => {
    if (!params) return { amount0Wei: 0n, amount1Wei: 0n };
    if (!token0Config || !token1Config) return { amount0Wei: 0n, amount1Wei: 0n };

    const amt0 = params.amount0 && parseFloat(params.amount0) > 0
      ? parseUnits(params.amount0, token0Config.decimals)
      : 0n;
    const amt1 = params.amount1 && parseFloat(params.amount1) > 0
      ? parseUnits(params.amount1, token1Config.decimals)
      : 0n;

    return { amount0Wei: amt0, amount1Wei: amt1 };
  }, [params?.amount0, params?.amount1, token0Config, token1Config]);

  // Skip approvals for decrease/collect operations
  const skipApprovals =
    params?.operationType === LiquidityTransactionType.Decrease ||
    params?.operationType === LiquidityTransactionType.Collect;

  // ==========================================================================
  // ERC20 Allowance Checks (Token -> Permit2)
  // ==========================================================================

  const {
    data: token0Allowance,
    isLoading: isLoadingToken0,
    refetch: refetchToken0,
  } = useReadContract({
    address: token0Config?.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [params?.userAddress as `0x${string}`, PERMIT2_ADDRESS],
    query: {
      enabled:
        options?.enabled !== false &&
        !skipApprovals &&
        !isToken0Native &&
        Boolean(params?.userAddress && token0Config),
      staleTime: options?.staleTime ?? 1000,
      gcTime: 0,
    },
  });

  const {
    data: token1Allowance,
    isLoading: isLoadingToken1,
    refetch: refetchToken1,
  } = useReadContract({
    address: token1Config?.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [params?.userAddress as `0x${string}`, PERMIT2_ADDRESS],
    query: {
      enabled:
        options?.enabled !== false &&
        !skipApprovals &&
        !isToken1Native &&
        Boolean(params?.userAddress && token1Config),
      staleTime: options?.staleTime ?? 1000,
      gcTime: 0,
    },
  });

  // ==========================================================================
  // Permit2 Allowance Checks (Permit2 -> PositionManager)
  // ==========================================================================

  const POSITION_MANAGER = getPositionManagerAddress(networkMode);

  const needsToken0ERC20Approval =
    !isToken0Native &&
    amount0Wei > 0n &&
    (token0Allowance === undefined || (token0Allowance as bigint) < amount0Wei);

  const needsToken1ERC20Approval =
    !isToken1Native &&
    amount1Wei > 0n &&
    (token1Allowance === undefined || (token1Allowance as bigint) < amount1Wei);

  const {
    data: token0PermitData,
    isLoading: isLoadingToken0Permit,
    refetch: refetchToken0Permit,
  } = useReadContract({
    address: PERMIT2_ADDRESS as `0x${string}`,
    abi: iallowance_transfer_abi,
    functionName: 'allowance',
    args: [
      params?.userAddress as `0x${string}`,
      token0Config?.address as `0x${string}`,
      POSITION_MANAGER as `0x${string}`,
    ],
    query: {
      enabled:
        options?.enabled !== false &&
        !skipApprovals &&
        !isToken0Native &&
        !needsToken0ERC20Approval &&
        Boolean(params?.userAddress && token0Config),
      staleTime: options?.staleTime ?? 1000,
      gcTime: 0,
    },
  });

  const {
    data: token1PermitData,
    isLoading: isLoadingToken1Permit,
    refetch: refetchToken1Permit,
  } = useReadContract({
    address: PERMIT2_ADDRESS as `0x${string}`,
    abi: iallowance_transfer_abi,
    functionName: 'allowance',
    args: [
      params?.userAddress as `0x${string}`,
      token1Config?.address as `0x${string}`,
      POSITION_MANAGER as `0x${string}`,
    ],
    query: {
      enabled:
        options?.enabled !== false &&
        !skipApprovals &&
        !isToken1Native &&
        !needsToken1ERC20Approval &&
        Boolean(params?.userAddress && token1Config),
      staleTime: options?.staleTime ?? 1000,
      gcTime: 0,
    },
  });

  // ==========================================================================
  // Build result
  // ==========================================================================

  const data = useMemo((): ApprovalCheckResult => {
    if (!params || skipApprovals) {
      return {
        token0: null,
        token1: null,
        needsERC20Approvals: false,
        needsPermit2Signature: false,
        isLoading: false,
      };
    }

    const now = Math.floor(Date.now() / 1000);

    const buildTokenStatus = (
      isNative: boolean,
      amountWei: bigint,
      allowance: bigint | undefined,
      permitData: readonly [bigint, number, bigint] | undefined,
      tokenSymbol: TokenSymbol,
      tokenConfig: { address: string; decimals: number } | undefined
    ): TokenApprovalStatus | null => {
      if (isNative || amountWei <= 0n || !tokenConfig) return null;

      const currentAllowance = allowance ?? 0n;
      const needsERC20Approval = currentAllowance < amountWei;

      let needsPermit2Signature = false;
      if (!needsERC20Approval && permitData) {
        const [amount, expiration] = permitData;
        needsPermit2Signature = amount < amountWei || Number(expiration) < now;
      }

      return {
        tokenSymbol,
        tokenAddress: getAddress(tokenConfig.address) as Address,
        needsERC20Approval,
        needsPermit2Signature,
        currentAllowance,
        requiredAmount: amountWei,
      };
    };

    const token0Status = buildTokenStatus(
      isToken0Native,
      amount0Wei,
      token0Allowance as bigint | undefined,
      token0PermitData as readonly [bigint, number, bigint] | undefined,
      params.token0Symbol,
      token0Config
    );

    const token1Status = buildTokenStatus(
      isToken1Native,
      amount1Wei,
      token1Allowance as bigint | undefined,
      token1PermitData as readonly [bigint, number, bigint] | undefined,
      params.token1Symbol,
      token1Config
    );

    const isLoading = isLoadingToken0 || isLoadingToken1 || isLoadingToken0Permit || isLoadingToken1Permit;

    return {
      token0: token0Status,
      token1: token1Status,
      needsERC20Approvals: (token0Status?.needsERC20Approval ?? false) || (token1Status?.needsERC20Approval ?? false),
      needsPermit2Signature: (token0Status?.needsPermit2Signature ?? false) || (token1Status?.needsPermit2Signature ?? false),
      isLoading,
    };
  }, [
    params,
    skipApprovals,
    isToken0Native,
    isToken1Native,
    amount0Wei,
    amount1Wei,
    token0Allowance,
    token1Allowance,
    token0PermitData,
    token1PermitData,
    token0Config,
    token1Config,
    isLoadingToken0,
    isLoadingToken1,
    isLoadingToken0Permit,
    isLoadingToken1Permit,
  ]);

  const refetch = async () => {
    await Promise.all([
      refetchToken0(),
      refetchToken1(),
      refetchToken0Permit(),
      refetchToken1Permit(),
    ]);
  };

  return {
    data,
    isLoading: isLoadingToken0 || isLoadingToken1 || isLoadingToken0Permit || isLoadingToken1Permit,
    refetch,
  };
}

// =============================================================================
// CONVENIENCE HOOKS
// =============================================================================

export interface LegacyApprovalResponse {
  needsToken0ERC20Approval: boolean;
  needsToken1ERC20Approval: boolean;
  needsToken0Permit: boolean;
  needsToken1Permit: boolean;
}

function transformToLegacyFormat(data: ApprovalCheckResult): LegacyApprovalResponse {
  return {
    needsToken0ERC20Approval: data.token0?.needsERC20Approval ?? false,
    needsToken1ERC20Approval: data.token1?.needsERC20Approval ?? false,
    needsToken0Permit: data.token0?.needsPermit2Signature ?? false,
    needsToken1Permit: data.token1?.needsPermit2Signature ?? false,
  };
}

export interface CheckMintApprovalsParams {
  userAddress?: string;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  amount0: string;
  amount1: string;
  chainId?: number;
  tickLower?: number;
  tickUpper?: number;
}

export function useCheckMintApprovals(
  params: CheckMintApprovalsParams | undefined,
  options?: UseApprovalsOptions
) {
  const result = useLiquidityApprovals(
    params
      ? {
          ...params,
          operationType: LiquidityTransactionType.Create,
        }
      : undefined,
    options
  );

  return {
    data: transformToLegacyFormat(result.data),
    isLoading: result.isLoading,
    refetch: result.refetch,
  };
}

export interface CheckIncreaseApprovalsParams {
  userAddress?: string;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  amount0: string;
  amount1: string;
  chainId?: number;
  tokenId?: bigint;
  fee0?: string;
  fee1?: string;
}

export function useCheckIncreaseApprovals(
  params: CheckIncreaseApprovalsParams | undefined,
  options?: UseApprovalsOptions
) {
  const result = useLiquidityApprovals(
    params
      ? {
          ...params,
          operationType: LiquidityTransactionType.Increase,
        }
      : undefined,
    options
  );

  return {
    data: transformToLegacyFormat(result.data),
    isLoading: result.isLoading,
    refetch: result.refetch,
  };
}
