/**
 * Add Liquidity Transaction Hook
 *
 * Handles the transaction flow for adding liquidity to V4 pools.
 */
import * as Sentry from '@sentry/nextjs';
import { useCallback, useState, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSignTypedData, useBalance, usePublicClient, useSendTransaction } from 'wagmi';
import { toast } from 'sonner';
import { IconBadgeCheck2, IconCircleXmarkFilled, IconCircleInfo } from 'nucleo-micro-bold-essential';
import React from 'react';
import { TokenSymbol, NATIVE_TOKEN_ADDRESS, getToken } from '@/lib/pools-config';
import { getExplorerTxUrl } from '@/lib/wagmiConfig';
import { PERMIT2_ADDRESS } from '@/lib/swap/swap-constants';
import { ERC20_ABI } from '@/lib/abis/erc20';
import { type Hex, maxUint256, formatUnits, parseUnits as viemParseUnits, decodeEventLog } from 'viem';
import { addPositionIdToCache } from '@/lib/client-cache';
import { position_manager_abi } from '@/lib/abis/PositionManager_abi';
import { useCheckMintApprovals } from '@/lib/liquidity';
import { isInfiniteApprovalEnabled, getStoredUserSettings } from '@/hooks/useUserSettings';
import { useTransactionAdder, TransactionType, type LiquidityIncreaseTransactionInfo, type ApproveTransactionInfo } from '@/lib/transactions';

type LiquidityOperation = 'liquidity_mint' | 'liquidity_approve';

const captureError = (
  error: unknown,
  operation: LiquidityOperation,
  context: Record<string, unknown>
) => {
  Sentry.captureException(error, {
    tags: { operation },
    extra: context
  });
};

export interface UseAddLiquidityTransactionProps {
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  amount0: string;
  amount1: string;
  tickLower: string;
  tickUpper: string;
  activeInputSide: 'amount0' | 'amount1' | null;
  calculatedData: any;
  onLiquidityAdded: (token0Symbol?: string, token1Symbol?: string, txInfo?: { txHash: `0x${string}`; blockNumber?: bigint; tvlDelta?: number }) => void;
  onOpenChange: (isOpen: boolean) => void;
  deadlineSeconds?: number; // Transaction deadline in seconds (default: 1800 = 30 minutes)
}

