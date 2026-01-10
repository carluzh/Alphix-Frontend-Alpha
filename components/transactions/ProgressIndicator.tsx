'use client'

/**
 * ProgressIndicator - Shows multi-step transaction progress
 * Styled to match wizard stepper with rounded squares
 * Shows only 2 steps: last completed + current in action
 *
 * @see interface/packages/uniswap/src/components/ConfirmSwapModal/ProgressIndicator.tsx
 */

import { Fragment } from 'react'
import Image from 'next/image'
import { Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  TransactionStep,
  TransactionStepType,
  StepStatus,
  CurrentStepState,
  TokenApprovalStep,
  LiquidityPositionStep,
} from '@/lib/transactions/types'

interface ProgressIndicatorProps {
  steps: TransactionStep[]
  currentStep?: CurrentStepState
}

/**
 * Check if two steps are equal (for status calculation)
 * @see Uniswap's areStepsEqual function
 */
function areStepsEqual(
  step: TransactionStep,
  currentStep: TransactionStep | undefined
): boolean {
  if (!currentStep) return false
  if (step.type !== currentStep.type) return false

  if (
    step.type === TransactionStepType.TokenApprovalTransaction &&
    currentStep.type === TransactionStepType.TokenApprovalTransaction
  ) {
    return (step as TokenApprovalStep).tokenAddress === (currentStep as TokenApprovalStep).tokenAddress
  }

  return true
}

/**
 * Calculate status for a step based on current progress
 * @see Uniswap's getStatus logic
 */
function getStepStatus(
  step: TransactionStep,
  steps: TransactionStep[],
  currentStep?: CurrentStepState
): StepStatus {
  const currentIndex = currentStep
    ? steps.findIndex((s) => areStepsEqual(s, currentStep.step))
    : -1
  const targetIndex = steps.indexOf(step)

  if (currentIndex < 0) {
    return targetIndex === 0 ? StepStatus.Active : StepStatus.Preview
  }

  if (targetIndex < currentIndex) {
    return StepStatus.Complete
  }

  if (targetIndex === currentIndex) {
    return currentStep?.accepted ? StepStatus.InProgress : StepStatus.Active
  }

  return StepStatus.Preview
}

/**
 * Get step title based on type and status
 */
function getStepTitle(step: TransactionStep, status: StepStatus): string {
  switch (step.type) {
    case TransactionStepType.TokenApprovalTransaction: {
      const symbol = (step as TokenApprovalStep).tokenSymbol
      const titles: Record<StepStatus, string> = {
        [StepStatus.Preview]: `Approve ${symbol}`,
        [StepStatus.Active]: 'Approve in wallet',
        [StepStatus.InProgress]: `Approving ${symbol}...`,
        [StepStatus.Complete]: `${symbol} approved`,
      }
      return titles[status]
    }

    case TransactionStepType.Permit2Signature: {
      const titles: Record<StepStatus, string> = {
        [StepStatus.Preview]: 'Sign permit',
        [StepStatus.Active]: 'Sign in wallet',
        [StepStatus.InProgress]: 'Signing...',
        [StepStatus.Complete]: 'Permit signed',
      }
      return titles[status]
    }

    case TransactionStepType.CreatePositionTransaction:
    case TransactionStepType.IncreasePositionTransaction: {
      const titles: Record<StepStatus, string> = {
        [StepStatus.Preview]: 'Create position',
        [StepStatus.Active]: 'Confirm in wallet',
        [StepStatus.InProgress]: 'Creating position...',
        [StepStatus.Complete]: 'Position created',
      }
      return titles[status]
    }

    case TransactionStepType.ZapSwapAndDeposit: {
      const titles: Record<StepStatus, string> = {
        [StepStatus.Preview]: 'Swap & deposit',
        [StepStatus.Active]: 'Confirm in wallet',
        [StepStatus.InProgress]: 'Processing...',
        [StepStatus.Complete]: 'Complete',
      }
      return titles[status]
    }

    case TransactionStepType.DecreasePositionTransaction: {
      const titles: Record<StepStatus, string> = {
        [StepStatus.Preview]: 'Remove liquidity',
        [StepStatus.Active]: 'Confirm in wallet',
        [StepStatus.InProgress]: 'Removing...',
        [StepStatus.Complete]: 'Removed',
      }
      return titles[status]
    }

    case TransactionStepType.CollectFeesTransactionStep: {
      const titles: Record<StepStatus, string> = {
        [StepStatus.Preview]: 'Collect fees',
        [StepStatus.Active]: 'Confirm in wallet',
        [StepStatus.InProgress]: 'Collecting...',
        [StepStatus.Complete]: 'Fees collected',
      }
      return titles[status]
    }

    default:
      return 'Transaction'
  }
}

