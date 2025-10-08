"use client"

import React, { useEffect, useState } from 'react'

interface ToastTimerProps {
  duration: number // in milliseconds
}

export function ToastTimer({ duration }: ToastTimerProps) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let animationFrame: number
    const startTime = Date.now()

    const animate = () => {
      const elapsed = Date.now() - startTime
      const newProgress = Math.min(elapsed / duration, 1)
      setProgress(newProgress)

      if (newProgress < 1) {
        animationFrame = requestAnimationFrame(animate)
      }
    }

    animationFrame = requestAnimationFrame(animate)

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame)
      }
    }
  }, [duration])

  const radius = 8
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = -circumference * progress

  return (
    <svg
      className="w-6 h-6"
      viewBox="0 0 24 24"
      style={{
        position: 'absolute',
        right: '0.75rem',
        top: '50%',
        transform: 'translateY(-50%) rotate(-90deg)',
        pointerEvents: 'none',
        zIndex: 10
      }}
    >
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="rgba(255, 255, 255, 0.2)"
        strokeWidth="2"
      />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="rgba(255, 255, 255, 0.6)"
        strokeWidth="2"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
      />
    </svg>
  )
}