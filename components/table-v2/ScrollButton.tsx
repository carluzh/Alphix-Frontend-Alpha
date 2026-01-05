"use client"

import { cn } from '@/lib/utils'
import { ChevronRight } from 'lucide-react'

type ScrollButtonDirection = 'left' | 'right'

export type ScrollButtonProps = {
  onPress: () => void
  opacity?: number
  direction: ScrollButtonDirection
}

export const ScrollButton = ({ onPress, opacity = 1, direction }: ScrollButtonProps) => (
  <button
    onClick={onPress}
    className={cn(
      "p-3 rounded-full bg-muted/80 hover:bg-muted border border-sidebar-border",
      "backdrop-blur-sm shadow-lg transition-all duration-200",
      "-translate-y-1/2"
    )}
    style={{ opacity }}
  >
    <ChevronRight
      className={cn(
        "h-3 w-3 text-foreground",
        direction === 'left' && "rotate-180"
      )}
    />
  </button>
)
