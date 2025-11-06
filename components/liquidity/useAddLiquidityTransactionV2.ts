// Refactored Add Liquidity Transaction Hook (Uniswap-style)
import { useCallback, useState, useRef } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSignTypedData } from 'wagmi';
import { toast } from 'sonner';
import { BadgeCheck, OctagonX, InfoIcon } from 'lucide-react';
import React from 'react';
import { TokenSymbol, TOKEN_DEFINITIONS, NATIVE_TOKEN_ADDRESS, getToken } from '@/lib/pools-config';
import { PERMIT2_ADDRESS, getPermit2Domain, PERMIT_TYPES } from '@/lib/swap-constants';
import { ERC20_ABI } from '@/lib/abis/erc20';
import { type Hex, maxUint256, formatUnits, formatUnits as viemFormatUnits, parseUnits as viemParseUnits } from 'viem';
import { publicClient } from '@/lib/viemClient';
import { useCheckLiquidityApprovals } from './useCheckLiquidityApprovals';
import { useCheckZapApprovals } from './useCheckZapApprovals';

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
  const { address: accountAddress, chainId } = useAccount();

  // Check approvals for regular mode using React Query
  const {
    data: regularApprovalData,
    isLoading: isCheckingRegularApprovals,
    refetch: refetchRegularApprovals,
  } = useCheckLiquidityApprovals(
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
  const {
    data: zapApprovalData,
    isLoading: isCheckingZapApprovals,
    refetch: refetchZapApprovals,
  } = useCheckZapApprovals(
    accountAddress && chainId && calculatedData && isZapMode
      ? {
          userAddress: accountAddress,
          token0Symbol,
          token1Symbol,
          inputTokenSymbol: zapInputToken,
          inputAmount: zapInputToken === 'token0' ? amount0 : amount1,
          chainId,
          tickLower: calculatedData.finalTickLower ?? parseInt(tickLower),
          tickUpper: calculatedData.finalTickUpper ?? parseInt(tickUpper),
        }
      : undefined,
    {
      enabled: isZapMode && Boolean(accountAddress && chainId && calculatedData),
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
      const tokenConfig = getToken(tokenSymbol);
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

  // Handle swap execution for zap mode (simplified - permits signed inline)
  const handleZapSwapAndDeposit = useCallback(
    async (): Promise<void> => {
      if (!accountAddress || !chainId) throw new Error('Wallet not connected');
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
          slippageTolerance: 50,
        };

        // Include permit signature if it was required
        if (swapPermitSignature && zapApprovalData.swapPermitData) {
          requestBody.permitSignature = swapPermitSignature;
          requestBody.permitNonce = zapApprovalData.swapPermitData.nonce;
          requestBody.permitExpiration = zapApprovalData.swapPermitData.expiration;
          requestBody.permitSigDeadline = zapApprovalData.swapPermitData.sigDeadline;
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
        
        // Log the full response for debugging
        console.log('[handleZapSwapAndDeposit] API response:', {
          hasSwapTransaction: !!result.swapTransaction,
          swapTransaction: result.swapTransaction,
          needsApproval: result.needsApproval,
          error: result.error,
          message: result.message,
        });
        
        if (!result.swapTransaction) {
          // Provide more detailed error message
          const errorMsg = result.message || result.error || 'No swap transaction returned from API';
          console.error('[handleZapSwapAndDeposit] Missing swapTransaction:', result);
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
        const getTokenBalance = async (tokenAddress: string, isNative: boolean): Promise<bigint> => {
          if (isNative) {
            return await publicClient.getBalance({ address: accountAddress });
          } else {
            return await publicClient.readContract({
              address: tokenAddress as `0x${string}`,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [accountAddress],
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
        const [balance0After, balance1After] = await Promise.all([
          getTokenBalance(token0Config.address, isToken0Native),
          getTokenBalance(token1Config.address, isToken1Native),
        ]);

        // Calculate actual amounts received from swap
        // Note: Input token balance decreases (we sent tokens), output token balance increases (we received tokens)
        const actualToken0Change = balance0After - balance0Before;
        const actualToken1Change = balance1After - balance1Before;

        // Get swap amount from API response (in wei/smallest units)
        const swapAmount = BigInt(result.details?.swapAmount || '0');
        // Use decimals from pools.json via getToken() (same as swap-interface.tsx)
        const inputTokenDecimals = zapInputToken === 'token0' ? token0Config.decimals : token1Config.decimals;
        const parsedInputAmount = viemParseUnits(inputAmount, inputTokenDecimals);
        
        // Determine which token is input and which is output
        const inputIsToken0 = zapInputToken === 'token0';
        
        // Calculate actual amounts:
        // - Remaining input = total input - swap amount (what we kept, didn't swap)
        //   Note: We calculate this instead of using balance change because:
        //   - For ERC20: balance change is negative (we sent tokens)
        //   - For native ETH: balance change includes gas fees, so it's not accurate
        // - Received output = balance change of output token (what we actually got from swap)
        const remainingInputAmount = parsedInputAmount - swapAmount;
        const receivedOutputAmount = inputIsToken0 ? actualToken1Change : actualToken0Change;
        
        // Map to token0/token1 amounts
        const actualToken0Amount = inputIsToken0 ? remainingInputAmount : receivedOutputAmount;
        const actualToken1Amount = inputIsToken0 ? receivedOutputAmount : remainingInputAmount;

        // Format amounts for API using decimals from pools.json
        const token0AmountStr = viemFormatUnits(actualToken0Amount, token0Config.decimals);
        const token1AmountStr = viemFormatUnits(actualToken1Amount, token1Config.decimals);

        console.log('Using ACTUAL amounts from swap:', {
          swapAmount: swapAmount.toString(),
          remainingInputAmount: remainingInputAmount.toString(),
          actualToken0Change: actualToken0Change.toString(),
          actualToken1Change: actualToken1Change.toString(),
          actualToken0Amount: actualToken0Amount.toString(),
          actualToken1Amount: actualToken1Amount.toString(),
          token0: token0AmountStr,
          token1: token1AmountStr,
          token0Symbol,
          token1Symbol,
        });

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
            slippageTolerance: 50,
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
            throw new Error('Batch permit data missing from API response');
          }

          toast('Sign LP Permit in Wallet', {
            icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
          });

          // Check if we have signatureDetails (like regular flow) or embedded in permitBatchData
          const domain = mintResult.signatureDetails?.domain || mintResult.permitBatchData.domain;
          const types = mintResult.signatureDetails?.types || mintResult.permitBatchData.types;
          const valuesToSign = mintResult.permitBatchData.values || mintResult.permitBatchData.message || mintResult.permitBatchData;

          if (!domain || !types) {
            throw new Error('Missing domain or types for batch permit signature');
          }

          batchPermitSignature = await signTypedDataAsync({
            domain: domain as any,
            types: types as any,
            primaryType: 'PermitBatch',
            message: valuesToSign as any,
          });

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
              slippageTolerance: 50,
              permitSignature: batchPermitSignature,
              permitBatchData: mintResult.permitBatchData, // Include permit batch data
              signatureDetails: mintResult.signatureDetails, // Include signature details if present
            }),
          });

          if (!finalMintResponse.ok) {
            const errorData = await finalMintResponse.json();
            throw new Error(errorData.message || 'Failed to prepare final LP deposit');
          }

          const finalResult = await finalMintResponse.json();

          if (!finalResult.transaction || !finalResult.transaction.data) {
            throw new Error('Invalid LP deposit transaction from API');
          }

          // Execute LP deposit
          toast('Confirm LP Deposit in Wallet', {
            icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
          });

          const depositConfig: any = {
            address: finalResult.transaction.to as `0x${string}`,
            abi: [{
              name: 'multicall',
              type: 'function',
              stateMutability: finalResult.transaction.value && finalResult.transaction.value !== '0' ? 'payable' : 'nonpayable',
              inputs: [{ name: 'data', type: 'bytes[]' }],
              outputs: [{ name: 'results', type: 'bytes[]' }],
            }],
            functionName: 'multicall',
            args: [[finalResult.transaction.data as Hex]],
          };

          if (finalResult.transaction.value && finalResult.transaction.value !== '0') {
            depositConfig.value = BigInt(finalResult.transaction.value);
          }

          await depositAsync(depositConfig);
        } else if (mintResult.transaction && mintResult.transaction.data) {
          // No permit needed, execute directly
          toast('Confirm LP Deposit in Wallet', {
            icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
          });

          const depositConfig: any = {
            address: mintResult.transaction.to as `0x${string}`,
            abi: [{
              name: 'multicall',
              type: 'function',
              stateMutability: mintResult.transaction.value && mintResult.transaction.value !== '0' ? 'payable' : 'nonpayable',
              inputs: [{ name: 'data', type: 'bytes[]' }],
              outputs: [{ name: 'results', type: 'bytes[]' }],
            }],
            functionName: 'multicall',
            args: [[mintResult.transaction.data as Hex]],
          };

          if (mintResult.transaction.value && mintResult.transaction.value !== '0') {
            depositConfig.value = BigInt(mintResult.transaction.value);
          }

          await depositAsync(depositConfig);
        } else {
          throw new Error('Invalid LP deposit response from API');
        }
      } catch (error: any) {
        throw error;
      }
    },
    [accountAddress, chainId, zapApprovalData, calculatedData, tickLower, tickUpper, zapInputToken, amount0, amount1, token0Symbol, token1Symbol, swapAsync, depositAsync, signTypedDataAsync, approveAsync]
  );

  // OLD HANDLERS REMOVED - Now using consolidated handleZapSwapAndDeposit

  // Handle deposit transaction (with optional permit signature)
  const handleDeposit = useCallback(
    async (permitSignature?: string) => {
      if (!accountAddress || !chainId) throw new Error('Wallet not connected');

      // Validate permit requirements (regular mode only)
      if (!isZapMode && regularApprovalData) {
        if ((regularApprovalData.needsToken0Permit || regularApprovalData.needsToken1Permit)) {
          if (!permitSignature) throw new Error('Permit signature required but not provided');
          if (!regularApprovalData.permitBatchData || !regularApprovalData.signatureDetails) {
            throw new Error('Permit batch data missing - please sign permit again');
          }
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
        // In zap mode, after swap is complete, use the mint-after-swap endpoint
        const endpoint = isZapMode ? '/api/liquidity/prepare-mint-after-swap-tx' : '/api/liquidity/prepare-mint-tx';

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
          // Include batch permit signature if we have one
          if (permitSignature) {
            requestBody.permitSignature = permitSignature;
          }
        }

        // If we have a permit signature, include it (only for non-zap mode)
        if (!isZapMode && permitSignature && regularApprovalData?.permitBatchData) {
          requestBody.permitSignature = permitSignature;
          requestBody.permitBatchData = regularApprovalData.permitBatchData;
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

        console.log('[handleDeposit] API response:', result);

        // In the new flow, batch permits are signed before calling handleDeposit
        // So we should not encounter needsApproval here
        if (result.needsApproval) {
          console.error('[handleDeposit] API returned permit request but permit should have been obtained already');
          throw new Error('Permit signature required. Please sign the batch permit first.');
        }

        // In zap mode, the swap was already executed by handleExecuteSwap
        // This function only executes the mint/deposit transaction
        console.log('[handleDeposit] Executing deposit transaction...', { isZapMode, result });

        if (result.transaction && result.transaction.to) {
          // ========== EXECUTE MINT/DEPOSIT TRANSACTION ==========
          // In zap mode: Swap already completed, now minting LP position with both tokens
          // In regular mode: Directly minting LP position with both tokens

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

          toast('Confirm Deposit in Wallet', {
            icon: React.createElement(InfoIcon, { className: 'h-4 w-4' }),
          });

          const hash = await depositAsync(depositConfig);
          console.log('[handleDeposit] Deposit transaction submitted:', hash);
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
    [accountAddress, chainId, token0Symbol, token1Symbol, amount0, amount1, tickLower, tickUpper, calculatedData, approvalData, depositAsync, onLiquidityAdded, isZapMode, zapInputToken, regularApprovalData, signTypedDataAsync]
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
          const { getToken } = await import('@/lib/pools-config');
          const token0Config = getToken(token0Symbol);
          const token1Config = getToken(token1Symbol);
          const amt0 = parseFloat(formatUnits(BigInt(calculatedData.amount0), token0Config?.decimals || 18));
          const amt1 = parseFloat(formatUnits(BigInt(calculatedData.amount1), token1Config?.decimals || 18));
          const [p0, p1] = await Promise.all([getTokenPrice(token0Symbol), getTokenPrice(token1Symbol)]);
          tvlDelta = (p0 ? amt0 * p0 : 0) + (p1 ? amt1 * p1 : 0);
        }
        onLiquidityAdded(token0Symbol, token1Symbol, { txHash: depositTxHash as `0x${string}`, blockNumber: receipt?.blockNumber, tvlDelta });
      })().catch(e => console.error('Post-deposit processing error:', e));

      onOpenChange(false);
    }
  }, [isDepositConfirmed, depositTxHash, accountAddress, token0Symbol, token1Symbol, onLiquidityAdded, onOpenChange, calculatedData]);

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
    handleZapSwapAndDeposit, // New consolidated handler for zap mode
    refetchApprovals,
    reset: resetAll,
  };
}
