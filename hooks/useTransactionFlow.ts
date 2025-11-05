import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { TokenSymbol, TOKEN_DEFINITIONS, NATIVE_TOKEN_ADDRESS } from '@/lib/pools-config';

export type FlowStep =
  | 'idle'
  | 'approving_token0'
  | 'approving_token1'
  | 'signing_permit'
  | 'executing';

export interface TransactionFlowState {
  currentStep: FlowStep;
  permitSignature?: string;
  isLocked: boolean; // Prevents state changes during transitions
  completedSteps: Set<FlowStep>;
  error?: string;
}

export interface TransactionFlowActions {
  startFlow: () => void;
  setStep: (step: FlowStep) => void;
  completeStep: (step: FlowStep) => void;
  setPermitSignature: (signature: string) => void;
  setError: (error: string | undefined) => void;
  lock: () => void;
  unlock: () => void;
  reset: () => void;
  isStepCompleted: (step: FlowStep) => boolean;
}

export interface UseTransactionFlowProps {
  onFlowComplete?: () => void;
  onStepComplete?: (step: FlowStep) => void;
}

export interface UseTransactionFlowReturn {
  state: TransactionFlowState;
  actions: TransactionFlowActions;
  getNextStep: (approvalData: any) => FlowStep | null;
  canProceed: () => boolean;
  isFlowActive: () => boolean;
}

/**
 * Hook to manage transaction flow state atomically
 * Ensures smooth transitions between steps without flickering
 */
export function useTransactionFlow(props?: UseTransactionFlowProps): UseTransactionFlowReturn {
  const { onFlowComplete, onStepComplete } = props || {};

  const [state, setState] = useState<TransactionFlowState>({
    currentStep: 'idle',
    isLocked: false,
    completedSteps: new Set(),
  });

  const flowActiveRef = useRef(false);

  const actions: TransactionFlowActions = useMemo(() => ({
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

    setStep: (step: FlowStep) => {
      setState(prev => {
        if (prev.isLocked) return prev;
        return { ...prev, currentStep: step, error: undefined };
      });
    },

    completeStep: (step: FlowStep) => {
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

    setPermitSignature: (signature: string) => {
      setState(prev => ({ ...prev, permitSignature: signature }));
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
        permitSignature: undefined,
      });
      flowActiveRef.current = false;
    },

    isStepCompleted: (step: FlowStep) => {
      return state.completedSteps.has(step);
    },
  }), [state.completedSteps, onStepComplete]);

  const getNextStep = useCallback((approvalData: any): FlowStep | null => {
    if (!approvalData) return null;

    // Check token0 approval
    if (approvalData.needsToken0ERC20Approval && !state.completedSteps.has('approving_token0')) {
      return 'approving_token0';
    }

    // Check token1 approval
    if (approvalData.needsToken1ERC20Approval && !state.completedSteps.has('approving_token1')) {
      return 'approving_token1';
    }

    // Check permit signature - ALWAYS required for ERC20 tokens after approvals
    // (Permit is short-lived and minimal amount, similar to swap flow)
    // Note: We check if we have a signature, not if we've completed the step before
    // This allows re-signing if the signature was cleared (e.g., amount changed)
    if (!state.permitSignature) {
      return 'signing_permit';
    }

    // Ready to execute
    if (!state.completedSteps.has('executing')) {
      return 'executing';
    }

    // All steps completed
    return null;
  }, [state.completedSteps, state.permitSignature]);

  const canProceed = useCallback(() => {
    return !state.isLocked && state.currentStep === 'idle' && !state.error;
  }, [state.isLocked, state.currentStep, state.error]);

  const isFlowActive = useCallback(() => {
    return flowActiveRef.current;
  }, []);

  // Check if flow is complete (only once)
  useEffect(() => {
    if (state.completedSteps.has('executing') && flowActiveRef.current && onFlowComplete) {
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
 * Helper to generate stepper steps from flow state and approval data
 */
export function generateStepperSteps(
  flowState: TransactionFlowState,
  approvalData: any,
  token0Symbol?: TokenSymbol,
  token1Symbol?: TokenSymbol,
) {
  const steps: any[] = [];

  // Token Approvals step - ALWAYS show actual state
  const needsToken0 = approvalData?.needsToken0ERC20Approval;
  const needsToken1 = approvalData?.needsToken1ERC20Approval;

  // Determine total number of tokens (excluding native ETH)
  const token0IsNative = token0Symbol && TOKEN_DEFINITIONS[token0Symbol]?.address === NATIVE_TOKEN_ADDRESS;
  const token1IsNative = token1Symbol && TOKEN_DEFINITIONS[token1Symbol]?.address === NATIVE_TOKEN_ADDRESS;
  const totalTokens = (token0IsNative ? 0 : 1) + (token1IsNative ? 0 : 1);

  // Count how many are already approved (don't need approval) or have been approved this session
  const alreadyApprovedCount =
    (!token0IsNative && !needsToken0 ? 1 : 0) +  // Token0 is ERC20 and doesn't need approval = already approved
    (!token1IsNative && !needsToken1 ? 1 : 0);   // Token1 is ERC20 and doesn't need approval = already approved

  const sessionApprovedCount =
    (needsToken0 && flowState.completedSteps.has('approving_token0') ? 1 : 0) +
    (needsToken1 && flowState.completedSteps.has('approving_token1') ? 1 : 0);

  const totalApproved = alreadyApprovedCount + sessionApprovedCount;

  // Determine if currently working on approvals
  const isWorkingOnApprovals =
    flowState.currentStep === 'approving_token0' ||
    flowState.currentStep === 'approving_token1' ||
    (flowState.isLocked && (needsToken0 || needsToken1) && totalApproved < totalTokens);

  steps.push({
    id: 'approvals',
    label: 'Token Approvals',
    status:
      isWorkingOnApprovals ? 'loading' as const :
      (totalApproved === totalTokens) ? 'completed' as const :
      'pending' as const,
    count: { completed: totalApproved, total: totalTokens },
  });

  // Permit Signature step - ALWAYS show, ALWAYS required for ERC20 tokens
  // (Short-lived permit with exact amount + 1 wei, 10 minute expiry)
  const isWorkingOnPermit =
    flowState.currentStep === 'signing_permit' ||
    (flowState.isLocked && !flowState.permitSignature && totalApproved === totalTokens);

  // Permit is completed ONLY if we have a valid signature
  // (Don't rely on completedSteps since signature can be cleared when amounts change)
  const permitIsCompleted = !!flowState.permitSignature;

  steps.push({
    id: 'permit',
    label: 'Permit Signature',
    status:
      permitIsCompleted ? 'completed' as const :
      isWorkingOnPermit ? 'loading' as const :
      'pending' as const,
  });

  // Execute Transaction step (Deposit Transaction) - ALWAYS show
  const isWorkingOnExecute =
    flowState.currentStep === 'executing' ||
    (flowState.isLocked && !flowState.completedSteps.has('executing') && totalApproved === totalTokens && flowState.permitSignature);

  steps.push({
    id: 'execute',
    label: 'Deposit Transaction',
    status: flowState.completedSteps.has('executing') ? 'completed' as const :
            isWorkingOnExecute ? 'loading' as const :
            'pending' as const,
  });

  return steps;
}