/**
 * Get step icon info
 */
function getStepIcon(step: TransactionStep): { icon?: string; symbol?: string } {
  switch (step.type) {
    case TransactionStepType.TokenApprovalTransaction:
      return {
        icon: (step as TokenApprovalStep).tokenIcon,
        symbol: (step as TokenApprovalStep).tokenSymbol,
      }
    case TransactionStepType.CreatePositionTransaction:
    case TransactionStepType.IncreasePositionTransaction:
    case TransactionStepType.DecreasePositionTransaction:
    case TransactionStepType.ZapSwapAndDeposit:
      return {
        icon: (step as LiquidityPositionStep).token0Icon,
        symbol: (step as LiquidityPositionStep).token0Symbol,
      }
    default:
      return {}
  }
}

/**
 * Single step row - wizard stepper style with rounded square
 */
function StepRow({
  step,
  status,
  stepNumber,
}: {
  step: TransactionStep
  status: StepStatus
  stepNumber: number
}): React.ReactNode {
  const title = getStepTitle(step, status)
  const { icon, symbol } = getStepIcon(step)

  const isActiveOrInProgress = status === StepStatus.Active || status === StepStatus.InProgress
  const isComplete = status === StepStatus.Complete

  return (
    <div className="flex items-center gap-3 py-2">
      {/* Step indicator - rounded square like wizard */}
      <div
        className={cn(
          'h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
          isActiveOrInProgress
            ? 'bg-sidebar-primary/20'
            : isComplete
              ? 'bg-green-500/15'
              : 'bg-sidebar-accent'
        )}
      >
        {isComplete ? (
          <Check className="w-4 h-4 text-green-500" />
        ) : status === StepStatus.InProgress ? (
          <Loader2 className="w-4 h-4 text-sidebar-primary animate-spin" />
        ) : icon ? (
          <Image
            src={icon}
            alt={symbol || 'token'}
            width={20}
            height={20}
            className="rounded-full"
          />
        ) : symbol ? (
          <span className="text-xs font-semibold text-white">
            {symbol.charAt(0)}
          </span>
        ) : (
          <span className="text-xs font-semibold text-muted-foreground font-mono">
            {stepNumber}
          </span>
        )}
      </div>

      {/* Step content */}
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span
          className={cn(
            'text-[10px] uppercase tracking-wider font-semibold',
            isActiveOrInProgress ? 'text-muted-foreground' : 'text-muted-foreground/60'
          )}
        >
          Step {stepNumber}
        </span>
        <span
          className={cn(
            'text-sm font-medium truncate',
            isActiveOrInProgress ? 'text-white' : 'text-muted-foreground/70'
          )}
        >
          {title}
        </span>
      </div>
    </div>
  )
}

/**
 * ProgressIndicator - Shows only 2 steps: last completed + current
 * Styled to match wizard stepper
 *
 * @see interface/packages/uniswap/src/components/ConfirmSwapModal/ProgressIndicator.tsx
 */
export function ProgressIndicator({
  steps,
  currentStep,
}: ProgressIndicatorProps): React.ReactNode {
  if (steps.length === 0) return null

  // Find current step index
  const currentIndex = currentStep
    ? steps.findIndex((s) => areStepsEqual(s, currentStep.step))
    : 0

  // Get visible steps: last completed (if any) + current
  const visibleSteps: Array<{ step: TransactionStep; index: number }> = []

  // Add last completed step if we're past the first step
  if (currentIndex > 0) {
    visibleSteps.push({ step: steps[currentIndex - 1], index: currentIndex - 1 })
  }

  // Add current step
  if (currentIndex >= 0 && currentIndex < steps.length) {
    visibleSteps.push({ step: steps[currentIndex], index: currentIndex })
  }

  return (
    <div className="animate-in fade-in duration-200">
      {/* Header with separator lines */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 h-px bg-sidebar-border" />
        <span className="text-xs text-muted-foreground">Continue in wallet</span>
        <div className="flex-1 h-px bg-sidebar-border" />
      </div>

      {/* Steps list - only show 2 steps */}
      <div className="space-y-1">
        {visibleSteps.map(({ step, index }, i) => {
          const status = getStepStatus(step, steps, currentStep)
          const isNotLast = i < visibleSteps.length - 1

          return (
            <Fragment key={`step-${index}-${step.type}`}>
              <StepRow
                step={step}
                status={status}
                stepNumber={index + 1}
              />

              {/* Connecting line between steps - centered under step indicator */}
              {isNotLast && (
                <div className="w-8 flex justify-center">
                  <div className="w-0.5 h-3 bg-green-500/30 rounded-full" />
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
