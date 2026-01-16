import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { TokenSymbol, NATIVE_TOKEN_ADDRESS, type TokenDefinitions } from '@/lib/pools-config';

export type FlowStep =
  | 'idle'
  | 'approving_token0'
  | 'approving_token1'
  | 'signing_permit'
  | 'executing';

export interface TransactionFlowState {
  currentStep: FlowStep;
  permitSignature?: string;
  isLocked: boolean;
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
      setState({
        currentStep: 'idle',
        isLocked: false,
        completedSteps: new Set(),
        error: undefined,
      });
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
  }), [onStepComplete]);

  const getNextStep = useCallback((approvalData: any): FlowStep | null => {
    if (!approvalData) return null;

    // Regular flow
    if (approvalData.needsToken0ERC20Approval && !state.completedSteps.has('approving_token0')) {
      return 'approving_token0';
    }
    if (approvalData.needsToken1ERC20Approval && !state.completedSteps.has('approving_token1')) {
      return 'approving_token1';
    }

    // Permit signing is now handled internally by handleDeposit (API-driven flow)
    return state.completedSteps.has('executing') ? null : 'executing';
  }, [state.completedSteps]);

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

export function generateStepperSteps(
  flowState: TransactionFlowState,
  approvalData: any,
  token0Symbol?: TokenSymbol,
  token1Symbol?: TokenSymbol,
  _isZapMode?: boolean, // Kept for backwards compatibility but ignored
  tokenDefinitions?: TokenDefinitions,
) {
  const steps: any[] = [];

  // Regular mode: Approvals → Permit → Deposit
  const needsToken0 = approvalData?.needsToken0ERC20Approval;
  const needsToken1 = approvalData?.needsToken1ERC20Approval;
  const token0IsNative = token0Symbol && tokenDefinitions?.[token0Symbol]?.address === NATIVE_TOKEN_ADDRESS;
  const token1IsNative = token1Symbol && tokenDefinitions?.[token1Symbol]?.address === NATIVE_TOKEN_ADDRESS;
  const totalTokens = (token0IsNative ? 0 : 1) + (token1IsNative ? 0 : 1);

  const alreadyApproved = (!token0IsNative && !needsToken0 ? 1 : 0) + (!token1IsNative && !needsToken1 ? 1 : 0);
  const sessionApproved = (needsToken0 && flowState.completedSteps.has('approving_token0') ? 1 : 0) +
                          (needsToken1 && flowState.completedSteps.has('approving_token1') ? 1 : 0);
  const totalApproved = alreadyApproved + sessionApproved;
  const isWorkingOnApprovals = flowState.currentStep === 'approving_token0' || flowState.currentStep === 'approving_token1';

  steps.push({
    id: 'approvals',
    label: 'Token Approvals',
    status: isWorkingOnApprovals ? 'loading' as const : totalApproved === totalTokens ? 'completed' as const : 'pending' as const,
    count: { completed: totalApproved, total: totalTokens },
  });

  // Permit signing is now handled internally by handleDeposit (API-driven flow)
  // Mark as completed when we reach executing step, or show as pending before that
  const permitCompleted = flowState.currentStep === 'executing' || flowState.completedSteps.has('executing');

  steps.push({
    id: 'permit',
    label: 'Permit Signature',
    status: permitCompleted ? 'completed' as const : 'pending' as const,
  });

  steps.push({
    id: 'execute',
    label: 'Deposit Transaction',
    status: flowState.completedSteps.has('executing') ? 'completed' as const : flowState.currentStep === 'executing' ? 'loading' as const : 'pending' as const,
  });

  return steps;
}
