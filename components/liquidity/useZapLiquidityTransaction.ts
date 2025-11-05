/**
 * Hook for managing single-token zap liquidity transactions
 * Handles: Calculate → Swap → Mint flow with separate Permit2 signatures
 */

import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSignTypedData } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, OctagonX } from 'lucide-react';
import React from 'react';
import { TokenSymbol, TOKEN_DEFINITIONS } from '@/lib/pools-config';
import { PERMIT2_ADDRESS, getPermit2Domain, PERMIT_TYPES } from '@/lib/swap-constants';
import { PERMIT2_TYPES } from '@/lib/liquidity-utils';
import { ERC20_ABI } from '@/lib/abis/erc20';
import { type Hex, maxUint256, formatUnits } from 'viem';
import { publicClient } from '@/lib/viemClient';
import { invalidateAfterTx } from '@/lib/invalidation';
import { invalidateActivityCache, invalidateUserPositionsCache, invalidateUserPositionIdsCache } from '@/lib/client-cache';

export interface UseZapLiquidityTransactionProps {
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  inputAmount: string; // Single input amount
  inputTokenSymbol: TokenSymbol; // Which token user is providing
  tickLower: string;
  tickUpper: string;
  calculatedData: any; // From calculate-amounts endpoint
  onLiquidityAdded: (token0Symbol?: string, token1Symbol?: string, txInfo?: { txHash: `0x${string}`; blockNumber?: bigint }) => void;
}

