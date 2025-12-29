/**
 * Add Liquidity Transaction Hook
 *
 * Handles the transaction flow for adding liquidity to V4 pools.
 * Supports both regular dual-token and zap (single-token) modes.
 */
import * as Sentry from '@sentry/nextjs';
import { useCallback, useState, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSignTypedData, useBalance, usePublicClient, useSendTransaction } from 'wagmi';
import { toast } from 'sonner';
import { BadgeCheck, OctagonX, InfoIcon } from 'lucide-react';
import React from 'react';
import { TokenSymbol, NATIVE_TOKEN_ADDRESS, getToken } from '@/lib/pools-config';
import { getExplorerTxUrl } from '@/lib/wagmiConfig';
import { PERMIT2_ADDRESS, getPermit2Domain, PERMIT_TYPES } from '@/lib/swap-constants';
import { ERC20_ABI } from '@/lib/abis/erc20';
import { type Hex, maxUint256, formatUnits, formatUnits as viemFormatUnits, parseUnits as viemParseUnits, decodeEventLog } from 'viem';
import { addPositionIdToCache } from '@/lib/client-cache';
import { position_manager_abi } from '@/lib/abis/PositionManager_abi';
import { useCheckMintApprovals } from '@/lib/liquidity';
import { useCheckZapApprovals } from '../approval/useCheckZapApprovals';
import { isInfiniteApprovalEnabled, getStoredSlippageBps, getStoredUserSettings } from '@/hooks/useUserSettings';

