// Refactored Add Liquidity Transaction Hook (Uniswap-style)
import { useCallback, useState, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSignTypedData } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BadgeCheck, OctagonX, InfoIcon } from 'lucide-react';
import React from 'react';
import { TokenSymbol, TOKEN_DEFINITIONS } from '@/lib/pools-config';
import { PERMIT2_ADDRESS, getPermit2Domain, PERMIT_TYPES } from '@/lib/swap-constants';
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
  onLiquidityAdded: (token0Symbol?: string, token1Symbol?: string, txInfo?: { txHash: `0x${string}`; blockNumber?: bigint; tvlDelta?: number }) => void;
  onOpenChange: (isOpen: boolean) => void;
  isZapMode?: boolean;
  zapInputToken?: 'token0' | 'token1';
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
  isZapMode = false,
  zapInputToken = 'token0',
}: UseAddLiquidityTransactionV2Props) {
  const queryClient = useQueryClient();
  const { address: accountAddress, chainId } = useAccount();

  // Check approvals using React Query (disabled for zap mode - handleDeposit handles it)
  const {
    data: approvalData,
    isLoading: isCheckingApprovals,
    refetch: refetchApprovals,
  } = useCheckLiquidityApprovals(
    accountAddress && chainId && calculatedData && !isZapMode
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
      enabled: !isZapMode && Boolean(accountAddress && chainId && calculatedData && (BigInt(calculatedData.amount0 || '0') > 0n || BigInt(calculatedData.amount1 || '0') > 0n)),
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

  // Wagmi hook for Permit2 signing (zap mode)
  const { signTypedDataAsync } = useSignTypedData();

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
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      toast.success(`${tokenSymbol} Approved`, {
        icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
        description: `Approved infinite ${tokenSymbol} for liquidity`,
        action: {
          label: 'View Transaction',
          onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, '_blank'),
        },
      });

      // Don't refetch here - the form component handles refetch after a delay
      // This prevents the loop but ensures state is updated
    },
    [approveAsync]
  );

  // Handle deposit transaction (with optional permit signature)
  const handleDeposit = useCallback(
    async (permitSignature?: string) => {
      if (!accountAddress || !chainId) throw new Error('Wallet not connected');

      // Validate permit requirements
      if ((approvalData?.needsToken0Permit || approvalData?.needsToken1Permit)) {
        if (!permitSignature) throw new Error('Permit signature required but not provided');
        if (!approvalData?.permitBatchData || !approvalData?.signatureDetails) {
          throw new Error('Permit batch data missing - please sign permit again');
        }
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

        // Choose the endpoint based on zap mode
        const endpoint = isZapMode ? '/api/liquidity/prepare-zap-mint-tx' : '/api/liquidity/prepare-mint-tx';

        const requestBody: any = {
          userAddress: accountAddress,
          token0Symbol,
          token1Symbol,
          inputAmount,
          inputTokenSymbol: isZapMode ? (zapInputToken === 'token0' ? token0Symbol : token1Symbol) : inputTokenSymbol,
          userTickLower: tl,
          userTickUpper: tu,
          chainId,
        };

        // Add slippage tolerance for zap mode
        if (isZapMode) {
          requestBody.slippageTolerance = 50; // 0.5% default
        }

        // If we have a permit signature, include it (only for non-zap mode)
        if (!isZapMode && permitSignature && approvalData?.permitBatchData) {
          requestBody.permitSignature = permitSignature;
          requestBody.permitBatchData = approvalData.permitBatchData;
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to prepare transaction');
        }

        const result = await response.json();

        // Check if API is requesting permit signature
        if (result.needsApproval) {
          if (isZapMode && result.approvalType === 'PERMIT2_SIGNATURE' && result.permitData) {
            // Zap mode: Need to get Permit2 signature for single token
            console.log('[handleDeposit] Zap mode requires Permit2 signature, requesting from user...');

            if (!chainId) throw new Error('Chain ID not available');

            // Prepare signature data
            const domain = getPermit2Domain(chainId, PERMIT2_ADDRESS);
            const types = PERMIT_TYPES;
            const values = {
              details: {
                token: result.permitData.token,
                amount: result.permitData.amount,
                expiration: result.permitData.expiration,
                nonce: result.permitData.nonce,
              },
              spender: result.permitData.spender,
              sigDeadline: result.permitData.sigDeadline,
            };

            // Request signature from user using wagmi
            const signature = await signTypedDataAsync({
              domain: domain as any,
              types: types as any,
              primaryType: 'PermitSingle',
              message: values as any,
            });

            // Retry the API call with the signature
            const retryBody = {
              ...requestBody,
              permitSignature: signature,
              permitNonce: result.permitData.nonce,
              permitExpiration: result.permitData.expiration,
              permitSigDeadline: result.permitData.sigDeadline,
            };

            const retryResponse = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(retryBody),
            });

            if (!retryResponse.ok) {
              const errorData = await retryResponse.json();
              throw new Error(errorData.message || 'Failed to prepare transaction after signing');
            }

            const retryResult = await retryResponse.json();

            // Replace result with retry result
            Object.assign(result, retryResult);
          } else if (result.approvalType === 'PERMIT2_BATCH_SIGNATURE') {
            console.error('[handleDeposit] API returned permit request but permit should have been obtained already');
            throw new Error('Permit signature required. Please refresh and try again.');
          }
        }

        // Handle zap mode (two transactions) vs regular mode (one transaction)
        if (isZapMode && result.swapTransaction && result.mintTransaction) {
          // ========== ZAP MODE: TWO SEQUENTIAL TRANSACTIONS ==========

          // STEP 1: Execute swap transaction via Universal Router
          console.log('[handleDeposit] Zap mode: Executing swap transaction...');

          const swapConfig: any = {
            address: result.swapTransaction.to as `0x${string}`,
            abi: [
              {
                name: 'execute',
                type: 'function',
                stateMutability: result.swapTransaction.value && result.swapTransaction.value !== '0' ? 'payable' : 'nonpayable',
                inputs: [
                  { name: 'commands', type: 'bytes' },
                  { name: 'inputs', type: 'bytes[]' },
                  { name: 'deadline', type: 'uint256' }
                ],
                outputs: [],
              },
            ],
            functionName: 'execute',
            args: [
              result.swapTransaction.commands as Hex,
              result.swapTransaction.inputs as Hex[],
              BigInt(result.swapTransaction.deadline)
            ],
          };

          if (result.swapTransaction.value && result.swapTransaction.value !== '0') {
            swapConfig.value = BigInt(result.swapTransaction.value);
          }

          // Execute swap
          const swapHash = await depositAsync(swapConfig);
          console.log('[handleDeposit] Swap transaction submitted:', swapHash);

          // Wait for swap to confirm
          const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
          console.log('[handleDeposit] Swap confirmed, executing mint...');

          // STEP 2: Execute mint transaction via PositionManager
          const mintConfig: any = {
            address: result.mintTransaction.to as `0x${string}`,
            abi: [
              {
                name: 'multicall',
                type: 'function',
                stateMutability: result.mintTransaction.value && result.mintTransaction.value !== '0' ? 'payable' : 'nonpayable',
                inputs: [{ name: 'data', type: 'bytes[]' }],
                outputs: [{ name: 'results', type: 'bytes[]' }],
              },
            ],
            functionName: 'multicall',
            args: [[result.mintTransaction.data as Hex]],
          };

          if (result.mintTransaction.value && result.mintTransaction.value !== '0') {
            mintConfig.value = BigInt(result.mintTransaction.value);
          }

          // Execute mint (this will be the hash returned and tracked)
          const hash = await depositAsync(mintConfig);
          console.log('[handleDeposit] Mint transaction submitted:', hash);

        } else if (result.transaction && result.transaction.to) {
          // ========== REGULAR MODE: SINGLE TRANSACTION ==========

          if (!result.transaction.data) {
            console.error('[handleDeposit] Missing transaction data:', result);
            throw new Error('Invalid transaction data from API');
          }

          const depositConfig: any = {
            address: result.transaction.to as `0x${string}`,
            abi: [
              {
                name: 'multicall',
                type: 'function',
                stateMutability: result.transaction.value && result.transaction.value !== '0' ? 'payable' : 'nonpayable',
                inputs: [{ name: 'data', type: 'bytes[]' }],
                outputs: [{ name: 'results', type: 'bytes[]' }],
              },
            ],
            functionName: 'multicall',
            args: [[result.transaction.data as Hex]],
          };

          if (result.transaction.value && result.transaction.value !== '0') {
            depositConfig.value = BigInt(result.transaction.value);
          }

          const hash = await depositAsync(depositConfig);
        } else {
          console.error('[handleDeposit] Invalid API response:', result);
          throw new Error('Invalid transaction data from API');
        }

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

  // Removed backup useEffect to prevent duplicate refetch logic
  // The optimistic flow in AddLiquidityForm handles the progression now

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

  React.useEffect(() => {
    if (isDepositConfirmed && depositTxHash && accountAddress) {
      if (processedDepositHashRef.current === depositTxHash) return;
      processedDepositHashRef.current = depositTxHash;

      toast.success('Position Created', {
        icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
        description: `Liquidity added to ${token0Symbol}/${token1Symbol} pool successfully`,
        action: { label: 'View Transaction', onClick: () => window.open(`https://sepolia.basescan.org/tx/${depositTxHash}`, '_blank') },
      });

      (async () => {
        const receipt = await publicClient.getTransactionReceipt({ hash: depositTxHash as `0x${string}` });
        let tvlDelta = 0;
        if (calculatedData?.amount0 && calculatedData?.amount1) {
          const { getTokenPrice } = await import('@/lib/price-service');
          const { formatUnits } = await import('viem');
          const { TOKEN_DEFINITIONS } = await import('@/lib/pools-config');
          const amt0 = parseFloat(formatUnits(BigInt(calculatedData.amount0), TOKEN_DEFINITIONS[token0Symbol]?.decimals || 18));
          const amt1 = parseFloat(formatUnits(BigInt(calculatedData.amount1), TOKEN_DEFINITIONS[token1Symbol]?.decimals || 18));
          const [p0, p1] = await Promise.all([getTokenPrice(token0Symbol), getTokenPrice(token1Symbol)]);
          tvlDelta = (p0 ? amt0 * p0 : 0) + (p1 ? amt1 * p1 : 0);
        }
        onLiquidityAdded(token0Symbol, token1Symbol, { txHash: depositTxHash as `0x${string}`, blockNumber: receipt?.blockNumber, tvlDelta });
      })().catch(e => console.error('Post-deposit processing error:', e));

      onOpenChange(false);
    }
  }, [isDepositConfirmed, depositTxHash, accountAddress, token0Symbol, token1Symbol, onLiquidityAdded, onOpenChange, queryClient, calculatedData]);

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
