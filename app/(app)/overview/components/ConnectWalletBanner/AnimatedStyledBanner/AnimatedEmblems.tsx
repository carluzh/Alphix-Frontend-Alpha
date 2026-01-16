'use client'

import { ReactElement } from 'react'
import { Icons } from '@/lib/icons/unicon-svgs'

interface AnimatedEmblemProps {
  children: ReactElement
  duration?: string
  delay?: string
  rotationDirection?: 'clockwise' | 'counterclockwise'
}

function AnimatedEmblem({
  children,
  duration = '300ms',
  delay = '50ms',
  rotationDirection = 'clockwise',
}: AnimatedEmblemProps) {
  const animationName = rotationDirection === 'clockwise' ? 'emblemEnterCW' : 'emblemEnterCCW'

  return (
    <div
      style={{
        animationName,
        animationDuration: duration,
        animationDelay: delay,
        animationTimingFunction: 'ease-out',
        animationFillMode: 'forwards',
        opacity: 0,
      }}
    >
      {children}
    </div>
  )
}

// Match pattern.svg stroke color (#282828)
const PATTERN_COLOR = '#282828'

// Unicon icon component with solid background to prevent pattern showing through
function UniconIcon({ iconKey, size }: { iconKey: string; size: number }) {
  const paths = Icons[iconKey]
  if (!paths) return null

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      {paths.map((d, i) => (
        <path key={i} d={d} fill={PATTERN_COLOR} />
      ))}
    </svg>
  )
}

const ICON_KEYS = ['0', '3', '20', '26', '15', '21', '12', '17']

export function AnimatedEmblems() {
  const animationDuration = '300ms'
  const delays = ['50ms', '100ms', '150ms', '200ms', '250ms', '300ms', '350ms', '400ms']

  return (
    <>
      <style>
        {`
          @keyframes emblemEnterCW {
            from {
              opacity: 0;
              transform: scale(0.7) rotate(30deg);
            }
            to {
              opacity: 1;
              transform: scale(1) rotate(0deg);
            }
          }
          @keyframes emblemEnterCCW {
            from {
              opacity: 0;
              transform: scale(0.7) rotate(-30deg);
            }
            to {
              opacity: 1;
              transform: scale(1) rotate(0deg);
            }
          }
        `}
      </style>

      <div className="absolute top-[20px] -left-[15px] rotate-90 z-[1]">
        <AnimatedEmblem duration={animationDuration} delay={delays[0]} rotationDirection="clockwise">
          <UniconIcon iconKey={ICON_KEYS[0]} size={71} />
        </AnimatedEmblem>
      </div>

      <div className="absolute bottom-[20px] left-[180px] z-[1]">
        <AnimatedEmblem duration={animationDuration} delay={delays[1]} rotationDirection="counterclockwise">
          <UniconIcon iconKey={ICON_KEYS[1]} size={71} />
        </AnimatedEmblem>
      </div>

      <div className="absolute top-[30px] left-[120px] z-[1]">
        <AnimatedEmblem duration={animationDuration} delay={delays[2]} rotationDirection="clockwise">
          <UniconIcon iconKey={ICON_KEYS[2]} size={71} />
        </AnimatedEmblem>
      </div>

      <div className="absolute bottom-[30px] left-[50px] z-[1]">
        <AnimatedEmblem duration={animationDuration} delay={delays[3]} rotationDirection="counterclockwise">
          <UniconIcon iconKey={ICON_KEYS[3]} size={65} />
        </AnimatedEmblem>
      </div>

      <div className="absolute top-[20px] -right-[15px] -rotate-90 z-[1]">
        <AnimatedEmblem duration={animationDuration} delay={delays[4]} rotationDirection="counterclockwise">
          <UniconIcon iconKey={ICON_KEYS[4]} size={71} />
        </AnimatedEmblem>
      </div>

      <div className="absolute bottom-[20px] right-[180px] z-[1]">
        <AnimatedEmblem duration={animationDuration} delay={delays[5]} rotationDirection="clockwise">
          <UniconIcon iconKey={ICON_KEYS[5]} size={71} />
        </AnimatedEmblem>
      </div>

      <div className="absolute top-[30px] right-[120px] z-[1]">
        <AnimatedEmblem duration={animationDuration} delay={delays[6]} rotationDirection="counterclockwise">
          <UniconIcon iconKey={ICON_KEYS[6]} size={71} />
        </AnimatedEmblem>
      </div>

      <div className="absolute bottom-[30px] right-[50px] z-[1]">
        <AnimatedEmblem duration={animationDuration} delay={delays[7]} rotationDirection="clockwise">
          <UniconIcon iconKey={ICON_KEYS[7]} size={65} />
        </AnimatedEmblem>
      </div>
    </>
  )
}