export function useZapLiquidityTransaction({
  token0Symbol,
  token1Symbol,
  inputAmount,
  inputTokenSymbol,
  tickLower,
  tickUpper,
  calculatedData,
  onLiquidityAdded,
}: UseZapLiquidityTransactionProps) {
  const queryClient = useQueryClient();
  const { address: accountAddress, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  // Zap calculation state
  const [zapCalculation, setZapCalculation] = useState<any>(null);
  const [isCalculatingZap, setIsCalculatingZap] = useState(false);

  // Swap approval state
  const [swapApprovalData, setSwapApprovalData] = useState<any>(null);
  const [isCheckingSwapApprovals, setIsCheckingSwapApprovals] = useState(false);

  // Mint approval state
  const [mintApprovalData, setMintApprovalData] = useState<any>(null);
  const [isCheckingMintApprovals, setIsCheckingMintApprovals] = useState(false);

  // Transaction state
  const [swapTxHash, setSwapTxHash] = useState<Hex | undefined>();
  const [isSwapConfirming, setIsSwapConfirming] = useState(false);
  const [isSwapSuccess, setIsSwapSuccess] = useState(false);

  // Wagmi hooks for ERC20 approvals
  const {
    data: approveTxHash,
    writeContractAsync: approveAsync,
    isPending: isApprovePending,
    reset: resetApprove,
  } = useWriteContract();

  const { isLoading: isApproving, isSuccess: isApproved } = useWaitForTransactionReceipt({ hash: approveTxHash });

  // Wagmi hooks for swap transaction
  const {
    data: swapWriteTxHash,
    writeContractAsync: swapAsync,
    isPending: isSwapPending,
    reset: resetSwap,
  } = useWriteContract();

  // Wagmi hooks for mint/deposit transaction
  const {
    data: depositTxHash,
    writeContractAsync: depositAsync,
    isPending: isDepositPending,
    reset: resetDeposit,
  } = useWriteContract();

  const {
    isLoading: isDepositConfirming,
    isSuccess: isDepositSuccess,
  } = useWaitForTransactionReceipt({ hash: depositTxHash });

  // Calculate zap amounts
  const calculateZapAmounts = useCallback(async () => {
    if (!accountAddress || !chainId || !inputAmount || parseFloat(inputAmount) <= 0) {
      return;
    }

    setIsCalculatingZap(true);

    try {
      const response = await fetch('/api/liquidity/calculate-zap-amounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token0Symbol,
          token1Symbol,
          inputAmount,
          inputTokenSymbol,
          userTickLower: parseInt(tickLower),
          userTickUpper: parseInt(tickUpper),
          chainId,
          slippageTolerance: 50, // 0.5%
        }),
      });

      const result = await response.json();

      if (response.ok && !result.error) {
        setZapCalculation(result);
        return result;
      } else {
        throw new Error(result.error || 'Failed to calculate zap amounts');
      }
    } catch (error: any) {
      console.error('[calculateZapAmounts] Error:', error);
      toast.error('Calculation Failed', {
        icon: React.createElement(OctagonX, { className: 'h-4 w-4 text-red-500' }),
        description: error.message,
      });
      return null;
    } finally {
      setIsCalculatingZap(false);
    }
  }, [accountAddress, chainId, token0Symbol, token1Symbol, inputAmount, inputTokenSymbol, tickLower, tickUpper]);

  // Check swap approvals
  const checkSwapApprovals = useCallback(async (swapAmount: string, permitSignature?: string) => {
    if (!accountAddress || !chainId || !zapCalculation) {
      return;
    }

    setIsCheckingSwapApprovals(true);

    try {
      const outputTokenSymbol = inputTokenSymbol === token0Symbol ? token1Symbol : token0Symbol;

      const response = await fetch('/api/liquidity/prepare-zap-swap-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: accountAddress,
          inputTokenSymbol,
          outputTokenSymbol,
          swapAmount: zapCalculation.optimalSwapAmount,
          minOutputAmount: zapCalculation.minSwapOutput,
          chainId,
          slippageTolerance: 50,
          ...(permitSignature && {
            permitSignature,
            permitNonce: swapApprovalData?.permitData?.nonce,
            permitExpiration: swapApprovalData?.permitData?.expiration,
            permitSigDeadline: swapApprovalData?.permitData?.sigDeadline,
          }),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setSwapApprovalData(result);
        return result;
      } else {
        throw new Error(result.error || 'Failed to check swap approvals');
      }
    } catch (error: any) {
      console.error('[checkSwapApprovals] Error:', error);
      toast.error('Approval Check Failed', {
        icon: React.createElement(OctagonX, { className: 'h-4 w-4 text-red-500' }),
        description: error.message,
      });
      return null;
    } finally {
      setIsCheckingSwapApprovals(false);
    }
  }, [accountAddress, chainId, zapCalculation, inputTokenSymbol, token0Symbol, token1Symbol, swapApprovalData]);

  // Check mint approvals (after swap completes)
  const checkMintApprovals = useCallback(async (calculationData?: any, permitSignature?: string) => {
    const calcToUse = calculationData || zapCalculation;

    if (!accountAddress || !chainId || !calcToUse) {
      console.log('[checkMintApprovals] Missing required data:', { accountAddress, chainId, calcToUse });
      return null;
    }

    setIsCheckingMintApprovals(true);

    try {
      const response = await fetch('/api/liquidity/prepare-mint-after-swap-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: accountAddress,
          token0Symbol,
          token1Symbol,
          token0Amount: calcToUse.expectedToken0Amount,
          token1Amount: calcToUse.expectedToken1Amount,
          userTickLower: parseInt(tickLower),
          userTickUpper: parseInt(tickUpper),
          chainId,
          slippageTolerance: 50,
          ...(permitSignature && {
            permitSignature,
            permitBatchData: mintApprovalData?.permitBatchData,
          }),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setMintApprovalData(result);
        return result;
      } else {
        throw new Error(result.error || 'Failed to check mint approvals');
      }
    } catch (error: any) {
      console.error('[checkMintApprovals] Error:', error);
      toast.error('Approval Check Failed', {
        icon: React.createElement(OctagonX, { className: 'h-4 w-4 text-red-500' }),
        description: error.message,
      });
      return null;
    } finally {
      setIsCheckingMintApprovals(false);
    }
  }, [accountAddress, chainId, zapCalculation, token0Symbol, token1Symbol, tickLower, tickUpper, mintApprovalData]);

  // Approve token to Permit2
  const handleApprove = useCallback(async (tokenSymbol: TokenSymbol) => {
    const tokenConfig = TOKEN_DEFINITIONS[tokenSymbol];
    if (!tokenConfig || !accountAddress) return;

    try {
      const hash = await approveAsync({
        address: tokenConfig.address as Hex,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS, maxUint256],
      });

      toast('Approval Submitted', {
        description: `Approving ${tokenSymbol} for Permit2...`,
      });

      await publicClient.waitForTransactionReceipt({ hash });

      toast.success('Approval Confirmed', {
        icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
        description: `${tokenSymbol} approved successfully`,
      });

      return hash;
    } catch (error: any) {
      console.error('[handleApprove] Error:', error);
      throw error;
    }
  }, [accountAddress, approveAsync]);

  // Sign swap Permit2 signature
  const signSwapPermit = useCallback(async (): Promise<string | undefined> => {
    // Check if we actually need a permit signature
    if (!swapApprovalData || !swapApprovalData.needsApproval || swapApprovalData.approvalType !== 'PERMIT2_SIGNATURE') {
      console.log('[signSwapPermit] No permit signature needed');
      return undefined;
    }

    const permitDataToUse = swapApprovalData.permitData;
    if (!permitDataToUse) {
      throw new Error('No permit data available when signature is required');
    }

    try {
      // Use domain and types from API response (like swap flow does)
      const signature = await signTypedDataAsync({
        domain: permitDataToUse.domain,
        types: permitDataToUse.types,
        primaryType: 'PermitSingle',
        message: permitDataToUse.message,
      });

      return signature;
    } catch (error: any) {
      console.error('[signSwapPermit] Error:', error);
      throw error;
    }
  }, [swapApprovalData, signTypedDataAsync, zapCalculation, checkSwapApprovals]);

  // Sign mint PermitBatch signature
  const signMintPermit = useCallback(async (): Promise<string | undefined> => {
    // Check current state or fetch fresh data
    let dataToUse = mintApprovalData;

    if (!dataToUse) {
      console.log('[signMintPermit] No mint approval data, checking approvals first...');
      dataToUse = await checkMintApprovals();
      if (!dataToUse) {
        throw new Error('Failed to check mint approvals');
      }
    }

    // If approvals not needed (transaction ready), return undefined
    if (!dataToUse.needsApproval) {
      console.log('[signMintPermit] Mint transaction ready, no permit needed');
      return undefined;
    }

    // If we need ERC20 approval, that should have been handled already
    if (dataToUse.approvalType === 'ERC20_TO_PERMIT2') {
      throw new Error('ERC20 approval should have been completed before signing permit');
    }

    // Get permit batch data for signing
    const permitBatchDataToUse = dataToUse.permitBatchData;
    if (!permitBatchDataToUse) {
      throw new Error('No permit batch data available for mint signature');
    }

    try {
      // Use domain, types, and message from API response (like swap flow does)
      const signature = await signTypedDataAsync({
        domain: permitBatchDataToUse.domain,
        types: permitBatchDataToUse.types,
        primaryType: 'PermitBatch',
        message: permitBatchDataToUse.message || permitBatchDataToUse.values, // Support both formats
      });

      return signature;
    } catch (error: any) {
      console.error('[signMintPermit] Error:', error);
      throw error;
    }
  }, [mintApprovalData, signTypedDataAsync, checkMintApprovals]);

  // Execute swap
  const executeSwap = useCallback(async (permitSignature?: string): Promise<string> => {
    if (!zapCalculation?.optimalSwapAmount) {
      throw new Error('No zap calculation available');
    }

    try {
      // Fetch transaction data with signature (if provided)
      const finalSwapData = await checkSwapApprovals(zapCalculation.optimalSwapAmount, permitSignature || undefined);

      if (!finalSwapData?.transaction) {
        throw new Error('Failed to prepare swap transaction');
      }

      const hash = await swapAsync({
        address: finalSwapData.transaction.to as Hex,
        abi: [{
          name: 'execute',
          type: 'function',
          stateMutability: finalSwapData.transaction.value && finalSwapData.transaction.value !== '0' ? 'payable' : 'nonpayable',
          inputs: [
            { name: 'commands', type: 'bytes' },
            { name: 'inputs', type: 'bytes[]' },
            { name: 'deadline', type: 'uint256' }
          ],
          outputs: [],
        }],
        functionName: 'execute',
        args: [
          finalSwapData.transaction.commands as Hex,
          finalSwapData.transaction.inputs as Hex[],
          BigInt(finalSwapData.transaction.deadline)
        ],
        ...(finalSwapData.transaction.value && finalSwapData.transaction.value !== '0' && {
          value: BigInt(finalSwapData.transaction.value)
        }),
      });

      setSwapTxHash(hash);
      setIsSwapConfirming(true);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      setIsSwapSuccess(true);
      setIsSwapConfirming(false);

      toast.success('Swap Confirmed', {
        icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
        description: 'Swap completed successfully',
      });

      return hash;
    } catch (error: any) {
      setIsSwapConfirming(false);
      console.error('[executeSwap] Error:', error);
      throw error;
    }
  }, [swapApprovalData, zapCalculation, checkSwapApprovals, swapAsync]);

  // Execute deposit (mint)
  const executeDeposit = useCallback(async (permitSignature?: string): Promise<void> => {
    try {
      // Fetch transaction data with signature (if provided)
      const finalMintData = await checkMintApprovals(permitSignature || undefined);

      if (!finalMintData?.transaction) {
        throw new Error('Failed to prepare mint transaction');
      }

      const hash = await depositAsync({
        address: finalMintData.transaction.to as Hex,
        abi: [{
          name: 'multicall',
          type: 'function',
          stateMutability: finalMintData.transaction.value && finalMintData.transaction.value !== '0' ? 'payable' : 'nonpayable',
          inputs: [{ name: 'data', type: 'bytes[]' }],
          outputs: [{ name: 'results', type: 'bytes[]' }],
        }],
        functionName: 'multicall',
        args: [[finalMintData.transaction.data as Hex]],
        ...(finalMintData.transaction.value && finalMintData.transaction.value !== '0' && {
          value: BigInt(finalMintData.transaction.value)
        }),
      });

      // Wait for confirmation is handled by useWaitForTransactionReceipt

    } catch (error: any) {
      console.error('[executeDeposit] Error:', error);
      throw error;
    }
  }, [mintApprovalData, checkMintApprovals, depositAsync]);

  // Success handler
  useEffect(() => {
    if (isDepositSuccess && depositTxHash) {
      const handleSuccess = async () => {
        toast.success('Liquidity Added Successfully!', {
          icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
        });

        // Invalidate caches
        invalidateAfterTx(queryClient, { owner: accountAddress! });
        invalidateActivityCache(accountAddress!);
        invalidateUserPositionsCache(accountAddress!);
        invalidateUserPositionIdsCache(accountAddress!);

        // Callback
        onLiquidityAdded(token0Symbol, token1Symbol, { txHash: depositTxHash });
      };

      handleSuccess();
    }
  }, [isDepositSuccess, depositTxHash, queryClient, accountAddress, token0Symbol, token1Symbol, onLiquidityAdded]);

  // Reset function
  const reset = useCallback(() => {
    resetApprove();
    resetSwap();
    resetDeposit();
    setZapCalculation(null);
    setSwapApprovalData(null);
    setMintApprovalData(null);
    setSwapTxHash(undefined);
    setIsSwapConfirming(false);
    setIsSwapSuccess(false);
  }, [resetApprove, resetSwap, resetDeposit]);

  // Combined approval data for UI - structured for the new flow
  const combinedApprovalData = useMemo(() => {
    // Determine what approvals we need
    const inputIsNative = inputTokenSymbol === 'FTM';
    const outputIsNative = (inputTokenSymbol === token0Symbol ? token1Symbol : token0Symbol) === 'FTM';

    // Determine which token currently needs approval from mintApprovalData
    const mintNeedsToken0 = mintApprovalData?.needsApproval &&
                            mintApprovalData?.approvalType === 'ERC20_TO_PERMIT2' &&
                            mintApprovalData?.approvalTokenSymbol === token0Symbol;
    const mintNeedsToken1 = mintApprovalData?.needsApproval &&
                            mintApprovalData?.approvalType === 'ERC20_TO_PERMIT2' &&
                            mintApprovalData?.approvalTokenSymbol === token1Symbol;
    // Check if API indicated the other token also needs approval
    const bothTokensNeedApproval = mintApprovalData?.token1AlsoNeedsApproval;

    // For input token: check if it's the one currently needing approval OR if it's indicated as also needing approval
    const inputNeedsApproval = !inputIsNative && (
      (swapApprovalData?.needsApproval && swapApprovalData?.approvalType === 'ERC20_TO_PERMIT2') ||
      ((inputTokenSymbol === token0Symbol && mintNeedsToken0) || (inputTokenSymbol === token1Symbol && mintNeedsToken1))
    );

    // For output token: check if it's the one currently needing approval OR if both need approval
    const outputNeedsApproval = !outputIsNative && (
      ((inputTokenSymbol === token0Symbol && mintNeedsToken1) || (inputTokenSymbol === token1Symbol && mintNeedsToken0)) ||
      bothTokensNeedApproval
    );

    return {
      // Step 1: Input token approval (if not native)
      inputNeedsERC20Approval: inputNeedsApproval,

      // Step 2: Output token approval
      outputNeedsERC20Approval: outputNeedsApproval,

      // Step 3: Swap needs permit signature (if not native and not sufficient allowance)
      swapNeedsPermit: !inputIsNative && swapApprovalData?.needsApproval && swapApprovalData?.approvalType === 'PERMIT2_SIGNATURE',

      // Helper data for UI
      swapReady: swapApprovalData && !swapApprovalData.needsApproval,
      mintReady: mintApprovalData && !mintApprovalData.needsApproval,
    };
  }, [swapApprovalData, mintApprovalData, inputTokenSymbol, token0Symbol, token1Symbol]);

  return {
    // Calculation
    zapCalculation,
    isCalculatingZap,
    calculateZapAmounts,

    // Approvals
    swapApprovalData,
    mintApprovalData,
    combinedApprovalData,
    isCheckingSwapApprovals,
    isCheckingMintApprovals,
    checkSwapApprovals,
    checkMintApprovals,

    // Actions
    handleApprove,
    signSwapPermit,
    signMintPermit,
    executeSwap,
    executeDeposit,

    // State
    isApproving,
    isSwapConfirming,
    isSwapSuccess,
    swapTxHash,
    isDepositConfirming,
    isDepositSuccess,

    // Utility
    isWorking: isApprovePending || isApproving || isSwapPending || isSwapConfirming || isDepositPending || isDepositConfirming,
    reset,
  };
}
