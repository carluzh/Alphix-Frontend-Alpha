/**
 * Step-Based Transaction Example
 *
 * This component demonstrates how to use the new Uniswap step-based transaction
 * pattern for liquidity operations. It can be used as a reference for migrating
 * PositionDetailsModal and other components to the new architecture.
 *
 * The step-based pattern:
 * 1. Generates ordered transaction steps (approvals, permits, position tx)
 * 2. Executes steps sequentially with proper state management
 * 3. Provides UI feedback through step state updates
 */

'use client';

import React, { useMemo } from 'react';
import {
  useStepBasedIncreaseLiquidity,
  useStepBasedDecreaseLiquidity,
  useStepBasedCollectFees,
  type IncreasePositionParams,
  type DecreasePositionParams,
} from '@/lib/liquidity/hooks';
import {
  generateStepperSteps,
  type LiquidityExecutorState,
} from '@/lib/liquidity/transaction';
import {
  LiquidityTransactionType,
  type TransactionStep,
  type FlowStatus,
  type LiquidityFlowState,
} from '@/lib/liquidity/types';
import type { TokenSymbol } from '@/lib/pools-config';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

/**
 * Helper to convert executor state to LiquidityFlowState for UI
 */
function buildFlowStateFromExecutor(
  steps: TransactionStep[],
  executorState: LiquidityExecutorState,
  operationType: LiquidityTransactionType,
): LiquidityFlowState {
  return {
    operationType,
    steps: steps.map((step, index) => ({
      step,
      status: executorState.steps[index]?.status || 'pending',
      txHash: executorState.steps[index]?.txHash,
      signature: executorState.steps[index]?.signature,
      error: executorState.steps[index]?.error,
    })),
    currentStepIndex: executorState.currentStepIndex,
    isComplete: executorState.status === 'completed',
    error: executorState.error,
  };
}

// =============================================================================
// STEP INDICATOR COMPONENT
// =============================================================================

interface StepIndicatorProps {
  steps: Array<{
    id: string;
    label: string;
    status: 'pending' | 'loading' | 'completed' | 'error';
  }>;
}