export function useAddLiquidityTransaction({
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
  deadlineSeconds = 1800, // Default 30 minutes
}: UseAddLiquidityTransactionProps) {
  const { address: accountAddress, chainId } = useAccount();
  const publicClient = usePublicClient();

  // Use balance hooks for refetching after swap (same pattern as swap-interface.tsx)
  const token0Config = getToken(token0Symbol);
  const token1Config = getToken(token1Symbol);
  const isToken0Native = token0Config?.address === NATIVE_TOKEN_ADDRESS;
  const isToken1Native = token1Config?.address === NATIVE_TOKEN_ADDRESS;

  const { refetch: refetchToken0Balance } = useBalance({
    address: accountAddress,
    token: isToken0Native ? undefined : (token0Config?.address as `0x${string}` | undefined),
    chainId,
    query: { enabled: false }, // Disabled by default, we'll refetch manually
  });

  const { refetch: refetchToken1Balance } = useBalance({
    address: accountAddress,
    token: isToken1Native ? undefined : (token1Config?.address as `0x${string}` | undefined),
    chainId,
    query: { enabled: false }, // Disabled by default, we'll refetch manually
  });

  // Check approvals using React Query
  const {
    data: approvalData,
    isLoading: isCheckingApprovals,
    refetch: refetchApprovals,
  } = useCheckMintApprovals(
    accountAddress && chainId && calculatedData
      ? {
          userAddress: accountAddress,
          token0Symbol,
          token1Symbol,
          amount0: formatUnits(BigInt(calculatedData.amount0 || '0'), getToken(token0Symbol)?.decimals || 18),
          amount1: formatUnits(BigInt(calculatedData.amount1 || '0'), getToken(token1Symbol)?.decimals || 18),
          chainId,
          tickLower: calculatedData.finalTickLower ?? parseInt(tickLower),
          tickUpper: calculatedData.finalTickUpper ?? parseInt(tickUpper),
        }
      : undefined,
    {
      enabled: Boolean(accountAddress && chainId && calculatedData && (BigInt(calculatedData.amount0 || '0') > 0n || BigInt(calculatedData.amount1 || '0') > 0n)),
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

  // Wagmi hooks for deposit transaction - using sendTransaction for raw tx (Uniswap pattern)
  const {
    data: depositTxHash,
    sendTransactionAsync,
    isPending: isDepositPending,
    error: depositError,
    reset: resetDeposit,
  } = useSendTransaction();

  const {
    isLoading: isDepositConfirming,
    isSuccess: isDepositConfirmed,
    isError: isDepositError,
    error: depositReceiptError,
  } = useWaitForTransactionReceipt({ hash: depositTxHash });

  // Sign typed data for permit2 batch signatures
  const { signTypedDataAsync } = useSignTypedData();

  // Transaction tracking
  const addTransaction = useTransactionAdder();

  const [isWorking, setIsWorking] = useState(false);
  const processedDepositHashRef = useRef<string | null>(null);
  const processedFailedHashRef = useRef<string | null>(null);

  // Approves exact amount (+1 wei buffer) or infinite based on user setting
  const handleApprove = useCallback(
    async (tokenSymbol: TokenSymbol, exactAmount?: string) => {
      if (!publicClient) throw new Error('Public client not available');
      const tokenConfig = getToken(tokenSymbol);
      if (!tokenConfig) throw new Error(`Token ${tokenSymbol} not found`);

      toast('Confirm in Wallet', {
        icon: React.createElement(IconCircleInfo, { className: 'h-4 w-4' }),
      });

      let approvalAmount: bigint = maxUint256;

      if (!isInfiniteApprovalEnabled() && exactAmount) {
        try {
          approvalAmount = viemParseUnits(exactAmount, tokenConfig.decimals) + 1n; // +1 wei buffer
        } catch {
          approvalAmount = maxUint256; // Fall back to infinite on parse error
        }
      }

      const hash = await approveAsync({
        address: tokenConfig.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS, approvalAmount],
      });

      // Track approval transaction in Redux store
      if (hash && chainId) {
        const approveInfo: ApproveTransactionInfo = {
          type: TransactionType.Approve,
          tokenAddress: tokenConfig.address,
          spender: PERMIT2_ADDRESS,
        };
        addTransaction(
          { hash, chainId, from: accountAddress, to: tokenConfig.address } as any,
          approveInfo
        );
      }

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      const isInfinite = approvalAmount === maxUint256;
      toast.success(`${tokenSymbol} Approved`, {
        icon: React.createElement(IconBadgeCheck2, { className: 'h-4 w-4 text-green-500' }),
        description: isInfinite
          ? `Approved infinite ${tokenSymbol} for liquidity`
          : `Approved ${exactAmount} ${tokenSymbol} for this transaction`,
        action: {
          label: 'View Transaction',
          onClick: () => window.open(getExplorerTxUrl(hash), '_blank'),
        },
      });

      // Don't refetch here - the form component handles refetch after a delay
    },
    [approveAsync, chainId, accountAddress, addTransaction]
  );

  // Handle deposit transaction
  // Simplified flow: API is single source of truth for permit data
  // 1. Call API without permit
  // 2. If API returns PERMIT2_BATCH_SIGNATURE needed, sign it and retry
  // 3. Execute transaction
  const handleDeposit = useCallback(
    async () => {
      if (!accountAddress || !chainId) throw new Error('Wallet not connected');

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

        // Use activeInputSide to determine which token the user actually entered
        let inputAmount: string;
        let inputTokenSymbol: TokenSymbol;

        if (activeInputSide === 'amount0') {
          inputAmount = finalAmount0;
          inputTokenSymbol = token0Symbol;
        } else if (activeInputSide === 'amount1') {
          inputAmount = finalAmount1;
          inputTokenSymbol = token1Symbol;
        } else {
          inputAmount = finalAmount0 && parseFloat(finalAmount0) > 0 ? finalAmount0 : finalAmount1;
          inputTokenSymbol = finalAmount0 && parseFloat(finalAmount0) > 0 ? token0Symbol : token1Symbol;
        }

        const endpoint = '/api/liquidity/prepare-mint-tx';

        // Get user settings for slippage and deadline
        const userSettings = getStoredUserSettings();
        const slippageBps = Math.round(userSettings.slippage * 100);
        const deadlineMinutes = userSettings.deadline;

        const baseRequestBody = {
          userAddress: accountAddress,
          token0Symbol,
          token1Symbol,
          inputAmount,
          inputTokenSymbol,
          userTickLower: tl,
          userTickUpper: tu,
          chainId,
          slippageBps,
          deadlineMinutes,
        };

        let response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(baseRequestBody),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to prepare transaction');
        }

        let result = await response.json();

        if (result.needsApproval && result.approvalType === 'PERMIT2_BATCH_SIGNATURE') {
          const { permitBatchData, signatureDetails } = result;
          if (!permitBatchData || !signatureDetails) {
            throw new Error('API returned permit required but no permit data');
          }

          // Sign the permit data from API (single source of truth)
          toast('Sign Permit in Wallet', {
            icon: React.createElement(IconCircleInfo, { className: 'h-4 w-4' }),
          });

          const valuesToSign = permitBatchData.values || permitBatchData;
          const signature = await signTypedDataAsync({
            domain: signatureDetails.domain,
            types: signatureDetails.types,
            primaryType: 'PermitBatch',
            message: valuesToSign,
          });

          toast.success('Permit Signed', {
            icon: React.createElement(IconBadgeCheck2, { className: 'h-4 w-4 text-green-500' }),
          });

          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...baseRequestBody,
              permitSignature: signature,
              permitBatchData,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to prepare transaction');
          }

          result = await response.json();
        }

        // Handle ERC20 approval needed (should be handled separately before deposit)
        if (result.needsApproval && result.approvalType === 'ERC20_TO_PERMIT2') {
          throw new Error(`ERC20 approval needed for ${result.approvalTokenSymbol}. Please approve first.`);
        }

        // Execute the transaction
        const txData = result.transaction || result.create;
        if (!txData?.to || !txData?.data) {
          throw new Error('Invalid transaction data from API');
        }

        toast('Confirm Transaction in Wallet', {
          icon: React.createElement(IconCircleInfo, { className: 'h-4 w-4' }),
        });

        const hash = await sendTransactionAsync({
          to: txData.to as `0x${string}`,
          data: txData.data as Hex,
          value: txData.value && txData.value !== '0' ? BigInt(txData.value) : undefined,
        });

        // Track transaction in Redux store for cache invalidation
        if (hash && chainId) {
          const typeInfo: LiquidityIncreaseTransactionInfo = {
            type: TransactionType.LiquidityIncrease,
            currency0Id: `${chainId}-${token0Config?.address ?? ''}`,
            currency1Id: `${chainId}-${token1Config?.address ?? ''}`,
            currency0AmountRaw: calculatedData?.amount0 ?? '0',
            currency1AmountRaw: calculatedData?.amount1 ?? '0',
          };
          // Create a minimal TransactionResponse-compatible object
          addTransaction(
            { hash, chainId, from: accountAddress, to: txData.to, data: txData.data } as any,
            typeInfo
          );
        }

      } catch (error: any) {
        console.error('[handleDeposit] Error:', error);

        const isUserRejection =
          error.message?.toLowerCase().includes('user rejected') ||
          error.message?.toLowerCase().includes('user denied') ||
          error.code === 4001;

        if (isUserRejection) {
          toast.error('Transaction Rejected', {
            icon: React.createElement(IconCircleXmarkFilled, { className: 'h-4 w-4 text-red-500' }),
            description: 'The request was rejected in your wallet.',
          });
        } else {
          captureError(error, 'liquidity_mint', {
            step: 'deposit',
            token0Symbol,
            token1Symbol,
            amount0,
            amount1,
            tickLower,
            tickUpper,
          });
          toast.error('Transaction Failed', {
            icon: React.createElement(IconCircleXmarkFilled, { className: 'h-4 w-4 text-red-500' }),
            description: error.message || 'Unknown error',
          });
        }

        throw error;
      } finally {
        setIsWorking(false);
      }
    },
    [accountAddress, chainId, token0Symbol, token1Symbol, amount0, amount1, tickLower, tickUpper, calculatedData, sendTransactionAsync, signTypedDataAsync, activeInputSide, addTransaction, token0Config, token1Config]
  );

  // Handle deposit transaction failure
  React.useEffect(() => {
    if (isDepositError && depositTxHash) {
      // Guard against duplicate processing
      if (processedFailedHashRef.current === depositTxHash) return;
      processedFailedHashRef.current = depositTxHash;

      toast.error('Transaction Failed', {
        icon: React.createElement(IconCircleXmarkFilled, { className: 'h-4 w-4 text-red-500' }),
        description: `Transaction was submitted but reverted on-chain.`,
        action: {
          label: 'View on Explorer',
          onClick: () => window.open(getExplorerTxUrl(depositTxHash), '_blank'),
        },
      });

      setIsWorking(false);
    }
  }, [isDepositError, depositTxHash, depositReceiptError]);

  React.useEffect(() => {
    if (isDepositConfirmed && depositTxHash && accountAddress) {
      if (processedDepositHashRef.current === depositTxHash) return;
      processedDepositHashRef.current = depositTxHash;

      toast.success('Position Created', {
        icon: React.createElement(IconBadgeCheck2, { className: 'h-4 w-4 text-green-500' }),
        description: `Liquidity added to ${token0Symbol}/${token1Symbol} pool successfully`,
        action: { label: 'View Transaction', onClick: () => window.open(getExplorerTxUrl(depositTxHash), '_blank') },
      });

      (async () => {
        if (!publicClient) return;
        let tvlDelta = 0;
        let volumeDelta = 0;
        let newTokenId: string | undefined = undefined;

        // Retry with backoff - RPC might be behind
        let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>> | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            receipt = await publicClient.getTransactionReceipt({ hash: depositTxHash as `0x${string}` });
            if (receipt) break;
          } catch {
            if (attempt < 4) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          }
        }
        if (!receipt) return;

        // Extract tokenId from Transfer event (mint = from zero address)
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: position_manager_abi,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === 'Transfer' && decoded.args) {
              const args = decoded.args as unknown as { from: string; to: string; id: bigint };
              if (args.from === '0x0000000000000000000000000000000000000000' &&
                  args.to?.toLowerCase() === accountAddress?.toLowerCase()) {
                newTokenId = args.id?.toString();
                if (accountAddress && newTokenId) {
                  addPositionIdToCache(accountAddress, newTokenId);
                }
                break;
              }
            }
          } catch {}
        }

        if (calculatedData?.amount0 && calculatedData?.amount1) {
          const { getTokenPrice } = await import('@/lib/swap/quote-prices');
          const { formatUnits } = await import('viem');
          const { getToken } = await import('@/lib/pools-config');
          const token0Config = getToken(token0Symbol);
          const token1Config = getToken(token1Symbol);
          const amt0 = parseFloat(formatUnits(BigInt(calculatedData.amount0), token0Config?.decimals || 18));
          const amt1 = parseFloat(formatUnits(BigInt(calculatedData.amount1), token1Config?.decimals || 18));
          const [p0, p1] = await Promise.all([getTokenPrice(token0Symbol), getTokenPrice(token1Symbol)]);
          tvlDelta = (p0 ? amt0 * p0 : 0) + (p1 ? amt1 * p1 : 0);
        }

        onLiquidityAdded(token0Symbol, token1Symbol, {
          txHash: depositTxHash as `0x${string}`,
          blockNumber: receipt?.blockNumber,
          tvlDelta,
        });
      })().catch(e => console.error('[useAddLiquidityTransaction] Post-deposit processing error:', e));

      onOpenChange(false);
    }
  }, [isDepositConfirmed, depositTxHash, accountAddress, token0Symbol, token1Symbol, onLiquidityAdded, onOpenChange, calculatedData]);

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
    isApproving: isApproving,
    isDepositConfirming,
    isDepositSuccess: isDepositConfirmed,
    handleApprove,
    handleDeposit,
    refetchApprovals,
    reset: resetAll,
  };
}

// =============================================================================
// BACKWARDS COMPATIBILITY ALIASES
// =============================================================================

/** @deprecated Use UseAddLiquidityTransactionProps instead */
export type UseAddLiquidityTransactionV2Props = UseAddLiquidityTransactionProps;

/** @deprecated Use useAddLiquidityTransaction instead */
export const useAddLiquidityTransactionV2 = useAddLiquidityTransaction;
