import { Placement } from '@popperjs/core'
import { CSSProperties, ReactNode } from 'react'
import { IconCircleInfo } from 'nucleo-micro-bold-essential'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

// ──────────────────────────────────────────────────────────────────────────────
// InfoHelper — Alphix points-page tooltip (1:1)
//
// Mirrors `SeasonTimelineBanner.tsx:229-251` exactly:
//   - `TooltipProvider delayDuration={0}` so hover is instant.
//   - `IconCircleInfo` from `nucleo-micro-bold-essential` at `w-3 h-3` with
//     muted-gray tint (`text-muted-foreground/60`).
//   - `TooltipContent` inherits the canonical Alphix style from
//     `components/ui/tooltip.tsx` (bg-container, border-sidebar-border/60,
//     px-3 py-1.5, rounded-md). We size the body to `max-w-[220px]` and the
//     inner `<p>` to `text-xs` to match the points page exactly.
//
// The legacy popper `placement` prop is mapped to Radix's `side` so existing
// callers stay compatible without any rewrites.
// ──────────────────────────────────────────────────────────────────────────────

const placementToSide = (
  placement?: Placement,
): 'top' | 'right' | 'bottom' | 'left' | undefined => {
  if (!placement) return undefined
  if (placement.startsWith('top')) return 'top'
  if (placement.startsWith('bottom')) return 'bottom'
  if (placement.startsWith('left')) return 'left'
  if (placement.startsWith('right')) return 'right'
  return undefined
}

export default function InfoHelper({
  text,
  size = 12,
  placement,
  style,
}: {
  text: string | ReactNode
  size?: number
  isActive?: boolean
  placement?: Placement
  style?: CSSProperties
  color?: string
}) {
  const side = placementToSide(placement) ?? 'bottom'

  return (
    <span
      style={style}
      className="inline-flex items-center justify-center align-middle ml-1 leading-none"
    >
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center justify-center cursor-default">
              <IconCircleInfo
                className="text-muted-foreground/60"
                style={{ width: size, height: size }}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side={side} className="max-w-[220px]">
            <p className="text-xs">{text}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  )
}
