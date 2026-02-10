"use client"

import { cn } from '@/lib/utils'
import { IconChevronLeft, IconChevronRight } from 'nucleo-micro-bold-essential'

type ScrollButtonDirection = 'left' | 'right'

export type ScrollButtonProps = {
  onPress: () => void
  opacity?: number
  direction: ScrollButtonDirection
}

export const ScrollButton = ({ onPress, opacity = 1, direction }: ScrollButtonProps) => {
  const Icon = direction === 'left' ? IconChevronLeft : IconChevronRight
  return (
    <button
      onClick={onPress}
      className={cn(
        "p-2 rounded-md bg-muted/50 hover:bg-muted border border-sidebar-border/60",
        "transition-all duration-200"
      )}
      style={{ opacity }}
    >
      <Icon className="h-3.5 w-3.5 text-foreground" />
    </button>
  )
}
