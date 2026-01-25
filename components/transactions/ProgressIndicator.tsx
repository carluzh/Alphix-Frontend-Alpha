'use client'

/**
 * ProgressIndicator - Multi-step transaction progress
 */

import { Fragment } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import {
  IconCheckboxCheckedFilled,
  IconPenWriting,
  IconPlus,
  IconMinus,
  IconCoins,
} from 'nucleo-micro-bold-essential'
import {
  TransactionStep,
  TransactionStepType,
  StepStatus,
  CurrentStepState,
  TokenApprovalStep,
  FaucetMintStep,
} from '@/lib/transactions/types'

interface ProgressIndicatorProps {
  steps: TransactionStep[]
  currentStep?: CurrentStepState
}

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

  if (
    step.type === TransactionStepType.FaucetMintTransaction &&
    currentStep.type === TransactionStepType.FaucetMintTransaction
  ) {
    return (step as FaucetMintStep).tokenAddress === (currentStep as FaucetMintStep).tokenAddress
  }

  return true
}

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

function getStepText(step: TransactionStep, status: StepStatus): { title: string; subtitle?: string } {
  const isComplete = status === StepStatus.Complete

  switch (step.type) {
    case TransactionStepType.TokenApprovalTransaction: {
      const symbol = (step as TokenApprovalStep).tokenSymbol
      return isComplete
        ? { title: `${symbol} approved` }
        : { title: `Approving ${symbol}`, subtitle: 'Approve in wallet' }
    }

    case TransactionStepType.Permit2Signature:
      return isComplete
        ? { title: 'Permit signed' }
        : { title: 'Signing Permit', subtitle: 'Sign in wallet' }

    case TransactionStepType.CreatePositionTransaction:
      return isComplete
        ? { title: 'Position created' }
        : { title: 'Creating Position', subtitle: 'Confirm in wallet' }

    case TransactionStepType.IncreasePositionTransaction:
      return isComplete
        ? { title: 'Liquidity added' }
        : { title: 'Adding Liquidity', subtitle: 'Confirm in wallet' }

    case TransactionStepType.DecreasePositionTransaction:
      return isComplete
        ? { title: 'Liquidity removed' }
        : { title: 'Removing Liquidity', subtitle: 'Confirm in wallet' }

    case TransactionStepType.CollectFeesTransactionStep:
      return isComplete
        ? { title: 'Fees collected' }
        : { title: 'Collecting Fees', subtitle: 'Confirm in wallet' }

    case TransactionStepType.FaucetMintTransaction: {
      const symbol = (step as FaucetMintStep).tokenSymbol
      return isComplete
        ? { title: `${symbol} minted` }
        : { title: `Minting ${symbol}`, subtitle: 'Confirm in wallet' }
    }

    default:
      return { title: 'Transaction' }
  }
}

type StepIconInfo =
  | { type: 'token'; icon?: string; symbol?: string }
  | { type: 'icon'; Icon: React.ComponentType<{ className?: string }> }

function getStepIcon(step: TransactionStep): StepIconInfo {
  switch (step.type) {
    case TransactionStepType.TokenApprovalTransaction:
      return { type: 'token', icon: (step as TokenApprovalStep).tokenIcon, symbol: (step as TokenApprovalStep).tokenSymbol }
    case TransactionStepType.Permit2Signature:
      return { type: 'icon', Icon: IconPenWriting }
    case TransactionStepType.CreatePositionTransaction:
    case TransactionStepType.IncreasePositionTransaction:
      return { type: 'icon', Icon: IconPlus }
    case TransactionStepType.DecreasePositionTransaction:
      return { type: 'icon', Icon: IconMinus }
    case TransactionStepType.CollectFeesTransactionStep:
      return { type: 'icon', Icon: IconCoins }
    case TransactionStepType.FaucetMintTransaction:
      return { type: 'token', icon: (step as FaucetMintStep).tokenIcon, symbol: (step as FaucetMintStep).tokenSymbol }
    default:
      return { type: 'icon', Icon: IconPenWriting }
  }
}

function StepRow({
  step,
  status,
}: {
  step: TransactionStep
  status: StepStatus
}): React.ReactNode {
  const { title, subtitle } = getStepText(step, status)
  const iconInfo = getStepIcon(step)
  const isComplete = status === StepStatus.Complete

  const renderIcon = () => {
    if (isComplete) {
      return <IconCheckboxCheckedFilled className="w-4 h-4 text-green-500" />
    }
    if (iconInfo.type === 'token') {
      if (iconInfo.icon) {
        return <Image src={iconInfo.icon} alt={iconInfo.symbol || 'token'} width={20} height={20} className="rounded-full" />
      }
      if (iconInfo.symbol) {
        return <span className="text-xs font-semibold text-white">{iconInfo.symbol.charAt(0)}</span>
      }
    }
    if (iconInfo.type === 'icon') {
      return <iconInfo.Icon className="w-4 h-4 text-muted-foreground" />
    }
    return null
  }

  return (
    <div className={cn(
      "flex items-center gap-3 py-2 transition-all duration-100",
      isComplete && "opacity-50"
    )}>
      <div className="h-8 w-8 shrink-0 rounded-lg bg-sidebar-accent flex items-center justify-center">
        {renderIcon()}
      </div>

      <div className="flex flex-col min-w-0 flex-1">
        <span className={cn('text-sm font-medium truncate', isComplete ? 'text-muted-foreground' : 'text-white')}>
          {title}
        </span>
        {subtitle && (
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        )}
      </div>
    </div>
  )
}

export function ProgressIndicator({
  steps,
  currentStep,
}: ProgressIndicatorProps): React.ReactNode {
  if (steps.length === 0) return null

  const currentIndex = currentStep
    ? steps.findIndex((s) => areStepsEqual(s, currentStep.step))
    : 0

  // Visible steps: last completed (if any) + current
  const visibleSteps: Array<{ step: TransactionStep; index: number }> = []
  if (currentIndex > 0) {
    visibleSteps.push({ step: steps[currentIndex - 1], index: currentIndex - 1 })
  }
  if (currentIndex >= 0 && currentIndex < steps.length) {
    visibleSteps.push({ step: steps[currentIndex], index: currentIndex })
  }

  return (
    <div className="animate-in fade-in duration-200">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 h-px bg-sidebar-border" />
        <span className="text-xs text-muted-foreground">Continue in wallet</span>
        <div className="flex-1 h-px bg-sidebar-border" />
      </div>

      <div className="space-y-0.5">
        {visibleSteps.map(({ step, index }, i) => (
          <Fragment key={`step-${index}-${step.type}`}>
            <StepRow step={step} status={getStepStatus(step, steps, currentStep)} />
            {i < visibleSteps.length - 1 && (
              <div className="w-8 flex justify-center">
                <div className="w-0.5 h-2 bg-green-500/30 rounded-full" />
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