function StepIndicator({ steps }: StepIndicatorProps) {
  if (steps.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-white/80">Transaction Steps</h4>
      <div className="space-y-1">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className="flex items-center gap-2 text-sm"
          >
            <div
              className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                step.status === 'completed'
                  ? 'bg-green-500/20 text-green-400'
                  : step.status === 'loading'
                  ? 'bg-blue-500/20 text-blue-400'
                  : step.status === 'error'
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-white/10 text-white/40'
              }`}
            >
              {step.status === 'loading' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : step.status === 'completed' ? (
                '✓'
              ) : step.status === 'error' ? (
                '!'
              ) : (
                index + 1
              )}
            </div>
            <span
              className={
                step.status === 'completed'
                  ? 'text-green-400'
                  : step.status === 'loading'
                  ? 'text-blue-400'
                  : step.status === 'error'
                  ? 'text-red-400'
                  : 'text-white/60'
              }
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// INCREASE LIQUIDITY EXAMPLE
// =============================================================================

interface IncreaseLiquidityExampleProps {
  tokenId: string;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  tickLower: number;
  tickUpper: number;
  onSuccess?: () => void;
}

export function IncreaseLiquidityExample({
  tokenId,
  token0Symbol,
  token1Symbol,
  tickLower,
  tickUpper,
  onSuccess,
}: IncreaseLiquidityExampleProps) {
  const [amount0, setAmount0] = React.useState('');
  const [amount1, setAmount1] = React.useState('');

  const {
    increaseLiquidity,
    isLoading,
    state,
    steps,
    reset,
  } = useStepBasedIncreaseLiquidity({
    onSuccess: (info) => {
      console.log('Increase liquidity success:', info);
      onSuccess?.();
    },
    onError: (error) => {
      console.error('Increase liquidity error:', error);
    },
    onStepChange: (stepIndex, step, accepted) => {
      console.log(`Step ${stepIndex} (${step.type}):`, accepted ? 'accepted' : 'pending');
    },
  });

  // Convert transaction steps to UI stepper steps
  const stepperSteps = useMemo(() => {
    if (steps.length === 0) return [];
    const flowState = buildFlowStateFromExecutor(steps, state, LiquidityTransactionType.Increase);
    return generateStepperSteps(flowState);
  }, [steps, state]);

  const handleIncrease = async () => {
    const params: IncreasePositionParams = {
      tokenId,
      token0Symbol,
      token1Symbol,
      additionalAmount0: amount0,
      additionalAmount1: amount1,
      tickLower,
      tickUpper,
      slippageBps: 50, // 0.5%
      deadlineMinutes: 20,
    };

    await increaseLiquidity(params);
  };

  return (
    <div className="p-4 bg-[#131313] rounded-lg border border-white/10 space-y-4">
      <h3 className="text-lg font-medium text-white">Add Liquidity (Step-Based)</h3>

      {/* Amount inputs */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-white/60">{token0Symbol} Amount</label>
          <input
            type="text"
            value={amount0}
            onChange={(e) => setAmount0(e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-white/5 border border-white/10 rounded text-white"
            placeholder="0.0"
            disabled={isLoading}
          />
        </div>
        <div>
          <label className="text-sm text-white/60">{token1Symbol} Amount</label>
          <input
            type="text"
            value={amount1}
            onChange={(e) => setAmount1(e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-white/5 border border-white/10 rounded text-white"
            placeholder="0.0"
            disabled={isLoading}
          />
        </div>
      </div>

      {/* Step indicator */}
      {stepperSteps.length > 0 && <StepIndicator steps={stepperSteps} />}

      {/* Status */}
      {state.status === 'error' && (
        <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
          Error: {state.error}
        </div>
      )}

      {state.status === 'completed' && (
        <div className="p-2 bg-green-500/10 border border-green-500/20 rounded text-green-400 text-sm">
          Transaction completed successfully!
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={handleIncrease}
          disabled={isLoading || (!amount0 && !amount1)}
          className="flex-1"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            'Add Liquidity'
          )}
        </Button>

        {(state.status === 'completed' || state.status === 'error') && (
          <Button variant="outline" onClick={reset}>
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// DECREASE LIQUIDITY EXAMPLE
// =============================================================================

interface DecreaseLiquidityExampleProps {
  tokenId: string;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  tickLower: number;
  tickUpper: number;
  onSuccess?: () => void;
}

export function DecreaseLiquidityExample({
  tokenId,
  token0Symbol,
  token1Symbol,
  tickLower,
  tickUpper,
  onSuccess,
}: DecreaseLiquidityExampleProps) {
  const [percentage, setPercentage] = React.useState(100);

  const {
    decreaseLiquidity,
    isLoading,
    state,
    steps,
    reset,
  } = useStepBasedDecreaseLiquidity({
    onSuccess: (info) => {
      console.log('Decrease liquidity success:', info);
      onSuccess?.();
    },
    onError: (error) => {
      console.error('Decrease liquidity error:', error);
    },
  });

  const stepperSteps = useMemo(() => {
    if (steps.length === 0) return [];
    const flowState = buildFlowStateFromExecutor(steps, state, LiquidityTransactionType.Decrease);
    return generateStepperSteps(flowState);
  }, [steps, state]);

  const handleDecrease = async () => {
    const params: DecreasePositionParams = {
      tokenId,
      token0Symbol,
      token1Symbol,
      liquidityPercentage: percentage,
      tickLower,
      tickUpper,
      slippageBps: 50,
      deadlineMinutes: 20,
    };

    await decreaseLiquidity(params);
  };

  return (
    <div className="p-4 bg-[#131313] rounded-lg border border-white/10 space-y-4">
      <h3 className="text-lg font-medium text-white">Remove Liquidity (Step-Based)</h3>

      {/* Percentage selector */}
      <div>
        <label className="text-sm text-white/60">Percentage to Remove</label>
        <div className="flex gap-2 mt-2">
          {[25, 50, 75, 100].map((p) => (
            <Button
              key={p}
              variant={percentage === p ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPercentage(p)}
              disabled={isLoading}
            >
              {p}%
            </Button>
          ))}
        </div>
      </div>

      {/* Step indicator */}
      {stepperSteps.length > 0 && <StepIndicator steps={stepperSteps} />}

      {/* Status */}
      {state.status === 'error' && (
        <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
          Error: {state.error}
        </div>
      )}

      {state.status === 'completed' && (
        <div className="p-2 bg-green-500/10 border border-green-500/20 rounded text-green-400 text-sm">
          Transaction completed successfully!
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={handleDecrease}
          disabled={isLoading}
          className="flex-1"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            `Remove ${percentage}%`
          )}
        </Button>

        {(state.status === 'completed' || state.status === 'error') && (
          <Button variant="outline" onClick={reset}>
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// COLLECT FEES EXAMPLE
// =============================================================================

interface CollectFeesExampleProps {
  tokenId: string;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  onSuccess?: () => void;
}

export function CollectFeesExample({
  tokenId,
  token0Symbol,
  token1Symbol,
  onSuccess,
}: CollectFeesExampleProps) {
  const {
    collectFees,
    isLoading,
    state,
    reset,
  } = useStepBasedCollectFees({
    onSuccess: (info) => {
      console.log('Collect fees success:', info);
      onSuccess?.();
    },
    onError: (error) => {
      console.error('Collect fees error:', error);
    },
  });

  const handleCollect = async () => {
    await collectFees({
      tokenId,
      token0Symbol,
      token1Symbol,
    });
  };

  return (
    <div className="p-4 bg-[#131313] rounded-lg border border-white/10 space-y-4">
      <h3 className="text-lg font-medium text-white">Collect Fees (Step-Based)</h3>

      {/* Status */}
      {state.status === 'error' && (
        <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
          Error: {state.error}
        </div>
      )}

      {state.status === 'completed' && (
        <div className="p-2 bg-green-500/10 border border-green-500/20 rounded text-green-400 text-sm">
          Fees collected successfully!
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          onClick={handleCollect}
          disabled={isLoading}
          className="flex-1"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Collecting...
            </>
          ) : (
            'Collect Fees'
          )}
        </Button>

        {(state.status === 'completed' || state.status === 'error') && (
          <Button variant="outline" onClick={reset}>
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}
