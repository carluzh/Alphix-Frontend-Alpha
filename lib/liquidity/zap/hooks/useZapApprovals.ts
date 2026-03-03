/**
 * useZapApprovals Hook
 *
 * Checks and tracks approval status for all tokens involved in a zap deposit.
 * This includes:
 * - Input token approval for swap (PSM or Universal Router)
 * - Both tokens approval for Hook deposit
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { type Address, erc20Abi } from 'viem';
import { usePublicClient } from 'wagmi';

import { PSM_CONFIG, USDS_USDC_POOL_CONFIG, PERMIT2_ADDRESS, getZapPoolConfigByHook } from '../constants';
import type { ZapToken, ZapSwapRoute, ZapApprovalStatus, RouteDetails } from '../types';
import { getKyberswapRouterAddress } from '@/lib/aggregators/kyberswap';
import { isNativeToken } from '@/lib/aggregators/types';

// =============================================================================
// TYPES
// =============================================================================

export interface UseZapApprovalsParams {
  /** User's wallet address */
  userAddress: Address | undefined;
  /** Token being deposited (USDS or USDC) */
  inputToken: ZapToken | undefined;
  /** Amount to swap (in wei) */
  swapAmount: bigint | undefined;
  /** Selected swap route details */
  route: RouteDetails | undefined;
  /** Hook address for deposit */
  hookAddress: Address | undefined;
  /** Total input amount for deposit calculations */
  inputAmount: bigint | undefined;
  /** Whether the query is enabled */
  enabled?: boolean;
}

