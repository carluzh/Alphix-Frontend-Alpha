'use client'

import { LucideIcon } from 'lucide-react'
import { useId } from 'react'

interface GlitchIconProps {
  icon: LucideIcon
  className?: string
  glitchIndex?: number
  /** Scale factor for pixelation blocks. 1 = default (8px blocks), 0.5 = 4px blocks, etc. */
  pixelScale?: number
}

export const GlitchIcon = ({ icon: Icon, className = '', glitchIndex = 1, pixelScale = 1 }: GlitchIconProps) => {
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
