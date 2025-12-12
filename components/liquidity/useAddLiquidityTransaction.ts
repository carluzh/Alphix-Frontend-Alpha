import * as Sentry from "@sentry/nextjs";
import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  useAccount,
  useWriteContract,
  useSendTransaction,
  useWaitForTransactionReceipt,
  usePublicClient
} from "wagmi";
import { useQueryClient } from '@tanstack/react-query';
import { toast } from "sonner";
import { BadgeCheck, OctagonX, CircleCheck, InfoIcon } from "lucide-react";

const showErrorToast = (title: string, description?: string, error?: unknown) => {
  if (error) {
    Sentry.captureException(error, {
      tags: { operation: 'liquidity_add' },
      extra: { title, description }
    });
  } else {
    Sentry.captureMessage(`${title}: ${description || 'No description'}`, {
      level: 'error',
      tags: { operation: 'liquidity_add' }
    });
  }
  toast.error(title, {
    icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
    description: description,
    action: {
      label: "Open Ticket",
      onClick: () => window.open('https://discord.com/invite/NTXRarFbTr', '_blank')
    }
  });
};
import { getTokenDefinitions, TokenSymbol, getPoolSubgraphId } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { prefetchService } from "@/lib/prefetch-service";
import { invalidateAfterTx } from '@/lib/invalidation';
import { addPositionIdToCache } from "@/lib/client-cache";
import { ERC20_ABI } from "@/lib/abis/erc20";
import { type Hex, formatUnits, parseUnits, encodeFunctionData, parseAbi, decodeEventLog } from "viem";
import { position_manager_abi } from "@/lib/abis/PositionManager_abi";
import { preparePermit2BatchForNewPosition, type PreparedPermit2Batch } from "@/lib/liquidity-utils";
import { PERMIT2_ADDRESS, V4_POSITION_MANAGER_ADDRESS } from "@/lib/swap-constants";
import { useEthersSigner } from "@/hooks/useEthersSigner";
import { isInfiniteApprovalEnabled } from "@/hooks/useUserSettings";

