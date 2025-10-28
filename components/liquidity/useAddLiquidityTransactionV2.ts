// Refactored Add Liquidity Transaction Hook (Uniswap-style)
import { useCallback, useState, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, OctagonX, InfoIcon } from 'lucide-react';
import React from 'react';
import { TokenSymbol, TOKEN_DEFINITIONS } from '@/lib/pools-config';
import { PERMIT2_ADDRESS } from '@/lib/swap-constants';
import { ERC20_ABI } from '@/lib/abis/erc20';
import { type Hex, maxUint256, formatUnits } from 'viem';
import { publicClient } from '@/lib/viemClient';
import { prefetchService } from '@/lib/prefetch-service';
import { invalidateAfterTx } from '@/lib/invalidation';
import { invalidateActivityCache, invalidateUserPositionsCache, invalidateUserPositionIdsCache } from '@/lib/client-cache';
import { clearBatchDataCache } from '@/lib/cache-version';
import { useCheckLiquidityApprovals } from './useCheckLiquidityApprovals';

export interface UseAddLiquidityTransactionV2Props {
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  amount0: string;
  amount1: string;
  tickLower: string;
  tickUpper: string;
  activeInputSide: 'amount0' | 'amount1' | null;
  calculatedData: any;
  onLiquidityAdded: (token0Symbol?: string, token1Symbol?: string, txInfo?: { txHash: `0x${string}`; blockNumber?: bigint }) => void;
  onOpenChange: (isOpen: boolean) => void;
}

