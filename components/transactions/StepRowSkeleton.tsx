'use client'

/**
 * StepRowSkeleton - Base UI component for all transaction step rows
 * Adapted from: interface/packages/uniswap/src/components/ConfirmSwapModal/steps/StepRowSkeleton.tsx
 *
 * Converted from Tamagui to Tailwind CSS
 */

import { PropsWithChildren, useMemo } from 'react'
import { Check } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { StepStatus, TransactionStep, StepRowProps } from '@/lib/transactions/types'

// Re-export for convenience
export type { StepRowProps }

export const STEP_ROW_HEIGHT = 40 // h-10
export const STEP_ROW_ICON_SIZE = 24 // w-6 h-6

interface StepRowSkeletonProps {
  /** Token icon URL */
  tokenIcon?: string
  /** Token symbol for fallback avatar */
  tokenSymbol?: string
  /** Custom icon component (overrides tokenIcon) */
  icon?: React.ReactNode
  /** Step status - drives visual state */
  status: StepStatus
  /** Title text displayed next to icon */
  title: string
  /** Optional timer countdown in seconds */
  secondsRemaining?: number
  /** Learn more link - only shown when Active */
  learnMore?: { url: string; text: string }
  /** Current step index (0-based) */
  currentStepIndex: number
  /** Total number of steps */
  totalStepsCount: number
}

// ============================================================================
// Icon Wrapper Component
// ============================================================================

/**
 * Wraps the step icon with status-based animations
 * Adapted from Uniswap's StepIconWrapper
 */
export function StepIconWrapper({
  children,
  stepStatus,
}: PropsWithChildren<{
  stepStatus: StepStatus
}>): React.ReactNode {
  const layoutSize = (STEP_ROW_ICON_SIZE / 6) * 10 // ~40px

  // Active state - pulsing ripple effect
  if (stepStatus === StepStatus.Active) {
    return (
      <div
        className="relative flex items-center justify-center"
        style={{ width: layoutSize, height: layoutSize }}
      >
        {/* Pulse ripple animation */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="absolute w-8 h-8 rounded-full bg-sidebar-primary/20 animate-ping" />
        </div>
        <div className="relative z-10 opacity-100">{children}</div>
      </div>
    )
  }

  // InProgress state - spinning border
  if (stepStatus === StepStatus.InProgress) {
    return (
      <div
        className="relative flex items-center justify-center"
        style={{ width: layoutSize, height: layoutSize }}
      >
        {/* Spinning border animation */}
        <div className="absolute inset-1 rounded-full border-2 border-sidebar-primary border-t-transparent animate-spin" />
        <div className="relative z-10">{children}</div>
      </div>
    )
  }

  // Preview or Complete - neutral placeholder
  return (
    <div
      className="flex items-center justify-center"
      style={{ width: layoutSize, height: layoutSize }}
    >
      <div className="w-6 h-6 rounded-full bg-muted-foreground/20 flex items-center justify-center">
        {stepStatus === StepStatus.Complete ? (
          <Check className="w-3.5 h-3.5 text-green-500" />
        ) : (
          <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Timer Component
// ============================================================================

/**
 * Timer display for deadline-based steps (e.g., UniswapX orders)
 */
function Timer({ secondsRemaining }: { secondsRemaining: number }): React.ReactNode {
  const timerText = useMemo(() => {
    const minutes = Math.floor(secondsRemaining / 60)
    const seconds = secondsRemaining % 60
    const minutesText = minutes < 10 ? `0${minutes}` : minutes
    const secondsText = seconds < 10 ? `0${seconds}` : seconds
    return `${minutesText}:${secondsText}`
  }, [secondsRemaining])

  return (
    <span data-testid="step-timer" className="text-sm font-medium font-mono text-foreground pr-2">
      {timerText}
    </span>
  )
}

// ============================================================================
// Right Side Status Component
// ============================================================================

/**
 * Right side of the step row - shows status indicator
 */
function RightSide({
  status,
  currentStepIndex,
  totalStepsCount,
}: {
  status: StepStatus
  currentStepIndex: number
  totalStepsCount: number
}): React.ReactNode {
  // Complete - show checkmark
  if (status === StepStatus.Complete) {
    return <Check className="w-5 h-5 text-green-500" />
  }

  // Active or InProgress - show step counter
  if (status === StepStatus.Active || status === StepStatus.InProgress) {
    return (
      <span className="text-xs text-muted-foreground">
        Step {currentStepIndex + 1} of {totalStepsCount}
      </span>
    )
  }

  // Preview - show nothing
  return null
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * StepRowSkeleton - Reusable base component for transaction step rows
 * Adapted from Uniswap's implementation with Tailwind styling
 *
 * Features:
 * - Status-based icon animations (pulse for Active, spin for InProgress)
 * - Learn more links (only shown when Active)
 * - Step counter on the right side
 * - Optional countdown timer
 */
export function StepRowSkeleton({
  tokenIcon,
  tokenSymbol,
  icon,
  status,
  title,
  secondsRemaining,
  learnMore,
  currentStepIndex,
  totalStepsCount,
}: StepRowSkeletonProps): React.ReactNode {
  const isActiveOrInProgress =
    status === StepStatus.Active || status === StepStatus.InProgress

  // Determine icon content priority: custom icon > tokenIcon > tokenSymbol fallback
  const iconContent = icon ?? (
    tokenIcon ? (
      <Image
        src={tokenIcon}
        alt={tokenSymbol || 'token'}
        width={STEP_ROW_ICON_SIZE}
        height={STEP_ROW_ICON_SIZE}
        className="rounded-full"
      />
    ) : tokenSymbol ? (
      <div className="w-6 h-6 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-bold text-white">
        {tokenSymbol.charAt(0)}
      </div>
    ) : null
  )

  return (
    <div className="flex items-center justify-between py-2">
      {/* Left side: icon + title */}
      <div className="flex items-center gap-2">
        <StepIconWrapper stepStatus={status}>{iconContent}</StepIconWrapper>

        <div className="flex flex-col">
          {/* Title */}
          <span
            className={cn(
              'transition-colors',
              isActiveOrInProgress
                ? 'text-sm text-white font-medium'
                : 'text-xs text-muted-foreground'
            )}
          >
            {title}
          </span>

          {/* Learn more link - only when Active */}
          {status === StepStatus.Active && learnMore && (
            <a
              href={learnMore.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-sidebar-primary hover:underline"
            >
              {learnMore.text}
            </a>
          )}
        </div>
      </div>

      {/* Right side: timer + status */}
      <div className="flex items-center gap-2">
        {secondsRemaining !== undefined && secondsRemaining > 0 && (
          <Timer secondsRemaining={secondsRemaining} />
        )}
        <RightSide
          status={status}
          currentStepIndex={currentStepIndex}
          totalStepsCount={totalStepsCount}
        />
      </div>
    </div>
  )
}
