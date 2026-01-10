'use client'

/**
 * Permit2StepRow - Step row for Permit2 signature
 * Adapted from: interface/packages/uniswap/src/components/ConfirmSwapModal/steps/Permit.tsx
 */

import { FileSignature } from 'lucide-react'
import { StepRowSkeleton } from '../StepRowSkeleton'
import { StepStatus, StepRowProps, Permit2SignatureStep } from '@/lib/transactions/types'

/**
 * Sign icon - circular badge with signature icon
 * Adapted from Uniswap's SignIcon with Tailwind
 */
function SignIcon(): React.ReactNode {
  return (
    <div className="w-6 h-6 rounded-full bg-sidebar-primary flex items-center justify-center">
      <FileSignature className="w-3 h-3 text-sidebar-background" />
    </div>
  )
}

/**
 * Get title text based on step status
 * Follows Uniswap's pattern
 */
function getTitle(status: StepStatus): string {
  if (status === StepStatus.Active) {
    return 'Sign in wallet'
  }
  if (status === StepStatus.InProgress) {
    return 'Signing...'
  }
  if (status === StepStatus.Complete) {
    return 'Permit signed'
  }
  return 'Sign permit'
}

/**
 * Permit2SignatureStepRow - Displays permit signature step with custom sign icon
 */
export function Permit2SignatureStepRow({
  step,
  status,
  currentStepIndex,
  totalStepsCount,
}: StepRowProps<Permit2SignatureStep>): React.ReactNode {
  return (
    <StepRowSkeleton
      title={getTitle(status)}
      icon={<SignIcon />}
      learnMore={{
        url: 'https://support.uniswap.org/hc/en-us/articles/8120520483085',
        text: 'Why sign?',
      }}
      status={status}
      currentStepIndex={currentStepIndex}
      totalStepsCount={totalStepsCount}
    />
  )
}
