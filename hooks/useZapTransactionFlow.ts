/**
 * Hook for managing single-token zap transaction flow
 * Flow:
 * 1. Approve input token (and output token if already have some) to Permit2
 * 2. Sign Swap Permit (if needed - not for native tokens)
 * 3. Execute Swap
 * 4. Sign Mint Permit (always needed for PermitBatch)
 * 5. Execute Deposit (always needed)
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { TokenSymbol } from '@/lib/pools-config';

export type ZapFlowStep =
  | 'idle'
  | 'approving_input_token'   // Approve input token to Permit2
  | 'approving_output_token'  // Approve output token to Permit2
  | 'signing_swap_permit'     // Sign Permit2 for swap (if needed)
  | 'executing_swap'          // Execute the swap transaction
  | 'signing_mint_permit'     // Sign PermitBatch for mint (always)
  | 'depositing';

export interface ZapTransactionFlowState {
  currentStep: ZapFlowStep;
  swapPermitSignature?: string;
  mintPermitSignature?: string;
  swapTxHash?: string;
  isLocked: boolean;
  completedSteps: Set<ZapFlowStep>;
  error?: string;
  zapCalculation?: {
    optimalSwapAmount: string;
    minSwapOutput: string;
    expectedToken0Amount: string;
    expectedToken1Amount: string;
    expectedLiquidity: string;
  };
}

export interface ZapTransactionFlowActions {
  startFlow: () => void;
  setStep: (step: ZapFlowStep) => void;
  completeStep: (step: ZapFlowStep) => void;
  setSwapPermitSignature: (signature: string) => void;
  setMintPermitSignature: (signature: string) => void;
  setSwapTxHash: (hash: string) => void;
  setZapCalculation: (calc: any) => void;
  setError: (error: string | undefined) => void;
  lock: () => void;
  unlock: () => void;
  reset: () => void;
  isStepCompleted: (step: ZapFlowStep) => boolean;
}

export interface UseZapTransactionFlowProps {
  onFlowComplete?: () => void;
  onStepComplete?: (step: ZapFlowStep) => void;
}

export interface UseZapTransactionFlowReturn {
  state: ZapTransactionFlowState;
  actions: ZapTransactionFlowActions;
  getNextStep: (approvalData: any) => ZapFlowStep | null;
  canProceed: () => boolean;
  isFlowActive: () => boolean;
}

/**
 * Hook to manage zap transaction flow state
 */
export function useZapTransactionFlow(props?: UseZapTransactionFlowProps): UseZapTransactionFlowReturn {
  const { onFlowComplete, onStepComplete } = props || {};

  const [state, setState] = useState<ZapTransactionFlowState>({
    currentStep: 'idle',
    isLocked: false,
    completedSteps: new Set(),
  });

  const flowActiveRef = useRef(false);

  const actions: ZapTransactionFlowActions = useMemo(() => ({
    startFlow: () => {
      setState(prev => ({
        ...prev,
        currentStep: 'idle',
        isLocked: false,
        completedSteps: new Set(),
        error: undefined,
      }));
      flowActiveRef.current = true;
    },

    setStep: (step: ZapFlowStep) => {
      setState(prev => {
        if (prev.isLocked) return prev;
        return { ...prev, currentStep: step, error: undefined };
      });
    },

    completeStep: (step: ZapFlowStep) => {
      setState(prev => {
        const newCompletedSteps = new Set(prev.completedSteps);
        newCompletedSteps.add(step);
        return {
          ...prev,
          completedSteps: newCompletedSteps,
          currentStep: 'idle',
          error: undefined,
        };
      });
      onStepComplete?.(step);
    },

    setSwapPermitSignature: (signature: string) => {
      setState(prev => ({ ...prev, swapPermitSignature: signature }));
    },

    setMintPermitSignature: (signature: string) => {
      setState(prev => ({ ...prev, mintPermitSignature: signature }));
    },

    setSwapTxHash: (hash: string) => {
      setState(prev => ({ ...prev, swapTxHash: hash }));
    },

    setZapCalculation: (calc: any) => {
      setState(prev => ({ ...prev, zapCalculation: calc }));
    },

    setError: (error: string | undefined) => {
      setState(prev => ({ ...prev, error, isLocked: false }));
    },

    lock: () => {
      setState(prev => ({ ...prev, isLocked: true }));
    },

    unlock: () => {
      setState(prev => ({ ...prev, isLocked: false }));
    },

    reset: () => {
      setState({
        currentStep: 'idle',
        isLocked: false,
        completedSteps: new Set(),
        error: undefined,
        swapPermitSignature: undefined,
        mintPermitSignature: undefined,
        swapTxHash: undefined,
        zapCalculation: undefined,
      });
      flowActiveRef.current = false;
    },

    isStepCompleted: (step: ZapFlowStep) => {
      return state.completedSteps.has(step);
    },
  }), [state.completedSteps, onStepComplete]);

  const getNextStep = useCallback((approvalData: any): ZapFlowStep | null => {
    if (!approvalData) return null;

    // STEP 1: Input token approval
    if (approvalData.inputNeedsERC20Approval && !state.completedSteps.has('approving_input_token')) {
      return 'approving_input_token';
    }

    // STEP 2: Output token approval
    if (approvalData.outputNeedsERC20Approval && !state.completedSteps.has('approving_output_token')) {
      return 'approving_output_token';
    }

    // STEP 3: Sign swap Permit2 (only if needed)
    if (approvalData.swapNeedsPermit && !state.swapPermitSignature && !state.completedSteps.has('signing_swap_permit')) {
      return 'signing_swap_permit';
    }

    // STEP 4: Execute swap
    if (!state.swapTxHash && !state.completedSteps.has('executing_swap')) {
      return 'executing_swap';
    }

    // STEP 5: Sign mint PermitBatch (always)
    if (state.completedSteps.has('executing_swap') && !state.mintPermitSignature && !state.completedSteps.has('signing_mint_permit')) {
      return 'signing_mint_permit';
    }

    // STEP 6: Execute deposit
    if (state.completedSteps.has('signing_mint_permit') && !state.completedSteps.has('depositing')) {
      return 'depositing';
    }

    // All steps completed
    return null;
  }, [state.completedSteps, state.swapPermitSignature, state.mintPermitSignature, state.swapTxHash]);

  const canProceed = useCallback(() => {
    return !state.isLocked && state.currentStep === 'idle' && !state.error;
  }, [state.isLocked, state.currentStep, state.error]);

  const isFlowActive = useCallback(() => {
    return flowActiveRef.current;
  }, []);

  // Check if flow is complete
  useEffect(() => {
    if (state.completedSteps.has('depositing') && flowActiveRef.current && onFlowComplete) {
      flowActiveRef.current = false;
      onFlowComplete();
    }
  }, [state.completedSteps, onFlowComplete]);

  return {
    state,
    actions,
    getNextStep,
    canProceed,
    isFlowActive,
  };
}

