"use client"

/**
 * SwapExecuteModal - Wizard modal for executing swap transactions
 *
 * Opens in review state with action button. User clicks to execute.
 * Follows the same pattern as ReviewExecuteModal for liquidity operations:
 * - Single consistent title + single close button
 * - Inline error callout (no separate error view)
 * - ProgressIndicator replaces action button during execution
 * - User rejection returns to review state silently
 *
 * @see components/liquidity/wizard/ReviewExecuteModal.tsx
 * @see components/swap/useSwapStepExecutor.ts
 */

import { createElement, useEffect, useState } from "react"
import Image from "next/image"
import { ArrowDown, AlertCircle, RotateCw } from "lucide-react"
import { IconXmark, IconBadgeCheck2 } from "nucleo-micro-bold-essential"
import { toast } from "sonner"

import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { TokenImage } from "@/components/ui/token-image"
import { ProgressIndicator } from "@/components/transactions/ProgressIndicator"

import { useSwapStepExecutor, type UseSwapStepExecutorArgs } from "./useSwapStepExecutor"
import { formatTokenAmountDisplay } from "./useSwapTrade"
import { SwapRoutePreview } from "./SwapRoutePreview"
import type { Token } from "./swap-interface"

interface SwapExecuteModalProps extends UseSwapStepExecutorArgs {
  isOpen: boolean
  onClose: () => void
  displayFromToken: Token
  displayToToken: Token
  routeInfo?: { path: string[]; hops: number; isDirectRoute: boolean; pools: string[] } | null
}

// ---------------------------------------------------------------------------
// Inline error callout (matches ReviewExecuteModal pattern)
// ---------------------------------------------------------------------------

