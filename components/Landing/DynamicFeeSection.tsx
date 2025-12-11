'use client'

import { cn } from '@/lib/utils'
import { useInView } from '@/hooks/useInView'
import { Check, ArrowUpRight, ChevronUp, ChevronDown } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useRef, useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts'

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
  difference: number
  feeChange: 'up' | 'down' | 'neutral'
  feeChangeAmount: number
  dynamicFee: number
}

// Generate mock fee history data
const generateMockFeeHistory = (points = 30): FeeHistoryPoint[] => {
  const data: FeeHistoryPoint[] = []
  let currentFeePercent = 0.3
  const emaPeriod = 10
  const ratios: number[] = []
  const emaValues: number[] = []

  for (let i = 0; i < points; i++) {
    const timeLabel = `Step ${i + 1}`

    const prevRatio = ratios.length > 0 ? ratios[ratios.length - 1] : 1.0
    let change = (Math.random() - 0.5) * 0.15
    if (i % 8 === 0) change += (Math.random() - 0.5) * 0.3
    const volumeTvlRatio = Math.max(0.7, Math.min(1.3, parseFloat((prevRatio + change).toFixed(4))))
    ratios.push(volumeTvlRatio)

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

    const deadband = 0.02
    const feeStepPercent = 0.01

    if (volumeTvlRatio > emaRatio + deadband) {
      currentFeePercent += feeStepPercent
    } else if (volumeTvlRatio < emaRatio - deadband) {
      currentFeePercent -= feeStepPercent
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

// Fee Update Indicator component
const FeeUpdateIndicator = ({ type }: { type: 'up' | 'down' | 'neutral' }) => {
  const colors = {
    up: 'bg-green-50 dark:bg-green-950 text-green-500 dark:text-green-500',
    down: 'bg-red-50 dark:bg-red-950 text-red-500 dark:text-red-500',
    neutral: 'bg-sidebar-accent text-muted-foreground',
  }

  return (
    <div
      className={cn(
        'flex h-5 w-5 items-center justify-center rounded-sm transition-colors duration-150',
        colors[type]
      )}
    >
      {type === 'up' && <ChevronUp className="h-2.5 w-2.5" />}
      {type === 'down' && <ChevronDown className="h-2.5 w-2.5" />}
      {type === 'neutral' && <span className="text-[10px]">-</span>}
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

export const DynamicFeeSection = () => {
  const [isMobile, setIsMobile] = useState(false)
  const { ref, inView } = useInView<HTMLDivElement>({ once: true, threshold: 0.1 })
  const [isInView, setIsInView] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
  }, [])

  // Track when component comes into view for animation
  useEffect(() => {
    if (inView && !isInView) {
      setIsInView(true)
    }
  }, [inView, isInView])

  // Pre-generate 30 days of initial history
  const initialHistory = useMemo(() => generateMockFeeHistory(30), [])

  // Pre-compute initial 3 fee updates from history
  const initialFeeUpdates = useMemo(() => {
    const baseDate = new Date(2025, 3, 12)
    const last3 = initialHistory.slice(-3).reverse()

    return last3.map((point, idx) => {
      const historyIndex = initialHistory.length - 1 - idx
      const prevPoint = initialHistory[historyIndex - 1]

      let feeChange: 'up' | 'down' | 'neutral' = 'neutral'
      let feeChangeAmount = 0
      if (prevPoint) {
        feeChangeAmount = Math.abs(point.dynamicFee - prevPoint.dynamicFee)
        if (point.dynamicFee > prevPoint.dynamicFee) feeChange = 'up'
        else if (point.dynamicFee < prevPoint.dynamicFee) feeChange = 'down'
      }

      const dayOffset = 31 - (historyIndex + 1)
      const updateDate = new Date(baseDate)
      updateDate.setDate(baseDate.getDate() - dayOffset)

      return {
        id: historyIndex + 1000,
        timestamp: updateDate,
        emaRatio: point.emaRatio,
        volumeTvlRatio: point.volumeTvlRatio,
        difference: point.volumeTvlRatio - point.emaRatio,
        feeChange,
        feeChangeAmount,
        dynamicFee: point.dynamicFee,
      }
    })
  }, [initialHistory])

  const [chartData, setChartData] = useState<FeeHistoryPoint[]>(initialHistory)
  const [activityUpdates, setActivityUpdates] = useState<FeeUpdateItem[]>(initialFeeUpdates)

  const MICRO_STEPS_PER_MAJOR = isMobile ? 5 : 15
  const TOTAL_POINTS = 30 * MICRO_STEPS_PER_MAJOR

  const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
    const t2 = t * t
    const t3 = t2 * t
    return 0.5 * (
      (2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    )
  }

  const generateTarget = (prevRatio: number, prevEma: number, dayIndex: number) => {
    let change = (Math.random() - 0.5) * 0.15
    if (dayIndex % 8 === 0) change += (Math.random() - 0.5) * 0.3
    const newRatio = Math.max(0.7, Math.min(1.3, prevRatio + change))
    const emaPeriod = 10
    const k = 2 / (emaPeriod + 1)
    const newEma = newRatio * k + prevEma * (1 - k)
    return { ratio: newRatio, ema: newEma }
  }

  const lastPoint = initialHistory[initialHistory.length - 1]
  const secondLastPoint = initialHistory[initialHistory.length - 2]
  const futureTargets = useMemo(() => {
    const targets: Array<{ ratio: number; ema: number }> = []
    let prev = { ratio: lastPoint.volumeTvlRatio, ema: lastPoint.emaRatio }
    for (let i = 0; i < 3; i++) {
      const next = generateTarget(prev.ratio, prev.ema, 31 + i)
      targets.push(next)
      prev = next
    }
    return targets
  }, [lastPoint])

  const expandedInitialHistory = useMemo(() => {
    const expanded: FeeHistoryPoint[] = []
    const points = initialHistory

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)]
      const p1 = points[i]
      const p2 = points[i + 1]
      const p3 = points[Math.min(points.length - 1, i + 2)]

      for (let j = 0; j < MICRO_STEPS_PER_MAJOR; j++) {
        const t = j / MICRO_STEPS_PER_MAJOR
        expanded.push({
          timeLabel: `${p1.timeLabel}-${j}`,
          volumeTvlRatio: catmullRom(p0.volumeTvlRatio, p1.volumeTvlRatio, p2.volumeTvlRatio, p3.volumeTvlRatio, t),
          emaRatio: catmullRom(p0.emaRatio, p1.emaRatio, p2.emaRatio, p3.emaRatio, t),
          dynamicFee: p1.dynamicFee,
        })
      }
    }
    const last = points[points.length - 1]
    const p0 = secondLastPoint
    const p1 = last
    const p2 = futureTargets[0]
    const p3 = futureTargets[1]
    for (let j = 0; j < MICRO_STEPS_PER_MAJOR; j++) {
      const t = j / MICRO_STEPS_PER_MAJOR
      expanded.push({
        timeLabel: `${last.timeLabel}-${j}`,
        volumeTvlRatio: catmullRom(p0.volumeTvlRatio, p1.volumeTvlRatio, p2.ratio, p3.ratio, t),
        emaRatio: catmullRom(p0.emaRatio, p1.emaRatio, p2.ema, p3.ema, t),
        dynamicFee: last.dynamicFee,
      })
    }
    return expanded.slice(-TOTAL_POINTS)
  }, [initialHistory, futureTargets, secondLastPoint])

  const initialTargets = useMemo(() => {
    return [
      { ratio: secondLastPoint.volumeTvlRatio, ema: secondLastPoint.emaRatio },
      { ratio: lastPoint.volumeTvlRatio, ema: lastPoint.emaRatio },
      futureTargets[0],
      futureTargets[1],
    ]
  }, [lastPoint, secondLastPoint, futureTargets])

  const baseDate = useMemo(() => new Date(2025, 3, 12), [])

  const stateRef = useRef({
    currentFee: lastPoint.dynamicFee,
    dayIndex: 31,
    chartData: expandedInitialHistory,
    targetQueue: initialTargets,
    segmentIndex: 0,
    microStepCount: 0,
    consecutiveSteps: 0,
    lastFeeDirection: 'neutral' as 'up' | 'down' | 'neutral',
  })
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    setChartData(expandedInitialHistory)
  }, [expandedInitialHistory])

  useEffect(() => {
    if (!isInView || isMobile) return

    const FRAME_INTERVAL_MS = 120
    let lastFrameTime = performance.now()

    const animate = (currentTime: number) => {
      const state = stateRef.current
      const elapsed = currentTime - lastFrameTime

      if (elapsed >= FRAME_INTERVAL_MS) {
        lastFrameTime = currentTime
        state.microStepCount++

        const microStepInSegment = state.microStepCount % MICRO_STEPS_PER_MAJOR
        const t = microStepInSegment / MICRO_STEPS_PER_MAJOR

        if (state.microStepCount > 0 && microStepInSegment === 0) {
          state.targetQueue.shift()
          const lastTarget = state.targetQueue[state.targetQueue.length - 1]

          const generateTargetWithLikelihood = (prevRatio: number, prevEma: number, dayIdx: number) => {
            let change = (Math.random() - 0.5) * 0.15
            if (dayIdx % 8 === 0) change += (Math.random() - 0.5) * 0.3

            const fee = state.currentFee
            if (fee > 0.60) {
              change -= 0.02 * Math.random()
            } else if (fee < 0.10) {
              change += 0.02 * Math.random()
            }

            const newRatio = Math.max(0.7, Math.min(1.3, prevRatio + change))
            const emaPeriod = 10
            const k = 2 / (emaPeriod + 1)
            const newEma = newRatio * k + prevEma * (1 - k)
            return { ratio: newRatio, ema: newEma }
          }

          state.targetQueue.push(generateTargetWithLikelihood(lastTarget.ratio, lastTarget.ema, state.dayIndex + 3))

          const currentRatio = state.targetQueue[1].ratio
          const currentEma = state.targetQueue[1].ema
          const difference = currentRatio - currentEma
          const deadband = 0.02
          const prevFee = state.currentFee

          let direction: 'up' | 'down' | 'neutral' = 'neutral'
          if (currentRatio > currentEma + deadband) {
            direction = 'up'
          } else if (currentRatio < currentEma - deadband) {
            direction = 'down'
          }

          let feeStep = 0.01
          let feeChangeAmount = 0

          if (direction !== 'neutral') {
            if (direction === state.lastFeeDirection) {
              state.consecutiveSteps++
              feeStep = 0.01 * Math.pow(1.1, Math.min(state.consecutiveSteps, 3))
            } else {
              state.consecutiveSteps = 0
            }
            state.lastFeeDirection = direction

            feeChangeAmount = feeStep
            let newFee = direction === 'up' ? prevFee + feeStep : prevFee - feeStep
            newFee = Math.max(0.01, Math.min(1.0, newFee))
            state.currentFee = newFee
          } else {
            state.consecutiveSteps = 0
            state.lastFeeDirection = 'neutral'
          }

          const updateDate = new Date(baseDate)
          updateDate.setDate(baseDate.getDate() + state.dayIndex - 31)

          const newUpdate: FeeUpdateItem = {
            id: Date.now(),
            timestamp: updateDate,
            emaRatio: currentEma,
            volumeTvlRatio: currentRatio,
            difference,
            feeChange: direction,
            feeChangeAmount,
            dynamicFee: state.currentFee,
          }
          setActivityUpdates(prev => [newUpdate, ...prev].slice(0, 3))

          state.dayIndex++
        }

        const [p0, p1, p2, p3] = state.targetQueue
        const currentRatio = catmullRom(p0.ratio, p1.ratio, p2.ratio, p3.ratio, t)
        const currentEma = catmullRom(p0.ema, p1.ema, p2.ema, p3.ema, t)

        const newPoint: FeeHistoryPoint = {
          timeLabel: `Step-${state.microStepCount}`,
          volumeTvlRatio: currentRatio,
          emaRatio: currentEma,
          dynamicFee: state.currentFee,
        }

        const newData = [...state.chartData.slice(1), newPoint]
        state.chartData = newData
        setChartData([...newData])
      }

      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [isInView, isMobile])

  const currentFee = useMemo(
    () => (chartData.length > 0 ? chartData[chartData.length - 1].dynamicFee : 0.3),
    [chartData]
  )

  const ratioYDomain = useMemo(() => {
    const allRatios = chartData.flatMap((d) => [d.volumeTvlRatio, d.emaRatio])
    const min = Math.min(...allRatios)
    const max = Math.max(...allRatios)
    const pad = (max - min) * 0.1 || 0.1
    return [min - pad, max + pad] as [number, number]
  }, [chartData])

  const feeYDomain = useMemo(() => {
    const fees = chartData.map((d) => d.dynamicFee)
    const min = Math.min(...fees)
    const max = Math.max(...fees)
    const pad = Math.max((max - min) * 0.1, 0.02)
    return [Math.max(0, min - pad), max + pad] as [number, number]
  }, [chartData])

  const bullets = [
    'Competitive in any market condition',
    'Fee automatically converges to market equilibrium',
    'No migration between fee tiers needed',
  ]

  return (
    <div
      ref={ref}
      id="dynamic-fees-section"
      className={`animate-on-scroll flex w-full flex-col gap-y-4 md:gap-y-6 overflow-hidden rounded-lg border border-sidebar-border/60 bg-white dark:bg-[#131313] p-2 xl:flex-row ${inView ? 'in-view' : ''}`}
    >
      {/* Left Side - Text Content */}
      <div className="flex w-full flex-1 flex-col gap-y-4 md:gap-y-8 p-4 md:p-6 lg:p-12">
        <span className="w-fit rounded-md bg-green-950/70 px-2 md:px-2.5 py-1 text-xs font-medium text-green-500 transition-colors hover:bg-green-950/50">
          Live Now
        </span>
        <h3 className="text-2xl md:text-3xl lg:text-4xl font-semibold leading-tight text-balance">
          Pricing Fees Correctly
        </h3>
        <p className="text-base md:text-lg text-muted-foreground">
          Our Dynamic Fee algorithm responds to market conditions in real time to optimize returns for liquidity providers.
        </p>
        <ul className="flex flex-col gap-y-1">
          {bullets.map((bullet, index) => (
            <li
              key={index}
              className="flex flex-row items-start md:items-center gap-x-2"
            >
              <Check className="h-4 w-4 text-green-500 shrink-0 mt-0.5 md:mt-0" />
              <p className="text-sm md:text-base leading-relaxed text-pretty text-foreground">
                {bullet}
              </p>
            </li>
          ))}
        </ul>
        <div>
          <Link href="https://alphix.gitbook.io/docs/products/dynamic-fee" target="_blank">
            <button className="group relative flex flex-row items-center gap-x-2 rounded-md border border-sidebar-border bg-button px-6 md:px-8 py-2 md:py-2.5 text-sm font-semibold text-foreground hover:bg-accent hover:brightness-110 hover:border-white/30 transition-all overflow-hidden">
              <span
                className="absolute inset-0 transition-opacity duration-200 group-hover:opacity-0"
                style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
              />
              <span className="relative z-10">Learn More</span>
              <ArrowUpRight className="relative z-10 h-4 w-4" />
            </button>
          </Link>
        </div>
      </div>

      {/* Right Side - Chart & Fee Updates */}
      <div className="flex w-full flex-1 flex-col rounded-lg bg-gray-50 dark:bg-[#161616] p-3 md:p-4 lg:p-6">
        <div className="flex flex-row items-center justify-between gap-x-2 md:gap-x-4 mb-3 md:mb-4">
          <h3 className="text-sm md:text-base">Fee Algorithm</h3>
          <div className="flex flex-row items-center gap-x-2 md:gap-x-4">
            <div className="flex flex-row items-center gap-x-2 md:gap-x-4 text-xs font-sans">
              <span className="hidden md:inline">Dynamic Fee</span>
              <span className="text-muted-foreground">
                {currentFee.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>

        <div className="h-[160px] md:h-[220px] w-full pointer-events-none select-none">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
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

        {/* Fee Updates List - CSS transitions instead of AnimatePresence */}
        <div className="mt-auto flex flex-col">
          <div className="grid grid-cols-4 px-3 pb-2 text-[10px] text-muted-foreground">
            <span>Date</span>
            <span className="text-center">Ratio</span>
            <span className="text-center">Target</span>
            <span className="text-right">Change</span>
          </div>
          <div
            className="relative overflow-hidden"
            style={{
              maskImage: 'linear-gradient(to bottom, black calc(100% - 3px), transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 3px), transparent 100%)',
            }}
          >
            <div className="flex w-full flex-col gap-y-2 pb-[3px]">
              {activityUpdates.length === 0 ? (
                <div className="flex h-[100px] items-center justify-center text-xs text-muted-foreground">
                  Waiting for fee updates...
                </div>
              ) : (
                activityUpdates.slice(0, 3).map((update, index) => (
                  <div
                    key={update.id}
                    className="grid grid-cols-4 items-center rounded-md border border-sidebar-border/60 bg-[#1b1b1b] px-3 py-2 text-xs transition-all duration-300 ease-out"
                    style={{
                      opacity: 1,
                      transform: 'translateY(0)',
                    }}
                  >
                    <span className="text-foreground whitespace-nowrap" style={{ fontFamily: 'Consolas, monospace' }}>
                      {update.timestamp.toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="text-muted-foreground text-center" style={{ fontFamily: 'Consolas, monospace' }}>
                      {update.volumeTvlRatio.toFixed(3)}
                    </span>
                    <span className="text-muted-foreground text-center" style={{ fontFamily: 'Consolas, monospace' }}>
                      {update.emaRatio.toFixed(3)}
                    </span>
                    <div className="flex flex-row items-center justify-end gap-x-2">
                      <span
                        className={cn(
                          "text-[11px]",
                          update.feeChange === 'up' ? "text-green-500" : update.feeChange === 'down' ? "text-red-500" : "text-muted-foreground"
                        )}
                        style={{ fontFamily: 'Consolas, monospace' }}
                      >
                        {update.feeChange === 'neutral'
                          ? '0bp'
                          : `${update.feeChange === 'up' ? '+' : '-'}${(update.feeChangeAmount * 100).toFixed(0)}bp`}
                      </span>
                      <FeeUpdateIndicator type={update.feeChange} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
