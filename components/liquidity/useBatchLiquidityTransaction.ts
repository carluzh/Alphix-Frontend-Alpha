import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  useAccount,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useSignTypedData
} from "wagmi";
import { useQueryClient } from '@tanstack/react-query';
import { toast } from "sonner";
import { BadgeCheck, OctagonX, Layers } from "lucide-react";
import { TokenSymbol } from "@/lib/pools-config";
import { type Hex } from "viem";

// Import our new utilities
import {
  useWalletCapabilities,
  useSendCalls,
  useBatchTransactionPolling,
  determineExecutionStrategy,
  TransactionExecutionStrategy,
  EIP5792Error,
  handleEIP5792Error
} from "@/lib/wallet-capabilities";
import {
  generatePermitBatchTypedData,
  generatePermitSingleTypedData,
  validatePermitSignature,
  createLiquidityPermitConfig,
  type PermitBatchTypedData,
  type PermitSingleTypedData
} from "@/lib/permit-utils";

// Transaction types
export type BatchOperationType = 'mint' | 'decrease' | 'collect' | 'compound';

export interface BatchOperation {
  type: BatchOperationType;
  // Mint operation data
  token0Symbol?: TokenSymbol;
  token1Symbol?: TokenSymbol;
  inputAmount?: string;
  inputTokenSymbol?: TokenSymbol;
  userTickLower?: number;
  userTickUpper?: number;
  // Decrease operation data
  tokenId?: string | number;
  liquidityPercentage?: number;
  tickLower?: number;
  tickUpper?: number;
  collectFees?: boolean;
}

export interface BatchTransactionRequest {
  type: string;
  to: string;
  data: string;
  value: string;
  description: string;
}

export interface BatchPreparedTx {
  needsApproval: boolean;
  useAtomicBatching: boolean;
  transactions: BatchTransactionRequest[];
  permitData?: {
    domain: any;
    types: any;
    value: any;
  };
  deadline: string;
  batchId?: string;
  executionStrategy: TransactionExecutionStrategy;
  gasEstimate?: string;
}

export type BatchTransactionStep =
  | 'input'
  | 'permit-signature'
  | 'approve'
  | 'batch-execute'
  | 'individual-execute';

export interface BatchTransactionState {
  step: BatchTransactionStep;
  isWorking: boolean;
  isPermitSigning: boolean;
  isApproving: boolean;
  isBatchExecuting: boolean;
  isIndividualExecuting: boolean;
  currentTransactionIndex: number;
  permitSignature?: string;
  approvalHash?: Hex;
  batchId?: string;
  individualHashes: Hex[];
  completedOperations: number;
  error?: string;
}

