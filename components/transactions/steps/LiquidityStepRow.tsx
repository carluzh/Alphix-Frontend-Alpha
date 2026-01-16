'use client'

/**
 * LiquidityStepRow - Step row for liquidity position transactions
 * Adapted from: interface/packages/uniswap/src/components/ConfirmSwapModal/steps/LP.tsx
 */

import { Droplets } from 'lucide-react'
import { StepRowSkeleton } from '../StepRowSkeleton'
import {
  StepStatus,
  StepRowProps,
  LiquidityPositionStep,
  TransactionStepType,
} from '@/lib/transactions/types'

/**
 * LP icon - circular badge with droplets icon
 * Adapted from Uniswap's LPIcon with Tailwind
 */
function LPIcon(): React.ReactNode {
  return (
    <div className="w-6 h-6 rounded-full bg-sidebar-primary flex items-center justify-center">
      <Droplets className="w-3 h-3 text-sidebar-background" />
    </div>
  )
}

/**
 * Get action label based on step type
 */
function getActionLabel(stepType: TransactionStepType): string {
  const actionLabels: Record<TransactionStepType, string> = {
    [TransactionStepType.CreatePositionTransaction]: 'Create position',
    [TransactionStepType.IncreasePositionTransaction]: 'Add liquidity',
    [TransactionStepType.IncreasePositionTransactionAsync]: 'Add liquidity',
    [TransactionStepType.DecreasePositionTransaction]: 'Remove liquidity',
    [TransactionStepType.CollectFeesTransactionStep]: 'Collect fees',
    // These won't be used but needed for type completeness
    [TransactionStepType.TokenApprovalTransaction]: 'Approve',
    [TransactionStepType.TokenRevocationTransaction]: 'Revoke',
    [TransactionStepType.Permit2Signature]: 'Sign',
    [TransactionStepType.Permit2Transaction]: 'Permit',
  }
  return actionLabels[stepType] || 'Confirm'
}

/**
 * Get title based on step status and type
 * Follows Uniswap's pattern of status-based titles
 */
function getTitle(status: StepStatus, stepType: TransactionStepType): string {
  const baseLabel = getActionLabel(stepType)

  const titles: Record<StepStatus, string> = {
    [StepStatus.Preview]: baseLabel,
    [StepStatus.Active]: 'Confirm in wallet',
    [StepStatus.InProgress]: 'Transaction pending...',
    [StepStatus.Complete]: `${baseLabel} complete`,
  }

  return titles[status]
}

/**
 * LiquidityStepRow - Displays liquidity transaction step with LP icon
 */
export function LiquidityStepRow({
  step,
  status,
  currentStepIndex,
  totalStepsCount,
}: StepRowProps<LiquidityPositionStep>): React.ReactNode {
  return (
    <StepRowSkeleton
      title={getTitle(status, step.type)}
      icon={<LPIcon />}
      status={status}
      currentStepIndex={currentStepIndex}
      totalStepsCount={totalStepsCount}
    />
  )
}
