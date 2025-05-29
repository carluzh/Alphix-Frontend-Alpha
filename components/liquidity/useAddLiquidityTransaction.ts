// components/liquidity/useAddLiquidityTransaction.ts
import { useState, useCallback, useEffect, useMemo } from "react";
import { 
  useAccount, 
  useWriteContract, 
  useSendTransaction, 
  useWaitForTransactionReceipt,
  useSignTypedData
} from "wagmi";
import { toast } from "sonner";
import { TokenSymbol, TOKEN_DEFINITIONS } from "@/lib/swap-constants";
import { baseSepolia } from "@/lib/wagmiConfig";
import { ERC20_ABI } from "@/lib/abis/erc20";
import { type Hex, formatUnits, parseUnits } from "viem";

// Minimal ABI for Permit2.permit function
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
  onLiquidityAdded: () => void;
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

  // Token approval related state
  const initialTokenCompletionStatus: Record<TokenSymbol, boolean> = {
    YUSDC: false,
    BTCRL: false,
  };
  const [tokenCompletionStatus, setTokenCompletionStatus] = useState<Record<TokenSymbol, boolean>>(initialTokenCompletionStatus);

  // Wagmi hooks for transactions
  const { data: approveTxHash, error: approveWriteError, isPending: isApproveWritePending, writeContractAsync: approveERC20Async, reset: resetApproveWriteContract } = useWriteContract();
  const { isLoading: isApproving, isSuccess: isApproved, error: approveReceiptError } = useWaitForTransactionReceipt({ hash: approveTxHash });
  
  const { data: mintTxHash, error: mintSendError, isPending: isMintSendPending, sendTransactionAsync, reset: resetSendTransaction } = useSendTransaction();
  const { isLoading: isMintConfirming, isSuccess: isMintConfirmed, error: mintReceiptError } = useWaitForTransactionReceipt({ hash: mintTxHash });

  // Wagmi hooks for Permit2
  const { 
    data: permit2TxHash, 
    error: permit2SendError, 
    isPending: isPermit2SendPending, 
    writeContractAsync: permit2WriteContractAsync, 
    reset: resetPermit2WriteContract 
  } = useWriteContract();
  
  const { 
    isLoading: isPermit2Confirming, 
    isSuccess: isPermit2Confirmed, 
    error: permit2ReceiptError 
  } = useWaitForTransactionReceipt({ hash: permit2TxHash });

  const { signTypedDataAsync } = useSignTypedData();

  // Function to prepare a mint transaction (internal version)
  const handlePrepareMintInternal = useCallback(async (isCalledAfterApprovalOrPermit: boolean, tokenJustProcessed?: TokenSymbol): Promise<PreparedTxData | null> => {
    if (!accountAddress || !chainId) {
      if (!isCalledAfterApprovalOrPermit) toast.error("Please connect your wallet.");
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
        if (!isCalledAfterApprovalOrPermit) toast.error("Please enter an amount for at least one token.");
        return null;
    }

    const finalTickLowerNum = calculatedData?.finalTickLower ?? parseInt(tickLower);
    const finalTickUpperNum = calculatedData?.finalTickUpper ?? parseInt(tickUpper);

    if (isNaN(finalTickLowerNum) || isNaN(finalTickUpperNum) || finalTickLowerNum >= finalTickUpperNum) {
      toast.error("Invalid tick range provided or calculated.");
      return null;
    }
    if (token0Symbol === token1Symbol) {
      toast.error("Tokens cannot be the same.");
      return null;
    }
    
    if (!isCalledAfterApprovalOrPermit) {
      setStep('input');
      toast.loading("Preparing transaction...", { id: "prepare-mint" });
      setTokenCompletionStatus(initialTokenCompletionStatus); // Reset completion status on fresh preparation
    }
    
    let rawResponseData: any;
    try {
      const response = await fetch('/api/liquidity/prepare-mint-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: accountAddress,
          token0Symbol, 
          token1Symbol,
          inputAmount: finalInputAmount,         
          inputTokenSymbol: finalInputTokenSymbol, 
          userTickLower: finalTickLowerNum,
          userTickUpper: finalTickUpperNum,
          chainId: chainId ?? baseSepolia.id,
          tokenJustProcessed: isCalledAfterApprovalOrPermit ? tokenJustProcessed : undefined,
        }),
      });
      
      if (!isCalledAfterApprovalOrPermit) toast.dismiss("prepare-mint");
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
          if (!isCalledAfterApprovalOrPermit || preparedTxData?.approvalTokenSymbol !== data.approvalTokenSymbol || preparedTxData?.approvalType !== data.approvalType) {
            toast.info(`ERC20 Approval for Permit2 needed for ${data.approvalTokenSymbol}`, {
              description: `You need to approve Permit2 to use your ${data.approvalTokenSymbol}.`
            });
          }
          setStep('approve'); 
        } else if (data.approvalType === 'PERMIT2_SIGNATURE_FOR_PM') {
          if (!isCalledAfterApprovalOrPermit || preparedTxData?.approvalTokenSymbol !== data.approvalTokenSymbol || preparedTxData?.approvalType !== data.approvalType) {
            toast.info(`Permit2 Signature needed for ${data.approvalTokenSymbol}`, {
              description: `Please sign the message to allow the Position Manager to use your ${data.approvalTokenSymbol} via Permit2.`
            });
          }
          if (!data.permit2Address) {
            toast.error("Internal Error", { description: "Permit2 address is missing for signature request." });
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
          if (!isCalledAfterApprovalOrPermit) toast.error("Unknown Approval Needed", { description: "An unspecified approval is required." });
          setStep('input');
        }
      } else {
        if (!isCalledAfterApprovalOrPermit || (isCalledAfterApprovalOrPermit && tokenJustProcessed)) {
             // If no approval needed, all involved tokens are considered complete.
             // This happens on initial check if no approvals needed, or after the last approval.
            const tokensToComplete: Record<TokenSymbol, boolean> = { YUSDC: false, BTCRL: false };
            if (parseFloat(amount0) > 0) tokensToComplete[token0Symbol] = true;
            if (parseFloat(amount1) > 0) tokensToComplete[token1Symbol] = true;
            setTokenCompletionStatus(prev => ({...prev, ...tokensToComplete}));
        }
        toast.success("Transaction ready to mint!");
        setStep('mint');
      }
      return data; // Return the fetched data
    } catch (error: any) {
      if (!isCalledAfterApprovalOrPermit) toast.dismiss("prepare-mint");
      if (error && typeof error.message === 'string' && 
          (error.message.includes("Position Manager does not have sufficient allowance from Permit2") || 
           error.message.includes("Permit2 allowance for the Position Manager to spend"))) {
           toast.error("Permit2 Authorization Incomplete", { 
               description: error.message + " This step often requires signing a message or a separate one-time transaction to authorize the Position Manager via Permit2.",
               duration: 12000
           });
      } else {
           if (!isCalledAfterApprovalOrPermit) toast.error("Error Preparing Transaction", { description: error.message || "Unknown error during preparation." });
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
    preparedTxData
  ]);

  // Exposed function for UI to initiate preparation
  const handlePrepareMint = useCallback(async () => {
    setIsWorking(true);
    await handlePrepareMintInternal(false);
    setIsWorking(false);
  }, [handlePrepareMintInternal]);

  // Function to handle ERC20 approvals
  const handleApprove = useCallback(async () => {
    if (!preparedTxData?.needsApproval || preparedTxData.approvalType !== 'ERC20_TO_PERMIT2' || !approveERC20Async) return;

    if (!accountAddress || chainId === undefined || chainId === null) {
      toast.error("Wallet not connected or chain not identified. Please reconnect.");
      setIsWorking(false);
      return;
    }
    if (!preparedTxData.approvalTokenAddress) {
      toast.error("Approval Error", { description: "Approval token address is missing." });
      setIsWorking(false);
      return;
    }

    setIsWorking(true);
    toast.loading(`Approving ${preparedTxData.approvalTokenSymbol}...`, { id: "approve-tx" });
    
    try {
      const approvalAmountBigInt = BigInt(preparedTxData.approvalAmount ?? "0");

      if (chainId !== baseSepolia.id) {
        toast.error("Network Mismatch", { description: `Please switch to ${baseSepolia.name} to approve this transaction.` });
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
      toast.dismiss("approve-tx");
      
      let detailedErrorMessage = "Unknown error during approval.";
      if (err instanceof Error) {
        detailedErrorMessage = err.message;
        if ((err as any).shortMessage) { detailedErrorMessage = (err as any).shortMessage; }
      }
      toast.error("Failed to send approval transaction.", { description: detailedErrorMessage });
      setIsWorking(false);
      resetApproveWriteContract();
    }
  }, [accountAddress, chainId, preparedTxData, approveERC20Async, resetApproveWriteContract]);

  // Function to handle Permit2 signing and submission
  const handleSignAndSubmitPermit2 = useCallback(async () => {
    if (!permit2SignatureRequest || !accountAddress || !chainId) {
      toast.error("Permit2 Error", { description: "Missing data for Permit2 signature." });
      return;
    }

    setIsWorking(true);
    toast.loading(`Requesting signature for ${permit2SignatureRequest.approvalTokenSymbol}...`, { id: "permit2-sign" });

    try {
      const { domain, types, primaryType, message, permit2Address, approvalTokenSymbol } = permit2SignatureRequest;
      
      // Ensure message values are correctly typed for signing and for contract call
      const typedMessage = {
        details: {
          token: message.details.token as Hex,
          amount: BigInt(message.details.amount), // uint160 -> BigInt
          expiration: Number(message.details.expiration), // uint48 -> Number
          nonce: Number(message.details.nonce), // uint48 -> Number
        },
        spender: message.spender as Hex,
        sigDeadline: BigInt(message.sigDeadline), // uint256 -> BigInt
      };

      const signature = await signTypedDataAsync({
        domain,
        types,
        primaryType,
        message: typedMessage, // Use the structured message with BigInts
        account: accountAddress,
      });

      toast.dismiss("permit2-sign");
      toast.loading(`Submitting Permit2 for ${approvalTokenSymbol}...`, { id: "permit2-submit" });

      if (!permit2WriteContractAsync) {
        throw new Error("Permit2 write function not available.");
      }

      await permit2WriteContractAsync({
        address: permit2Address,
        abi: PERMIT2_PERMIT_ABI_MINIMAL,
        functionName: 'permit',
        args: [
          accountAddress, // owner
          typedMessage,   // permitSingle (already structured correctly for ABI)
          signature       // signature
        ],
        account: accountAddress,
        chain: baseSepolia,
      });
    } catch (err: any) {
      toast.dismiss("permit2-sign");
      toast.dismiss("permit2-submit");
      let detailedErrorMessage = "Permit2 operation failed.";
      if (err instanceof Error) {
        detailedErrorMessage = err.message;
        if ((err as any).shortMessage) { detailedErrorMessage = (err as any).shortMessage; }
      }
      toast.error("Permit2 Error", { description: detailedErrorMessage });
      setIsWorking(false);
    }
  }, [accountAddress, chainId, permit2SignatureRequest, signTypedDataAsync, permit2WriteContractAsync]);

  // Function to handle minting
  const handleMint = useCallback(async () => {
    if (!preparedTxData || preparedTxData.needsApproval || !sendTransactionAsync) return;
    if (!preparedTxData.transaction || typeof preparedTxData.transaction.data !== 'string') {
      toast.error("Minting Error", { description: "Transaction data is missing or invalid. Please try preparing again." });
      setStep('input'); 
      setIsWorking(false);
      return;
    }
    
    setIsWorking(true);
    toast.loading("Sending mint transaction...", { id: "mint-tx" });
    
    try {
      const { to, data, value: txValueString } = preparedTxData.transaction;
      const txParams: { to: `0x${string}`; data: Hex; value?: bigint } = {
        to: to as `0x${string}`,
        data: data as Hex,
      };
      if (txValueString && BigInt(txValueString) > 0n) {
        txParams.value = BigInt(txValueString);
      }
      await sendTransactionAsync(txParams);
    } catch (err: any) { 
      let detailedErrorMessage = "Unknown error sending mint transaction.";
      if (err instanceof Error) {
        detailedErrorMessage = err.message;
        if ((err as any).shortMessage) { detailedErrorMessage = (err as any).shortMessage; }
      }
      toast.error("Failed to send mint transaction.", { id: "mint-tx", description: detailedErrorMessage });
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
    resetPermit2WriteContract();
  }, [resetApproveWriteContract, resetSendTransaction, resetPermit2WriteContract]);

  // Update states when approve transaction is completed
  useEffect(() => {
    if (isApproved) {
      toast.dismiss("approve-tx");
      toast.success("Approval successful!");
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
      toast.dismiss("approve-tx");
      const errorMsg = (approveWriteError as any)?.shortMessage || (approveReceiptError as any)?.shortMessage || approveWriteError?.message || approveReceiptError?.message || "Approval transaction failed.";
      toast.error("Approval failed", { description: errorMsg });
      setIsWorking(false);
      resetApproveWriteContract();
      setPreparedTxData(null);
      setStep('input'); 
    }
  }, [isApproved, approveWriteError, approveReceiptError, preparedTxData, resetApproveWriteContract, handlePrepareMintInternal]);

  // Update states when permit2 transaction is completed
  useEffect(() => {
    if (isPermit2Confirmed) {
      toast.success("Permit2 call successful!", { id: "permit2-submit" });
      const currentPermittedTokenSymbol = permit2SignatureRequest?.approvalTokenSymbol;
      
      resetPermit2WriteContract();
      
      if (currentPermittedTokenSymbol) {
        const checkNextStep = async () => {
          setIsWorking(true);
          const nextPrepData = await handlePrepareMintInternal(true, currentPermittedTokenSymbol);
          if (nextPrepData) {
            if (!nextPrepData.needsApproval || (nextPrepData.needsApproval && nextPrepData.approvalTokenSymbol !== currentPermittedTokenSymbol)) {
              // currentPermittedTokenSymbol is now fully processed for this operation
              setTokenCompletionStatus(prev => ({ ...prev, [currentPermittedTokenSymbol]: true }));
            }
            // If nextPrepData requires further action for currentPermittedTokenSymbol, it's handled by handlePrepareMintInternal setting the step.
          } else {
             // Error or abort during prepare mint internal
            setStep('input'); 
            setPreparedTxData(null);
          }
          setIsWorking(false);
        };
        checkNextStep();
      } else {
        setIsWorking(false); // No token to process further
      }
    }
    
    if (permit2SendError || permit2ReceiptError) {
      const errorMsg = (permit2SendError as any)?.shortMessage || (permit2ReceiptError as any)?.shortMessage || permit2SendError?.message || permit2ReceiptError?.message || "Permit2 transaction failed.";
      toast.error("Permit2 Submission Failed", { id: "permit2-submit", description: errorMsg });
      setIsWorking(false);
      resetPermit2WriteContract();
    }
  }, [isPermit2Confirmed, permit2SendError, permit2ReceiptError, preparedTxData, resetPermit2WriteContract, handlePrepareMintInternal, permit2SignatureRequest?.approvalTokenSymbol]);

  // Update states when mint transaction is completed
  useEffect(() => {
    if (isMintConfirmed) {
      toast.success("Liquidity minted successfully!", { id: "mint-tx" });
      onLiquidityAdded();
      resetTransactionState();
      onOpenChange(false);
      resetSendTransaction();
    }
    
    if (mintSendError || mintReceiptError) {
      const errorMsg = (mintSendError as any)?.shortMessage || (mintReceiptError as any)?.shortMessage || mintSendError?.message || mintReceiptError?.message || "Minting transaction failed.";
      toast.error("Minting failed", { id: "mint-tx", description: errorMsg });
      
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