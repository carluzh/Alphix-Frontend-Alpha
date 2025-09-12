// components/liquidity/useAddLiquidityTransaction.ts
import React, { useState, useCallback, useEffect, useMemo } from "react";
import { 
  useAccount, 
  useWriteContract, 
  useSendTransaction, 
  useWaitForTransactionReceipt,
  useSignTypedData
} from "wagmi";
import { useQueryClient } from '@tanstack/react-query';
import { toast } from "sonner";
import { BadgeCheck, OctagonX } from "lucide-react";
import { TOKEN_DEFINITIONS } from "@/lib/pools-config";
import { prefetchService } from "@/lib/prefetch-service";
import { invalidateAfterTx } from '@/lib/invalidation';
import { invalidateActivityCache, invalidateUserPositionsCache, invalidateUserPositionIdsCache, refreshFeesAfterTransaction } from "@/lib/client-cache";
import { clearBatchDataCache } from "@/lib/cache-version";
import { ERC20_ABI } from "@/lib/abis/erc20";
import { type Hex, formatUnits, parseUnits, encodeFunctionData } from "viem";
import { TokenSymbol } from "@/lib/pools-config";
import { preparePermit2BatchForNewPosition, type PreparedPermit2Batch } from "@/lib/liquidity-utils";
import { publicClient } from "@/lib/viemClient";
import { PERMIT2_ADDRESS } from "@/lib/swap-constants";
import { readContract } from '@wagmi/core';
import { erc20Abi } from 'viem';
import { config } from '@/lib/wagmiConfig';

// Helper function to safely parse amounts
const safeParseUnits = (amount: string, decimals: number): bigint => {
  const cleaned = (amount || '').toString().replace(/,/g, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '< 0.0001') return 0n;
  return parseUnits(cleaned, decimals);
};

// Define types for transaction-related state
export type TransactionStep = 'input' | 'approve' | 'mint';

