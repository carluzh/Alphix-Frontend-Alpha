import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { TokenSymbol, TOKEN_DEFINITIONS, NATIVE_TOKEN_ADDRESS } from '@/lib/pools-config';

export type FlowStep =
  | 'idle'
  | 'approving_token0'
  | 'approving_token1'
  | 'approving_zap_tokens'   // Zap: approve both tokens together
  | 'approving_input'        // Zap: track input token approval for UI
  | 'approving_output'       // Zap: track output token approval for UI
  | 'signing_swap_permit'    // Zap: sign permit for swap (unused currently)
  | 'swapping'               // Zap: execute swap (unused currently)
  | 'signing_permit'         // Regular: sign batch permit for LP
  | 'signing_batch_permit'   // Zap: sign batch permit for LP (unused currently)
  | 'executing';

export interface TransactionFlowState {
  currentStep: FlowStep;
  permitSignature?: string;        // Regular mode: batch permit signature
  swapPermitSignature?: string;    // Zap mode: swap permit signature
  batchPermitSignature?: string;   // Zap mode: batch permit signature after swap
  isLocked: boolean; // Prevents state changes during transitions
  completedSteps: Set<FlowStep>;
  error?: string;
}

export interface TransactionFlowActions {
  startFlow: () => void;
  setStep: (step: FlowStep) => void;
  completeStep: (step: FlowStep) => void;
  setPermitSignature: (signature: string) => void;
  setSwapPermitSignature: (signature: string) => void;
  setBatchPermitSignature: (signature: string) => void;
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
  getNextStep: (approvalData: any, isZapMode?: boolean) => FlowStep | null;
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

    setSwapPermitSignature: (signature: string) => {
      setState(prev => ({ ...prev, swapPermitSignature: signature }));
    },

