'use client'

import { cn } from '@/lib/utils'
import { useInView } from '@/hooks/useInView'
import { ArrowUpRight, ChevronUp, ChevronDown } from 'lucide-react'
import { IconCheck } from 'nucleo-micro-bold-essential'
import Link from 'next/link'
import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts'
import { Button } from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Production parameters (ETH/USDC on Base)
// fee_bps = C * sigma_annual_decimal^2, clamped to [MIN_FEE_BPS, MAX_FEE_BPS]
// ---------------------------------------------------------------------------

const C = 15
const MIN_FEE_BPS = 5   // 0.05%
const MAX_FEE_BPS = 30  // 0.30%

const feeFromSigma = (sigmaPercent: number): number => {
  const s = sigmaPercent / 100
  const raw = C * s * s
  return Math.max(MIN_FEE_BPS, Math.min(MAX_FEE_BPS, raw))
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeeHistoryPoint {
  timeLabel: string
  sigmaPercent: number  // annualized volatility (%)
  feeBps: number        // on-chain fee in bps
}

interface FeeUpdateItem {
  id: number
  timestamp: Date
  sigmaPercent: number
  feeBps: number
  feeChangeBps: number
  feeChange: 'up' | 'down' | 'neutral'
}

// ---------------------------------------------------------------------------
// Mock ETH/USDC sigma walk — baseline ~60%, drift, occasional spikes
// Sized so the fee mostly sits near floor (5 bps) with vol-driven bumps.
// ---------------------------------------------------------------------------

const stepSigma = (prev: number): number => {
  const drift = (Math.random() - 0.5) * 6
  const reversion = (60 - prev) * 0.05
  let next = prev + drift + reversion
  const r = Math.random()
  if (r < 0.08) next += 12 + Math.random() * 22    // spike
  else if (r < 0.12) next -= 8                     // calm
  return Math.max(40, Math.min(140, next))
}

const generateMockSigmaHistory = (points = 30): FeeHistoryPoint[] => {
  const data: FeeHistoryPoint[] = []
  let sigma = 62 + (Math.random() - 0.5) * 8
  for (let i = 0; i < points; i++) {
    if (i > 0) sigma = stepSigma(sigma)
    data.push({
      timeLabel: `Step ${i + 1}`,
      sigmaPercent: parseFloat(sigma.toFixed(2)),
      feeBps: parseFloat(feeFromSigma(sigma).toFixed(2)),
    })
  }
  return data
}

// ---------------------------------------------------------------------------
// Fee Update Indicator
// ---------------------------------------------------------------------------

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
        colors[type],
      )}
    >
      {type === 'up' && <ChevronUp className="h-2.5 w-2.5" />}
      {type === 'down' && <ChevronDown className="h-2.5 w-2.5" />}
      {type === 'neutral' && <span className="text-[10px]">-</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chart config
// ---------------------------------------------------------------------------

const chartConfig = {
  sigma: { color: 'hsl(var(--chart-3))' },
  fee: { color: '#e85102' },
}

// ---------------------------------------------------------------------------
// DynamicFeeSection
// ---------------------------------------------------------------------------

export const DynamicFeeSection = () => {
  const [isMobile, setIsMobile] = useState(false)
  const [mobileAnimationStarted, setMobileAnimationStarted] = useState(false)
  const { ref, inView } = useInView<HTMLDivElement>({ once: true, threshold: 0.1 })
  const [isInView, setIsInView] = useState(false)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
  }, [])

  const handlePlayClick = useCallback(() => {
    setMobileAnimationStarted(true)
  }, [])

  useEffect(() => {
    if (inView && !isInView) setIsInView(true)
  }, [inView, isInView])

  // Pre-generate 30 steps of initial history
  const initialHistory = useMemo(() => generateMockSigmaHistory(30), [])

  // Pre-compute initial 3 push events from history
  const initialFeeUpdates = useMemo<FeeUpdateItem[]>(() => {
    const baseDate = new Date(2025, 3, 12)
    const last3 = initialHistory.slice(-3).reverse()
    return last3.map((point, idx) => {
      const historyIndex = initialHistory.length - 1 - idx
      const prevPoint = initialHistory[historyIndex - 1]
      const delta = prevPoint ? point.feeBps - prevPoint.feeBps : 0
      const direction: 'up' | 'down' | 'neutral' =
        delta > 0.1 ? 'up' : delta < -0.1 ? 'down' : 'neutral'
      const dayOffset = 31 - (historyIndex + 1)
      const updateDate = new Date(baseDate)
      updateDate.setDate(baseDate.getDate() - dayOffset)
      return {
        id: historyIndex + 1000,
        timestamp: updateDate,
        sigmaPercent: point.sigmaPercent,
        feeBps: point.feeBps,
        feeChangeBps: Math.abs(delta),
        feeChange: direction,
      }
    })
  }, [initialHistory])

  const [chartData, setChartData] = useState<FeeHistoryPoint[]>(initialHistory)
  const [activityUpdates, setActivityUpdates] = useState<FeeUpdateItem[]>(initialFeeUpdates)

  const MICRO_STEPS_PER_MAJOR = isMobile ? 10 : 15
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

  const lastPoint = initialHistory[initialHistory.length - 1]
  const secondLastPoint = initialHistory[initialHistory.length - 2]

  const futureTargets = useMemo(() => {
    const targets: FeeHistoryPoint[] = []
    let prevSigma = lastPoint.sigmaPercent
    for (let i = 0; i < 3; i++) {
      prevSigma = stepSigma(prevSigma)
      targets.push({
        timeLabel: `Future ${i + 1}`,
        sigmaPercent: parseFloat(prevSigma.toFixed(2)),
        feeBps: parseFloat(feeFromSigma(prevSigma).toFixed(2)),
      })
    }
    return targets
  }, [lastPoint])

  // Expand initial history with Catmull-Rom interpolation for smooth sigma line
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
          sigmaPercent: catmullRom(p0.sigmaPercent, p1.sigmaPercent, p2.sigmaPercent, p3.sigmaPercent, t),
          feeBps: p1.feeBps, // fee stays constant between major steps (step-after)
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
        sigmaPercent: catmullRom(p0.sigmaPercent, p1.sigmaPercent, p2.sigmaPercent, p3.sigmaPercent, t),
        feeBps: last.feeBps,
      })
    }
    return expanded.slice(-TOTAL_POINTS)
  }, [initialHistory, futureTargets, secondLastPoint, MICRO_STEPS_PER_MAJOR, TOTAL_POINTS])

  const initialTargets = useMemo<FeeHistoryPoint[]>(() => {
    return [secondLastPoint, lastPoint, futureTargets[0], futureTargets[1]]
  }, [lastPoint, secondLastPoint, futureTargets])

  const baseDate = useMemo(() => new Date(2025, 3, 12), [])

  const stateRef = useRef({
    currentFeeBps: lastPoint.feeBps,
    dayIndex: 31,
    chartData: expandedInitialHistory,
    targetQueue: initialTargets,
    microStepCount: 0,
  })
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    setChartData(expandedInitialHistory)
  }, [expandedInitialHistory])

  useEffect(() => {
    const shouldAnimate = isInView && (!isMobile || mobileAnimationStarted)
    if (!shouldAnimate) return

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

        // Major step boundary: new push event
        if (state.microStepCount > 0 && microStepInSegment === 0) {
          state.targetQueue.shift()
          const lastTarget = state.targetQueue[state.targetQueue.length - 1]
          const nextSigma = stepSigma(lastTarget.sigmaPercent)
          state.targetQueue.push({
            timeLabel: `Future`,
            sigmaPercent: parseFloat(nextSigma.toFixed(2)),
            feeBps: parseFloat(feeFromSigma(nextSigma).toFixed(2)),
          })

          const current = state.targetQueue[1]
          const prevFee = state.currentFeeBps
          const newFee = current.feeBps
          const deltaBps = newFee - prevFee

          let direction: 'up' | 'down' | 'neutral' = 'neutral'
          if (deltaBps > 0.1) direction = 'up'
          else if (deltaBps < -0.1) direction = 'down'

          state.currentFeeBps = newFee

          const updateDate = new Date(baseDate)
          updateDate.setDate(baseDate.getDate() + state.dayIndex - 31)

          const newUpdate: FeeUpdateItem = {
            id: Date.now(),
            timestamp: updateDate,
            sigmaPercent: current.sigmaPercent,
            feeBps: newFee,
            feeChangeBps: Math.abs(deltaBps),
            feeChange: direction,
          }
          setActivityUpdates(prev => [newUpdate, ...prev].slice(0, 3))

          state.dayIndex++
        }

        const [p0, p1, p2, p3] = state.targetQueue
        const currentSigma = catmullRom(p0.sigmaPercent, p1.sigmaPercent, p2.sigmaPercent, p3.sigmaPercent, t)

        const newPoint: FeeHistoryPoint = {
          timeLabel: `Step-${state.microStepCount}`,
          sigmaPercent: currentSigma,
          feeBps: state.currentFeeBps,
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
  }, [isInView, isMobile, mobileAnimationStarted, baseDate, MICRO_STEPS_PER_MAJOR])

  const currentFeeBps = useMemo(
    () => (chartData.length > 0 ? chartData[chartData.length - 1].feeBps : MIN_FEE_BPS),
    [chartData],
  )

  const sigmaYDomain = useMemo(() => {
    const values = chartData.map(d => d.sigmaPercent)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const pad = Math.max((max - min) * 0.15, 3)
    return [Math.max(0, min - pad), max + pad] as [number, number]
  }, [chartData])

  const feeYDomain = useMemo(() => {
    return [0, MAX_FEE_BPS + 2] as [number, number]
  }, [])

  const bullets = [
    'Competitive in any market condition',
    'Fee automatically converges to market equilibrium',
    'No migration between fee tiers needed',
  ]

  return (
    <div
      ref={ref}
      id="dynamic-fees-section"
      className={`animate-on-scroll flex w-full flex-col gap-y-6 overflow-hidden rounded-lg border border-sidebar-border/60 bg-white dark:bg-[#131313] p-2 xl:flex-row ${inView ? 'in-view' : ''}`}
    >
      {/* Left Side - Text Content */}
      <div className="flex w-full flex-1 flex-col gap-y-8 p-6 md:p-12">
        <span className="w-fit rounded-md bg-green-950/70 px-2.5 py-1 text-xs font-medium text-green-500">
          Live
        </span>
        <h3 className="text-3xl font-semibold leading-tight text-balance md:text-4xl">
          Pricing Fees Correctly
        </h3>
        <p className="text-lg text-muted-foreground">
          Our Dynamic Fee algorithm responds to market conditions in real time to optimize returns for liquidity providers.
        </p>
        <ul className="flex flex-col gap-y-1">
          {bullets.map((bullet, index) => (
            <li key={index} className="flex flex-row items-center gap-x-2">
              <IconCheck className="h-4 w-4 text-green-500 shrink-0" />
              <p className="leading-relaxed text-pretty text-foreground">{bullet}</p>
            </li>
          ))}
        </ul>
        <div className="hidden md:block">
          <Link href="https://alphix.gitbook.io/docs/products/dynamic-fee" target="_blank">
            <button className="group relative flex flex-row items-center gap-x-2 rounded-md border border-sidebar-border bg-button px-8 py-2.5 text-sm font-semibold text-foreground hover:bg-accent hover:brightness-110 hover:border-white/30 transition-all overflow-hidden">
              <span
                className="absolute inset-0 transition-opacity duration-200 group-hover:opacity-0"
                style={{ backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
              />
              <span className="relative z-10">Learn More</span>
              <ArrowUpRight className="relative z-10 h-4 w-4" />
            </button>
          </Link>
        </div>
      </div>

      {/* Right Side - Chart & Fee Updates */}
      <div className="flex w-full flex-1 flex-col rounded-lg bg-gray-50 dark:bg-[#161616] p-4 md:p-6">
        <div className="flex flex-row items-center justify-between gap-x-4 mb-4">
          <h3>Fee Algorithm</h3>
          <div className="flex flex-row items-center gap-x-4">
            <div className="hidden md:flex flex-row items-center gap-x-4 text-xs font-sans">
              <span>Dynamic Fee</span>
              <span className="text-muted-foreground">
                {(currentFeeBps / 100).toFixed(2)}%
              </span>
            </div>
            <div className="md:hidden">
              {!mobileAnimationStarted ? (
                <Button
                  onClick={handlePlayClick}
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 pl-2.5 pr-3 text-xs font-medium border-sidebar-border bg-[#1b1b1b] hover:bg-[#252525] hover:border-sidebar-border"
                >
                  <svg style={{ width: '12px', height: '12px', minWidth: '12px', minHeight: '12px' }} viewBox="0 0 8 8" fill="currentColor" className="text-muted-foreground shrink-0">
                    <path d="M1.5 1.2a.5.5 0 0 1 .75-.43l4.5 2.8a.5.5 0 0 1 0 .86l-4.5 2.8a.5.5 0 0 1-.75-.43V1.2z" />
                  </svg>
                  <span className="text-muted-foreground text-[11px]">Play</span>
                </Button>
              ) : (
                <div className="flex flex-row items-center gap-x-2 text-xs font-sans">
                  <span className="text-muted-foreground/70">Dynamic Fee</span>
                  <span className="text-muted-foreground">
                    {(currentFeeBps / 100).toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="h-[220px] w-full pointer-events-none select-none">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
            >
              <XAxis dataKey="timeLabel" hide />
              <YAxis yAxisId="left" domain={sigmaYDomain} hide />
              <YAxis yAxisId="right" orientation="right" domain={feeYDomain} hide />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="sigmaPercent"
                stroke={chartConfig.sigma.color}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="right"
                type="stepAfter"
                dataKey="feeBps"
                stroke={chartConfig.fee.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Fee Updates List */}
        <div className="mt-auto flex flex-col">
          <div className="grid grid-cols-4 px-3 pb-2 text-[10px] text-muted-foreground">
            <span>Date</span>
            <span className="text-center">Volatility</span>
            <span className="text-center">Fee</span>
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
                activityUpdates.slice(0, 3).map((update) => (
                  <div
                    key={update.id}
                    className="grid grid-cols-4 items-center rounded-md border border-sidebar-border/60 bg-[#1b1b1b] px-3 py-2 text-xs transition-all duration-300 ease-out"
                    style={{ opacity: 1, transform: 'translateY(0)' }}
                  >
                    <span className="text-foreground whitespace-nowrap" style={{ fontFamily: 'Consolas, monospace' }}>
                      {update.timestamp.toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="text-muted-foreground text-center" style={{ fontFamily: 'Consolas, monospace' }}>
                      {update.sigmaPercent.toFixed(1)}%
                    </span>
                    <span className="text-muted-foreground text-center" style={{ fontFamily: 'Consolas, monospace' }}>
                      {update.feeBps.toFixed(1)}bps
                    </span>
                    <div className="flex flex-row items-center justify-end gap-x-2">
                      <span
                        className={cn(
                          "text-[11px]",
                          update.feeChange === 'up'
                            ? "text-green-500"
                            : update.feeChange === 'down'
                              ? "text-red-500"
                              : "text-muted-foreground",
                        )}
                        style={{ fontFamily: 'Consolas, monospace' }}
                      >
                        {update.feeChange === 'neutral'
                          ? '0bp'
                          : `${update.feeChange === 'up' ? '+' : '-'}${update.feeChangeBps.toFixed(1)}bp`}
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