// Uniswap-compatible signTypedData function for permit signatures
const signTypedDataSimple = async ({ signer, domain, types, value, primaryType }: any) => {
  if (!signer) {
    throw new Error('No signer available');
  }

  try {
    // Prefer ethers _signTypedData (used by Uniswap)
    if (typeof (signer as any)._signTypedData === 'function') {
      return await (signer as any)._signTypedData(domain, types, value);
    }
    // Fallback to v4 RPC
    const address = await signer.getAddress();
    const message = JSON.stringify({
      types,
      domain,
      primaryType: primaryType || 'PermitBatch',
      message: value,
    });
    return await signer.provider.send('eth_signTypedData_v4', [address, message]);
  } catch (error: any) {
    // Fallback for older wallets
    if (error.message?.includes('not found') || error.message?.includes('not implemented')) {
      const address = await signer.getAddress();
      const message = JSON.stringify({
        types,
        domain,
        primaryType: primaryType || 'PermitBatch',
        message: value,
      });
      return await signer.provider.send('eth_signTypedData', [address, message]);
    }
    throw error;
  }
};
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
  approvalType?: 'ERC20_TO_PERMIT2' | 'PERMIT2_BATCH_SIGNATURE';
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
  // SDK-based permit data
  permitBatchData?: any;
  signatureDetails?: {
    domain: any;
    types: any;
    primaryType: string;
  };
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
  const { networkMode } = useNetwork();

  const publicClient = usePublicClient();

  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  const [isWorking, setIsWorking] = useState(false);
  const [step, setStep] = useState<TransactionStep>('input');
  const [preparedTxData, setPreparedTxData] = useState<PreparedTxData | null>(null);
  const [needsERC20Approvals, setNeedsERC20Approvals] = useState<TokenSymbol[]>([]);
  const [allRequiredApprovals, setAllRequiredApprovals] = useState<TokenSymbol[]>([]);
  const [completedApprovals, setCompletedApprovals] = useState<TokenSymbol[]>([]);
  const [batchPermitSigned, setBatchPermitSigned] = useState(false);
  const [isCheckingApprovals, setIsCheckingApprovals] = useState(false);
  const processedApprovalTxRef = useRef<string | null>(null);
  
  // Initialize batchPermitSigned based on existing signature
  useEffect(() => {
    const hasSignature = !!preparedTxData?.batchPermitOptions?.batchPermit?.signature;

    if (hasSignature && !batchPermitSigned) {
      setBatchPermitSigned(true);
    }
  }, [preparedTxData?.batchPermitOptions?.batchPermit?.signature, batchPermitSigned]);

  // Wagmi hooks for transactions
  const { data: approveTxHash, error: approveWriteError, isPending: isApproveWritePending, writeContractAsync: approveERC20Async, reset: resetApproveWriteContract } = useWriteContract();
  const { isLoading: isApproving, isSuccess: isApproved, error: approveReceiptError } = useWaitForTransactionReceipt({ hash: approveTxHash });
  
  const { data: mintTxHash, error: mintSendError, isPending: isMintSendPending, sendTransactionAsync, reset: resetSendTransaction } = useSendTransaction();
  const { isLoading: isMintConfirming, isSuccess: isMintConfirmed, error: mintReceiptError } = useWaitForTransactionReceipt({ hash: mintTxHash });

  const signer = useEthersSigner();

  // Check what approvals are needed (ERC20 to Permit2)
  const checkApprovals = useCallback(async (): Promise<TokenSymbol[]> => {
    if (!accountAddress || !chainId || !publicClient) return [];

    const needsApproval: TokenSymbol[] = [];
    const tokens = [
      { symbol: token0Symbol, amount: amount0 },
      { symbol: token1Symbol, amount: amount1 }
    ];

    for (const token of tokens) {
      const tokenDef = tokenDefinitions[token.symbol];
      if (!tokenDef || tokenDef.address === "0x0000000000000000000000000000000000000000") continue;

      try {
        // Check ERC20 allowance to Permit2
        const allowance = await publicClient.readContract({
          address: tokenDef.address as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [accountAddress, PERMIT2_ADDRESS]
        });

        // For liquidity provision, we need max allowance regardless of current amounts
        // because the API will calculate required amounts for both tokens
        const maxAllowanceNeeded = parseUnits("1000000", tokenDef.decimals); // 1M tokens as threshold
        
        
        if (allowance < maxAllowanceNeeded) {
          needsApproval.push(token.symbol);
        }
      } catch (error) {
        console.error(`Error checking allowance for ${token.symbol}:`, error);
        // Be safe, assume approval needed on error
        needsApproval.push(token.symbol);
      }
    }

    return needsApproval;
  }, [accountAddress, chainId, token0Symbol, token1Symbol, amount0, amount1, publicClient]);

  // Check existing ERC20 approvals to display correct counts
  const updateExistingApprovalCounts = useCallback(async () => {
    if (!accountAddress || !chainId || !publicClient) {
      return;
    }

    const tokens = [token0Symbol, token1Symbol];
    const alreadyApproved: TokenSymbol[] = [];
    const totalRequired: TokenSymbol[] = [];


    for (const tokenSymbol of tokens) {
      const tokenDef = tokenDefinitions[tokenSymbol];
      
      if (!tokenDef || tokenDef.address === "0x0000000000000000000000000000000000000000") {
        continue;
      }

      totalRequired.push(tokenSymbol);

      try {
        // Check ERC20 allowance to Permit2
        const allowance = await publicClient.readContract({
          address: tokenDef.address as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [accountAddress, PERMIT2_ADDRESS]
        });

        const maxAllowanceNeeded = parseUnits("1000000", tokenDef.decimals);
        
        if (allowance >= maxAllowanceNeeded) {
          alreadyApproved.push(tokenSymbol);
        }
      } catch (error) {
        console.error(`Error checking existing allowance for ${tokenSymbol}:`, error);
      }
    }

    
    // Always update the total required approvals to show proper counts
    setAllRequiredApprovals(totalRequired);
    setCompletedApprovals(alreadyApproved);
  }, [accountAddress, chainId, token0Symbol, token1Symbol, publicClient, tokenDefinitions]);

  // Check existing Permit2 allowances to display correct permit status
  const updateExistingPermitStatus = useCallback(async () => {
    if (!accountAddress || !chainId || !publicClient) return;

    const tokens = [token0Symbol, token1Symbol];
    let hasValidPermits = true;

    try {
      const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
      const currentTime = Number(latestBlock.timestamp);

      for (const tokenSymbol of tokens) {
        const tokenDef = tokenDefinitions[tokenSymbol];
        if (!tokenDef || tokenDef.address === "0x0000000000000000000000000000000000000000") continue;

        const [permitAmt, permitExp, permitNonce] = await publicClient.readContract({
          address: PERMIT2_ADDRESS,
          abi: parseAbi(['function allowance(address,address,address) view returns (uint160,uint48,uint48)']),
          functionName: 'allowance',
          args: [accountAddress, tokenDef.address as `0x${string}`, V4_POSITION_MANAGER_ADDRESS as `0x${string}`]
        }) as readonly [bigint, number, number];

        // Need substantial permit amount (1M tokens)
        const requiredPermitAmount = parseUnits("1000000", tokenDef.decimals);
        const hasValidPermit = permitAmt >= requiredPermitAmount && (permitExp === 0 || permitExp > currentTime);

        if (!hasValidPermit) {
          hasValidPermits = false;
          break;
        }
      }

      setBatchPermitSigned(hasValidPermits);
    } catch (error) {
      console.error('Error checking permit status:', error);
      setBatchPermitSigned(false);
    }
  }, [accountAddress, chainId, token0Symbol, token1Symbol, publicClient, tokenDefinitions]);

  // Update approval and permit status when component loads or tokens change
  useEffect(() => {
    if (accountAddress && chainId && token0Symbol && token1Symbol) {
      updateExistingApprovalCounts();
      updateExistingPermitStatus();
    } else {
    }
  }, [accountAddress, chainId, token0Symbol, token1Symbol, updateExistingApprovalCounts, updateExistingPermitStatus]);

  // Comprehensive preparation with deterministic approval checking
  const handlePrepareMint = useCallback(async () => {
    setIsWorking(true);
    setIsCheckingApprovals(true);
    
    try {
      // STEP 1: Check which ERC20 approvals are actually needed for transaction
      const needsApprovals = await checkApprovals();
      setNeedsERC20Approvals(needsApprovals);
      
      
      if (needsApprovals.length > 0) {
        // Start with first approval
        setStep('approve');

        const firstToken = needsApprovals[0];
        const firstTokenDef = tokenDefinitions[firstToken];
        const exactAmount = firstToken === token0Symbol ? amount0 : amount1;
        let approvalAmountStr = "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // max uint256

        if (!isInfiniteApprovalEnabled() && exactAmount && firstTokenDef) {
          try {
            approvalAmountStr = (parseUnits(exactAmount, firstTokenDef.decimals) + 1n).toString();
          } catch {}
        }

        setPreparedTxData({
          needsApproval: true,
          approvalType: 'ERC20_TO_PERMIT2',
          approvalTokenSymbol: firstToken,
          approvalTokenAddress: firstTokenDef?.address,
          approvalAmount: approvalAmountStr,
          approveToAddress: PERMIT2_ADDRESS,
        });
      } else {
        // Try to prepare transaction - API will handle batch permit requirements
        try {
          const inputAmount = amount0 && parseFloat(amount0) > 0 ? amount0 : amount1;
          const inputTokenSymbol = amount0 && parseFloat(amount0) > 0 ? token0Symbol : token1Symbol;

          const requestBody = {
            userAddress: accountAddress,
            token0Symbol,
            token1Symbol,
            inputAmount,
            inputTokenSymbol,
            userTickLower: calculatedData?.finalTickLower ?? parseInt(tickLower),
            userTickUpper: calculatedData?.finalTickUpper ?? parseInt(tickUpper),
            chainId,
          };

          const response = await fetch('/api/liquidity/prepare-mint-tx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          const result = await response.json();

          if (result.needsApproval) {
            if (result.approvalType === 'PERMIT2_BATCH_SIGNATURE') {
              setStep('mint'); // Ready for signature + mint
              setPreparedTxData({
                needsApproval: true,
                approvalType: 'PERMIT2_BATCH_SIGNATURE',
                permitBatchData: result.permitBatchData,
                signatureDetails: result.signatureDetails,
              });
            } else if (result.approvalType === 'ERC20_TO_PERMIT2') {
              // Server says we need ERC20 approval
              const tokenSymbol = result.approvalTokenSymbol as TokenSymbol;
              setNeedsERC20Approvals([tokenSymbol]);
              setStep('approve');
              setPreparedTxData({
                needsApproval: true,
                approvalType: 'ERC20_TO_PERMIT2',
                approvalTokenSymbol: tokenSymbol,
                approvalTokenAddress: result.approvalTokenAddress,
                approvalAmount: result.approvalAmount,
                approveToAddress: result.approveToAddress,
              });
            } else {
              // Trust server but log unexpected type
              showErrorToast('Preparation failed', 'Server requested unexpected approval type. Please try again.');
            }
          } else {
            setStep('mint');
            setPreparedTxData({ needsApproval: false, transaction: result.transaction });
            // API confirmed no permit needed (or existing permits are valid)
            setBatchPermitSigned(true);
          }
        } catch (error) {
          console.error('Error preparing transaction:', error);
          showErrorToast('Preparation failed', error instanceof Error ? error.message : 'Unknown error', error);
        }
      }
      
      return preparedTxData;
    } catch (error: any) {
      console.error('Prepare mint error:', error);
      showErrorToast("Preparation Error", error.message || "Failed to prepare transaction");
      return null;
    } finally {
      setIsWorking(false);
      setIsCheckingApprovals(false);
    }
  }, [checkApprovals, preparedTxData]);

  // Function to handle ERC20 approvals
  const handleApprove = useCallback(async () => {
    if (!preparedTxData?.needsApproval || preparedTxData.approvalType !== 'ERC20_TO_PERMIT2' || !approveERC20Async) return;

    setIsWorking(true);

    try {
      // Inform user about approval request
      toast("Confirm in Wallet", {
        icon: React.createElement(InfoIcon, { className: "h-4 w-4" })
      });

      await approveERC20Async({
        address: preparedTxData.approvalTokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS, BigInt(preparedTxData.approvalAmount || "0")],
      });
    } catch (error: any) {
      toast.error("Approval Error", {
        icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
        description: error.shortMessage || error.message || "Failed to approve token.",
        action: {
          label: "Open Ticket",
          onClick: () => window.open('https://discord.com/invite/NTXRarFbTr', '_blank')
        }
      });
      setIsWorking(false);
      resetApproveWriteContract();
    }
  }, [preparedTxData, approveERC20Async, resetApproveWriteContract]);

  // Clean mint function with batch permit (like useIncreaseLiquidity)
  const handleMint = useCallback(async () => {
    if (!sendTransactionAsync || !accountAddress || !chainId) {
      return;
    }

    setIsWorking(true);

    try {
      // Check if we have batch permit signature ready
      const hasExistingSignature = preparedTxData?.batchPermitOptions?.batchPermit?.signature;
      const needsNewSignature = preparedTxData?.permitBatchData && preparedTxData?.signatureDetails && !hasExistingSignature;

      if (!batchPermitSigned && !hasExistingSignature) {
        // If we have permit batch data from API preparation, get signature
        if (needsNewSignature) {
          try {
            if (!signer) {
              throw new Error('No signer available - wallet may not be connected');
            }

            
            // Extract the values part for signing - prioritize raw SDK values (not stringified)
            const valuesToSign = (preparedTxData.permitBatchData as any).valuesRaw || preparedTxData.permitBatchData.values || preparedTxData.permitBatchData;

            // Inform user about batch signature request
            toast("Sign in Wallet", {
              icon: React.createElement(InfoIcon, { className: "h-4 w-4" })
            });

            // Use SDK-generated signature data (identical to Uniswap)
            const domainToUse = preparedTxData.signatureDetails!.domain;
            const typesToUse = preparedTxData.signatureDetails!.types;
            const signature = await signTypedDataSimple({
              signer,
              domain: domainToUse,
              types: typesToUse,
              value: valuesToSign,
              primaryType: preparedTxData.signatureDetails!.primaryType
            });
            
            // Store batch permit signature
            const updatedTxData = {
              ...preparedTxData,
              needsApproval: false,
              batchPermitOptions: {
                batchPermit: {
                  owner: accountAddress,
                  permitBatch: valuesToSign, // Use the same values we signed
                  signature,
                }
              }
            };

            setPreparedTxData(updatedTxData);
            setBatchPermitSigned(true);
            
            
            // Show batch signature success toast with deadline duration (like swap)
            const currentTime = Math.floor(Date.now() / 1000);
            const sigDeadline = valuesToSign?.sigDeadline || valuesToSign?.details?.[0]?.expiration || 0;
            const durationSeconds = Number(sigDeadline) - currentTime;

            // Format duration in human-readable format (round UP within the chosen unit)
            let durationFormatted = "";
            if (durationSeconds >= 31536000) {
                const years = Math.ceil(durationSeconds / 31536000);
                durationFormatted = `${years} year${years > 1 ? 's' : ''}`;
            } else if (durationSeconds >= 2592000) {
                const months = Math.ceil(durationSeconds / 2592000);
                durationFormatted = `${months} month${months > 1 ? 's' : ''}`;
            } else if (durationSeconds >= 604800) {
                const weeks = Math.ceil(durationSeconds / 604800);
                durationFormatted = `${weeks} week${weeks > 1 ? 's' : ''}`;
            } else if (durationSeconds >= 86400) {
                const days = Math.ceil(durationSeconds / 86400);
                durationFormatted = `${days} day${days > 1 ? 's' : ''}`;
            } else if (durationSeconds >= 3600) {
                const hours = Math.ceil(durationSeconds / 3600);
                durationFormatted = `${hours} hour${hours > 1 ? 's' : ''}`;
            } else {
                const minutes = Math.ceil(durationSeconds / 60);
                durationFormatted = `${minutes} minute${minutes > 1 ? 's' : ''}`;
            }

            toast.success("Batch Signature Complete", {
              icon: React.createElement(BadgeCheck, { className: "h-4 w-4 text-green-500" }),
              description: `Batch permit signed successfully for ${durationFormatted}`
            });
            
            setIsWorking(false);
            return; // User needs to click Deposit again
          } catch (e) {
            setBatchPermitSigned(false);
            setIsWorking(false);
            if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' && e.message.includes('User rejected')) {
              toast.error('Signature Rejected', {
                icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
                description: 'The permit signature was rejected in your wallet.',
                duration: 4000
              });
            }
            return;
          }
        } else {
          // No batch permit data - fetch fresh permit/tx from API
          
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

          const response = await fetch('/api/liquidity/prepare-mint-tx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userAddress: accountAddress,
              token0Symbol,
              token1Symbol,
              inputAmount,
              inputTokenSymbol,
              userTickLower: calculatedData?.finalTickLower ?? parseInt(tickLower),
              userTickUpper: calculatedData?.finalTickUpper ?? parseInt(tickUpper),
              chainId,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || "Failed to prepare transaction");
          }

          const freshData = await response.json();
          
          if (freshData.needsApproval && freshData.approvalType === 'PERMIT2_BATCH_SIGNATURE') {
            // Update state with fresh permit data and retry
            setPreparedTxData({
              needsApproval: true,
              approvalType: 'PERMIT2_BATCH_SIGNATURE',
              permitBatchData: freshData.permitBatchData,
              signatureDetails: freshData.signatureDetails,
            });
            setIsWorking(false);
            // No toast needed here - user already got proper flow guidance
            return; // User needs to click again
          } else if (!freshData.needsApproval) {
            // Use fresh transaction data
            setPreparedTxData({ needsApproval: false, transaction: freshData.transaction });
            setBatchPermitSigned(true); // No permit needed, so consider it "signed"
            // Continue to transaction execution below
          } else {
            throw new Error(`Unexpected fresh API response: ${JSON.stringify(freshData)}`);
          }
        }
      } else if (hasExistingSignature) {
        setBatchPermitSigned(true); // Ensure state is consistent
      }

      // 2. Use existing transaction data or prepare new transaction with batch permit
      let txData;

      if (preparedTxData?.transaction) {
        // Use existing transaction data
        txData = { transaction: preparedTxData.transaction };
      } else {
        // Need to prepare transaction with batch permit

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

        txData = await response.json();
      }
      
      // Check if we have transaction data
      if (!txData.transaction || !txData.transaction.to || !txData.transaction.data) {
        throw new Error(`Invalid API response: ${JSON.stringify(txData)}`);
      }
      
      // Inform user about deposit transaction request
      toast("Confirm Deposit", {
        icon: React.createElement(InfoIcon, { className: "h-4 w-4" })
      });
      
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
      
      // Check if user rejected the transaction
      const isUserRejection = detailedErrorMessage.toLowerCase().includes("user rejected") ||
                              detailedErrorMessage.toLowerCase().includes("request rejected") ||
                              detailedErrorMessage.toLowerCase().includes("action rejected") ||
                              (err as any).code === 4001;
      
      if (isUserRejection) {
        toast.error("Transaction Rejected", {
          icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
          description: "The request was rejected in your wallet.",
          duration: 4000
        });
      } else {
        toast.error("Transaction Failed", {
          icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
          description: detailedErrorMessage,
          action: {
            label: "Copy Error",
            onClick: () => navigator.clipboard.writeText(detailedErrorMessage)
          }
        });
      }
      
      setIsWorking(false);
      resetSendTransaction();
    }
  }, [sendTransactionAsync, accountAddress, chainId, token0Symbol, token1Symbol, amount0, amount1, activeInputSide, calculatedData, tickLower, tickUpper, signer, onLiquidityAdded, resetSendTransaction, batchPermitSigned, preparedTxData]);

  // Function to reset the transaction state
  const resetTransactionState = useCallback(() => {
    setStep('input');
    setPreparedTxData(null);
    setNeedsERC20Approvals([]);
    setAllRequiredApprovals([]);
    setCompletedApprovals([]);
    setBatchPermitSigned(false);
    setIsWorking(false);
    setIsCheckingApprovals(false);
    processedApprovalTxRef.current = null; // Clear processed transaction ref
    resetApproveWriteContract();
    resetSendTransaction();
  }, [resetApproveWriteContract, resetSendTransaction]);

  // Update states when approve transaction is completed
  useEffect(() => {
    if (isApproved && preparedTxData && approveTxHash) {
      // Guard: Only process each transaction once
      if (processedApprovalTxRef.current === approveTxHash) {
        return;
      }
      
      // Deterministic approval flow
      const handleApprovalSuccess = async () => {
        try {
          // Mark this transaction as processed
          processedApprovalTxRef.current = approveTxHash;
          
          // Keep working state active while preparing next step
          setIsWorking(true);
          
          const approvedToken = preparedTxData.approvalTokenSymbol!;
          
          // Show approval success toast with transaction link (like swap)
          const approvalAmount = BigInt(preparedTxData.approvalAmount || "0");
          const tokenDef = tokenDefinitions[approvedToken];
          const approvalAmountFormatted = tokenDef ? Number(formatUnits(approvalAmount, tokenDef.decimals)) : 0;
          const approvalDescription = approvalAmountFormatted >= 100000000
            ? `Approved infinite ${approvedToken} for liquidity`
            : `Approved ${approvalAmountFormatted.toLocaleString()} ${approvedToken} for liquidity`;

          toast.success(`${approvedToken} Approved`, {
            icon: React.createElement(BadgeCheck, { className: "h-4 w-4 text-green-500" }),
            description: approvalDescription,
            action: {
              label: "View Transaction",
              onClick: () => window.open(getExplorerTxUrl(approveTxHash), '_blank')
            }
          });
          
          // Update completed approvals (only if not already completed)
          let updatedCompletedApprovals = completedApprovals;
          if (!completedApprovals.includes(approvedToken)) {
            updatedCompletedApprovals = [...completedApprovals, approvedToken];
            setCompletedApprovals(updatedCompletedApprovals);
          }
          
          // Calculate remaining approvals using fresh completed list
          const remainingApprovals = allRequiredApprovals.filter(token => 
            !updatedCompletedApprovals.includes(token)
          );
          
          
          if (remainingApprovals.length > 0) {
            // Continue with next approval
            const nextToken = remainingApprovals[0];
            const nextTokenDef = tokenDefinitions[nextToken];
            const nextExactAmount = nextToken === token0Symbol ? amount0 : amount1;
            let nextApprovalAmountStr = "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // max uint256

            if (!isInfiniteApprovalEnabled() && nextExactAmount && nextTokenDef) {
              try {
                nextApprovalAmountStr = (parseUnits(nextExactAmount, nextTokenDef.decimals) + 1n).toString();
              } catch {}
            }

            setPreparedTxData({
              needsApproval: true,
              approvalType: 'ERC20_TO_PERMIT2',
              approvalTokenSymbol: nextToken,
              approvalTokenAddress: nextTokenDef?.address,
              approvalAmount: nextApprovalAmountStr,
              approveToAddress: PERMIT2_ADDRESS,
            });
            setStep('approve');
            setIsWorking(false);
            resetApproveWriteContract();
            return;
          }
          
          // All approvals complete, proceed to permit/transaction preparation

          // Determine input amount/token
          let inputAmount: string | undefined, inputTokenSymbol: TokenSymbol | undefined;
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
            throw new Error('No valid amounts provided'); 
          }

          // Always ask server what's next
          const response = await fetch('/api/liquidity/prepare-mint-tx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userAddress: accountAddress,
              token0Symbol,
              token1Symbol,
              inputAmount,
              inputTokenSymbol,
              userTickLower: calculatedData?.finalTickLower ?? parseInt(tickLower),
              userTickUpper: calculatedData?.finalTickUpper ?? parseInt(tickUpper),
              chainId,
            }),
          });
          
          if (!response.ok) {
            throw new Error('Failed to fetch next step from server');
          }
          
          const result = await response.json();
          
          if (result.needsApproval && result.approvalType === 'PERMIT2_BATCH_SIGNATURE') {
            // Server says we need PermitBatch signature
            setPreparedTxData({
              needsApproval: true,
              approvalType: 'PERMIT2_BATCH_SIGNATURE',
              permitBatchData: result.permitBatchData,
              signatureDetails: result.signatureDetails,
            });
            setNeedsERC20Approvals([]);
            setStep('mint');
            setIsWorking(false);
          } else if (result.needsApproval && result.approvalType === 'ERC20_TO_PERMIT2') {
            // Server says we need another ERC20 approval
            const nextTokenSymbol = result.approvalTokenSymbol as TokenSymbol;
            setNeedsERC20Approvals([nextTokenSymbol]);
            setPreparedTxData({
              needsApproval: true,
              approvalType: 'ERC20_TO_PERMIT2',
              approvalTokenSymbol: nextTokenSymbol,
              approvalTokenAddress: result.approvalTokenAddress,
              approvalAmount: result.approvalAmount,
              approveToAddress: result.approveToAddress,
            });
            setStep('approve');
            setIsWorking(false);
          } else if (!result.needsApproval) {
            // Server says transaction is ready
            setPreparedTxData({ needsApproval: false, transaction: result.transaction });
            setNeedsERC20Approvals([]);
            setStep('mint');
            setBatchPermitSigned(true); // No permit needed, so consider it "signed"
            setIsWorking(false);
          } else {
            throw new Error(`Unexpected server response: ${JSON.stringify(result)}`);
          }
          
          resetApproveWriteContract();
        } catch (error) {
          console.error('Error handling approval success:', error);
          showErrorToast("Failed to determine next step");
          setIsWorking(false);
          resetApproveWriteContract();
        }
      };

      handleApprovalSuccess();
    }
    
    if (approveWriteError || approveReceiptError) {
      toast.error("Approval Failed", {
        icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
        description: "Token approval transaction failed.",
        action: {
          label: "Open Ticket",
          onClick: () => window.open('https://discord.com/invite/NTXRarFbTr', '_blank')
        }
      });
      setStep('input');
      setIsWorking(false);
      resetApproveWriteContract();
    }
  }, [isApproved, approveWriteError, approveReceiptError, preparedTxData, accountAddress, token0Symbol, token1Symbol, amount0, amount1, onApprovalInsufficient, resetApproveWriteContract, allRequiredApprovals, completedApprovals, activeInputSide, calculatedData, tickLower, tickUpper, chainId, approveTxHash]);

  // Track processed mint hashes to prevent duplicate toasts
  const processedMintHashRef = useRef<string | null>(null);

  // Update states when mint transaction is completed
  useEffect(() => {
    if (isMintConfirmed && accountAddress && mintTxHash) {
      // Guard against re-processing the same transaction
      if (processedMintHashRef.current === mintTxHash) {
        return;
      }
      processedMintHashRef.current = mintTxHash;

      // Show success toast & trigger balance refresh
      toast.success("Position Created", {
        icon: React.createElement(BadgeCheck, { className: "h-4 w-4 text-green-500" }),
        description: `Liquidity added to ${token0Symbol}/${token1Symbol} pool successfully`,
        action: mintTxHash ? {
          label: "View Transaction",
          onClick: () => window.open(getExplorerTxUrl(mintTxHash), '_blank')
        } : undefined
      });

      (async () => {
        if (!publicClient) return;
        let blockNumber: bigint | undefined = undefined;
        let newTokenId: string | undefined = undefined;

        // Retry with backoff - RPC might be behind
        let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>> | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            receipt = await publicClient.getTransactionReceipt({ hash: mintTxHash as `0x${string}` });
            if (receipt) break;
          } catch {
            if (attempt < 4) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
          }
        }

        if (receipt) {
          blockNumber = receipt.blockNumber;
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
        }
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
      
      // Invalidate caches after successful mint
      try {
        if (accountAddress && chainId) {
          const poolId = getPoolSubgraphId(`${token0Symbol}/${token1Symbol}`) || undefined;
          invalidateAfterTx(queryClient, {
            owner: accountAddress,
            chainId,
            poolId,
            reason: 'mint'
          }).catch(() => {});
        }
      } catch {}
      
      onOpenChange(false);
    }
    
    if (mintSendError || mintReceiptError) {
      toast.error("Transaction Failed", {
        icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
        description: "Mint transaction failed.",
        action: {
          label: "Open Ticket",
          onClick: () => window.open('https://discord.com/invite/NTXRarFbTr', '_blank')
        }
      });
      setStep('input');
      setIsWorking(false);
      resetSendTransaction();
    }
  }, [isMintConfirmed, mintSendError, mintReceiptError, accountAddress, queryClient, resetTransactionState, onOpenChange, resetSendTransaction, token0Symbol, token1Symbol, onLiquidityAdded, mintTxHash]);

  // Calculate involved tokens count (exclude native ETH)
  const involvedTokensCount = useMemo(() => {
    const tokens: TokenSymbol[] = [];
    if (tokenDefinitions[token0Symbol]?.address !== "0x0000000000000000000000000000000000000000") {
      tokens.push(token0Symbol);
    }
    if (tokenDefinitions[token1Symbol]?.address !== "0x0000000000000000000000000000000000000000") {
      tokens.push(token1Symbol);
    }
    return tokens.length;
  }, [token0Symbol, token1Symbol]);

  // Calculate completed ERC20 approvals count using deterministic state
  const completedERC20ApprovalsCount = useMemo(() => {
    return completedApprovals.length;
  }, [completedApprovals.length]);

  return {
    // Transaction state
    isWorking,
    step,
    preparedTxData,
    
    // Progress tracking
    involvedTokensCount,
    completedERC20ApprovalsCount,
    needsERC20Approvals,
    allRequiredApprovals,
    completedApprovals,
    isCheckingApprovals,
    batchPermitSigned: batchPermitSigned || !!preparedTxData?.batchPermitOptions?.batchPermit?.signature,
    
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