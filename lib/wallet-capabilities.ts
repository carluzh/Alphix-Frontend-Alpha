import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConfig } from 'wagmi';
import { getAccount, getConnectorClient } from '@wagmi/core';

// EIP-5792 capability types
export interface WalletCapabilities {
  [chainId: string]: {
    atomic?: {
      status: 'unsupported' | 'supported' | 'ready';
    };
    paymasterService?: {
      status: 'unsupported' | 'supported' | 'ready';
      url?: string;
    };
    auxiliaryFunds?: {
      status: 'unsupported' | 'supported' | 'ready';
      supported: string[];
    };
  };
}

export interface CallsStatus {
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  receipts?: Array<{
    logs: Array<{
      address: string;
      topics: string[];
      data: string;
    }>;
    status: string;
    blockHash: string;
    blockNumber: string;
    gasUsed: string;
    transactionHash: string;
  }>;
}

export interface SendCallsParams {
  version: string;
  chainId: string;
  from: string;
  calls: Array<{
    to: string;
    data: string;
    value?: string;
  }>;
  capabilities?: {
    atomic?: boolean;
    paymaster?: {
      url: string;
    };
    auxiliaryFunds?: {
      supported: string[];
    };
  };
}

export interface SendCallsResult {
  batchId: string;
}

// Capability detection hook
export function useWalletCapabilities() {
  const { address, connector, chainId } = useAccount();
  const config = useConfig();
  const [capabilities, setCapabilities] = useState<WalletCapabilities | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const detectCapabilities = useCallback(async () => {
    if (!connector || !address || !chainId) {
      setCapabilities(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const client = await getConnectorClient(config, { connector });

      // Check if wallet supports wallet_getCapabilities
      if (!client.request) {
        throw new Error('Wallet does not support JSON-RPC requests');
      }

      // Request capabilities with timeout
      const capabilitiesPromise = client.request({
        method: 'wallet_getCapabilities',
        params: [address],
      }) as Promise<WalletCapabilities>;

      // Set timeout for capability detection
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Capability detection timeout')), 5000);
      });

      const detectedCapabilities = await Promise.race([
        capabilitiesPromise,
        timeoutPromise
      ]);

      setCapabilities(detectedCapabilities);
    } catch (err) {
      console.warn('Failed to detect wallet capabilities:', err);
      // Set fallback capabilities (no atomic batching support)
      setCapabilities({
        [chainId.toString()]: {
          atomic: { status: 'unsupported' }
        }
      });
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, [connector, address, chainId, config]);

  useEffect(() => {
    detectCapabilities();
  }, [detectCapabilities]);

  const supportsAtomicBatching = useCallback((targetChainId?: number) => {
    if (!capabilities) return false;

    const chain = targetChainId?.toString() || chainId?.toString();
    if (!chain) return false;

    const chainCapabilities = capabilities[chain];
    return chainCapabilities?.atomic?.status === 'supported' ||
           chainCapabilities?.atomic?.status === 'ready';
  }, [capabilities, chainId]);

  const supportsPaymaster = useCallback((targetChainId?: number) => {
    if (!capabilities) return false;

    const chain = targetChainId?.toString() || chainId?.toString();
    if (!chain) return false;

    const chainCapabilities = capabilities[chain];
    return chainCapabilities?.paymasterService?.status === 'supported' ||
           chainCapabilities?.paymasterService?.status === 'ready';
  }, [capabilities, chainId]);

  return {
    capabilities,
    isLoading,
    error,
    supportsAtomicBatching,
    supportsPaymaster,
    refetch: detectCapabilities,
  };
}

// Hook for sending batched calls using EIP-5792
export function useSendCalls() {
  const { address, connector } = useAccount();
  const config = useConfig();
  const { supportsAtomicBatching } = useWalletCapabilities();

  const sendCalls = useCallback(async (params: Omit<SendCallsParams, 'from'>) => {
    if (!connector || !address) {
      throw new Error('Wallet not connected');
    }

    if (!supportsAtomicBatching()) {
      throw new Error('Wallet does not support atomic batching');
    }

    const client = await getConnectorClient(config, { connector });

    if (!client.request) {
      throw new Error('Wallet does not support JSON-RPC requests');
    }

    const sendCallsParams: SendCallsParams = {
      ...params,
      from: address,
    };

    try {
      const result = await client.request({
        method: 'wallet_sendCalls',
        params: [sendCallsParams],
      }) as SendCallsResult;

      return result;
    } catch (error) {
      console.error('Failed to send batched calls:', error);
      throw error;
    }
  }, [connector, address, config, supportsAtomicBatching]);

  return { sendCalls };
}

// Hook for checking call status
export function useCallsStatus() {
  const { connector } = useAccount();
  const config = useConfig();

  const getCallsStatus = useCallback(async (batchId: string): Promise<CallsStatus> => {
    if (!connector) {
      throw new Error('Wallet not connected');
    }

    const client = await getConnectorClient(config, { connector });

    if (!client.request) {
      throw new Error('Wallet does not support JSON-RPC requests');
    }

    try {
      const status = await client.request({
        method: 'wallet_getCallsStatus',
        params: [batchId],
      }) as CallsStatus;

      return status;
    } catch (error) {
      console.error('Failed to get calls status:', error);
      throw error;
    }
  }, [connector, config]);

  return { getCallsStatus };
}

// Polling hook for batch transaction status
export function useBatchTransactionPolling(batchId: string | null) {
  const [status, setStatus] = useState<CallsStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const { getCallsStatus } = useCallsStatus();

  const startPolling = useCallback(async () => {
    if (!batchId || isPolling) return;

    setIsPolling(true);

    const poll = async () => {
      try {
        const currentStatus = await getCallsStatus(batchId);
        setStatus(currentStatus);

        // Continue polling if still pending
        if (currentStatus.status === 'PENDING') {
          setTimeout(poll, 2000); // Poll every 2 seconds
        } else {
          setIsPolling(false);
        }
      } catch (error) {
        console.error('Polling error:', error);
        setIsPolling(false);
      }
    };

    poll();
  }, [batchId, isPolling, getCallsStatus]);

  useEffect(() => {
    if (batchId && !isPolling) {
      startPolling();
    }
  }, [batchId, startPolling, isPolling]);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
  }, []);

  return {
    status,
    isPolling,
    startPolling,
    stopPolling,
  };
}

