// components/liquidity/useAddLiquidityTransaction.ts
import React, { useState, useCallback, useEffect, useMemo } from "react";
import { 
  useAccount, 
  useWriteContract, 
  useSendTransaction, 
  useWaitForTransactionReceipt,
  useSignTypedData
} from "wagmi";
import { toast } from "sonner";
import { BadgeCheck, OctagonX } from "lucide-react";
import { V4_POOL_FEE, V4_POOL_TICK_SPACING, V4_POOL_HOOKS } from "@/lib/swap-constants";
import { TOKEN_DEFINITIONS } from "@/lib/pools-config";
import { baseSepolia } from "@/lib/wagmiConfig";
import { prefetchService } from "@/lib/prefetch-service";
import { invalidateActivityCache, invalidateUserPositionsCache, invalidateUserPositionIdsCache } from "@/lib/client-cache";
import { clearBatchDataCache } from "@/lib/cache-version";
import { ERC20_ABI } from "@/lib/abis/erc20";
import { type Hex, formatUnits, parseUnits, encodeFunctionData } from "viem";
import { TokenSymbol } from "@/lib/pools-config";

// Minimal ABI for Permit2 functions (both single and batch)
const PERMIT2_PERMIT_ABI_MINIMAL = [
  {
    "inputs": [
      { "internalType": "address", "name": "owner", "type": "address" },
      {
        "components": [
          {
            "components": [
              { "internalType": "address", "name": "token", "type": "address" },
              { "internalType": "uint160", "name": "amount", "type": "uint160" },
              { "internalType": "uint48", "name": "expiration", "type": "uint48" },
              { "internalType": "uint48", "name": "nonce", "type": "uint48" }
            ],
            "internalType": "struct ISignatureTransfer.PermitDetails",
            "name": "details",
            "type": "tuple"
          },
          { "internalType": "address", "name": "spender", "type": "address" },
          { "internalType": "uint256", "name": "sigDeadline", "type": "uint256" }
        ],
        "internalType": "struct ISignatureTransfer.PermitSingle",
        "name": "permitSingle",
        "type": "tuple"
      },
      { "internalType": "bytes", "name": "signature", "type": "bytes" }
    ],
    "name": "permit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "owner", "type": "address" },
      {
        "components": [
          {
            "components": [
              { "internalType": "address", "name": "token", "type": "address" },
              { "internalType": "uint160", "name": "amount", "type": "uint160" },
              { "internalType": "uint48", "name": "expiration", "type": "uint48" },
              { "internalType": "uint48", "name": "nonce", "type": "uint48" }
            ],
            "internalType": "struct ISignatureTransfer.PermitDetails[]",
            "name": "details",
            "type": "tuple[]"
          },
          { "internalType": "address", "name": "spender", "type": "address" },
          { "internalType": "uint256", "name": "sigDeadline", "type": "uint256" }
        ],
        "internalType": "struct ISignatureTransfer.PermitBatch",
        "name": "permitBatch",
        "type": "tuple"
      },
      { "internalType": "bytes", "name": "signature", "type": "bytes" }
    ],
    "name": "permit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

// Define types for transaction-related state
export type TransactionStep = 'input' | 'approve' | 'mint' | 'permit2Sign';

export type Permit2SignatureRequest = {
  domain: any;
  types: any;
  primaryType: string;
  message: any;
  permit2Address: Hex;
  approvalTokenSymbol: TokenSymbol;
};

export type PreparedTxData = {
  needsApproval: boolean;
  approvalType?: 'ERC20_TO_PERMIT2' | 'PERMIT2_SIGNATURE_FOR_PM';
  approvalTokenSymbol?: TokenSymbol;
  approvalTokenAddress?: string;
  approvalAmount?: string;
  approveToAddress?: string;
  permit2Address?: Hex;
  signatureDetails?: any;
  transaction?: {
    to: string;
    data: string;
    value?: string;
  };
  processedTokenForThisData?: TokenSymbol;
};

export interface UseAddLiquidityTransactionProps {
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  amount0: string;
  amount1: string;
  tickLower: string;
  tickUpper: string;
  activeInputSide: 'amount0' | 'amount1' | null;
  calculatedData: any | null;
  onLiquidityAdded: (token0Symbol?: string, token1Symbol?: string) => void;
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
  onOpenChange
}: UseAddLiquidityTransactionProps) {
  const { address: accountAddress, chainId } = useAccount();
  
  const [isWorking, setIsWorking] = useState(false);
  const [step, setStep] = useState<TransactionStep>('input');
  const [preparedTxData, setPreparedTxData] = useState<PreparedTxData | null>(null);

  // Permit2 related state
  const [permit2SignatureRequest, setPermit2SignatureRequest] = useState<Permit2SignatureRequest | null>(null);

  // Token approval related state - dynamically initialize based on the tokens being used
  const initialTokenCompletionStatus: Record<TokenSymbol, boolean> = useMemo(() => {
    const status: Record<TokenSymbol, boolean> = {} as Record<TokenSymbol, boolean>;
    status[token0Symbol] = false;
    status[token1Symbol] = false;
    return status;
  }, [token0Symbol, token1Symbol]);
  
  const [tokenCompletionStatus, setTokenCompletionStatus] = useState<Record<TokenSymbol, boolean>>(initialTokenCompletionStatus);

  // Reset token completion status when tokens change
  useEffect(() => {
    setTokenCompletionStatus(initialTokenCompletionStatus);
  }, [initialTokenCompletionStatus]);

  // Wagmi hooks for transactions
  const { data: approveTxHash, error: approveWriteError, isPending: isApproveWritePending, writeContractAsync: approveERC20Async, reset: resetApproveWriteContract } = useWriteContract();
  const { isLoading: isApproving, isSuccess: isApproved, error: approveReceiptError } = useWaitForTransactionReceipt({ hash: approveTxHash });
  
  const { data: mintTxHash, error: mintSendError, isPending: isMintSendPending, sendTransactionAsync, reset: resetSendTransaction } = useSendTransaction();
  const { isLoading: isMintConfirming, isSuccess: isMintConfirmed, error: mintReceiptError } = useWaitForTransactionReceipt({ hash: mintTxHash });

  // Add permit2 transaction hooks for separate permit submission
  const { data: permit2TxHash, error: permit2SendError, isPending: isPermit2SendPending, sendTransactionAsync: sendPermit2TransactionAsync, reset: resetPermit2SendTransaction } = useSendTransaction();
  const { isLoading: isPermit2Confirming, isSuccess: isPermit2Confirmed, error: permit2ReceiptError } = useWaitForTransactionReceipt({ hash: permit2TxHash });

  const { signTypedDataAsync } = useSignTypedData();

  // Function to prepare a mint transaction (internal version)
  const handlePrepareMintInternal = useCallback(async (
    isCalledAfterApprovalOrPermit: boolean, 
    tokenJustProcessed?: TokenSymbol, 
    permitSignature?: string, 
    permitMessage?: any
  ): Promise<PreparedTxData | null> => {
    if (!accountAddress || !chainId) {
      if (!isCalledAfterApprovalOrPermit) toast.error("Wallet Not Connected", { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: "Please connect your wallet to continue." });
      // For internal calls, don't toast, just return null to signal failure to caller
      return null;
    }

    // Determine inputAmount and inputTokenSymbol based on activeInputSide or filled amounts
    let finalInputAmount: string | undefined;
    let finalInputTokenSymbol: TokenSymbol | undefined;

    if (activeInputSide === 'amount0' && amount0 && parseFloat(amount0) > 0) {
        finalInputAmount = amount0;
        finalInputTokenSymbol = token0Symbol;
    } else if (activeInputSide === 'amount1' && amount1 && parseFloat(amount1) > 0) {
        finalInputAmount = amount1;
        finalInputTokenSymbol = token1Symbol;
    } else if (amount0 && parseFloat(amount0) > 0 && (!amount1 || parseFloat(amount1) <= 0)) {
        finalInputAmount = amount0;
        finalInputTokenSymbol = token0Symbol;
    } else if (amount1 && parseFloat(amount1) > 0 && (!amount0 || parseFloat(amount0) <= 0)) {
        finalInputAmount = amount1;
        finalInputTokenSymbol = token1Symbol;
    } else if (amount0 && parseFloat(amount0) > 0) {
        finalInputAmount = amount0;
        finalInputTokenSymbol = token0Symbol;
    } else if (amount1 && parseFloat(amount1) > 0) {
        finalInputAmount = amount1;
        finalInputTokenSymbol = token1Symbol;
    }

    if (!finalInputAmount || !finalInputTokenSymbol) {
        if (!isCalledAfterApprovalOrPermit) toast.error("Missing Amount", { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: "Please enter an amount for at least one token." });
        return null;
    }

    const finalTickLowerNum = calculatedData?.finalTickLower ?? parseInt(tickLower);
    const finalTickUpperNum = calculatedData?.finalTickUpper ?? parseInt(tickUpper);

    if (isNaN(finalTickLowerNum) || isNaN(finalTickUpperNum) || finalTickLowerNum >= finalTickUpperNum) {
      toast.error("Invalid Range", { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: "The price range is invalid or overlapping." });
      return null;
    }
    if (token0Symbol === token1Symbol) {
      toast.error("Invalid Tokens", { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: "Cannot create pool with identical tokens." });
      return null;
    }
    
    if (!isCalledAfterApprovalOrPermit) {
      setStep('input');
      setTokenCompletionStatus(initialTokenCompletionStatus); // Reset completion status on fresh preparation
    }
    
    let rawResponseData: any;
    try {
      // Prepare the request body
      const requestBody: any = {
        userAddress: accountAddress,
        token0Symbol, 
        token1Symbol,
        inputAmount: finalInputAmount,         
        inputTokenSymbol: finalInputTokenSymbol, 
        userTickLower: finalTickLowerNum,
        userTickUpper: finalTickUpperNum,
        chainId: chainId ?? baseSepolia.id,
        tokenJustProcessed: isCalledAfterApprovalOrPermit ? tokenJustProcessed : undefined,
      };

      // Note: No longer sending permit data since permits are handled separately
      console.log(`[DEBUG Frontend] Preparing API call for ${token0Symbol}/${token1Symbol}:`);
      console.log(`[DEBUG Frontend] isCalledAfterApprovalOrPermit:`, isCalledAfterApprovalOrPermit);
      console.log(`[DEBUG Frontend] tokenJustProcessed:`, tokenJustProcessed);
      console.log(`[DEBUG Frontend] Sending simple API request (permits handled separately)`);

      const response = await fetch('/api/liquidity/prepare-mint-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      
      rawResponseData = await response.json();

      if (!response.ok) {
        // Use rawResponseData here, as it might contain an error message
        const err = new Error(rawResponseData?.message || "Failed to prepare transaction."); 
        throw err; 
      }
      const data: PreparedTxData = rawResponseData as PreparedTxData;
      data.processedTokenForThisData = tokenJustProcessed;

      setPreparedTxData(data);

      if (data.needsApproval) {
        if (data.approvalType === 'ERC20_TO_PERMIT2') {
          setStep('approve'); 
        } else if (data.approvalType === 'PERMIT2_SIGNATURE_FOR_PM') {
          if (!data.permit2Address) {
            toast.error("Internal Error: Permit2 address is missing");
            setStep('input');
            return null;
          }
          setPermit2SignatureRequest({
            domain: data.signatureDetails.domain,
            types: data.signatureDetails.types,
            primaryType: data.signatureDetails.primaryType,
            message: data.signatureDetails.message,
            permit2Address: data.permit2Address,
            approvalTokenSymbol: data.approvalTokenSymbol as TokenSymbol
          });
          setStep('permit2Sign');
        } else {
          if (!isCalledAfterApprovalOrPermit) toast.error("Unknown Approval Needed");
          setStep('input');
        }
      } else {
        if (!isCalledAfterApprovalOrPermit || (isCalledAfterApprovalOrPermit && tokenJustProcessed)) {
             // If no approval needed, all involved tokens are considered complete.
             // This happens on initial check if no approvals needed, or after the last approval.
            const tokensToComplete: Record<TokenSymbol, boolean> = {} as Record<TokenSymbol, boolean>;
            if (parseFloat(amount0) > 0) tokensToComplete[token0Symbol] = true;
            if (parseFloat(amount1) > 0) tokensToComplete[token1Symbol] = true;
            setTokenCompletionStatus(prev => ({...prev, ...tokensToComplete}));
        }
        setStep('mint');
      }
      return data; // Return the fetched data
    } catch (error: any) {
      if (error && typeof error.message === 'string' && 
          (error.message.includes("Position Manager does not have sufficient allowance from Permit2") || 
           error.message.includes("Permit2 allowance for the Position Manager to spend"))) {
           toast.error("Permit2 Authorization Incomplete");
      } else {
           if (!isCalledAfterApprovalOrPermit) toast.error(error.message || "Error Preparing Transaction");
      }
      return null; // Return null on error
    } finally {
      // setIsWorking(false); // Caller manages isWorking
    }
  }, [
    accountAddress, 
    chainId, 
    token0Symbol, 
    token1Symbol, 
    amount0, 
    amount1,
    tickLower,
    tickUpper,
    activeInputSide,
    calculatedData,
    preparedTxData,
    initialTokenCompletionStatus
  ]);

  // Exposed function for UI to initiate preparation
  const handlePrepareMint = useCallback(async () => {
    setIsWorking(true);
    const preparedData = await handlePrepareMintInternal(false);
    setIsWorking(false);
    return preparedData;
  }, [handlePrepareMintInternal]);

  // Function to handle ERC20 approvals
  const handleApprove = useCallback(async () => {
    if (!preparedTxData?.needsApproval || preparedTxData.approvalType !== 'ERC20_TO_PERMIT2' || !approveERC20Async) return;

    if (!accountAddress || chainId === undefined || chainId === null) {
      toast.error("Connection Error", { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: "Wallet not connected or chain not identified." });
      setIsWorking(false);
      return;
    }
    if (!preparedTxData.approvalTokenAddress) {
      toast.error("Approval Error: Approval token address is missing.");
      setIsWorking(false);
      return;
    }

    setIsWorking(true);
    
    try {
      const approvalAmountBigInt = BigInt(preparedTxData.approvalAmount ?? "0");

      if (chainId !== baseSepolia.id) {
        toast.error(`Network Mismatch: Please switch to ${baseSepolia.name}`);
        setIsWorking(false);
        return;
      }

      await approveERC20Async({
        address: preparedTxData.approvalTokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [preparedTxData.approveToAddress as `0x${string}`, approvalAmountBigInt],
        account: accountAddress,
        chain: baseSepolia,
      });
    } catch (err: any) {
      
      let detailedErrorMessage = "Unknown error during approval.";
      if (err instanceof Error) {
        detailedErrorMessage = err.message;
        if ((err as any).shortMessage) { detailedErrorMessage = (err as any).shortMessage; }
      }
      toast.error("Approval Failed", { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: detailedErrorMessage });
      setIsWorking(false);
      resetApproveWriteContract();
    }
  }, [accountAddress, chainId, preparedTxData, approveERC20Async, resetApproveWriteContract]);

  // Function to handle Permit2 signing and separate submission to Permit2 contract
  const handleSignAndSubmitPermit2 = useCallback(async () => {
    // Guard against re-entry / wrong step
    if (isWorking || isPermit2SendPending || isPermit2Confirming || step !== 'permit2Sign') return;
    if (!permit2SignatureRequest || !accountAddress || !chainId) {
      toast.error("Permit2 Error: Missing data for Permit2 signature.");
      return;
    }

    setIsWorking(true);

    try {
      const { domain, types, primaryType, message, permit2Address, approvalTokenSymbol } = permit2SignatureRequest;
      
      // Handle both PermitSingle and PermitBatch message formats
      let typedMessage: any;
      
      if (primaryType === 'PermitBatch') {
        // For PermitBatch, details is an array
        typedMessage = {
          details: message.details.map((detail: any) => ({
            token: detail.token as Hex,
            amount: BigInt(detail.amount), // uint160 -> BigInt
            expiration: Number(detail.expiration), // uint48 -> Number
            nonce: Number(detail.nonce), // uint48 -> Number
          })),
          spender: message.spender as Hex,
          sigDeadline: BigInt(message.sigDeadline), // uint256 -> BigInt
        };
      } else {
        // For PermitSingle, details is a single object
        typedMessage = {
          details: {
            token: message.details.token as Hex,
            amount: BigInt(message.details.amount), // uint160 -> BigInt
            expiration: Number(message.details.expiration), // uint48 -> Number
            nonce: Number(message.details.nonce), // uint48 -> Number
          },
          spender: message.spender as Hex,
          sigDeadline: BigInt(message.sigDeadline), // uint256 -> BigInt
        };
      }

      const signature = await signTypedDataAsync({
        domain,
        types,
        primaryType,
        message: typedMessage,
        account: accountAddress,
      });

      // Now submit the permit separately to Permit2 contract
      // Prepare permit transaction data
      const permitCalldata = encodeFunctionData({
        abi: PERMIT2_PERMIT_ABI_MINIMAL,
        functionName: 'permit',
        args: [
          accountAddress,
          primaryType === 'PermitBatch' ? {
            details: typedMessage.details,
            spender: typedMessage.spender,
            sigDeadline: typedMessage.sigDeadline
          } : {
            details: typedMessage.details,
            spender: typedMessage.spender,
            sigDeadline: typedMessage.sigDeadline
          },
          signature as Hex
        ],
      });

      await sendPermit2TransactionAsync({
        to: permit2Address,
        data: permitCalldata,
      });

      console.log(`[DEBUG Frontend] Permit transaction submitted for ${approvalTokenSymbol}`);
      
    } catch (err: any) {
      let detailedErrorMessage = "Permit2 operation failed.";
      if (err instanceof Error) {
        detailedErrorMessage = err.message;
        if ((err as any).shortMessage) { detailedErrorMessage = (err as any).shortMessage; }
      }
      toast.error(`Permit2 Error: ${detailedErrorMessage}`);
      setIsWorking(false);
      resetPermit2SendTransaction();
    }
  }, [accountAddress, chainId, permit2SignatureRequest, signTypedDataAsync, sendPermit2TransactionAsync, resetPermit2SendTransaction, isWorking, isPermit2SendPending, isPermit2Confirming, step]);

  // Function to handle minting
  const handleMint = useCallback(async () => {
    if (!preparedTxData || preparedTxData.needsApproval || !sendTransactionAsync) return;
    if (!preparedTxData.transaction || typeof preparedTxData.transaction.data !== 'string') {
      toast.error("Invalid Transaction", { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: "Transaction data is missing or invalid." });
      setStep('input'); 
      setIsWorking(false);
      return;
    }
    
    setIsWorking(true);
    
    try {
      const { to, data, value: txValueString } = preparedTxData.transaction;
      const txParams: { to: `0x${string}`; data: Hex; value?: bigint } = {
        to: to as `0x${string}`,
        data: data as Hex,
      };
      if (txValueString && BigInt(txValueString) > 0n) {
        txParams.value = BigInt(txValueString);
      }
      const hash = await sendTransactionAsync(txParams);
      // Immediately notify UI to show skeleton while waiting for confirmation
      try { onLiquidityAdded(token0Symbol, token1Symbol); } catch {}
    } catch (err: any) { 
      let detailedErrorMessage = "Unknown error sending mint transaction.";
      if (err instanceof Error) {
        detailedErrorMessage = err.message;
        if ((err as any).shortMessage) { detailedErrorMessage = (err as any).shortMessage; }
      }
      toast.error("Transaction Failed", { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: detailedErrorMessage });
      setIsWorking(false);
      resetSendTransaction();
    }
  }, [preparedTxData, sendTransactionAsync, resetSendTransaction]);

  // Function to reset the transaction state
  const resetTransactionState = useCallback(() => {
    setStep('input');
    setPreparedTxData(null);
    setPermit2SignatureRequest(null);
    setIsWorking(false);
    setTokenCompletionStatus(initialTokenCompletionStatus);
    resetApproveWriteContract();
    resetSendTransaction();
    resetPermit2SendTransaction();
  }, [initialTokenCompletionStatus, resetApproveWriteContract, resetSendTransaction, resetPermit2SendTransaction]);

  // Update states when approve transaction is completed
  useEffect(() => {
    if (isApproved) {
      const currentApprovedTokenSymbol = preparedTxData?.approvalTokenSymbol;
      
      resetApproveWriteContract(); 
      
      if (currentApprovedTokenSymbol) {
        const checkNextStep = async () => {
          setIsWorking(true);
          const nextPrepData = await handlePrepareMintInternal(true, currentApprovedTokenSymbol);
          if (nextPrepData) {
            if (!nextPrepData.needsApproval || (nextPrepData.needsApproval && nextPrepData.approvalTokenSymbol !== currentApprovedTokenSymbol)) {
              // currentApprovedTokenSymbol is now fully processed for this operation
              setTokenCompletionStatus(prev => ({ ...prev, [currentApprovedTokenSymbol]: true }));
            }
            // If nextPrepData requires further action for currentApprovedTokenSymbol, it's handled by handlePrepareMintInternal setting the step.
          } else {
            // Error or abort during prepare mint internal, reset relevant states
            setStep('input'); // Or handle error more gracefully
            setPreparedTxData(null);
          }
          setIsWorking(false); 
        };
        checkNextStep();
      } else {
        setIsWorking(false); // No token to process further
      }
    }
    
    if (approveWriteError || approveReceiptError) {
      const errorMsg = (approveWriteError as any)?.shortMessage || (approveReceiptError as any)?.shortMessage || approveWriteError?.message || approveReceiptError?.message || "Approval transaction failed.";
      toast.error("Approval Failed", { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: errorMsg });
      setIsWorking(false);
      resetApproveWriteContract();
      setPreparedTxData(null);
      setStep('input'); 
    }
  }, [isApproved, approveWriteError, approveReceiptError, preparedTxData, resetApproveWriteContract, handlePrepareMintInternal]);

  // Update states when permit2 transaction is completed
  useEffect(() => {
    if (isPermit2Confirmed) {
      const currentPermitTokenSymbol = permit2SignatureRequest?.approvalTokenSymbol;
      
      resetPermit2SendTransaction();
      
      if (currentPermitTokenSymbol) {
        // Mark token as completed and prepare final mint transaction
        const checkNextStep = async () => {
          setIsWorking(true);
          
          // For PermitBatch, mark ALL tokens in the batch as completed, not just the approvalTokenSymbol
          if (permit2SignatureRequest?.message?.details) {
            const updatedStatus: Record<string, boolean> = {};
            const details = permit2SignatureRequest.message.details;
            
            console.log('[DEBUG] PermitBatch completion - details:', details);
            console.log('[DEBUG] Available tokens:', { token0Symbol, token1Symbol });
            
            // If details is an array (PermitBatch), mark all tokens as completed
            if (Array.isArray(details)) {
              // Map token addresses back to symbols
              details.forEach((detail: any) => {
                const tokenAddress = detail.token?.toLowerCase();
                console.log('[DEBUG] Checking token address:', tokenAddress);
                
                // Find the matching token symbol
                [token0Symbol, token1Symbol].forEach(symbol => {
                  const tokenDef = TOKEN_DEFINITIONS[symbol];
                  if (tokenDef) {
                    console.log('[DEBUG] Comparing with', symbol, ':', tokenDef.address.toLowerCase());
                    if (tokenDef.address.toLowerCase() === tokenAddress) {
                      console.log('[DEBUG] Marking', symbol, 'as completed');
                      updatedStatus[symbol] = true;
                    }
                  }
                });
              });
            } else {
              // Single permit - just mark the current token
              updatedStatus[currentPermitTokenSymbol] = true;
            }
            
            console.log('[DEBUG] Final updatedStatus:', updatedStatus);
            setTokenCompletionStatus(prev => ({ ...prev, ...updatedStatus }));
            
            // Clear stale prepared data to avoid UI showing old needsApproval flags
            setPreparedTxData(null);

            // Check if all tokens are now completed
            const currentStatus = { ...tokenCompletionStatus, ...updatedStatus };
            const allTokensCompleted = [token0Symbol, token1Symbol].every(symbol => currentStatus[symbol]);
            
            console.log('[DEBUG] All tokens completed after PermitBatch:', allTokensCompleted);
            
            if (allTokensCompleted) {
              // All permits done, go straight to mint
              console.log('[DEBUG] All tokens completed, preparing final mint transaction');
              const nextPrepData = await handlePrepareMintInternal(true, currentPermitTokenSymbol);
              if (nextPrepData && !nextPrepData.needsApproval) {
                setStep('mint');
              }
            } else {
              // Some tokens still need processing
              console.log('[DEBUG] Some tokens still need processing, re-preparing transaction');
              const nextPrepData = await handlePrepareMintInternal(true, currentPermitTokenSymbol);
              if (nextPrepData) {
                if (!nextPrepData.needsApproval) {
                  setStep('mint');
                }
              } else {
                setStep('input');
                setPreparedTxData(null);
              }
            }
          } else {
            // Fallback to old behavior
            setTokenCompletionStatus(prev => ({ ...prev, [currentPermitTokenSymbol]: true }));
            
            // Clear stale prepared data to avoid UI showing old needsApproval flags
            setPreparedTxData(null);

            // Re-prepare transaction without permit data since permit is now on-chain
            console.log('[DEBUG] Re-preparing transaction after PermitBatch, tokenJustProcessed:', currentPermitTokenSymbol);
            console.log('[DEBUG] Current tokenCompletionStatus before API call:', tokenCompletionStatus);
            const nextPrepData = await handlePrepareMintInternal(true, currentPermitTokenSymbol);
            if (nextPrepData) {
              if (!nextPrepData.needsApproval) {
                setStep('mint');
              }
            } else {
              setStep('input');
              setPreparedTxData(null);
            }
          }
          setIsWorking(false);
        };
        checkNextStep();
      } else {
        setIsWorking(false);
      }
    }
    
    if (permit2SendError || permit2ReceiptError) {
      const errorMsg = (permit2SendError as any)?.shortMessage || (permit2ReceiptError as any)?.shortMessage || permit2SendError?.message || permit2ReceiptError?.message || "Permit transaction failed.";
      toast.error("Permit Failed", { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: errorMsg });
      setIsWorking(false);
      resetPermit2SendTransaction();
      setStep('permit2Sign'); // Stay on permit step to retry
    }
  }, [isPermit2Confirmed, permit2SendError, permit2ReceiptError, permit2SignatureRequest, resetPermit2SendTransaction, handlePrepareMintInternal]);

  // Update states when mint transaction is completed
  useEffect(() => {
    if (isMintConfirmed) {
      toast.success("Position Created", { icon: React.createElement(BadgeCheck, { className: "h-4 w-4 text-green-500" }) });
      try { if (accountAddress) prefetchService.notifyPositionsRefresh(accountAddress, 'mint'); } catch {}
      try { if (accountAddress) invalidateActivityCache(accountAddress); } catch {}
      try {
        if (accountAddress) {
          invalidateUserPositionsCache(accountAddress);
          invalidateUserPositionIdsCache(accountAddress);
        }
      } catch {}
      // CRITICAL: Invalidate global batch cache after liquidity addition
      try {
        // Clear client cache immediately
        clearBatchDataCache();
        // Trigger server-side cache invalidation
        fetch('/api/internal/revalidate-pools', { method: 'POST' }).catch(() => {});
      } catch {}
      // Set hint for newly created position to ensure it's included in cached data
      try {
        if (typeof window !== 'undefined' && accountAddress) {
          const hintKey = `recentPositionCreated:${accountAddress.toLowerCase()}`;
          // Note: We don't have the exact position ID here, but we can set a flag to wait for new positions
          window.localStorage.setItem(hintKey, JSON.stringify({
            positionId: null, // Will be detected by checking for new positions in the response
            timestamp: Date.now(),
            action: 'create'
          }));
        }
      } catch {}
      resetTransactionState();
      onOpenChange(false);
      resetSendTransaction();
    }
    
    if (mintSendError || mintReceiptError) {
      const errorMsg = (mintSendError as any)?.shortMessage || (mintReceiptError as any)?.shortMessage || mintSendError?.message || mintReceiptError?.message || "Minting transaction failed.";
      toast.error("Position Creation Failed", { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: errorMsg });
      
      setIsWorking(false);
      resetSendTransaction();
      setStep('mint');
    }
  }, [isMintConfirmed, mintSendError, mintReceiptError, onLiquidityAdded, onOpenChange, resetSendTransaction, resetTransactionState]);

  // Calculate involved and completed tokens for the UI
  const involvedTokensCount = useMemo(() => {
    let count = 0;
    if (amount0 && parseFloat(amount0) > 0) count++;
    if (amount1 && parseFloat(amount1) > 0) count++;
    return count;
  }, [amount0, amount1]);

  const completedTokensCount = useMemo(() => {
    let count = 0;
    if (amount0 && parseFloat(amount0) > 0 && tokenCompletionStatus[token0Symbol]) {
      count++;
    }
    if (amount1 && parseFloat(amount1) > 0 && tokenCompletionStatus[token1Symbol]) {
      count++;
    }
    return count;
  }, [token0Symbol, token1Symbol, amount0, amount1, tokenCompletionStatus]);

  return {
    // Transaction state
    isWorking,
    step,
    preparedTxData,
    permit2SignatureRequest,
    tokenCompletionStatus,
    
    // Transaction status
    isApproveWritePending,
    isApproving,
    isPermit2SendPending,
    isPermit2Confirming,
    isMintSendPending,
    isMintConfirming,
    isMintSuccess: isMintConfirmed,
    
    // Transaction functions
    handlePrepareMint,
    handleApprove,
    handleSignAndSubmitPermit2,
    handleMint,
    resetTransactionState,
    
    // Helper functions
    involvedTokensCount,
    completedTokensCount,
  };
}