export function useBatchLiquidityTransaction() {
  const { address, chainId } = useAccount();
  const queryClient = useQueryClient();

  // Wallet capability detection
  const { capabilities, supportsAtomicBatching } = useWalletCapabilities();
  const { sendCalls } = useSendCalls();

  // Wagmi hooks
  const { sendTransactionAsync } = useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();

  // State
  const [preparedTx, setPreparedTx] = useState<BatchPreparedTx | null>(null);
  const [transactionState, setTransactionState] = useState<BatchTransactionState>({
    step: 'input',
    isWorking: false,
    isPermitSigning: false,
    isApproving: false,
    isBatchExecuting: false,
    isIndividualExecuting: false,
    currentTransactionIndex: 0,
    individualHashes: [],
    completedOperations: 0,
  });

  // Batch polling
  const { status: batchStatus, isPolling } = useBatchTransactionPolling(
    transactionState.batchId || null
  );

  // Transaction receipts for individual transactions
  const { data: approvalReceipt } = useWaitForTransactionReceipt({
    hash: transactionState.approvalHash,
  });

  // Prepare batch transaction
  const prepareBatchTransaction = useCallback(async (operations: BatchOperation[]) => {
    if (!address || !chainId) {
      throw new Error('Wallet not connected');
    }

    try {
      setTransactionState(prev => ({ ...prev, isWorking: true, error: undefined }));

      // Determine execution strategy
      const strategy = determineExecutionStrategy(
        capabilities,
        chainId,
        operations.length
      );

      const response = await fetch('/api/liquidity/prepare-batch-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: address,
          chainId,
          operations,
          useAtomicBatching: strategy.method === 'atomic',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to prepare batch transaction');
      }

      const data = await response.json();

      const preparedData: BatchPreparedTx = {
        ...data,
        executionStrategy: strategy,
      };

      setPreparedTx(preparedData);

      // Show success toast
      toast.success("Batch transaction prepared", {
        description: `${operations.length} operations ready for execution`,
        icon: <Layers className="h-4 w-4 text-blue-500" />,
      });

      // Move to next step based on preparation result
      if (preparedData.needsApproval) {
        setTransactionState(prev => ({ ...prev, step: 'approve', isWorking: false }));
      } else if (preparedData.permitData) {
        setTransactionState(prev => ({ ...prev, step: 'permit-signature', isWorking: false }));
      } else {
        setTransactionState(prev => ({
          ...prev,
          step: preparedData.useAtomicBatching ? 'batch-execute' : 'individual-execute',
          isWorking: false
        }));
      }

    } catch (error) {
      console.error('Failed to prepare batch transaction:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to prepare transaction';

      setTransactionState(prev => ({
        ...prev,
        isWorking: false,
        error: errorMessage
      }));

      toast.error("Preparation Error", {
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description: errorMessage,
        action: {
          label: "Copy Error",
          onClick: () => navigator.clipboard.writeText(errorMessage)
        }
      });

      throw error;
    }
  }, [address, chainId, capabilities]);

  // Sign permit
  const signPermit = useCallback(async () => {
    if (!preparedTx?.permitData || !address) {
      throw new Error('No permit data available or wallet not connected');
    }

    try {
      setTransactionState(prev => ({
        ...prev,
        isPermitSigning: true,
        error: undefined
      }));

      const signature = await signTypedDataAsync({
        domain: preparedTx.permitData.domain,
        types: preparedTx.permitData.types,
        primaryType: 'PermitBatch', // or 'PermitSingle' depending on permit type
        message: preparedTx.permitData.value,
      });

      if (!validatePermitSignature(signature)) {
        throw new Error('Invalid permit signature received');
      }

      setTransactionState(prev => ({
        ...prev,
        permitSignature: signature,
        isPermitSigning: false,
        step: preparedTx.useAtomicBatching ? 'batch-execute' : 'individual-execute'
      }));

      toast.success("Permit signed successfully", {
        description: "Ready to execute batch transaction",
        icon: <BadgeCheck className="h-4 w-4 text-green-500" />,
      });

    } catch (error) {
      console.error('Failed to sign permit:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to sign permit';

      setTransactionState(prev => ({
        ...prev,
        isPermitSigning: false,
        error: errorMessage
      }));

      toast.error("Signature Failed", {
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description: errorMessage,
        action: {
          label: "Copy Error",
          onClick: () => navigator.clipboard.writeText(errorMessage)
        }
      });

      throw error;
    }
  }, [preparedTx, address, signTypedDataAsync]);

  // Execute batch transaction using EIP-5792
  const executeBatchTransaction = useCallback(async () => {
    if (!preparedTx || !address || !chainId) {
      throw new Error('No prepared transaction or wallet not connected');
    }

    if (!supportsAtomicBatching(chainId)) {
      throw new Error('Wallet does not support atomic batching');
    }

    try {
      setTransactionState(prev => ({
        ...prev,
        isBatchExecuting: true,
        error: undefined
      }));

      // Prepare calls for EIP-5792
      const calls = preparedTx.transactions.map(tx => ({
        to: tx.to,
        data: tx.data,
        value: tx.value || '0',
      }));

      const result = await sendCalls({
        version: '1.0',
        chainId: chainId.toString(),
        calls,
        capabilities: {
          atomic: true,
        },
      });

      setTransactionState(prev => ({
        ...prev,
        batchId: result.batchId,
        isBatchExecuting: false,
        step: 'batch-execute' // Stay in this step while polling
      }));

      toast.success("Batch transaction submitted", {
        description: `Batch ID: ${result.batchId.slice(0, 10)}...`,
        icon: <Layers className="h-4 w-4 text-blue-500" />,
      });

    } catch (error) {
      console.error('Failed to execute batch transaction:', error);
      const eip5792Error = handleEIP5792Error(error);

      setTransactionState(prev => ({
        ...prev,
        isBatchExecuting: false,
        error: eip5792Error.message
      }));

      toast.error("Batch Failed", {
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description: eip5792Error.message,
        action: {
          label: "Copy Error",
          onClick: () => navigator.clipboard.writeText(eip5792Error.message)
        }
      });

      throw eip5792Error;
    }
  }, [preparedTx, address, chainId, supportsAtomicBatching, sendCalls]);

  // Execute individual transactions sequentially
  const executeIndividualTransactions = useCallback(async () => {
    if (!preparedTx || !address) {
      throw new Error('No prepared transaction or wallet not connected');
    }

    try {
      setTransactionState(prev => ({
        ...prev,
        isIndividualExecuting: true,
        error: undefined,
        individualHashes: [],
        completedOperations: 0
      }));

      const hashes: Hex[] = [];

      for (let i = 0; i < preparedTx.transactions.length; i++) {
        const tx = preparedTx.transactions[i];

        setTransactionState(prev => ({
          ...prev,
          currentTransactionIndex: i
        }));

        toast.loading(`Executing transaction ${i + 1} of ${preparedTx.transactions.length}`, {
          description: tx.description,
          icon: <Layers className="h-4 w-4 text-blue-500" />,
        });

        const hash = await sendTransactionAsync({
          to: tx.to as Hex,
          data: tx.data as Hex,
          value: BigInt(tx.value || '0'),
        });

        hashes.push(hash);

        setTransactionState(prev => ({
          ...prev,
          individualHashes: [...prev.individualHashes, hash],
          completedOperations: i + 1
        }));

        // Wait for confirmation before next transaction
        // This could be optimized to not wait for each one
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      setTransactionState(prev => ({
        ...prev,
        isIndividualExecuting: false
      }));

      toast.success("All transactions completed", {
        description: `Successfully executed ${preparedTx.transactions.length} transactions`,
        icon: <BadgeCheck className="h-4 w-4 text-green-500" />,
      });

    } catch (error) {
      console.error('Failed to execute individual transactions:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to execute transactions';

      setTransactionState(prev => ({
        ...prev,
        isIndividualExecuting: false,
        error: errorMessage
      }));

      toast.error("Transaction Failed", {
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description: errorMessage,
        action: {
          label: "Copy Error",
          onClick: () => navigator.clipboard.writeText(errorMessage)
        }
      });

      throw error;
    }
  }, [preparedTx, address, sendTransactionAsync]);

  // Handle batch status updates
  useEffect(() => {
    if (batchStatus && transactionState.batchId) {
      switch (batchStatus.status) {
        case 'CONFIRMED':
          setTransactionState(prev => ({
            ...prev,
            isBatchExecuting: false,
            completedOperations: preparedTx?.transactions.length || 0
          }));

          toast.success("Batch transaction confirmed", {
            description: "All operations completed successfully",
            icon: <BadgeCheck className="h-4 w-4 text-green-500" />,
          });

          // Invalidate caches and refresh data
          queryClient.invalidateQueries({ queryKey: ['userPositions'] });
          queryClient.invalidateQueries({ queryKey: ['userActivity'] });
          break;

        case 'FAILED':
          setTransactionState(prev => ({
            ...prev,
            isBatchExecuting: false,
            error: 'Batch transaction failed'
          }));

          toast.error("Batch Failed", {
            icon: <OctagonX className="h-4 w-4 text-red-500" />,
            description: "One or more operations in the batch failed",
            action: {
              label: "Open Ticket",
              onClick: () => window.open('https://discord.gg/alphix', '_blank')
            }
          });
          break;

        case 'PENDING':
          // Still processing, continue polling
          break;
      }
    }
  }, [batchStatus, transactionState.batchId, preparedTx, queryClient]);

  // Reset transaction state
  const resetTransactionState = useCallback(() => {
    setPreparedTx(null);
    setTransactionState({
      step: 'input',
      isWorking: false,
      isPermitSigning: false,
      isApproving: false,
      isBatchExecuting: false,
      isIndividualExecuting: false,
      currentTransactionIndex: 0,
      individualHashes: [],
      completedOperations: 0,
    });
  }, []);

  // Computed states
  const canUseBatching = useMemo(() => {
    return capabilities && supportsAtomicBatching(chainId);
  }, [capabilities, supportsAtomicBatching, chainId]);

  const isTransactionPending = useMemo(() => {
    return transactionState.isWorking ||
           transactionState.isPermitSigning ||
           transactionState.isApproving ||
           transactionState.isBatchExecuting ||
           transactionState.isIndividualExecuting ||
           isPolling;
  }, [transactionState, isPolling]);

  const transactionProgress = useMemo(() => {
    if (!preparedTx) return 0;

    const totalSteps = preparedTx.transactions.length;
    const completed = transactionState.completedOperations;

    return totalSteps > 0 ? (completed / totalSteps) * 100 : 0;
  }, [preparedTx, transactionState.completedOperations]);

  return {
    // State
    preparedTx,
    transactionState,
    batchStatus,
    canUseBatching,
    isTransactionPending,
    transactionProgress,

    // Actions
    prepareBatchTransaction,
    signPermit,
    executeBatchTransaction,
    executeIndividualTransactions,
    resetTransactionState,

    // Computed values
    needsPermitSignature: !!preparedTx?.permitData && !transactionState.permitSignature,
    needsApproval: !!preparedTx?.needsApproval,
    readyToExecute: !!preparedTx &&
      (!preparedTx.permitData || !!transactionState.permitSignature) &&
      !preparedTx.needsApproval,
  };
}