/**
 * Helper to generate stepper steps from zap flow state
 */
export function generateZapStepperSteps(
  flowState: ZapTransactionFlowState,
  approvalData: any,
  inputTokenSymbol?: TokenSymbol,
  outputTokenSymbol?: TokenSymbol,
) {
  const steps: any[] = [];

  // Step 1: Token Approvals (show as single row with count like 0/2)
  const needsInputApproval = approvalData?.inputNeedsERC20Approval;
  const needsOutputApproval = approvalData?.outputNeedsERC20Approval;
  const needsApprovals = needsInputApproval || needsOutputApproval;

  if (needsApprovals) {
    const inputApproved = flowState.completedSteps.has('approving_input_token');
    const outputApproved = flowState.completedSteps.has('approving_output_token');
    const totalNeeded = (needsInputApproval ? 1 : 0) + (needsOutputApproval ? 1 : 0);
    const totalCompleted = (needsInputApproval && inputApproved ? 1 : 0) + (needsOutputApproval && outputApproved ? 1 : 0);
    const allApprovalsComplete = totalCompleted === totalNeeded;
    const isApproving = flowState.currentStep === 'approving_input_token' || flowState.currentStep === 'approving_output_token';

    steps.push({
      id: 'approvals',
      label: `Approve Tokens ${totalCompleted}/${totalNeeded}`,
      status:
        isApproving ? 'loading' as const :
        allApprovalsComplete ? 'completed' as const :
        'pending' as const,
    });
  }

  // Step 2: Swap Permit (only if needed)
  const needsSwapPermit = approvalData?.swapNeedsPermit;
  if (needsSwapPermit) {
    const swapPermitComplete = !!flowState.swapPermitSignature || flowState.completedSteps.has('signing_swap_permit');
    steps.push({
      id: 'swap_permit',
      label: 'Sign Swap Permit',
      status:
        flowState.currentStep === 'signing_swap_permit' ? 'loading' as const :
        swapPermitComplete ? 'completed' as const :
        'pending' as const,
    });
  }

  // Step 3: Execute Swap
  const swapComplete = !!flowState.swapTxHash || flowState.completedSteps.has('executing_swap');
  steps.push({
    id: 'execute_swap',
    label: 'Execute Swap',
    status:
      flowState.currentStep === 'executing_swap' ? 'loading' as const :
      swapComplete ? 'completed' as const :
      'pending' as const,
  });

  // Step 4: Mint Permit (always needed)
  const mintPermitComplete = !!flowState.mintPermitSignature || flowState.completedSteps.has('signing_mint_permit');
  steps.push({
    id: 'mint_permit',
    label: 'Sign Mint Permit',
    status:
      flowState.currentStep === 'signing_mint_permit' ? 'loading' as const :
      mintPermitComplete ? 'completed' as const :
      'pending' as const,
  });

  // Step 5: Deposit Transaction (always needed)
  steps.push({
    id: 'deposit',
    label: 'Deposit Transaction',
    status:
      flowState.currentStep === 'depositing' ? 'loading' as const :
      flowState.completedSteps.has('depositing') ? 'completed' as const :
      'pending' as const,
  });

  return steps;
}
