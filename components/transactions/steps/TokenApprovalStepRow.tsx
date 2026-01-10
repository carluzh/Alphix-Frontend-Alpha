'use client'

/**
 * TokenApprovalStepRow - Step row for ERC20 token approvals
 * Adapted from: interface/packages/uniswap/src/components/ConfirmSwapModal/steps/Approve.tsx
 */

import { StepRowSkeleton } from '../StepRowSkeleton'
import { StepStatus, StepRowProps, TokenApprovalStep } from '@/lib/transactions/types'

/**
 * Get title text based on step status and token symbol
 * Follows Uniswap's pattern of status-based titles
 */
function getTitle(status: StepStatus, symbol: string): string {
  const titles: Record<StepStatus, string> = {
    [StepStatus.Preview]: `Approve ${symbol}`,
    [StepStatus.Active]: 'Approve in wallet',
    [StepStatus.InProgress]: `Approving ${symbol}...`,
    [StepStatus.Complete]: `${symbol} approved`,
  }
  return titles[status]
}

/**
 * TokenApprovalStepRow - Displays approval step with token icon and status-based title
 */
export function TokenApprovalStepRow({
  step,
  status,
  currentStepIndex,
  totalStepsCount,
}: StepRowProps<TokenApprovalStep>): React.ReactNode {
  const title = getTitle(status, step.tokenSymbol)

  return (
    <StepRowSkeleton
      title={title}
      tokenIcon={step.tokenIcon}
      tokenSymbol={step.tokenSymbol}
      learnMore={{
        url: 'https://support.uniswap.org/hc/en-us/articles/8120520483085',
        text: 'Why approve?',
      }}
      status={status}
      currentStepIndex={currentStepIndex}
      totalStepsCount={totalStepsCount}
    />
  )
}
