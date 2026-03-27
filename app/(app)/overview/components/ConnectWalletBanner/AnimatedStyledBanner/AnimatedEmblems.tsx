'use client'

import { ReactElement, useMemo } from 'react'
import { GlitchIcon, type GlitchIconName } from '@/components/Landing/GlitchIcon'

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

const ALL_ICON_NAMES: GlitchIconName[] = [
  'SlidersVertical', 'Handshake', 'Repeat', 'BetweenVerticalStart',
  'FileStack', 'ScanEye', 'ToyBrick', 'Layers', 'Lock',
]

function pickRandomIcons(count: number): { name: GlitchIconName; shade: string }[] {
  const shuffled = [...ALL_ICON_NAMES].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count).map((name) => {
    // Random grey between #606060 and #a0a0a0
    const value = Math.floor(96 + Math.random() * 64)
    const hex = value.toString(16)
    return { name, shade: `#${hex}${hex}${hex}` }
  })
}

function EmblemIcon({ iconName, glitchIndex, size, shade }: { iconName: GlitchIconName; glitchIndex: number; size: number; shade: string }) {
  return (
    <div className="flex items-center justify-center" style={{ width: size, height: size, color: shade }}>
      <GlitchIcon
        iconName={iconName}
        className="w-12 h-12"
        glitchIndex={glitchIndex}
        pixelScale={2}
      />
    </div>
  )
}

export function AnimatedEmblems() {
  const icons = useMemo(() => pickRandomIcons(8), [])
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

      {/* Left icons — uniform 50% scale on mobile, taller virtual container for vertical spread */}
      <div className="absolute -inset-y-[40%] inset-x-0 md:inset-0 [transform:scale(0.5)] md:[transform:scale(1)] origin-left opacity-60 md:opacity-100">
        <div className="absolute top-[20px] -left-[15px] rotate-90 z-[1]">
          <AnimatedEmblem duration={animationDuration} delay={delays[0]} rotationDirection="clockwise">
            <EmblemIcon iconName={icons[0].name} glitchIndex={1} size={71} shade={icons[0].shade} />
          </AnimatedEmblem>
        </div>

        <div className="absolute bottom-[20px] left-[180px] z-[1]">
          <AnimatedEmblem duration={animationDuration} delay={delays[1]} rotationDirection="counterclockwise">
            <EmblemIcon iconName={icons[1].name} glitchIndex={2} size={71} shade={icons[1].shade} />
          </AnimatedEmblem>
        </div>

        <div className="absolute top-[30px] left-[120px] z-[1]">
          <AnimatedEmblem duration={animationDuration} delay={delays[2]} rotationDirection="clockwise">
            <EmblemIcon iconName={icons[2].name} glitchIndex={3} size={71} shade={icons[2].shade} />
          </AnimatedEmblem>
        </div>

        <div className="absolute bottom-[30px] left-[50px] z-[1]">
          <AnimatedEmblem duration={animationDuration} delay={delays[3]} rotationDirection="counterclockwise">
            <EmblemIcon iconName={icons[3].name} glitchIndex={4} size={65} shade={icons[3].shade} />
          </AnimatedEmblem>
        </div>
      </div>

      {/* Right icons — uniform 50% scale on mobile, taller virtual container for vertical spread */}
      <div className="absolute -inset-y-[40%] inset-x-0 md:inset-0 [transform:scale(0.5)] md:[transform:scale(1)] origin-right opacity-60 md:opacity-100">
        <div className="absolute top-[20px] -right-[15px] -rotate-90 z-[1]">
          <AnimatedEmblem duration={animationDuration} delay={delays[4]} rotationDirection="counterclockwise">
            <EmblemIcon iconName={icons[4].name} glitchIndex={5} size={71} shade={icons[4].shade} />
          </AnimatedEmblem>
        </div>

        <div className="absolute bottom-[20px] right-[180px] z-[1]">
          <AnimatedEmblem duration={animationDuration} delay={delays[5]} rotationDirection="clockwise">
            <EmblemIcon iconName={icons[5].name} glitchIndex={6} size={71} shade={icons[5].shade} />
          </AnimatedEmblem>
        </div>

        <div className="absolute top-[30px] right-[120px] z-[1]">
          <AnimatedEmblem duration={animationDuration} delay={delays[6]} rotationDirection="counterclockwise">
            <EmblemIcon iconName={icons[6].name} glitchIndex={7} size={71} shade={icons[6].shade} />
          </AnimatedEmblem>
        </div>

        <div className="absolute bottom-[30px] right-[50px] z-[1]">
          <AnimatedEmblem duration={animationDuration} delay={delays[7]} rotationDirection="clockwise">
            <EmblemIcon iconName={icons[7].name} glitchIndex={8} size={65} shade={icons[7].shade} />
          </AnimatedEmblem>
        </div>
      </div>
    </>
  )
}