export type PreparedTxData = {
  needsApproval: boolean;
  approvalType?: 'ERC20_TO_PERMIT2';
  approvalTokenSymbol?: TokenSymbol;
  approvalTokenAddress?: string;
  approvalAmount?: string;
  approveToAddress?: string;
  transaction?: {
    to: string;
    data: string;
    value?: string;
  };
  batchPermitOptions?: any;
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
  onLiquidityAdded: (token0Symbol?: string, token1Symbol?: string, txInfo?: { txHash: `0x${string}`; blockNumber?: bigint }) => void;
  onApprovalInsufficient?: () => void;
  onOpenChange: (isOpen: boolean) => void;
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
  onApprovalInsufficient,
  onOpenChange
}: UseAddLiquidityTransactionProps) {
  const queryClient = useQueryClient();
  const { address: accountAddress, chainId } = useAccount();
  
  const [isWorking, setIsWorking] = useState(false);
  const [step, setStep] = useState<TransactionStep>('input');
  const [preparedTxData, setPreparedTxData] = useState<PreparedTxData | null>(null);
  const [needsERC20Approvals, setNeedsERC20Approvals] = useState<TokenSymbol[]>([]);
  const [batchPermitSigned, setBatchPermitSigned] = useState(false);

  // Wagmi hooks for transactions
  const { data: approveTxHash, error: approveWriteError, isPending: isApproveWritePending, writeContractAsync: approveERC20Async, reset: resetApproveWriteContract } = useWriteContract();
  const { isLoading: isApproving, isSuccess: isApproved, error: approveReceiptError } = useWaitForTransactionReceipt({ hash: approveTxHash });
  
  const { data: mintTxHash, error: mintSendError, isPending: isMintSendPending, sendTransactionAsync, reset: resetSendTransaction } = useSendTransaction();
  const { isLoading: isMintConfirming, isSuccess: isMintConfirmed, error: mintReceiptError } = useWaitForTransactionReceipt({ hash: mintTxHash });

  const { signTypedDataAsync } = useSignTypedData();

  // Check what approvals are needed (ERC20 to Permit2)
  const checkApprovals = useCallback(async (): Promise<TokenSymbol[]> => {
    if (!accountAddress || !chainId) return [];

    const needsApproval: TokenSymbol[] = [];
    const tokens = [
      { symbol: token0Symbol, amount: amount0 },
      { symbol: token1Symbol, amount: amount1 }
    ];

    for (const token of tokens) {
      if (!token.amount || parseFloat(token.amount) <= 0) continue;
      
      const tokenDef = TOKEN_DEFINITIONS[token.symbol];
      if (!tokenDef || tokenDef.address === "0x0000000000000000000000000000000000000000") continue;

      try {
        // Check ERC20 allowance to Permit2
        const allowance = await publicClient.readContract({
          address: tokenDef.address as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [accountAddress, PERMIT2_ADDRESS]
        });

        const requiredAmount = safeParseUnits(token.amount, tokenDef.decimals);
        if (allowance < requiredAmount) {
          needsApproval.push(token.symbol);
        }
      } catch (error) {
        console.error(`Error checking allowance for ${token.symbol}:`, error);
      }
    }

    return needsApproval;
  }, [accountAddress, chainId, token0Symbol, token1Symbol, amount0, amount1]);

  // Simple preparation - just check what approvals are needed
  const handlePrepareMint = useCallback(async () => {
    setIsWorking(true);
    try {
      // Check what ERC20 approvals are needed
      const needsApprovals = await checkApprovals();
      setNeedsERC20Approvals(needsApprovals);
      
      if (needsApprovals.length > 0) {
        setStep('approve');
        setPreparedTxData({
          needsApproval: true,
          approvalType: 'ERC20_TO_PERMIT2',
          approvalTokenSymbol: needsApprovals[0], // Show first token needing approval
          approvalTokenAddress: TOKEN_DEFINITIONS[needsApprovals[0]]?.address,
          approvalAmount: "115792089237316195423570985008687907853269984665640564039457584007913129639935", // max uint256
          approveToAddress: PERMIT2_ADDRESS,
        });
      } else {
        setStep('mint');
        setPreparedTxData({ needsApproval: false });
      }
      
      return preparedTxData;
    } catch (error: any) {
      console.error('Prepare mint error:', error);
      toast.error("Preparation Error", { description: error.message || "Failed to prepare transaction" });
      return null;
    } finally {
      setIsWorking(false);
    }
  }, [checkApprovals, preparedTxData]);

  // Function to handle ERC20 approvals
  const handleApprove = useCallback(async () => {
    if (!preparedTxData?.needsApproval || preparedTxData.approvalType !== 'ERC20_TO_PERMIT2' || !approveERC20Async) return;

    setIsWorking(true);

    try {
      await approveERC20Async({
        address: preparedTxData.approvalTokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS, BigInt(preparedTxData.approvalAmount || "0")],
      });
    } catch (error: any) {
      toast.error("Approval Error", { description: error.shortMessage || error.message || "Failed to approve token." });
      setIsWorking(false);
      resetApproveWriteContract();
    }
  }, [preparedTxData, approveERC20Async, resetApproveWriteContract]);

  // Clean mint function with batch permit (like useIncreaseLiquidity)
  const handleMint = useCallback(async () => {
    if (!sendTransactionAsync || !accountAddress || !chainId) return;
    
    setIsWorking(true);
    
    try {
      // Check if we need to get batch permit signature first
      if (!batchPermitSigned) {
        // 1. Get batch permit signature if needed
        const deadline = Math.floor(Date.now() / 1000) + (20 * 60); // 20 minutes
        let batchPermitOptions: any = {};
        
        try {
          const batchPermit = await preparePermit2BatchForNewPosition(
            token0Symbol,
            token1Symbol,
            accountAddress,
            chainId,
            deadline
          );

          if (batchPermit.message.details && batchPermit.message.details.length > 0) {
            const signature = await signTypedDataAsync({
              domain: batchPermit.domain as any,
              types: batchPermit.types as any,
              primaryType: batchPermit.primaryType,
              message: batchPermit.message as any,
            });

            batchPermitOptions = {
              batchPermit: {
                owner: accountAddress,
                permitBatch: batchPermit.message,
                signature,
              }
            };
          }
        } catch (e) {
          console.log('No batch permit needed or failed:', e);
          // Reset batch permit signed state on rejection/failure
          setBatchPermitSigned(false);
          setIsWorking(false);
          if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' && e.message.includes('User rejected')) {
            toast.error('Signature Rejected', { description: 'Permit signature was rejected.' });
          }
          return;
        }
        
        // Store the batch permit data and mark as signed
        setPreparedTxData({
          needsApproval: false,
          ...preparedTxData,
          batchPermitOptions
        });
        setBatchPermitSigned(true);
        setIsWorking(false);
        return; // Exit here - user needs to click Deposit again
      }

      // 2. Prepare transaction with batch permit
      let inputAmount, inputTokenSymbol;
      if (activeInputSide === 'amount0' && amount0 && parseFloat(amount0) > 0) {
        inputAmount = amount0;
        inputTokenSymbol = token0Symbol;
      } else if (activeInputSide === 'amount1' && amount1 && parseFloat(amount1) > 0) {
        inputAmount = amount1;
        inputTokenSymbol = token1Symbol;
      } else if (amount0 && parseFloat(amount0) > 0) {
        inputAmount = amount0;
        inputTokenSymbol = token0Symbol;
      } else if (amount1 && parseFloat(amount1) > 0) {
        inputAmount = amount1;
        inputTokenSymbol = token1Symbol;
      } else {
        throw new Error("No valid amounts provided");
      }

      const requestBody = {
        userAddress: accountAddress,
        token0Symbol,
        token1Symbol,
        inputAmount,
        inputTokenSymbol,
        userTickLower: calculatedData?.finalTickLower ?? parseInt(tickLower),
        userTickUpper: calculatedData?.finalTickUpper ?? parseInt(tickUpper),
        chainId,
        permitSignature: preparedTxData?.batchPermitOptions?.batchPermit?.signature,
        permitBatchData: preparedTxData?.batchPermitOptions?.batchPermit?.permitBatch,
      };

      const response = await fetch('/api/liquidity/prepare-mint-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to prepare transaction");
      }

      const txData = await response.json();
      console.log('API Response:', txData);
      
      // Check if we have transaction data
      if (!txData.transaction || !txData.transaction.to || !txData.transaction.data) {
        throw new Error(`Invalid API response: ${JSON.stringify(txData)}`);
      }
      
      // 3. Send the transaction
      const hash = await sendTransactionAsync({
        to: txData.transaction.to as `0x${string}`,
        data: txData.transaction.data as `0x${string}`,
        value: txData.transaction.value ? BigInt(txData.transaction.value) : undefined,
      });

      try { onLiquidityAdded(token0Symbol, token1Symbol); } catch {}
    } catch (err: any) { 
      let detailedErrorMessage = "Transaction failed";
      if (err instanceof Error) {
        detailedErrorMessage = err.message;
        if ((err as any).shortMessage) { detailedErrorMessage = (err as any).shortMessage; }
      }
      toast.error("Transaction Failed", { description: detailedErrorMessage });
      setIsWorking(false);
      resetSendTransaction();
    }
  }, [sendTransactionAsync, accountAddress, chainId, token0Symbol, token1Symbol, amount0, amount1, activeInputSide, calculatedData, tickLower, tickUpper, signTypedDataAsync, onLiquidityAdded, resetSendTransaction, batchPermitSigned, preparedTxData]);

  // Function to reset the transaction state
  const resetTransactionState = useCallback(() => {
    setStep('input');
    setPreparedTxData(null);
    setNeedsERC20Approvals([]);
    setBatchPermitSigned(false);
    setIsWorking(false);
    resetApproveWriteContract();
    resetSendTransaction();
  }, [resetApproveWriteContract, resetSendTransaction]);

  // Update states when approve transaction is completed
  useEffect(() => {
    if (isApproved && preparedTxData) {
      // Re-check actual allowances after each approval transaction
      const recheckAllowances = async () => {
        try {
          // Wait a bit for the blockchain state to update
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          console.log(`[Approval Check] Re-checking actual allowances after ${preparedTxData.approvalTokenSymbol} approval`);
          console.log(`[Approval Check] Input amounts: ${token0Symbol}=${amount0}, ${token1Symbol}=${amount1}`);
          
          // Check actual allowances vs required amounts for both tokens
          const stillNeedsApprovals: TokenSymbol[] = [];
          const tokens = [
            { symbol: token0Symbol, amount: amount0 },
            { symbol: token1Symbol, amount: amount1 }
          ];

          for (const token of tokens) {
            if (!token.amount || parseFloat(token.amount) <= 0) continue;
            
            const tokenDef = TOKEN_DEFINITIONS[token.symbol];
            if (!tokenDef || !accountAddress) continue;

            try {
              const allowance = await readContract(config, {
                address: tokenDef.address as `0x${string}`,
                abi: erc20Abi,
                functionName: 'allowance',
                args: [accountAddress, PERMIT2_ADDRESS as `0x${string}`],
                blockTag: 'latest'
              });

              const requiredAmount = parseUnits(token.amount, tokenDef.decimals);
              
              if (allowance < requiredAmount) {
                stillNeedsApprovals.push(token.symbol);
              }
            } catch (error) {
              console.error(`Error checking allowance for ${token.symbol}:`, error);
              stillNeedsApprovals.push(token.symbol); // Be safe, assume needs approval
            }
          }
          
          console.log(`[Approval Check] Tokens still needing approval:`, stillNeedsApprovals);
          
          if (stillNeedsApprovals.length > 0) {
            // Still need approvals - trigger wiggle if this token still needs approval
            if (stillNeedsApprovals.includes(preparedTxData.approvalTokenSymbol as TokenSymbol)) {
              if (onApprovalInsufficient) {
                onApprovalInsufficient();
              }
              toast.error("Insufficient Approval");
            } else {
              toast.success(`${preparedTxData.approvalTokenSymbol} Approved`);
            }
            
            // Update the needs approval list and set up next approval with exact amount needed
            setNeedsERC20Approvals(stillNeedsApprovals);
            
            // Calculate exact amount needed for the first token that needs approval
            const nextTokenSymbol = stillNeedsApprovals[0];
            const nextTokenDef = TOKEN_DEFINITIONS[nextTokenSymbol];
            const nextTokenAmount = nextTokenSymbol === token0Symbol ? amount0 : amount1;
            const exactAmountNeeded = parseUnits(nextTokenAmount || '0', nextTokenDef.decimals);
            
            // Round up by 1 smallest decimal unit
            const buffer = BigInt(Math.pow(10, Math.max(0, nextTokenDef.decimals - 6))); // 1 micro-unit
            const roundedUpAmount = exactAmountNeeded + buffer;
            
            setPreparedTxData({
              needsApproval: true,
              approvalType: 'ERC20_TO_PERMIT2',
              approvalTokenSymbol: nextTokenSymbol,
              approvalTokenAddress: nextTokenDef.address,
              approvalAmount: roundedUpAmount.toString(),
              approveToAddress: PERMIT2_ADDRESS,
            });
          } else {
            // All approvals done
            console.log(`[Approval Check] ✅ All approvals complete!`);
            toast.success(`${preparedTxData.approvalTokenSymbol} Approved`);
            setNeedsERC20Approvals([]);
            setStep('mint');
            setPreparedTxData({ needsApproval: false });
          }
          
          setIsWorking(false);
          resetApproveWriteContract();
        } catch (error) {
          console.error('Error re-checking allowances:', error);
          toast.error("Approval Check Failed");
          setIsWorking(false);
          resetApproveWriteContract();
        }
      };

      recheckAllowances();
    }
    
    if (approveWriteError || approveReceiptError) {
      toast.error("Approval Failed", { description: "Token approval transaction failed." });
      setStep('input');
      setIsWorking(false);
      resetApproveWriteContract();
    }
  }, [isApproved, approveWriteError, approveReceiptError, preparedTxData, accountAddress, token0Symbol, token1Symbol, amount0, amount1, onApprovalInsufficient, resetApproveWriteContract]);

  // Update states when mint transaction is completed
  useEffect(() => {
    if (isMintConfirmed && accountAddress) {
      toast.success("Position Created", { icon: React.createElement(BadgeCheck, { className: "h-4 w-4 text-green-500" }) });
      
      // Delegate complex refresh logic to parent component (like other hooks do)
      (async () => {
        let blockNumber: bigint | undefined = undefined;
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: mintTxHash as `0x${string}` });
          blockNumber = receipt?.blockNumber;
        } catch {}
        if (mintTxHash) {
          onLiquidityAdded(token0Symbol, token1Symbol, { 
            txHash: mintTxHash as `0x${string}`, 
            blockNumber 
          });
        } else {
          onLiquidityAdded(token0Symbol, token1Symbol);
        }
        
        // Reset immediately after callback to prevent double loading states
        resetTransactionState();
      })();
      
      // Simple cache invalidation (matching other hooks pattern)
      try { if (accountAddress) prefetchService.notifyPositionsRefresh(accountAddress, 'mint'); } catch {}
      try { if (accountAddress) invalidateActivityCache(accountAddress); } catch {}
      try {
        if (accountAddress) {
          invalidateUserPositionsCache(accountAddress);
          invalidateUserPositionIdsCache(accountAddress);
        }
      } catch {}
      try { clearBatchDataCache(); } catch {}
      
      // Basic React Query invalidation
      try {
        if (accountAddress) {
          invalidateAfterTx(queryClient, {
            owner: accountAddress,
            reason: 'mint'
          }).catch(() => {});
        }
      } catch {}
      
      onOpenChange(false);
    }
    
    if (mintSendError || mintReceiptError) {
      toast.error("Transaction Failed", { description: "Mint transaction failed." });
      setStep('input');
      setIsWorking(false);
      resetSendTransaction();
    }
  }, [isMintConfirmed, mintSendError, mintReceiptError, accountAddress, queryClient, resetTransactionState, onOpenChange, resetSendTransaction, token0Symbol, token1Symbol, onLiquidityAdded, mintTxHash]);

  // Calculate involved tokens count (exclude native ETH)
  const involvedTokensCount = useMemo(() => {
    const tokens: TokenSymbol[] = [];
    if (TOKEN_DEFINITIONS[token0Symbol]?.address !== "0x0000000000000000000000000000000000000000") {
      tokens.push(token0Symbol);
    }
    if (TOKEN_DEFINITIONS[token1Symbol]?.address !== "0x0000000000000000000000000000000000000000") {
      tokens.push(token1Symbol);
    }
    return tokens.length;
  }, [token0Symbol, token1Symbol]);

  // Calculate completed ERC20 approvals count
  const completedERC20ApprovalsCount = useMemo(() => {
    return involvedTokensCount - needsERC20Approvals.length;
  }, [involvedTokensCount, needsERC20Approvals.length]);

  return {
    // Transaction state
    isWorking,
    step,
    preparedTxData,
    
    // Progress tracking
    involvedTokensCount,
    completedERC20ApprovalsCount,
    needsERC20Approvals,
    batchPermitSigned,
    
    // Transaction status
    isApproveWritePending,
    isApproving,
    isMintSendPending,
    isMintConfirming,
    isMintSuccess: isMintConfirmed,
    
    // Transaction functions
    handlePrepareMint,
    handleApprove,
    handleMint,
    resetTransactionState,
  };
}