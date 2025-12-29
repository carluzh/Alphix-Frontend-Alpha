/**
 * Step-Based Liquidity Hooks
 *
 * Thin hook wrappers that use the Uniswap step-based executor for liquidity operations.
 * These hooks provide a simplified interface while delegating to the step executor.
 *
 * ADAPTED FROM UNISWAP - Uses step-based transaction flow
 */

import { useState, useCallback, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { getToken, TokenSymbol } from '@/lib/pools-config';
import { useNetwork } from '@/lib/network-context';
import { type Address } from 'viem';

import {
  useLiquidityStepExecutor,
  buildLiquidityTxContext,
  generateLPTransactionSteps,
  type LiquidityExecutorState,
  type MintTxApiResponse,
} from '../../transaction';

import {
  LiquidityTransactionType,
  type TransactionStep,
  type ValidatedLiquidityTxContext,
} from '../../types';

// =============================================================================
// TYPES
// =============================================================================

export interface UseStepBasedIncreaseProps {
  onSuccess?: (info?: { txHash?: string; steps?: TransactionStep[] }) => void;
  onError?: (error: Error) => void;
  onStepChange?: (stepIndex: number, step: TransactionStep, accepted: boolean) => void;
}

export interface UseStepBasedDecreaseProps {
  onSuccess?: (info?: { txHash?: string; steps?: TransactionStep[] }) => void;
  onError?: (error: Error) => void;
  onStepChange?: (stepIndex: number, step: TransactionStep, accepted: boolean) => void;
}

export interface UseStepBasedCollectProps {
  onSuccess?: (info?: { txHash?: string }) => void;
  onError?: (error: Error) => void;
}

export interface IncreasePositionParams {
  tokenId: string | bigint;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  additionalAmount0: string;
  additionalAmount1: string;
  tickLower: number;
  tickUpper: number;
  slippageBps?: number;
  deadlineMinutes?: number;
}

export interface DecreasePositionParams {
  tokenId: string | bigint;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  liquidityPercentage: number; // 0-100
  tickLower: number;
  tickUpper: number;
  slippageBps?: number;
  deadlineMinutes?: number;
}

export interface CollectFeesParams {
  tokenId: string | bigint;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
}

// =============================================================================
// STEP-BASED INCREASE LIQUIDITY HOOK
// =============================================================================

/**
 * Step-based increase liquidity hook
 *
 * Uses the Uniswap step executor to handle the transaction flow:
 * 1. Check/request ERC20 approvals to Permit2
 * 2. Sign Permit2 batch (if needed)
 * 3. Execute increase position transaction
 */
export function useStepBasedIncreaseLiquidity(props: UseStepBasedIncreaseProps = {}) {
  const { onSuccess, onError, onStepChange } = props;
  const { address, chainId } = useAccount();
  const { networkMode } = useNetwork();

  const [isLoading, setIsLoading] = useState(false);
  const [apiResponse, setApiResponse] = useState<MintTxApiResponse | null>(null);
  const [steps, setSteps] = useState<TransactionStep[]>([]);

  // Step executor
  const executor = useLiquidityStepExecutor({
    onSuccess: (txHash) => {
      setIsLoading(false);
      onSuccess?.({ txHash, steps });
    },
    onFailure: (error) => {
      setIsLoading(false);
      onError?.(error || new Error('Transaction failed'));
    },
    onStepChange,
  });

  /**
   * Fetch transaction data from API
   */
  const fetchTransactionData = useCallback(
    async (params: IncreasePositionParams): Promise<MintTxApiResponse> => {
      const response = await fetch('/api/liquidity/prepare-mint-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: address,
          token0Symbol: params.token0Symbol,
          token1Symbol: params.token1Symbol,
          inputAmount: params.additionalAmount0 || params.additionalAmount1,
          inputTokenSymbol: params.additionalAmount0 ? params.token0Symbol : params.token1Symbol,
          userTickLower: params.tickLower,
          userTickUpper: params.tickUpper,
          chainId,
          slippageBps: params.slippageBps ?? 50,
          deadlineMinutes: params.deadlineMinutes ?? 20,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to prepare transaction');
      }

      return response.json();
    },
    [address, chainId],
  );

  /**
   * Execute increase liquidity
   */
  const increaseLiquidity = useCallback(
    async (params: IncreasePositionParams) => {
      if (!address || !chainId) {
        onError?.(new Error('Wallet not connected'));
        return;
      }

      setIsLoading(true);

      try {
        // Fetch API response
        const response = await fetchTransactionData(params);
        setApiResponse(response);

        // If approval is needed, we need to handle it differently
        if (response.needsApproval) {
          // For now, just notify the caller - they need to handle approval flow
          setIsLoading(false);
          onError?.(new Error(`Approval needed: ${response.approvalType}`));
          return;
        }

        // Build token configs
        const token0 = getToken(params.token0Symbol, networkMode);
        const token1 = getToken(params.token1Symbol, networkMode);

        if (!token0 || !token1) {
          throw new Error('Token configuration not found');
        }

        // Build context
        const context = buildLiquidityTxContext({
          type: LiquidityTransactionType.Increase,
          apiResponse: response,
          token0: {
            address: token0.address as Address,
            symbol: token0.symbol,
            decimals: token0.decimals,
            chainId,
          },
          token1: {
            address: token1.address as Address,
            symbol: token1.symbol,
            decimals: token1.decimals,
            chainId,
          },
          amount0: response.details?.token0.amount || '0',
          amount1: response.details?.token1.amount || '0',
          chainId,
        });

        // Generate and store steps
        const generatedSteps = generateLPTransactionSteps(context);
        setSteps(generatedSteps);

        // Execute
        await executor.execute(context as ValidatedLiquidityTxContext);
      } catch (error) {
        setIsLoading(false);
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    },
    [address, chainId, networkMode, fetchTransactionData, executor, onError],
  );

  return {
    increaseLiquidity,
    isLoading,
    state: executor.state,
    steps,
    apiResponse,
    reset: executor.reset,
  };
}

// =============================================================================
// STEP-BASED DECREASE LIQUIDITY HOOK
// =============================================================================

/**
 * Step-based decrease liquidity hook
 *
 * Uses the Uniswap step executor to handle the transaction flow:
 * 1. Check/request position token approval (if needed)
 * 2. Execute decrease position transaction
 */
export function useStepBasedDecreaseLiquidity(props: UseStepBasedDecreaseProps = {}) {
  const { onSuccess, onError, onStepChange } = props;
  const { address, chainId } = useAccount();
  const { networkMode } = useNetwork();

  const [isLoading, setIsLoading] = useState(false);
  const [steps, setSteps] = useState<TransactionStep[]>([]);

  // Step executor
  const executor = useLiquidityStepExecutor({
    onSuccess: (txHash) => {
      setIsLoading(false);
      onSuccess?.({ txHash, steps });
    },
    onFailure: (error) => {
      setIsLoading(false);
      onError?.(error || new Error('Transaction failed'));
    },
    onStepChange,
  });

  /**
   * Fetch decrease transaction data from API
   */
  const fetchDecreaseData = useCallback(
    async (params: DecreasePositionParams): Promise<MintTxApiResponse> => {
      const response = await fetch('/api/liquidity/prepare-decrease-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: address,
          tokenId: params.tokenId.toString(),
          token0Symbol: params.token0Symbol,
          token1Symbol: params.token1Symbol,
          liquidityPercentage: params.liquidityPercentage,
          chainId,
          slippageBps: params.slippageBps ?? 50,
          deadlineMinutes: params.deadlineMinutes ?? 20,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to prepare decrease transaction');
      }

      return response.json();
    },
    [address, chainId],
  );

  /**
   * Execute decrease liquidity
   */
  const decreaseLiquidity = useCallback(
    async (params: DecreasePositionParams) => {
      if (!address || !chainId) {
        onError?.(new Error('Wallet not connected'));
        return;
      }

      setIsLoading(true);

      try {
        // Fetch API response
        const response = await fetchDecreaseData(params);

        // Build token configs
        const token0 = getToken(params.token0Symbol, networkMode);
        const token1 = getToken(params.token1Symbol, networkMode);

        if (!token0 || !token1) {
          throw new Error('Token configuration not found');
        }

        // Build context
        const context = buildLiquidityTxContext({
          type: LiquidityTransactionType.Decrease,
          apiResponse: response,
          token0: {
            address: token0.address as Address,
            symbol: token0.symbol,
            decimals: token0.decimals,
            chainId,
          },
          token1: {
            address: token1.address as Address,
            symbol: token1.symbol,
            decimals: token1.decimals,
            chainId,
          },
          amount0: response.details?.token0.amount || '0',
          amount1: response.details?.token1.amount || '0',
          chainId,
        });

        // Generate and store steps
        const generatedSteps = generateLPTransactionSteps(context);
        setSteps(generatedSteps);

        // Execute
        await executor.execute(context as ValidatedLiquidityTxContext);
      } catch (error) {
        setIsLoading(false);
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    },
    [address, chainId, networkMode, fetchDecreaseData, executor, onError],
  );

  return {
    decreaseLiquidity,
    isLoading,
    state: executor.state,
    steps,
    reset: executor.reset,
  };
}

// =============================================================================
// STEP-BASED COLLECT FEES HOOK
// =============================================================================

/**
 * Step-based collect fees hook
 *
 * Uses the Uniswap step executor to handle the collect transaction.
 */
export function useStepBasedCollectFees(props: UseStepBasedCollectProps = {}) {
  const { onSuccess, onError } = props;
  const { address, chainId } = useAccount();
  const { networkMode } = useNetwork();

  const [isLoading, setIsLoading] = useState(false);

  // Step executor
  const executor = useLiquidityStepExecutor({
    onSuccess: (txHash) => {
      setIsLoading(false);
      onSuccess?.({ txHash });
    },
    onFailure: (error) => {
      setIsLoading(false);
      onError?.(error || new Error('Transaction failed'));
    },
  });

  /**
   * Fetch collect fees transaction data from API
   */
  const fetchCollectData = useCallback(
    async (params: CollectFeesParams): Promise<MintTxApiResponse> => {
      const response = await fetch('/api/liquidity/prepare-collect-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: address,
          tokenId: params.tokenId.toString(),
          token0Symbol: params.token0Symbol,
          token1Symbol: params.token1Symbol,
          chainId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to prepare collect transaction');
      }

      return response.json();
    },
    [address, chainId],
  );

  /**
   * Execute collect fees
   */
  const collectFees = useCallback(
    async (params: CollectFeesParams) => {
      if (!address || !chainId) {
        onError?.(new Error('Wallet not connected'));
        return;
      }

      setIsLoading(true);

      try {
        // Fetch API response
        const response = await fetchCollectData(params);

        // Build token configs
        const token0 = getToken(params.token0Symbol, networkMode);
        const token1 = getToken(params.token1Symbol, networkMode);

        if (!token0 || !token1) {
          throw new Error('Token configuration not found');
        }

        // Build context
        const context = buildLiquidityTxContext({
          type: LiquidityTransactionType.Collect,
          apiResponse: response,
          token0: {
            address: token0.address as Address,
            symbol: token0.symbol,
            decimals: token0.decimals,
            chainId,
          },
          token1: {
            address: token1.address as Address,
            symbol: token1.symbol,
            decimals: token1.decimals,
            chainId,
          },
          amount0: '0',
          amount1: '0',
          chainId,
        });

        // Execute
        await executor.execute(context as ValidatedLiquidityTxContext);
      } catch (error) {
        setIsLoading(false);
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    },
    [address, chainId, networkMode, fetchCollectData, executor, onError],
  );

  return {
    collectFees,
    isLoading,
    state: executor.state,
    reset: executor.reset,
  };
}
