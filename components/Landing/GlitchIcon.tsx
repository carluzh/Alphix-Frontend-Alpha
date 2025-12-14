'use client'

import type { LucideIcon } from 'lucide-react'
import {
  BetweenVerticalStart,
  FileStack,
  Handshake,
  Layers,
  Lock,
  Repeat,
  ScanEye,
  SlidersVertical,
  ToyBrick,
} from 'lucide-react'
import { useId } from 'react'

const ICONS = {
  SlidersVertical,
  Handshake,
  Repeat,
  BetweenVerticalStart,
  FileStack,
  ScanEye,
  ToyBrick,
  Layers,
  Lock,
} satisfies Record<string, LucideIcon>

export type GlitchIconName = keyof typeof ICONS

interface GlitchIconProps {
  iconName: GlitchIconName
  className?: string
  glitchIndex?: number
  /** Scale factor for pixelation blocks. 1 = default (8px blocks), 0.5 = 4px blocks, etc. */
  pixelScale?: number
}

export const GlitchIcon = ({ iconName, className = '', glitchIndex = 1, pixelScale = 1 }: GlitchIconProps) => {
  const Icon = ICONS[iconName]
  const filterId = useId()
  const baseSize = 8 * pixelScale
  const halfSize = 4 * pixelScale
  const quarterSize = 2 * pixelScale

  return (
    <div className={`censor-icon-wrapper censor-timing-${glitchIndex}`}>
      {/* SVG filter for pixelation effect */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id={`pixelate-${filterId}`}>
            <feFlood x={halfSize} y={halfSize} height={quarterSize} width={quarterSize} />
            <feComposite width={baseSize} height={baseSize} />
            <feTile result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
            <feMorphology operator="dilate" radius={halfSize} />
          </filter>
        </defs>
      </svg>

      <Icon
        className={`${className} censor-icon`}
        style={{
          '--filter-id': `url(#pixelate-${filterId})`
        } as React.CSSProperties}
      />
    </div>
  )
}
