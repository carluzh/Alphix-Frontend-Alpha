'use client'

import { useEffect, useRef, useState } from 'react'

export const SonicBoom = () => {
  const [isVisible, setIsVisible] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return

    // Intersection Observer for visibility-based animation
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting)
      },
      { threshold: 0.1 }
    )

    if (svgRef.current) {
      observer.observe(svgRef.current)
    }

    return () => observer.disconnect()
  }, [])

  return (
    <svg
      ref={svgRef}
      className="pointer-events-none absolute inset-x-0 -top-[300px] md:-top-[600px] h-[500px] md:h-[1000px] w-full overflow-visible"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="fadeGradient1" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="10%" stopColor="white" stopOpacity="0.8" />
          <stop offset="40%" stopColor="white" stopOpacity="0.5" />
          <stop offset="70%" stopColor="white" stopOpacity="0.2" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fadeGradient2" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="12%" stopColor="white" stopOpacity="0.8" />
          <stop offset="40%" stopColor="white" stopOpacity="0.5" />
          <stop offset="70%" stopColor="white" stopOpacity="0.2" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fadeGradient3" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="white" stopOpacity="0.7" />
          <stop offset="10%" stopColor="white" stopOpacity="0.7" />
          <stop offset="35%" stopColor="white" stopOpacity="0.4" />
          <stop offset="60%" stopColor="white" stopOpacity="0.15" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id="fadeMask1">
          <rect width="100%" height="100%" fill="url(#fadeGradient1)" />
        </mask>
        <mask id="fadeMask2">
          <rect x="-20" y="0" width="140" height="100" fill="url(#fadeGradient2)" />
        </mask>
        <mask id="fadeMask3">
          <rect x="-22" y="0" width="143" height="100" fill="url(#fadeGradient3)" />
        </mask>
      </defs>

      <path
        d="M 0 100 Q 50 25 100 100"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="0.15"
        strokeDasharray="0.8 0.6"
        fill="none"
        mask="url(#fadeMask1)"
        className="animate-sonic-flow-1"
        style={{ animationPlayState: isVisible ? 'running' : 'paused' }}
      />
      <path
        d="M -20 100 Q 50 13 120 100"
        stroke="rgba(255,255,255,0.4)"
        strokeWidth="0.12"
        strokeDasharray="0.6 0.4"
        fill="none"
        mask="url(#fadeMask2)"
        className="animate-sonic-flow-2"
        style={{ animationPlayState: isVisible ? 'running' : 'paused' }}
      />
      <path
        d="M -40 100 Q 50 5 140 100"
        stroke="rgba(255,255,255,0.3)"
        strokeWidth="0.09"
        strokeDasharray="0.4 0.2"
        fill="none"
        mask="url(#fadeMask3)"
        className="animate-sonic-flow-3"
        style={{ animationPlayState: isVisible ? 'running' : 'paused' }}
      />
    </svg>
  )
}