    setBatchPermitSignature: (signature: string) => {
      setState(prev => ({ ...prev, batchPermitSignature: signature }));
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
        swapPermitSignature: undefined,
        batchPermitSignature: undefined,
      });
      flowActiveRef.current = false;
    },

    isStepCompleted: (step: FlowStep) => {
      return state.completedSteps.has(step);
    },
  }), [state.completedSteps, onStepComplete]);

  const getNextStep = useCallback((approvalData: any, isZapMode?: boolean): FlowStep | null => {
    if (!approvalData) return null;

    if (isZapMode) {
      // Zap flow: 1. Approve both tokens → 2. Execute (consolidated swap + LP deposit)

      // If we've already completed approvals, skip to execution
      if (state.completedSteps.has('approving_zap_tokens')) {
        if (!state.completedSteps.has('executing')) {
          return 'executing';
        }
        return null; // All done
      }

      // Check if approvals are still needed
      const needsInputApproval = approvalData.needsInputTokenERC20Approval;
      const needsOutputApproval = approvalData.needsOutputTokenERC20Approval;

      // If either token needs approval and we haven't completed the batch approval, do it
      if (needsInputApproval || needsOutputApproval) {
        return 'approving_zap_tokens';
      }

      // No approvals needed, go straight to execution
      if (!state.completedSteps.has('executing')) {
        return 'executing';
      }
    } else {
      // Regular flow: 1. Approve tokens → 2. Sign batch permit → 3. Execute

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
    }

    // All steps completed
    return null;
  }, [state.completedSteps, state.permitSignature, state.swapPermitSignature, state.batchPermitSignature]);

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
  isZapMode?: boolean,
) {
  const steps: any[] = [];

  // ZAP MODE: 2 steps (Token Approvals → Execute Zap)
  if (isZapMode) {
    // Step 1: Token Approvals (both input and output)
    // Handle case when approvalData is not loaded yet
    if (!approvalData) {
      steps.push({
        id: 'approvals',
        label: 'Token Approvals',
        status: 'loading' as const,
        // Don't show count when data is loading
      });
    } else {
      // Safely extract approval flags - if undefined, we can't determine state yet
      const needsInputApproval = Boolean(approvalData.needsInputTokenERC20Approval);
      const needsOutputApproval = Boolean(approvalData.needsOutputTokenERC20Approval);

      // Debug logging
      console.log('[generateStepperSteps] Zap approval data:', {
        needsInputApproval,
        needsOutputApproval,
        approvalData,
        inputTokenAllowance: approvalData.inputTokenAllowance,
        outputTokenAllowance: approvalData.outputTokenAllowance,
      });

      // Count total approvals needed (0, 1, or 2)
      const totalApprovalsNeeded = (needsInputApproval ? 1 : 0) + (needsOutputApproval ? 1 : 0);

      // Check if batch approval is complete
      const batchApprovalComplete = flowState.completedSteps.has('approving_zap_tokens');

      // Check individual approval progress
      const inputApproved = flowState.completedSteps.has('approving_input');
      const outputApproved = flowState.completedSteps.has('approving_output');

      // Determine approval progress
      let approvalsCompleted = 0;

      if (batchApprovalComplete) {
        // Batch complete means all needed approvals are done
        approvalsCompleted = totalApprovalsNeeded;
      } else if (!needsInputApproval && !needsOutputApproval) {
        // Neither needs approval (both already approved or native)
        approvalsCompleted = totalApprovalsNeeded; // Will be 0
      } else {
        // Count individual approval progress
        // Only count as completed if: (step completed in this session) OR (doesn't need approval)
        // This ensures we don't count tokens that need approval but haven't been approved yet
        if (needsInputApproval) {
          // Needs approval - only count if step was completed
          if (inputApproved) approvalsCompleted++;
        } else {
          // Doesn't need approval - count as complete
          approvalsCompleted++;
        }
        
        if (needsOutputApproval) {
          // Needs approval - only count if step was completed
          if (outputApproved) approvalsCompleted++;
        } else {
          // Doesn't need approval - count as complete
          approvalsCompleted++;
        }
      }
      
      // Debug logging
      console.log('[generateStepperSteps] Approval progress calculation:', {
        needsInputApproval,
        needsOutputApproval,
        inputApproved,
        outputApproved,
        batchApprovalComplete,
        totalApprovalsNeeded,
        approvalsCompleted,
      });

      const allApprovalsComplete = batchApprovalComplete || (!needsInputApproval && !needsOutputApproval);
      const isWorkingOnApprovals = flowState.currentStep === 'approving_zap_tokens' ||
        (flowState.isLocked && totalApprovalsNeeded > 0 && !batchApprovalComplete);

      // Only show count if we have approvals needed (hide 0/0)
      steps.push({
        id: 'approvals',
        label: 'Token Approvals',
        status: allApprovalsComplete ? 'completed' as const :
                isWorkingOnApprovals ? 'loading' as const :
                'pending' as const,
        // Only show count if total > 0, otherwise hide it
        ...(totalApprovalsNeeded > 0 ? { count: { completed: approvalsCompleted, total: totalApprovalsNeeded } } : {}),
      });
    }

    // Step 2: Execute Zap (consolidated swap + LP deposit with inline permits)
    const zapCompleted = flowState.completedSteps.has('executing');
    // Calculate allApprovalsComplete if approvalData exists, otherwise default to true (skip approvals)
    const allApprovalsComplete = approvalData 
      ? (flowState.completedSteps.has('approving_zap_tokens') || 
         (!approvalData.needsInputTokenERC20Approval && !approvalData.needsOutputTokenERC20Approval))
      : false; // If no approvalData, don't allow execution yet
    const isWorkingOnZap = flowState.currentStep === 'executing' ||
      (flowState.isLocked && !zapCompleted && allApprovalsComplete);

    steps.push({
      id: 'execute',
      label: 'Execute Zap',
      status: zapCompleted ? 'completed' as const :
              isWorkingOnZap ? 'loading' as const :
              'pending' as const,
    });

    return steps;
  }

  // REGULAR MODE: 3 steps (Token Approvals → Permit → Deposit)

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