// Utility functions
export function formatCapabilityStatus(status: string): string {
  switch (status) {
    case 'unsupported':
      return 'Not supported';
    case 'supported':
      return 'Supported';
    case 'ready':
      return 'Ready';
    default:
      return 'Unknown';
  }
}

export function isAtomicBatchingReady(capabilities: WalletCapabilities | null, chainId: number): boolean {
  if (!capabilities) return false;

  const chainCapabilities = capabilities[chainId.toString()];
  return chainCapabilities?.atomic?.status === 'ready';
}

export function isAtomicBatchingSupported(capabilities: WalletCapabilities | null, chainId: number): boolean {
  if (!capabilities) return false;

  const chainCapabilities = capabilities[chainId.toString()];
  return chainCapabilities?.atomic?.status === 'supported' ||
         chainCapabilities?.atomic?.status === 'ready';
}

// Smart transaction router - determines best execution method
export interface TransactionExecutionStrategy {
  method: 'atomic' | 'individual' | 'sequential';
  reason: string;
  fallback?: 'individual' | 'sequential';
}

export function determineExecutionStrategy(
  capabilities: WalletCapabilities | null,
  chainId: number,
  transactionCount: number,
  gasEstimate?: bigint
): TransactionExecutionStrategy {
  // Single transaction - always use individual
  if (transactionCount === 1) {
    return {
      method: 'individual',
      reason: 'Single transaction - no batching needed',
    };
  }

  // Check atomic batching support
  if (isAtomicBatchingSupported(capabilities, chainId)) {
    return {
      method: 'atomic',
      reason: 'Wallet supports atomic batching',
      fallback: 'individual',
    };
  }

  // Fallback to individual transactions
  return {
    method: 'individual',
    reason: 'Atomic batching not supported - using individual transactions',
  };
}

// Error handling for EIP-5792 operations
export class EIP5792Error extends Error {
  constructor(
    message: string,
    public code?: number,
    public data?: any
  ) {
    super(message);
    this.name = 'EIP5792Error';
  }
}

export function handleEIP5792Error(error: any): EIP5792Error {
  if (error instanceof EIP5792Error) {
    return error;
  }

  // Common error codes from EIP-5792
  const errorCode = error?.code || error?.error?.code;
  const errorMessage = error?.message || error?.error?.message || 'Unknown EIP-5792 error';

  switch (errorCode) {
    case 4001:
      return new EIP5792Error('User rejected the request', 4001);
    case 4100:
      return new EIP5792Error('Unauthorized method', 4100);
    case 4200:
      return new EIP5792Error('Unsupported method', 4200);
    case 4900:
      return new EIP5792Error('Disconnected', 4900);
    case 4901:
      return new EIP5792Error('Chain disconnected', 4901);
    default:
      return new EIP5792Error(errorMessage, errorCode);
  }
}