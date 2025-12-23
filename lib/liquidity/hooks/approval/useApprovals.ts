/**
 * Unified Approval Hook
 *
 * Consolidates useCheckLiquidityApprovals, useCheckIncreaseLiquidityApprovals,
 * and useCheckZapApprovals into a single hook that handles all operation types.
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

import {
  type ApprovalCheckResult,
  type Permit2SignatureStep,
  type TokenApprovalStatus,
  type TokenInfo,
  LiquidityTransactionType,
  TransactionStepType,
} from '../../types';

// =============================================================================
// HOOK INTERFACE
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
    const token0 = token0Config;
    const token1 = token1Config;
    if (!token0 || !token1) return { amount0Wei: 0n, amount1Wei: 0n };

    const amt0 = params.amount0 && parseFloat(params.amount0) > 0
      ? parseUnits(params.amount0, token0.decimals)
      : 0n;
    const amt1 = params.amount1 && parseFloat(params.amount1) > 0
      ? parseUnits(params.amount1, token1.decimals)
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
  // ERC20 approval status
  // ==========================================================================

  const needsToken0ERC20Approval =
    !isToken0Native &&
    amount0Wei > 0n &&
    (token0Allowance === undefined || (token0Allowance as bigint) < amount0Wei);

  const needsToken1ERC20Approval =
    !isToken1Native &&
    amount1Wei > 0n &&
    (token1Allowance === undefined || (token1Allowance as bigint) < amount1Wei);

  // ==========================================================================
  // Permit2 Allowance Checks (Permit2 -> PositionManager)
  // ==========================================================================

  const POSITION_MANAGER = getPositionManagerAddress(networkMode);

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
  // Analyze approval requirements
  // ==========================================================================

  const approvals = useMemo(() => {
    if (!params || skipApprovals) {
      return {
        token0: null,
        token1: null,
        needsERC20Approvals: false,
        needsPermit2Signature: false,
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
      let permit2Allowance: { amount: bigint; expiration: number; nonce: number } | undefined;

      if (!needsERC20Approval && permitData) {
        const [amount, expiration, nonce] = permitData;
        permit2Allowance = { amount, expiration: Number(expiration), nonce: Number(nonce) };
        needsPermit2Signature = amount < amountWei || Number(expiration) < now;
      }

      return {
        tokenSymbol,
        tokenAddress: getAddress(tokenConfig.address) as Address,
        needsERC20Approval,
        needsPermit2Signature,
        currentAllowance,
        requiredAmount: amountWei,
        permit2Allowance,
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

    return {
      token0: token0Status,
      token1: token1Status,
      needsERC20Approvals: (token0Status?.needsERC20Approval ?? false) || (token1Status?.needsERC20Approval ?? false),
      needsPermit2Signature: (token0Status?.needsPermit2Signature ?? false) || (token1Status?.needsPermit2Signature ?? false),
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
  ]);

  // ==========================================================================
  // Build Permit2 batch data if needed
  // ==========================================================================

  const permitBatchData = useMemo((): Permit2SignatureStep | null => {
    if (!params || !approvals.needsPermit2Signature) return null;

    const now = Math.floor(Date.now() / 1000);
    const expiration = now + 30 * 24 * 60 * 60; // 30 days
    const sigDeadline = now + 30 * 24 * 60 * 60; // 30 days

    const details: Array<{
      token: Address;
      amount: string;
      expiration: string;
      nonce: string;
    }> = [];

    // Use first token that needs permit as the primary token for the step
    let primaryToken: TokenInfo | null = null;

    if (approvals.token0?.needsPermit2Signature && approvals.token0.permit2Allowance && token0Config) {
      details.push({
        token: approvals.token0.tokenAddress,
        amount: (approvals.token0.requiredAmount + 1n).toString(),
        expiration: expiration.toString(),
        nonce: approvals.token0.permit2Allowance.nonce.toString(),
      });
      if (!primaryToken) {
        primaryToken = {
          address: getAddress(token0Config.address) as Address,
          symbol: token0Config.symbol,
          decimals: token0Config.decimals,
        };
      }
    }

    if (approvals.token1?.needsPermit2Signature && approvals.token1.permit2Allowance && token1Config) {
      details.push({
        token: approvals.token1.tokenAddress,
        amount: (approvals.token1.requiredAmount + 1n).toString(),
        expiration: expiration.toString(),
        nonce: approvals.token1.permit2Allowance.nonce.toString(),
      });
      if (!primaryToken) {
        primaryToken = {
          address: getAddress(token1Config.address) as Address,
          symbol: token1Config.symbol,
          decimals: token1Config.decimals,
        };
      }
    }

    if (details.length === 0 || !primaryToken) return null;

    return {
      type: TransactionStepType.Permit2Signature,
      domain: {
        name: 'Permit2',
        chainId: params.chainId ?? 0,
        verifyingContract: PERMIT2_ADDRESS as Address,
      },
      types: {
        PermitDetails: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint160' },
          { name: 'expiration', type: 'uint48' },
          { name: 'nonce', type: 'uint48' },
        ],
        PermitBatch: [
          { name: 'details', type: 'PermitDetails[]' },
          { name: 'spender', type: 'address' },
          { name: 'sigDeadline', type: 'uint256' },
        ],
      },
      values: {
        details,
        spender: POSITION_MANAGER as Address,
        sigDeadline: sigDeadline.toString(),
      },
      token: primaryToken,
    };
  }, [params, approvals, POSITION_MANAGER, token0Config, token1Config]);

  // ==========================================================================
  // Build result
  // ==========================================================================

  const data = useMemo(
    (): ApprovalCheckResult => ({
      token0: approvals.token0,
      token1: approvals.token1,
      permitBatchData,
      isLoading:
        isLoadingToken0 || isLoadingToken1 || isLoadingToken0Permit || isLoadingToken1Permit,
    }),
    [
      approvals.token0,
      approvals.token1,
      permitBatchData,
      isLoadingToken0,
      isLoadingToken1,
      isLoadingToken0Permit,
      isLoadingToken1Permit,
    ]
  );

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
    isLoading:
      isLoadingToken0 || isLoadingToken1 || isLoadingToken0Permit || isLoadingToken1Permit,
    refetch,
  };
}

// =============================================================================
// CONVENIENCE HOOKS - Backward compatible wrappers returning old format
// =============================================================================

/**
 * Old format returned by the legacy hooks for backward compatibility
 */
export interface LegacyApprovalResponse {
  needsToken0ERC20Approval: boolean;
  needsToken1ERC20Approval: boolean;
  needsToken0Permit: boolean;
  needsToken1Permit: boolean;
  permitBatchData?: any;
  signatureDetails?: any;
}

function transformToLegacyFormat(data: ApprovalCheckResult): LegacyApprovalResponse {
  return {
    needsToken0ERC20Approval: data.token0?.needsERC20Approval ?? false,
    needsToken1ERC20Approval: data.token1?.needsERC20Approval ?? false,
    needsToken0Permit: data.token0?.needsPermit2Signature ?? false,
    needsToken1Permit: data.token1?.needsPermit2Signature ?? false,
    permitBatchData: data.permitBatchData,
    signatureDetails: data.permitBatchData ? {
      domain: data.permitBatchData.domain,
      types: data.permitBatchData.types,
      primaryType: 'PermitBatch',
      message: data.permitBatchData.values,
    } : undefined,
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