export function useAddLiquidityTransactionV2({
  token0Symbol,
  token1Symbol,
  amount0,
  amount1,
  tickLower,
  tickUpper,
  activeInputSide,
  calculatedData,
  onLiquidityAdded,
  onOpenChange,
}: UseAddLiquidityTransactionV2Props) {
  const queryClient = useQueryClient();
  const { address: accountAddress, chainId } = useAccount();

  // Check approvals using React Query
  const {
    data: approvalData,
    isLoading: isCheckingApprovals,
    refetch: refetchApprovals,
  } = useCheckLiquidityApprovals(
    accountAddress && chainId && calculatedData
      ? {
          userAddress: accountAddress,
          token0Symbol,
          token1Symbol,
          amount0: formatUnits(BigInt(calculatedData.amount0 || '0'), TOKEN_DEFINITIONS[token0Symbol]?.decimals || 18),
          amount1: formatUnits(BigInt(calculatedData.amount1 || '0'), TOKEN_DEFINITIONS[token1Symbol]?.decimals || 18),
          chainId,
          tickLower: calculatedData.finalTickLower ?? parseInt(tickLower),
          tickUpper: calculatedData.finalTickUpper ?? parseInt(tickUpper),
        }
      : undefined,
    {
      enabled: Boolean(accountAddress && chainId && calculatedData && BigInt(calculatedData.amount0 || '0') > 0n && BigInt(calculatedData.amount1 || '0') > 0n),
      staleTime: 5000,
    }
  );

  // Wagmi hooks for ERC20 approvals
  const {
    data: approveTxHash,
    writeContractAsync: approveAsync,
    isPending: isApprovePending,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();

  const { isLoading: isApproving, isSuccess: isApproved } = useWaitForTransactionReceipt({ hash: approveTxHash });

  // Wagmi hooks for deposit transaction
  const {
    data: depositTxHash,
    writeContractAsync: depositAsync,
    isPending: isDepositPending,
    error: depositError,
    reset: resetDeposit,
  } = useWriteContract();

  const {
    isLoading: isDepositConfirming,
    isSuccess: isDepositConfirmed,
    isError: isDepositError,
    error: depositReceiptError,
  } = useWaitForTransactionReceipt({ hash: depositTxHash });

  const [isWorking, setIsWorking] = useState(false);
  const processedDepositHashRef = useRef<string | null>(null);
  const processedFailedHashRef = useRef<string | null>(null);

  // Handle ERC20 approval for a specific token
  const handleApprove = useCallback(
    async (tokenSymbol: TokenSymbol) => {
      const tokenConfig = TOKEN_DEFINITIONS[tokenSymbol];
      if (!tokenConfig) throw new Error(`Token ${tokenSymbol} not found`);

      toast('Confirm in Wallet', {
        icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
      });

      const hash = await approveAsync({
        address: tokenConfig.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS, maxUint256],
      });

      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash });

      toast.success(`${tokenSymbol} Approved`, {
        icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
        description: `Approved infinite ${tokenSymbol} for liquidity`,
        action: {
          label: 'View Transaction',
          onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, '_blank'),
        },
      });

      // Refetch approvals after successful approval
      await refetchApprovals();
    },
    [approveAsync, refetchApprovals]
  );

  // Handle deposit transaction (with optional permit signature)
  const handleDeposit = useCallback(
    async (permitSignature?: string) => {
      if (!accountAddress || !chainId) throw new Error('Wallet not connected');

      // Validate that if permits are needed, signature must be provided
      if ((approvalData?.needsToken0Permit || approvalData?.needsToken1Permit) && !permitSignature) {
        throw new Error('Permit signature required but not provided');
      }

      setIsWorking(true);

      try {
        const tl = calculatedData?.finalTickLower ?? parseInt(tickLower);
        const tu = calculatedData?.finalTickUpper ?? parseInt(tickUpper);
        const currentTick = calculatedData?.currentPoolTick;

        let finalAmount0 = amount0;
        let finalAmount1 = amount1;

        if (currentTick !== null && currentTick !== undefined && !isNaN(tl) && !isNaN(tu)) {
          const isOOR = currentTick < tl || currentTick > tu;
          if (isOOR) {
            if (currentTick >= tu) {
              finalAmount0 = '0';
            } else if (currentTick <= tl) {
              finalAmount1 = '0';
            }
          }
        }

        const inputAmount = finalAmount0 && parseFloat(finalAmount0) > 0 ? finalAmount0 : finalAmount1;
        const inputTokenSymbol = finalAmount0 && parseFloat(finalAmount0) > 0 ? token0Symbol : token1Symbol;

        const requestBody: any = {
          userAddress: accountAddress,
          token0Symbol,
          token1Symbol,
          inputAmount,
          inputTokenSymbol,
          userTickLower: tl,
          userTickUpper: tu,
          chainId,
        };

        // If we have a permit signature, include it
        if (permitSignature && approvalData?.permitBatchData) {
          requestBody.permitSignature = permitSignature;
          requestBody.permitBatchData = approvalData.permitBatchData;
        }

        const response = await fetch('/api/liquidity/prepare-mint-tx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to prepare transaction');
        }

        const result = await response.json();

        // Check if API is requesting permit signature (should not happen if flow is correct)
        if (result.needsApproval && result.approvalType === 'PERMIT2_BATCH_SIGNATURE') {
          console.error('[handleDeposit] API returned permit request but permit should have been obtained already');
          throw new Error('Permit signature required. Please refresh and try again.');
        }

        if (!result.transaction || !result.transaction.to || !result.transaction.data) {
          console.error('[handleDeposit] Invalid API response:', result);
          throw new Error('Invalid transaction data from API');
        }

        toast('Confirm Deposit', {
          icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
        });

        // Use writeContractAsync for multicall
        const depositConfig: any = {
          address: result.transaction.to as `0x${string}`,
          abi: [
            {
              name: 'multicall',
              type: 'function',
              stateMutability: result.transaction.value ? 'payable' : 'nonpayable',
              inputs: [{ name: 'data', type: 'bytes[]' }],
              outputs: [{ name: 'results', type: 'bytes[]' }],
            },
          ],
          functionName: 'multicall',
          args: [[result.transaction.data as Hex]],
        };

        // Only add value if it exists
        if (result.transaction.value) {
          depositConfig.value = BigInt(result.transaction.value);
        }

        const hash = await depositAsync(depositConfig);

        // Note: onLiquidityAdded will be called after confirmation in the useEffect below
        // This prevents duplicate skeleton creation
      } catch (error: any) {
        console.error('Deposit error:', error);

        const isUserRejection =
          error.message?.toLowerCase().includes('user rejected') ||
          error.message?.toLowerCase().includes('user denied') ||
          error.code === 4001;

        if (isUserRejection) {
          toast.error('Transaction Rejected', {
            icon: React.createElement(OctagonX, { className: 'h-4 w-4 text-red-500' }),
            description: 'The request was rejected in your wallet.',
          });
        } else {
          toast.error('Transaction Failed', {
            icon: React.createElement(OctagonX, { className: 'h-4 w-4 text-red-500' }),
            description: error.message || 'Unknown error',
            action: {
              label: 'Copy Error',
              onClick: () => navigator.clipboard.writeText(error.message || ''),
            },
          });
        }

        throw error;
      } finally {
        setIsWorking(false);
      }
    },
    [accountAddress, chainId, token0Symbol, token1Symbol, amount0, amount1, tickLower, tickUpper, calculatedData, approvalData, depositAsync, onLiquidityAdded]
  );

  // Handle deposit transaction failure
  React.useEffect(() => {
    if (isDepositError && depositTxHash) {
      // Guard against duplicate processing
      if (processedFailedHashRef.current === depositTxHash) return;
      processedFailedHashRef.current = depositTxHash;

      console.error('Transaction reverted:', depositTxHash, depositReceiptError);

      toast.error('Transaction Failed', {
        icon: React.createElement(OctagonX, { className: 'h-4 w-4 text-red-500' }),
        description: `Transaction was submitted but reverted on-chain.`,
        action: {
          label: 'View on Explorer',
          onClick: () => window.open(`https://sepolia.basescan.org/tx/${depositTxHash}`, '_blank'),
        },
      });

      setIsWorking(false);
    }
  }, [isDepositError, depositTxHash, depositReceiptError]);

  // Handle successful deposit confirmation
  React.useEffect(() => {
    if (isDepositConfirmed && depositTxHash && accountAddress) {
      // Guard against duplicate processing
      if (processedDepositHashRef.current === depositTxHash) return;
      processedDepositHashRef.current = depositTxHash;

      toast.success('Position Created', {
        icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
        description: `Liquidity added to ${token0Symbol}/${token1Symbol} pool successfully`,
        action: {
          label: 'View Transaction',
          onClick: () => window.open(`https://sepolia.basescan.org/tx/${depositTxHash}`, '_blank'),
        },
      });

      // Refresh balances
      localStorage.setItem(`walletBalancesRefreshAt_${accountAddress}`, String(Date.now()));
      window.dispatchEvent(new Event('walletBalancesRefresh'));

      // Invalidate caches
      (async () => {
        try {
          let blockNumber: bigint | undefined;
          const receipt = await publicClient.getTransactionReceipt({ hash: depositTxHash as `0x${string}` });
          blockNumber = receipt?.blockNumber;

          onLiquidityAdded(token0Symbol, token1Symbol, { txHash: depositTxHash as `0x${string}`, blockNumber });

          prefetchService.notifyPositionsRefresh(accountAddress, 'mint');
          invalidateActivityCache(accountAddress);
          invalidateUserPositionsCache(accountAddress);
          invalidateUserPositionIdsCache(accountAddress);
          clearBatchDataCache();
          invalidateAfterTx(queryClient, { owner: accountAddress, reason: 'mint' });
        } catch (e) {
          console.error('Cache invalidation error:', e);
        }
      })();

      onOpenChange(false);
    }
  }, [isDepositConfirmed, depositTxHash, accountAddress, token0Symbol, token1Symbol, onLiquidityAdded, onOpenChange, queryClient]);

  const resetAll = React.useCallback(() => {
    resetApprove();
    resetDeposit();
    setIsWorking(false);
    processedDepositHashRef.current = null;
  }, [resetApprove, resetDeposit]);

  return {
    approvalData,
    isCheckingApprovals,
    isWorking: isWorking || isApprovePending || isApproving || isDepositPending || isDepositConfirming,
    isApproving,
    isDepositConfirming,
    isDepositSuccess: isDepositConfirmed,
    handleApprove,
    handleDeposit,
    refetchApprovals,
    reset: resetAll,
  };
}
