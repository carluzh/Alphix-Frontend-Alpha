'use client'

import { cn } from '@/lib/utils'
import { motion, useMotionValue, useMotionValueEvent } from 'framer-motion'
import { Check, ArrowUpRight, ChevronUp, ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts'
import { Button } from '@/components/ui/button'

// Types
interface FeeHistoryPoint {
  timeLabel: string
  volumeTvlRatio: number
  emaRatio: number
  dynamicFee: number
}

interface FeeUpdateItem {
  id: number
  timestamp: Date
  emaRatio: number
  volumeTvlRatio: number
  feeChange: 'up' | 'down' | 'neutral'
  dynamicFee: number
}

// Generate mock fee history data (adapted from dynamic-fee-chart.tsx)
const generateMockFeeHistory = (points = 30): FeeHistoryPoint[] => {
  const data: FeeHistoryPoint[] = []
  let currentFeePercent = 0.3
  let dailyFeeChangeAppliedThisDayPercent = 0
  let lastDayProcessed = -1
  const emaPeriod = 10
  const ratios: number[] = []
  const emaValues: number[] = []

  for (let i = 0; i < points; i++) {
    const timeLabel = `Step ${i + 1}`

    // Simulate Vol/TVL Ratio
    const prevRatio = ratios.length > 0 ? ratios[ratios.length - 1] : 1.0
    let change = (Math.random() - 0.5) * 0.15
    if (i % 8 === 0) change += (Math.random() - 0.5) * 0.3
    const volumeTvlRatio = Math.max(0.7, Math.min(1.3, parseFloat((prevRatio + change).toFixed(4))))
    ratios.push(volumeTvlRatio)

    // Calculate EMA
    let emaRatio: number
    if (ratios.length < emaPeriod || emaValues.length === 0) {
      const sum = ratios.slice(Math.max(0, ratios.length - emaPeriod)).reduce((s, r) => s + r, 0)
      emaRatio = parseFloat((sum / Math.min(ratios.length, emaPeriod)).toFixed(4))
    } else {
      const k = 2 / (emaPeriod + 1)
      const prevEma = emaValues[emaValues.length - 1]
      emaRatio = parseFloat((volumeTvlRatio * k + prevEma * (1 - k)).toFixed(4))
    }
    emaValues.push(emaRatio)

    // Calculate Dynamic Fee
    const dayIndex = Math.floor(i / 4)
    if (dayIndex !== lastDayProcessed) {
      dailyFeeChangeAppliedThisDayPercent = 0
      lastDayProcessed = dayIndex
    }

    let feeAdjustmentDirection = 0
    const deadband = 0.02
    if (volumeTvlRatio > emaRatio + deadband) {
      feeAdjustmentDirection = 1
    } else if (volumeTvlRatio < emaRatio - deadband) {
      feeAdjustmentDirection = -1
    }

    const feeStepPercent = 0.01
    const proposedStepPercent = feeStepPercent * feeAdjustmentDirection

    if (feeAdjustmentDirection !== 0) {
      if (Math.abs(dailyFeeChangeAppliedThisDayPercent + proposedStepPercent) <= feeStepPercent + 0.00001) {
        currentFeePercent += proposedStepPercent
        dailyFeeChangeAppliedThisDayPercent += proposedStepPercent
      } else if (dailyFeeChangeAppliedThisDayPercent === 0) {
        currentFeePercent += proposedStepPercent
        dailyFeeChangeAppliedThisDayPercent += proposedStepPercent
      }
    }
    currentFeePercent = Math.max(0.05, Math.min(1.0, parseFloat(currentFeePercent.toFixed(4))))

    data.push({
      timeLabel,
      volumeTvlRatio,
      emaRatio,
      dynamicFee: currentFeePercent,
    })
  }
  return data
}

// Convert history points to Fee Update items
const generateFeeUpdates = (history: FeeHistoryPoint[]): FeeUpdateItem[] => {
  return history.map((point, index) => {
    let feeChange: 'up' | 'down' | 'neutral' = 'neutral'
    if (index > 0) {
      const prevFee = history[index - 1].dynamicFee
      if (point.dynamicFee > prevFee) feeChange = 'up'
      else if (point.dynamicFee < prevFee) feeChange = 'down'
    }
    return {
      id: index + 1,
      timestamp: new Date(Date.now() - (history.length - index) * 3600000),
      emaRatio: point.emaRatio,
      volumeTvlRatio: point.volumeTvlRatio,
      feeChange,
      dynamicFee: point.dynamicFee,
    }
  })
}

// Fee Update Indicator component (matches Polar's EventCostIndicator)
const FeeUpdateIndicator = ({ type }: { type: 'up' | 'down' | 'neutral' }) => {
  const colors = {
    up: 'bg-emerald-50 dark:bg-emerald-950 text-emerald-500',
    down: 'bg-red-50 dark:bg-red-950 text-red-500',
    neutral: 'bg-gray-100 dark:bg-gray-800 text-gray-500',
  }

  return (
    <div
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-sm transition-colors duration-150',
        colors[type]
      )}
    >
      {type === 'up' && <ChevronUp className="h-4 w-4" />}
      {type === 'down' && <ChevronDown className="h-4 w-4" />}
      {type === 'neutral' && <span className="text-xs">—</span>}
    </div>
  )
}