function ErrorCallout({
  error,
  onRetry,
}: {
  error: string | null
  onRetry: () => void
}) {
  const [copied, setCopied] = useState(false)

  if (!error) return null

  const MAX_LEN = 120
  const display = error.length > MAX_LEN ? error.slice(0, MAX_LEN) + "..." : error

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(error)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 overflow-hidden">
      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 overflow-hidden">
        <p className="text-sm text-red-400 break-words">{display}</p>
        <div className="flex gap-3 mt-2">
          <button
            onClick={handleCopy}
            className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
          >
            {copied ? (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </button>
          <button
            onClick={onRetry}
            className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
          >
            <RotateCw className="w-3 h-3" />
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

type ModalView = "review" | "executing"

export function SwapExecuteModal({
  isOpen,
  onClose,
  displayFromToken,
  displayToToken,
  routeInfo,
  ...executorArgs
}: SwapExecuteModalProps) {
  const { execute, state, reset, currentStep } = useSwapStepExecutor(executorArgs)
  const [view, setView] = useState<ModalView>("review")
  const [error, setError] = useState<string | null>(null)

  // Track execution status changes to manage view
  useEffect(() => {
    if (state.status === "error") {
      const isUserCancelled = state.error?.includes("cancelled") ||
        state.error?.includes("rejected") ||
        state.error?.includes("denied") ||
        state.error?.includes("Cancelled")

      // User rejection: return to review silently
      if (isUserCancelled) {
        setView("review")
        setError(null)
        reset()
      } else {
        // Real error: return to review with error shown
        setView("review")
        setError(state.error ?? null)
      }
    }
  }, [state.status, state.error, reset])

  // Success toast when swap completes
  useEffect(() => {
    if (state.status === "completed" && state.txInfo?.hash) {
      const desc = `Swapped ${state.txInfo.fromAmount} ${state.txInfo.fromSymbol} to ${state.txInfo.toAmount} ${state.txInfo.toSymbol}`
      toast.success("Swap Successful", {
        icon: createElement(IconBadgeCheck2, { className: "h-4 w-4 text-green-500" }),
        description: desc,
        duration: 4000,
        action: {
          label: "View Transaction",
          onClick: () => window.open(state.txInfo!.explorerUrl, "_blank"),
        },
      })
      onClose()
    }
  }, [state.status, state.txInfo, onClose])

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        reset()
        setView("review")
        setError(null)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen, reset])

  const handleClose = () => {
    if (state.status === "executing") return
    onClose()
  }

  const handleConfirm = () => {
    setView("executing")
    setError(null)
    execute()
  }

  const handleRetry = () => {
    setError(null)
    reset()
  }

  const isExecuting = state.status === "executing"

  // Map step states to TransactionStep array for ProgressIndicator
  const progressSteps = state.steps.map(s => s.step)

  const displayFromAmount = formatTokenAmountDisplay(executorArgs.fromAmount, displayFromToken)
  const displayToAmount = formatTokenAmountDisplay(executorArgs.toAmount, displayToToken)

  // USD values
  const fromUsd = parseFloat(executorArgs.fromAmount || "0") * (displayFromToken.usdPrice || 0)
  const toUsd = parseFloat(executorArgs.toAmount || "0") * (displayToToken.usdPrice || 0)
  const fmtUsd = (v: number) =>
    v < 0.01 ? "<$0.01" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-[420px] p-0 border-sidebar-border/60 bg-container overflow-hidden"
        onPointerDownOutside={(e) => {
          if (isExecuting) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (isExecuting) e.preventDefault()
        }}
      >
        {/* Header — matches ReviewExecuteModal: px-4 pt-4 pb-2 */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-base font-medium text-muted-foreground">Swap</span>
          <button
            onClick={handleClose}
            disabled={isExecuting}
            className="text-muted-foreground hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <IconXmark className="w-5 h-5" />
          </button>
        </div>

        {/* Content — matches ReviewExecuteModal "Depositing" section: px-4 py-3 */}
        <div className="px-4 py-3">
          <div className="flex flex-col gap-4">
            {/* From row */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-xl font-semibold text-white">
                  {displayFromAmount} {displayFromToken.symbol}
                </span>
                {fromUsd > 0 && (
                  <span className="text-sm text-muted-foreground">{fmtUsd(fromUsd)}</span>
                )}
              </div>
              {displayFromToken.icon ? (
                <TokenImage src={displayFromToken.icon} alt={displayFromToken.symbol} size={36} />
              ) : (
                <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white">
                  {displayFromToken.symbol.charAt(0)}
                </div>
              )}
            </div>

            {/* Arrow divider — left aligned */}
            <div className="flex justify-start -my-2">
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
            </div>

            {/* To row */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-xl font-semibold text-white">
                  {displayToAmount} {displayToToken.symbol}
                </span>
                {toUsd > 0 && (
                  <span className="text-sm text-muted-foreground">{fmtUsd(toUsd)}</span>
                )}
              </div>
              {displayToToken.icon ? (
                <TokenImage src={displayToToken.icon} alt={displayToToken.symbol} size={36} />
              ) : (
                <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white">
                  {displayToToken.symbol.charAt(0)}
                </div>
              )}
            </div>

            {/* Route — standalone segment */}
            <div className="border-t border-muted-foreground/20" />
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Route</span>
                <span className="flex items-center gap-1.5">
                  {(executorArgs.source || "alphix") === "kyberswap" ? (
                    <>
                      <svg width={12} height={12} viewBox="0 0 47 67" fill="#31CB9E" xmlns="http://www.w3.org/2000/svg">
                        <path d="m20 33.51 25 14.32a1.32 1.32 0 0 0 2-1.14v-26.38a1.31 1.31 0 0 0 -2-1.13z" />
                        <path d="m44.47 12.84-17.09-12.57a1.36 1.36 0 0 0 -2.14.73l-6.24 28 25.32-14a1.26 1.26 0 0 0 .15-2.15" />
                        <path d="m27.36 66.74 17.11-12.57a1.28 1.28 0 0 0 -.14-2.17l-25.33-14 6.24 28a1.35 1.35 0 0 0 2.12.77" />
                        <path d="m13.5 33 6.5-30.41a1.29 1.29 0 0 0 -2-1.31l-16.65 12.77a3.45 3.45 0 0 0 -1.35 2.75v32.4a3.45 3.45 0 0 0 1.35 2.8l16.57 12.72a1.29 1.29 0 0 0 2-1.31z" />
                      </svg>
                      <span className="text-muted-foreground text-xs">via Kyberswap</span>
                    </>
                  ) : (
                    <>
                      <Image src="/logos/alphix-icon-white.svg" alt="Alphix" width={12} height={12} className="opacity-70" />
                      <span className="text-muted-foreground text-xs">via Alphix</span>
                    </>
                  )}
                </span>
              </div>
              <SwapRoutePreview
                source={executorArgs.source || "alphix"}
                fromToken={displayFromToken}
                toToken={displayToToken}
                routeInfo={routeInfo}
                kyberswapRouteSummary={executorArgs.kyberswapData?.routeSummary}
                tokenMetadata={executorArgs.kyberswapData?.tokenMetadata}
                compact
              />
            </div>

            {/* Detail rows — matches Zap wizard bg-muted/30 box */}
            <div className="flex flex-col gap-2 py-2 px-3 rounded-lg bg-muted/30">
            {/* Price */}
            {(() => {
              const fromNum = parseFloat(executorArgs.fromAmount || "0")
              const toNum = parseFloat(executorArgs.toAmount || "0")
              if (fromNum > 0 && toNum > 0) {
                const rate = toNum / fromNum
                const rateDisplay = rate >= 0.01 ? rate.toFixed(rate >= 100 ? 2 : 4) : rate.toPrecision(4)
                return (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Price</span>
                    <span className="text-white">
                      1 {displayFromToken.symbol} = {rateDisplay} {displayToToken.symbol}
                    </span>
                  </div>
                )
              }
              return null
            })()}

            {/* Slippage */}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Slippage</span>
              <span className="text-white">{executorArgs.currentSlippage}%</span>
            </div>

            {/* Minimum Received */}
            {(() => {
              const toNum = parseFloat(executorArgs.toAmount || "0")
              if (toNum > 0) {
                const minReceived = toNum * (1 - executorArgs.currentSlippage / 100)
                const minDisplay = minReceived >= 0.01
                  ? minReceived.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })
                  : minReceived.toPrecision(4)
                const minUsd = minReceived * (displayToToken.usdPrice || 0)
                return (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Min. received</span>
                    <span>
                      <span className="text-muted-foreground">
                        {minDisplay} {displayToToken.symbol}
                      </span>
                      {minUsd > 0 && (
                        <span className="text-white ml-1">
                          (~{fmtUsd(minUsd)})
                        </span>
                      )}
                    </span>
                  </div>
                )
              }
              return null
            })()}
            </div>
          </div>
        </div>

        {/* Error Callout - inline */}
        {error && (
          <div className="px-4 pb-2">
            <ErrorCallout error={error} onRetry={handleRetry} />
          </div>
        )}

        {/* Bottom Section: Button OR Progress Indicator */}
        <div className="p-4 pt-2">
          {view === "executing" && progressSteps.length > 0 ? (
            <ProgressIndicator steps={progressSteps} currentStep={currentStep} />
          ) : (
            <Button
              onClick={handleConfirm}
              className="w-full h-12 text-base font-semibold bg-button-primary border border-sidebar-primary text-sidebar-primary hover:bg-button-primary/90"
            >
              Swap
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
