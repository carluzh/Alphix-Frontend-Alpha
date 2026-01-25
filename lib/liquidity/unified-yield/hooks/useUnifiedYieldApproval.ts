/**
 * Unified Yield Approval Execution Hook
 *
 * Handles ERC20 approval execution for Unified Yield deposits.
 * Approves tokens to the Hook contract (not Permit2).
 */

import { useCallback, useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { type Address, type Hash, maxUint256 } from 'viem';
import { toast } from 'sonner';
import { IconBadgeCheck2 } from 'nucleo-micro-bold-essential';
import React from 'react';

import { ERC20_ABI } from '@/lib/abis/erc20';
import { getExplorerTxUrl } from '@/lib/wagmiConfig';
import { isInfiniteApprovalEnabled } from '@/hooks/useUserSettings';

export interface UseUnifiedYieldApprovalParams {
  /** Hook contract address (approval target) */
  hookAddress?: Address;
  /** Token address to approve */
  tokenAddress?: Address;
  /** Token symbol for display */
  tokenSymbol?: string;
  /** Amount needed (in wei) */
  amountWei?: bigint;
}

export interface UseUnifiedYieldApprovalResult {
  /** Execute approval transaction */
  approve: () => Promise<Hash | undefined>;
  /** Current transaction hash */
  txHash: Hash | undefined;
  /** Whether approval is pending wallet signature */
  isPending: boolean;
  /** Whether approval is confirming */
  isConfirming: boolean;
  /** Whether approval succeeded */
  isSuccess: boolean;
  /** Whether approval failed */
  isError: boolean;
  /** Error if any */
  error: Error | null;
  /** Reset state */
  reset: () => void;
}

/**
 * Hook for executing Unified Yield token approvals
 *
 * @param params - Approval parameters
 * @returns Approval execution controls and state
 */
export function useUnifiedYieldApproval(
  params?: UseUnifiedYieldApprovalParams
): UseUnifiedYieldApprovalResult {
  const { address: userAddress } = useAccount();
  const publicClient = usePublicClient();
  const [error, setError] = useState<Error | null>(null);

  const {
    data: txHash,
    writeContractAsync,
    isPending: isWritePending,
    isError: isWriteError,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const approve = useCallback(async (): Promise<Hash | undefined> => {
    setError(null);

    if (!params?.hookAddress || !params?.tokenAddress) {
      const err = new Error('Missing hook or token address');
      setError(err);
      return undefined;
    }

    if (!userAddress) {
      const err = new Error('Wallet not connected');
      setError(err);
      return undefined;
    }

    try {
      // Determine approval amount - infinite or exact
      let approvalAmount = maxUint256;
      if (!isInfiniteApprovalEnabled() && params.amountWei && params.amountWei > 0n) {
        // Add 1% buffer for price movements
        approvalAmount = (params.amountWei * 101n) / 100n;
      }

      const hash = await writeContractAsync({
        address: params.tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [params.hookAddress, approvalAmount],
      });

      if (hash) {
        // Show success toast
        toast.success(`${params.tokenSymbol || 'Token'} Approved`, {
          icon: React.createElement(IconBadgeCheck2, { className: 'h-4 w-4 text-green-500' }),
          description: `Approved ${params.tokenSymbol || 'tokens'} for Unified Yield`,
          action: {
            label: 'View',
            onClick: () => window.open(getExplorerTxUrl(hash), '_blank'),
          },
        });
      }

      return hash;
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error('Approval failed');
      setError(error);
      return undefined;
    }
  }, [params, userAddress, writeContractAsync]);

  const reset = useCallback(() => {
    setError(null);
    resetWrite();
  }, [resetWrite]);

  return {
    approve,
    txHash,
    isPending: isWritePending,
    isConfirming,
    isSuccess: isConfirmed,
    isError: isWriteError,
    error: error || writeError || null,
    reset,
  };
}
