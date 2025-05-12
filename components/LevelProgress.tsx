import React from 'react'
import { cn } from "@/lib/utils"

interface LevelProgressProps {
  currentLevel: number
  currentXP: number
  nextLevelXP: number
  className?: string
}

export function LevelProgress({ currentLevel, currentXP, nextLevelXP, className }: LevelProgressProps) {
  const progress = (currentXP / nextLevelXP) * 100

  return (
    <div className={cn("flex-1", className)}>
      <div className="flex-1">
        <div className="h-1 w-full rounded-full bg-muted">
          <div
            className="h-1 rounded-full bg-primary"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  )
} 