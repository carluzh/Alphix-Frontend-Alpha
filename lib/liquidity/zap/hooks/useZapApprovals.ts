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

import { PSM_CONFIG, USDS_USDC_POOL_CONFIG, PERMIT2_ADDRESS, USDC_TO_USDS_MULTIPLIER, USDS_TO_USDC_DIVISOR } from '../constants';
import type { ZapToken, ZapSwapRoute, ZapApprovalStatus, RouteDetails } from '../types';

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
      route ? `${route.type}-${route.priceImpact}-${route.feeBps}` : undefined,
      hookAddress,
      inputAmount?.toString(),
    ],
    queryFn: async (): Promise<ZapApprovalStatus> => {
      if (!userAddress || !inputToken || !swapAmount || !route || !hookAddress || !publicClient) {
        throw new Error('Missing required parameters');
      }

      // Determine token addresses
      const inputTokenAddress =
        inputToken === 'USDS'
          ? USDS_USDC_POOL_CONFIG.token0.address
          : USDS_USDC_POOL_CONFIG.token1.address;

      const outputToken: ZapToken = inputToken === 'USDS' ? 'USDC' : 'USDS';
      const outputTokenAddress =
        outputToken === 'USDS'
          ? USDS_USDC_POOL_CONFIG.token0.address
          : USDS_USDC_POOL_CONFIG.token1.address;

      // Determine swap spender based on route type
      const swapSpender = route.type === 'psm' ? PSM_CONFIG.address : PERMIT2_ADDRESS;

      // Fetch all allowances in parallel
      const [inputAllowanceForSwap, token0AllowanceForHook, token1AllowanceForHook] =
        await Promise.all([
          // Input token allowance for swap
          publicClient.readContract({
            address: inputTokenAddress,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [userAddress, swapSpender],
          }),
          // USDS allowance for Hook
          publicClient.readContract({
            address: USDS_USDC_POOL_CONFIG.token0.address,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [userAddress, hookAddress],
          }),
          // USDC allowance for Hook
          publicClient.readContract({
            address: USDS_USDC_POOL_CONFIG.token1.address,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [userAddress, hookAddress],
          }),
        ]);

      // Calculate required amounts
      // For swap: need to approve the swap amount
      const requiredSwapApproval = swapAmount;

      // For deposit: estimate required amounts after swap
      // The remaining input + swap output will be deposited
      const remainingInput = inputAmount ? inputAmount - swapAmount : 0n;

      // Calculate estimated output amount with correct decimals
      const estimatedSwapOutput =
        inputToken === 'USDC'
          ? swapAmount * USDC_TO_USDS_MULTIPLIER
          : swapAmount / USDS_TO_USDC_DIVISOR;

      // For deposit amounts:
      // - token0 (USDS, 18 dec): If input is USDS, use remainingInput. If input is USDC, use swap output (converted to 18 dec).
      // - token1 (USDC, 6 dec): If input is USDC, use remainingInput. If input is USDS, use swap output (converted to 6 dec).
      const estimatedToken0ForDeposit =
        inputToken === 'USDS' ? remainingInput : estimatedSwapOutput;
      const estimatedToken1ForDeposit =
        inputToken === 'USDC' ? remainingInput : estimatedSwapOutput;

      // Check if approvals are sufficient
      const inputTokenApprovedForSwap = inputAllowanceForSwap >= requiredSwapApproval;
      const token0ApprovedForHook = token0AllowanceForHook >= estimatedToken0ForDeposit;
      const token1ApprovedForHook = token1AllowanceForHook >= estimatedToken1ForDeposit;

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
    descriptions.push('Approve USDS for deposit');
  }
  if (!approvals.token1ApprovedForHook) {
    descriptions.push('Approve USDC for deposit');
  }

  return descriptions;
}