type LiquidityOperation = 'liquidity_mint' | 'liquidity_zap' | 'liquidity_approve';

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
  onLiquidityAdded: (token0Symbol?: string, token1Symbol?: string, txInfo?: { txHash: `0x${string}`; blockNumber?: bigint; tvlDelta?: number; volumeDelta?: number }) => void;
  onOpenChange: (isOpen: boolean) => void;
  isZapMode?: boolean;
  zapInputToken?: 'token0' | 'token1';
  zapSlippageToleranceBps?: number; // Slippage tolerance in basis points for zap mode
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
  isZapMode = false,
  zapInputToken = 'token0',
  zapSlippageToleranceBps = 50, // Default 0.5% (50 basis points)
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

  // Check approvals for regular mode using React Query
  const {
    data: regularApprovalData,
    isLoading: isCheckingRegularApprovals,
    refetch: refetchRegularApprovals,
  } = useCheckMintApprovals(
    accountAddress && chainId && calculatedData && !isZapMode
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
      enabled: !isZapMode && Boolean(accountAddress && chainId && calculatedData && (BigInt(calculatedData.amount0 || '0') > 0n || BigInt(calculatedData.amount1 || '0') > 0n)),
      staleTime: 5000,
    }
  );

  // Check approvals for zap mode using React Query
  const zapInputAmount = zapInputToken === 'token0' ? amount0 : amount1;
  const zapTickLower = Number.parseInt(tickLower);
  const zapTickUpper = Number.parseInt(tickUpper);
  const hasValidZapRange =
    Number.isFinite(zapTickLower) &&
    Number.isFinite(zapTickUpper) &&
    zapTickLower < zapTickUpper;
  const {
    data: zapApprovalData,
    isLoading: isCheckingZapApprovals,
    refetch: refetchZapApprovals,
  } = useCheckZapApprovals(
    accountAddress && chainId && isZapMode
      ? {
          userAddress: accountAddress,
          token0Symbol,
          token1Symbol,
          inputTokenSymbol: zapInputToken,
          inputAmount: zapInputAmount,
          chainId,
          // Zap approvals don't depend on calculatedData; they depend on the chosen range and input amount.
          tickLower: zapTickLower,
          tickUpper: zapTickUpper,
          slippageToleranceBps: zapSlippageToleranceBps,
        }
      : undefined,
    {
      enabled:
        isZapMode &&
        Boolean(accountAddress && chainId) &&
        hasValidZapRange &&
        Boolean(zapInputAmount && parseFloat(zapInputAmount) > 0),
      staleTime: 5000,
    }
  );

  // Unified approval data and state
  const approvalData = isZapMode ? zapApprovalData : regularApprovalData;
  const isCheckingApprovals = isZapMode ? isCheckingZapApprovals : isCheckingRegularApprovals;
  const refetchApprovals = isZapMode ? refetchZapApprovals : refetchRegularApprovals;

  // Wagmi hooks for ERC20 approvals
  const {
    data: approveTxHash,
    writeContractAsync: approveAsync,
    isPending: isApprovePending,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();

  const { isLoading: isApproving, isSuccess: isApproved } = useWaitForTransactionReceipt({ hash: approveTxHash });

  // Wagmi hooks for swap transaction (zap mode only)
  const {
    data: swapTxHash,
    writeContractAsync: swapAsync,
    isPending: isSwapPending,
    error: swapError,
    reset: resetSwap,
  } = useWriteContract();

  const {
    isLoading: isSwapConfirming,
    isSuccess: isSwapConfirmed,
    isError: isSwapError,
    error: swapReceiptError,
  } = useWaitForTransactionReceipt({ hash: swapTxHash });

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

  // Wagmi hook for Permit2 signing (zap mode)
  const { signTypedDataAsync } = useSignTypedData();

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
        icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
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

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      const isInfinite = approvalAmount === maxUint256;
      toast.success(`${tokenSymbol} Approved`, {
        icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
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
    [approveAsync]
  );

  // Handle swap execution for zap mode (simplified - permits signed inline)
  const handleZapSwapAndDeposit = useCallback(
    async (): Promise<void> => {
      if (!accountAddress || !chainId) throw new Error('Wallet not connected');
      if (!publicClient) throw new Error('Public client not available');
      if (!zapApprovalData) throw new Error('Approval data not available');

      try {
        const tl = calculatedData?.finalTickLower ?? parseInt(tickLower);
        const tu = calculatedData?.finalTickUpper ?? parseInt(tickUpper);
        const inputAmount = zapInputToken === 'token0' ? amount0 : amount1;
        const inputTokenSymbol = zapInputToken === 'token0' ? token0Symbol : token1Symbol;

        // ========== STEP 1: SIGN SWAP PERMIT (IF REQUIRED) ==========
        let swapPermitSignature: string | undefined = undefined;
        if (zapApprovalData.swapPermitData) {
          toast('Sign Swap Permit in Wallet', {
            icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
          });

          const { token, amount, nonce, expiration, sigDeadline, spender } = zapApprovalData.swapPermitData;

          // Use the permit data directly as provided by the API
          const domain = getPermit2Domain(chainId, PERMIT2_ADDRESS);
          const types = PERMIT_TYPES;

          // Ensure nonce and expiration are numbers (uint48 in the contract)
          const messageToSign = {
            details: {
              token: token as `0x${string}`,
              amount: BigInt(amount),
              expiration: Number(expiration), // Ensure it's a number for uint48
              nonce: Number(nonce),           // Ensure it's a number for uint48
            },
            spender: spender as `0x${string}`,
            sigDeadline: BigInt(sigDeadline),
          };

          swapPermitSignature = await signTypedDataAsync({
            domain: domain as any,
            types: types as any,
            primaryType: 'PermitSingle',
            message: messageToSign,
          });
        }

        // ========== STEP 2: EXECUTE SWAP TRANSACTION ==========
        const requestBody: any = {
          userAddress: accountAddress,
          token0Symbol,
          token1Symbol,
          inputAmount,
          inputTokenSymbol,
          userTickLower: tl,
          userTickUpper: tu,
          chainId,
          slippageTolerance: zapSlippageToleranceBps,
          deadlineSeconds,
          approvalMode: isInfiniteApprovalEnabled() ? 'infinite' : 'exact',
        };

        // Include permit signature if it was required
        if (swapPermitSignature && zapApprovalData.swapPermitData) {
          requestBody.permitSignature = swapPermitSignature;
          requestBody.permitNonce = zapApprovalData.swapPermitData.nonce;
          requestBody.permitExpiration = zapApprovalData.swapPermitData.expiration;
          requestBody.permitSigDeadline = zapApprovalData.swapPermitData.sigDeadline;
          requestBody.permitAmount = zapApprovalData.swapPermitData.amount;
        }

        const response = await fetch('/api/liquidity/prepare-zap-mint-tx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to prepare swap transaction');
        }

        const result = await response.json();
        
        if (!result.swapTransaction) {
          const errorMsg = result.message || result.error || 'No swap transaction returned from API';
          throw new Error(errorMsg);
        }

        toast('Confirm Swap in Wallet', {
          icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
        });

        const swapTx = result.swapTransaction;
        const commands = swapTx.data?.commands || swapTx.commands;
        const inputs = swapTx.data?.inputs || swapTx.inputs;

        if (!commands || !inputs) {
          throw new Error('Invalid swap transaction structure from API');
        }

        const swapConfig: any = {
          address: swapTx.to as `0x${string}`,
          abi: [{
            name: 'execute',
            type: 'function',
            stateMutability: swapTx.value && swapTx.value !== '0' ? 'payable' : 'nonpayable',
            inputs: [
              { name: 'commands', type: 'bytes' },
              { name: 'inputs', type: 'bytes[]' },
              { name: 'deadline', type: 'uint256' },
            ],
            outputs: [],
          }],
          functionName: 'execute',
          args: [commands, inputs, BigInt(swapTx.deadline || '0')],
        };

        if (swapTx.value && swapTx.value !== '0') {
          swapConfig.value = BigInt(swapTx.value);
        }

        // ========== STEP 3: GET BALANCES BEFORE SWAP ==========
        // Use getToken() to get decimals from pools.json (same as swap-interface.tsx)
        const token0Config = getToken(token0Symbol);
        const token1Config = getToken(token1Symbol);

        if (!token0Config || !token1Config) {
          throw new Error(`Token config not found for ${token0Symbol} or ${token1Symbol}`);
        }

        // Get balances before swap to calculate actual received amounts
        const getTokenBalance = async (tokenAddress: string, isNative: boolean, atBlockNumber?: bigint): Promise<bigint> => {
          const blockParam = atBlockNumber ? { blockNumber: atBlockNumber } : { blockTag: 'latest' as const };
          if (isNative) {
            return await publicClient.getBalance({
              address: accountAddress,
              ...blockParam
            });
          } else {
            return await publicClient.readContract({
              address: tokenAddress as `0x${string}`,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [accountAddress],
              ...blockParam,
            }) as bigint;
          }
        };

        const isToken0Native = token0Config.address === NATIVE_TOKEN_ADDRESS;
        const isToken1Native = token1Config.address === NATIVE_TOKEN_ADDRESS;

        const [balance0Before, balance1Before] = await Promise.all([
          getTokenBalance(token0Config.address, isToken0Native),
          getTokenBalance(token1Config.address, isToken1Native),
        ]);

        // ========== STEP 4: EXECUTE SWAP TRANSACTION ==========
        const swapHash = await swapAsync(swapConfig);
        const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });

        if (swapReceipt.status === 'reverted') {
          throw new Error('Swap transaction reverted');
        }

        toast.success('Swap Complete', {
          icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
          description: 'Tokens swapped successfully',
        });

        // ========== STEP 5: GET BALANCES AFTER SWAP AND CALCULATE ACTUAL AMOUNTS ==========
        const blockNumber = swapReceipt.blockNumber;
        // Read balances from 'latest' - transaction is already confirmed so this will have the updated balances
        const [balance0After, balance1After] = await Promise.all([
          getTokenBalance(token0Config.address, isToken0Native),
          getTokenBalance(token1Config.address, isToken1Native),
        ]);

        const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const formatTopicAddress = (address: string) => `0x000000000000000000000000${address.toLowerCase().slice(2)}`;
        const userTopic = formatTopicAddress(accountAddress);
        const token0AddressLower = token0Config.address?.toLowerCase();
        const token1AddressLower = token1Config.address?.toLowerCase();

        const calculateChangeFromLogs = (tokenAddress?: string | undefined) => {
          if (!tokenAddress) return null;
          const lowerAddress = tokenAddress.toLowerCase();
          let netChange = 0n;

          for (const log of swapReceipt.logs) {
            if (log.topics?.[0] !== TRANSFER_TOPIC) continue;
            if (log.address?.toLowerCase() !== lowerAddress) continue;
            if (!log.topics[1] || !log.topics[2]) continue;

            const fromTopic = log.topics[1].toLowerCase();
            const toTopic = log.topics[2].toLowerCase();

            try {
              const value = BigInt(log.data);
              if (toTopic === userTopic) {
                netChange += value;
              }
              if (fromTopic === userTopic) {
                netChange -= value;
              }
            } catch (err) {
              console.warn('[Zap Swap] Failed to parse log data for token change:', err, log);
            }
          }

          return netChange;
        };

        let actualToken0Change = balance0After - balance0Before;
        let actualToken1Change = balance1After - balance1Before;

        if (!isToken0Native) {
          const changeFromLogs = calculateChangeFromLogs(token0Config.address);
          if (changeFromLogs !== null) {
            actualToken0Change = changeFromLogs;
          }
        }
        if (!isToken1Native) {
          const changeFromLogs = calculateChangeFromLogs(token1Config.address);
          if (changeFromLogs !== null) {
            actualToken1Change = changeFromLogs;
          }
        }

        // Calculate actual amounts received from swap
        // Note: Input token balance decreases (we sent tokens), output token balance increases (we received tokens)
        const swapAmount = BigInt(result.details?.swapAmount || '0');
        const inputTokenDecimals = zapInputToken === 'token0' ? token0Config.decimals : token1Config.decimals;
        const parsedInputAmount = viemParseUnits(inputAmount, inputTokenDecimals);
        const inputIsToken0 = zapInputToken === 'token0';

        const remainingInputAmount = parsedInputAmount - swapAmount;
        const receivedOutputAmount = inputIsToken0 ? actualToken1Change : actualToken0Change;
        
        // Map to token0/token1 amounts
        const actualToken0Amount = inputIsToken0 ? remainingInputAmount : receivedOutputAmount;
        const actualToken1Amount = inputIsToken0 ? receivedOutputAmount : remainingInputAmount;

        // Format amounts for API using decimals from pools.json
        const token0AmountStr = viemFormatUnits(actualToken0Amount, token0Config.decimals);
        const token1AmountStr = viemFormatUnits(actualToken1Amount, token1Config.decimals);

        // ========== STEP 6: SIGN BATCH PERMIT FOR LP DEPOSIT ==========

        const mintResponse = await fetch('/api/liquidity/prepare-mint-after-swap-tx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: accountAddress,
            token0Symbol,
            token1Symbol,
            token0Amount: token0AmountStr,
            token1Amount: token1AmountStr,
            userTickLower: tl,
            userTickUpper: tu,
            chainId,
            slippageTolerance: zapSlippageToleranceBps,
            deadlineSeconds,
          }),
        });

        if (!mintResponse.ok) {
          const errorData = await mintResponse.json();
          throw new Error(errorData.message || 'Failed to prepare LP deposit');
        }

        const mintResult = await mintResponse.json();

        // Sign batch permit if needed
        let batchPermitSignature: string | undefined = undefined;
        if (mintResult.needsApproval && mintResult.approvalType === 'PERMIT2_BATCH_SIGNATURE') {
          if (!mintResult.permitBatchData) {
            console.error('[Zap BatchPermit] Missing permitBatchData in API response:', mintResult);
            throw new Error('Batch permit data missing from API response');
          }

          toast('Sign LP Permit in Wallet', {
            icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
          });

          // Extract domain and types from permitBatchData (API doesn't return signatureDetails)
          const domain = mintResult.permitBatchData.domain;
          const types = mintResult.permitBatchData.types;
          // Prefer message format (new) over values format (backwards compat)
          const valuesToSign = mintResult.permitBatchData.message || mintResult.permitBatchData.values;

          if (!domain || !types) {
            console.error('[Zap BatchPermit] Missing domain or types:', { domain: !!domain, types: !!types, permitBatchData: mintResult.permitBatchData });
            throw new Error('Missing domain or types for batch permit signature');
          }

          if (!valuesToSign) {
            console.error('[Zap BatchPermit] Missing valuesToSign:', { permitBatchData: mintResult.permitBatchData });
            throw new Error('Missing permit batch message/values for signature');
          }

          try {
            batchPermitSignature = await signTypedDataAsync({
              domain: domain as any,
              types: types as any,
              primaryType: 'PermitBatch',
              message: valuesToSign as any,
            });
          } catch (signError: any) {
            console.error('[Zap BatchPermit] Signature failed:', {
              error: signError.message,
              code: signError.code,
              domain,
              types,
              valuesToSign,
            });
            captureError(signError, 'liquidity_zap', {
              step: 'batch_permit_signature',
              token0Symbol,
              token1Symbol,
              tickLower: tl,
              tickUpper: tu,
            });
            throw signError;
          }

          // Fetch final transaction with signature
          const finalMintResponse = await fetch('/api/liquidity/prepare-mint-after-swap-tx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userAddress: accountAddress,
              token0Symbol,
              token1Symbol,
              token0Amount: token0AmountStr,
              token1Amount: token1AmountStr,
              userTickLower: tl,
              userTickUpper: tu,
              chainId,
              slippageTolerance: zapSlippageToleranceBps,
              deadlineSeconds,
              permitSignature: batchPermitSignature,
              permitBatchData: mintResult.permitBatchData, // Include permit batch data
            }),
          });

          if (!finalMintResponse.ok) {
            const errorData = await finalMintResponse.json();
            console.error('[Zap BatchPermit] Final API call failed:', {
              status: finalMintResponse.status,
              error: errorData,
              hasSignature: !!batchPermitSignature,
            });
            throw new Error(errorData.message || 'Failed to prepare final LP deposit');
          }

          const finalResult = await finalMintResponse.json();

          if (!finalResult.transaction || !finalResult.transaction.data) {
            throw new Error('Invalid LP deposit transaction from API');
          }

          // Execute LP deposit - send raw transaction (Uniswap pattern)
          toast('Confirm LP Deposit in Wallet', {
            icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
          });

          await sendTransactionAsync({
            to: finalResult.transaction.to as `0x${string}`,
            data: finalResult.transaction.data as Hex,
            value: finalResult.transaction.value && finalResult.transaction.value !== '0'
              ? BigInt(finalResult.transaction.value)
              : undefined,
          });
        } else if (mintResult.transaction && mintResult.transaction.data) {
          // No permit needed, execute directly - send raw transaction (Uniswap pattern)
          toast('Confirm LP Deposit in Wallet', {
            icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
          });

          await sendTransactionAsync({
            to: mintResult.transaction.to as `0x${string}`,
            data: mintResult.transaction.data as Hex,
            value: mintResult.transaction.value && mintResult.transaction.value !== '0'
              ? BigInt(mintResult.transaction.value)
              : undefined,
          });
        } else {
          throw new Error('Invalid LP deposit response from API');
        }
      } catch (error: any) {
        throw error;
      }
    },
    [accountAddress, chainId, zapApprovalData, calculatedData, tickLower, tickUpper, zapInputToken, amount0, amount1, token0Symbol, token1Symbol, swapAsync, sendTransactionAsync, signTypedDataAsync, approveAsync, publicClient]
  );

  // OLD HANDLERS REMOVED - Now using consolidated handleZapSwapAndDeposit

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

        const endpoint = isZapMode ? '/api/liquidity/prepare-mint-after-swap-tx' : '/api/liquidity/prepare-mint-tx';

        // Get user settings for slippage and deadline
        const userSettings = getStoredUserSettings();
        const slippageBps = Math.round(userSettings.slippage * 100);
        const deadlineMinutes = userSettings.deadline;

        const baseRequestBody = {
          userAddress: accountAddress,
          token0Symbol,
          token1Symbol,
          inputAmount,
          inputTokenSymbol: isZapMode ? (zapInputToken === 'token0' ? token0Symbol : token1Symbol) : inputTokenSymbol,
          userTickLower: tl,
          userTickUpper: tu,
          chainId,
          slippageBps,
          deadlineMinutes,
          ...(isZapMode && { slippageTolerance: zapSlippageToleranceBps || slippageBps }),
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
            icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
          });

          const valuesToSign = permitBatchData.values || permitBatchData;
          const signature = await signTypedDataAsync({
            domain: signatureDetails.domain,
            types: signatureDetails.types,
            primaryType: 'PermitBatch',
            message: valuesToSign,
          });

          toast.success('Permit Signed', {
            icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
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
          icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
        });

        await sendTransactionAsync({
          to: txData.to as `0x${string}`,
          data: txData.data as Hex,
          value: txData.value && txData.value !== '0' ? BigInt(txData.value) : undefined,
        });

      } catch (error: any) {
        console.error('[handleDeposit] Error:', error);

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
          captureError(error, isZapMode ? 'liquidity_zap' : 'liquidity_mint', {
            step: 'deposit',
            token0Symbol,
            token1Symbol,
            amount0,
            amount1,
            tickLower,
            tickUpper,
            isZapMode,
          });
          toast.error('Transaction Failed', {
            icon: React.createElement(OctagonX, { className: 'h-4 w-4 text-red-500' }),
            description: error.message || 'Unknown error',
          });
        }

        throw error;
      } finally {
        setIsWorking(false);
      }
    },
    [accountAddress, chainId, token0Symbol, token1Symbol, amount0, amount1, tickLower, tickUpper, calculatedData, sendTransactionAsync, isZapMode, zapInputToken, signTypedDataAsync, activeInputSide, zapSlippageToleranceBps]
  );

  // Handle deposit transaction failure
  React.useEffect(() => {
    if (isDepositError && depositTxHash) {
      // Guard against duplicate processing
      if (processedFailedHashRef.current === depositTxHash) return;
      processedFailedHashRef.current = depositTxHash;

      toast.error('Transaction Failed', {
        icon: React.createElement(OctagonX, { className: 'h-4 w-4 text-red-500' }),
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
        icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
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
          const { getTokenPrice } = await import('@/lib/price-service');
          const { formatUnits } = await import('viem');
          const { getToken } = await import('@/lib/pools-config');
          const token0Config = getToken(token0Symbol);
          const token1Config = getToken(token1Symbol);
          const amt0 = parseFloat(formatUnits(BigInt(calculatedData.amount0), token0Config?.decimals || 18));
          const amt1 = parseFloat(formatUnits(BigInt(calculatedData.amount1), token1Config?.decimals || 18));
          const [p0, p1] = await Promise.all([getTokenPrice(token0Symbol), getTokenPrice(token1Symbol)]);
          tvlDelta = (p0 ? amt0 * p0 : 0) + (p1 ? amt1 * p1 : 0);
        }

        // Calculate volume delta for zap transactions (swap contributes to volume)
        if (isZapMode && calculatedData?.optimalSwapAmount && calculatedData?.swapDirection?.from) {
          const { getTokenPrice } = await import('@/lib/price-service');
          const { formatUnits } = await import('viem');
          const { getToken } = await import('@/lib/pools-config');

          const swapFromSymbol = calculatedData.swapDirection.from as TokenSymbol;
          const swapTokenConfig = getToken(swapFromSymbol);
          const swapAmountFormatted = parseFloat(formatUnits(BigInt(calculatedData.optimalSwapAmount), swapTokenConfig?.decimals || 18));
          const swapPrice = await getTokenPrice(swapFromSymbol);

          volumeDelta = swapPrice ? swapAmountFormatted * swapPrice : 0;
        }

        onLiquidityAdded(token0Symbol, token1Symbol, {
          txHash: depositTxHash as `0x${string}`,
          blockNumber: receipt?.blockNumber,
          tvlDelta,
          volumeDelta: isZapMode ? volumeDelta : undefined, // Only pass volumeDelta for zap transactions
        } as any);
      })().catch(e => console.error('[useAddLiquidityTransactionV2] Post-deposit processing error:', e));

      onOpenChange(false);
    }
  }, [isDepositConfirmed, depositTxHash, accountAddress, token0Symbol, token1Symbol, onLiquidityAdded, onOpenChange, calculatedData, isZapMode]);

  const resetAll = React.useCallback(() => {
    resetApprove();
    resetSwap();
    resetDeposit();
    setIsWorking(false);
    processedDepositHashRef.current = null;
  }, [resetApprove, resetSwap, resetDeposit]);

  return {
    approvalData,
    isCheckingApprovals,
    isWorking: isWorking || isApprovePending || isApproving || isSwapPending || isSwapConfirming || isDepositPending || isDepositConfirming,
    isApproving: isApproving,
    isDepositConfirming,
    isDepositSuccess: isDepositConfirmed,
    handleApprove,
    handleDeposit,
    handleZapSwapAndDeposit,
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
