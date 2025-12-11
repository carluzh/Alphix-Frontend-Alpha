'use client'

import { GrainGradient } from '@paper-design/shaders-react'
import { useInView } from '@/hooks/useInView'
import { useMemo, useState, useEffect } from 'react'

const FRAME_THICKNESS = 10
const OUTER_RADIUS = 18
const INNER_RADIUS = OUTER_RADIUS - FRAME_THICKNESS
const PAGE_BG = '#0d0d0c'

const MEDIUM_BREAKPOINT = 2000
const NARROW_BREAKPOINT = 1700

export const PaperShaderFrame = () => {
  const [breakpoint, setBreakpoint] = useState<'full' | 'medium' | 'narrow'>('full')
  const [mounted, setMounted] = useState(false)
  const { ref, inView } = useInView<HTMLDivElement>({ once: true, threshold: 0.1 })

  useEffect(() => {
    if (window.innerWidth < 768) return // Skip heavy WebGL on mobile

    setMounted(true)

    const checkWidth = () => {
      const width = window.innerWidth
      if (width < NARROW_BREAKPOINT) setBreakpoint('narrow')
      else if (width < MEDIUM_BREAKPOINT) setBreakpoint('medium')
      else setBreakpoint('full')
    }
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  if (!mounted) return null

  const horizontalExtension = breakpoint === 'narrow' ? '-5rem' : breakpoint === 'medium' ? '-12rem' : '-16rem'

  const shaderFrame = useMemo(() => {
    if (typeof window === 'undefined' || typeof performance === 'undefined') return 0
    const w = window as unknown as { __shaderStartMs?: number }
    if (w.__shaderStartMs == null) {
      w.__shaderStartMs = performance.now()
    }
    return performance.now() - w.__shaderStartMs
  }, [])

  const shaderProps = {
    colors: ['#f94706', '#ff7919'] as [string, string],
    colorBack: '#060606',
    softness: 0.35,
    intensity: 0.4,
    noise: 0,
    shape: 'corners' as const,
    speed: 0.3,
    frame: shaderFrame,
  }

  return (
    <div
      ref={ref}
      className={`animate-fade-only absolute pointer-events-none overflow-hidden z-0 ${inView ? 'in-view' : ''}`}
      style={{
        left: horizontalExtension,
        right: horizontalExtension,
        top: 'calc(-12rem + 5px)',
        bottom: 'calc(-3rem - 5px)',
        borderBottomLeftRadius: OUTER_RADIUS,
        borderBottomRightRadius: OUTER_RADIUS,
      }}
    >
      <GrainGradient
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
        }}
        {...shaderProps}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: FRAME_THICKNESS,
          right: FRAME_THICKNESS,
          bottom: FRAME_THICKNESS,
          backgroundColor: PAGE_BG,
          borderBottomLeftRadius: INNER_RADIUS,
          borderBottomRightRadius: INNER_RADIUS,
        }}
      />
    </div>
  )
}