export interface UseZapApprovalsReturn {
  /** Current approval status */
  approvals: ZapApprovalStatus | undefined;
  /** Whether approvals are being checked */
  isLoading: boolean;
  /** Error if approval check failed */
  error: Error | null;
  /** Refetch approvals */
  refetch: () => void;
  /** Whether all required approvals are in place */
  allApproved: boolean;
  /** Number of approval transactions needed */
  approvalsNeeded: number;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to check approval status for a zap deposit.
 *
 * @param params - Approval check parameters
 * @returns Approval status and metadata
 */
export function useZapApprovals(params: UseZapApprovalsParams): UseZapApprovalsReturn {
  const {
    userAddress,
    inputToken,
    swapAmount,
    route,
    hookAddress,
    inputAmount,
    enabled = true,
  } = params;

  const publicClient = usePublicClient();

  const query = useQuery({
    queryKey: [
      'zap-approvals',
      userAddress,
      inputToken,
      swapAmount?.toString(),
      // Serialize route to avoid BigInt in query key (sqrtPriceX96)
      route ? `${route.type}-${route.priceImpact}-${'feeBps' in route ? route.feeBps : 'n/a'}` : undefined,
      hookAddress,
      inputAmount?.toString(),
    ],
    queryFn: async (): Promise<ZapApprovalStatus> => {
      if (!userAddress || !inputToken || !swapAmount || !route || !hookAddress || !publicClient) {
        throw new Error('Missing required parameters');
      }

      // Resolve pool config
      const poolConfig = getZapPoolConfigByHook(hookAddress) ?? {
        ...USDS_USDC_POOL_CONFIG,
        fallbackRoute: 'psm' as const,
        priceImpactThreshold: 0.01,
        isPegged: true,
      };

      const isInputToken0 = inputToken === poolConfig.token0.symbol;
      const inputTokenAddress = isInputToken0 ? poolConfig.token0.address : poolConfig.token1.address;
      const isInputNative = isNativeToken(inputTokenAddress);
      const isToken0Native = isNativeToken(poolConfig.token0.address);
      const isToken1Native = isNativeToken(poolConfig.token1.address);

      // Determine swap spender based on route type
      let swapSpender: Address;
      if (route.type === 'psm') {
        swapSpender = PSM_CONFIG.address;
      } else if (route.type === 'kyberswap') {
        swapSpender = getKyberswapRouterAddress() as Address;
      } else {
        swapSpender = PERMIT2_ADDRESS;
      }

      // Fetch allowances (skip for native tokens)
      const inputAllowanceForSwap = isInputNative
        ? swapAmount // Native tokens don't need approval
        : await publicClient.readContract({
            address: inputTokenAddress,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [userAddress, swapSpender],
          });

      const token0AllowanceForHook = isToken0Native
        ? BigInt(Number.MAX_SAFE_INTEGER) // Native token: no approval needed (uses msg.value)
        : await publicClient.readContract({
            address: poolConfig.token0.address,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [userAddress, hookAddress],
          });

      const token1AllowanceForHook = isToken1Native
        ? BigInt(Number.MAX_SAFE_INTEGER)
        : await publicClient.readContract({
            address: poolConfig.token1.address,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [userAddress, hookAddress],
          });

      // Calculate required amounts
      const requiredSwapApproval = swapAmount;
      const remainingInput = inputAmount ? inputAmount - swapAmount : 0n;

      // Estimate swap output for deposit requirement calculation
      const inputDecimals = isInputToken0 ? poolConfig.token0.decimals : poolConfig.token1.decimals;
      const outputDecimals = isInputToken0 ? poolConfig.token1.decimals : poolConfig.token0.decimals;
      const decimalDiff = inputDecimals - outputDecimals;
      const estimatedSwapOutput = decimalDiff > 0
        ? swapAmount / (10n ** BigInt(decimalDiff))
        : swapAmount * (10n ** BigInt(-decimalDiff));

      const estimatedToken0ForDeposit = isInputToken0 ? remainingInput : estimatedSwapOutput;
      const estimatedToken1ForDeposit = isInputToken0 ? estimatedSwapOutput : remainingInput;

      // Check if approvals are sufficient
      const inputTokenApprovedForSwap = isInputNative || inputAllowanceForSwap >= requiredSwapApproval;
      const token0ApprovedForHook = isToken0Native || token0AllowanceForHook >= estimatedToken0ForDeposit;
      const token1ApprovedForHook = isToken1Native || token1AllowanceForHook >= estimatedToken1ForDeposit;

      return {
        inputTokenApprovedForSwap,
        token0ApprovedForHook,
        token1ApprovedForHook,
        allowances: {
          inputTokenForSwap: inputAllowanceForSwap,
          token0ForHook: token0AllowanceForHook,
          token1ForHook: token1AllowanceForHook,
        },
        required: {
          inputTokenForSwap: requiredSwapApproval,
          token0ForHook: estimatedToken0ForDeposit,
          token1ForHook: estimatedToken1ForDeposit,
        },
      };
    },
    enabled:
      enabled &&
      !!userAddress &&
      !!inputToken &&
      !!swapAmount &&
      swapAmount > 0n &&
      !!route &&
      !!hookAddress &&
      !!publicClient,
    staleTime: 10_000, // 10 seconds
    gcTime: 30_000,
    refetchInterval: 15_000, // Refetch every 15 seconds
  });

  // Calculate derived values
  const approvals = query.data;
  const allApproved = approvals
    ? approvals.inputTokenApprovedForSwap &&
      approvals.token0ApprovedForHook &&
      approvals.token1ApprovedForHook
    : false;

  const approvalsNeeded = approvals
    ? (approvals.inputTokenApprovedForSwap ? 0 : 1) +
      (approvals.token0ApprovedForHook ? 0 : 1) +
      (approvals.token1ApprovedForHook ? 0 : 1)
    : 0;

  return {
    approvals,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    allApproved,
    approvalsNeeded,
  };
}

/**
 * Get a human-readable description of needed approvals.
 *
 * @param approvals - Current approval status
 * @returns Array of approval descriptions
 */
export function getNeededApprovalDescriptions(
  approvals: ZapApprovalStatus | undefined
): string[] {
  if (!approvals) return [];

  const descriptions: string[] = [];

  if (!approvals.inputTokenApprovedForSwap) {
    descriptions.push('Approve token for swap');
  }
  if (!approvals.token0ApprovedForHook) {
    descriptions.push('Approve token0 for deposit');
  }
  if (!approvals.token1ApprovedForHook) {
    descriptions.push('Approve token1 for deposit');
  }

  return descriptions;
}