// Chart config
const chartConfig = {
  volumeTvlRatio: {
    color: 'hsl(var(--chart-3))',
  },
  emaRatio: {
    color: 'hsl(var(--chart-2))',
  },
  dynamicFee: {
    color: '#e85102',
  },
}

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: 1,
      staggerChildren: 0.05,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 1 } },
}

export const DynamicFeeSection = () => {
  // Generate all mock data upfront
  const fullHistory = useMemo(() => generateMockFeeHistory(30), [])
  const fullUpdates = useMemo(() => generateFeeUpdates(fullHistory), [fullHistory])

  // Animation state
  const [visibleSteps, setVisibleSteps] = useState(5)
  const y = useMotionValue(0)
  const previousClosestIndexRef = useRef<number | null>(null)

  // Keyframes for scrolling animation (16s duration = half speed)
  const keyframes = useMemo(
    () => Array.from({ length: fullUpdates.length + 1 }, (_, i) => -750 + i * 50),
    [fullUpdates.length]
  )

  useMotionValueEvent(y, 'change', (latest) => {
    let closestIndex = 0
    let closestDistance = Math.abs(latest - keyframes[0])

    for (let i = 1; i < keyframes.length; i++) {
      const distance = Math.abs(latest - keyframes[i])
      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = i
      }
    }

    if (previousClosestIndexRef.current !== closestIndex) {
      previousClosestIndexRef.current = closestIndex
      const newSteps = Math.min(Math.max(closestIndex + 5, 5), fullUpdates.length)
      setVisibleSteps(newSteps)
    }
  })

  // Current data slices based on animation progress
  const visibleChartData = useMemo(
    () => fullHistory.slice(0, visibleSteps),
    [fullHistory, visibleSteps]
  )

  const currentFee = useMemo(
    () => (visibleChartData.length > 0 ? visibleChartData[visibleChartData.length - 1].dynamicFee : 0.3),
    [visibleChartData]
  )

  // Compute fixed Y-axis domains from FULL data (so chart doesn't squeeze)
  const ratioYDomain = useMemo(() => {
    const allRatios = fullHistory.flatMap((d) => [d.volumeTvlRatio, d.emaRatio])
    const min = Math.min(...allRatios)
    const max = Math.max(...allRatios)
    const pad = (max - min) * 0.1 || 0.1
    return [min - pad, max + pad]
  }, [fullHistory])

  const feeYDomain = useMemo(() => {
    const fees = fullHistory.map((d) => d.dynamicFee)
    const min = Math.min(...fees)
    const max = Math.max(...fees)
    const pad = Math.max((max - min) * 0.1, 0.02)
    return [Math.max(0, min - pad), max + pad]
  }, [fullHistory])

  const bullets = [
    'Automatic fee adjustment based on volatility',
    'Capital efficient pricing models',
    'No oracle dependencies - fully on-chain',
  ]

  return (
    <motion.div
      className="flex w-full flex-col gap-y-6 overflow-hidden rounded-lg border border-sidebar-border/60 bg-white dark:bg-[#141413] p-2 xl:flex-row"
      variants={containerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
    >
      {/* Left Side - Text Content */}
      <div className="flex w-full flex-1 flex-col gap-y-8 p-6 md:p-12">
        <motion.span
          className="w-fit rounded-full bg-button-primary px-3 py-1 text-xs font-medium text-sidebar-primary"
          variants={itemVariants}
        >
          Live
        </motion.span>
        <motion.h3
          className="text-3xl font-semibold leading-tight text-balance md:text-4xl"
          variants={itemVariants}
        >
          Dynamic Fee System
        </motion.h3>
        <motion.p
          className="text-lg text-muted-foreground"
          variants={itemVariants}
        >
          Our adaptive fee algorithm responds to market conditions in real-time,
          optimizing returns for liquidity providers.
        </motion.p>
        <ul className="flex flex-col gap-y-1">
          {bullets.map((bullet, index) => (
            <motion.li
              key={index}
              className="flex flex-row items-center gap-x-2"
              variants={itemVariants}
            >
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <p className="leading-relaxed text-pretty text-foreground">
                {bullet}
              </p>
            </motion.li>
          ))}
        </ul>
        <motion.div variants={itemVariants}>
          <Link href="/swap">
            <Button
              size="lg"
              className="rounded-md bg-muted/50 text-muted-foreground hover:bg-muted/70 hover:text-white flex flex-row items-center gap-x-2"
            >
              <span>Start Trading</span>
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </Link>
        </motion.div>
      </div>

      {/* Right Side - Chart & Fee Updates */}
      <div className="flex w-full flex-1 flex-col gap-y-4 rounded-lg bg-gray-50 dark:bg-[#1a1a19] p-8">
        {/* Header - matches Polar's Activity/Profit style exactly */}
        <div className="flex flex-row items-center justify-between gap-x-4">
          <h3>Fee Algorithm</h3>
          <div className="flex flex-row items-center gap-x-4">
            <div className="flex flex-row items-center gap-x-4 font-mono text-xs">
              <span>Dynamic Fee</span>
              <span className="text-muted-foreground">
                {currentFee.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        {/* Chart - 3/4 height, full width, no legend */}
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={visibleChartData}
              margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
            >
              <XAxis dataKey="timeLabel" hide />
              <YAxis
                yAxisId="left"
                domain={ratioYDomain as [number, number]}
                hide
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={feeYDomain as [number, number]}
                hide
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="volumeTvlRatio"
                stroke={chartConfig.volumeTvlRatio.color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="emaRatio"
                stroke={chartConfig.emaRatio.color}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="right"
                type="stepAfter"
                dataKey="dynamicFee"
                stroke={chartConfig.dynamicFee.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Fee Updates List - matches Polar's Activity items exactly */}
        <div className="relative h-[120px] overflow-hidden">
          <motion.div
            className="flex w-full flex-col gap-y-2 py-2"
            style={{ y }}
            initial={{ y: '-100%' }}
            animate={{ y: keyframes }}
            transition={{
              duration: 16,
              repeat: Infinity,
              repeatType: 'loop',
              ease: [0.83, 0, 0.17, 1],
            }}
            whileInView="animate"
          >
            {fullUpdates.map((update) => (
              <div
                key={update.id}
                className="flex flex-row items-center justify-between gap-x-8 rounded-md border border-gray-100 dark:border-white/5 bg-gray-100 dark:bg-[#262625] p-2 pl-4 font-mono text-xs md:justify-start"
              >
                <h3 className="w-full truncate xl:w-36">Fee Update</h3>
                <p className="hidden w-28 text-xs text-muted-foreground xl:flex">
                  EMA: {update.emaRatio.toFixed(3)}
                </p>
                <div className="flex w-fit flex-row items-center justify-end gap-x-4 md:w-32">
                  <span className="text-muted-foreground">
                    {update.volumeTvlRatio.toFixed(3)}
                  </span>
                  <FeeUpdateIndicator type={update.feeChange} />
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}
