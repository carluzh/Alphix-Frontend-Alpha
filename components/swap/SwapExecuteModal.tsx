"use client"

/**
 * SwapExecuteModal - Thin wrapper around TransactionModal for swap transactions
 *
 * Provides swap-specific review content (token amounts, route, price, slippage)
 * and delegates all execution logic to TransactionModal + useSwapFlow.
 *
 * @see components/transactions/TransactionModal.tsx
 * @see lib/transactions/flows/useSwapFlow.ts
 */

import Image from "next/image"
import { ArrowDown } from "lucide-react"
import { toast } from "sonner"

import { getExplorerTxUrl } from "@/lib/wagmiConfig"
import { TokenImage } from "@/components/ui/token-image"
import { TransactionModal } from "@/components/transactions/TransactionModal"
import { SwapRoutePreview } from "./SwapRoutePreview"
import { formatTokenAmountDisplay } from "./useSwapTrade"
import { useSwapFlow, type UseSwapFlowArgs } from "@/lib/transactions/flows/useSwapFlow"
import type { AggregatorSource } from "@/lib/aggregators/types"
import type { KyberswapQuoteData } from "./useSwapQuote"
import type { Token } from "./swap-interface"
import type { ExecutionTradeParams } from "./useSwapTrade"

// =============================================================================
// TYPES
// =============================================================================

interface SwapExecuteModalProps {
  isOpen: boolean
  onClose: () => void
  fromToken: Token
  toToken: Token
  fromAmount: string
  toAmount: string
  lastEditedSideRef: React.MutableRefObject<"from" | "to">
  trade?: ExecutionTradeParams
  tradeState?: "idle" | "loading" | "no_route" | "error" | "ready"
  currentSlippage: number
  fromTokenUsdPrice: number
  refetchFromTokenBalance?: () => Promise<any>
  refetchToTokenBalance?: () => Promise<any>
  source?: AggregatorSource
  kyberswapData?: KyberswapQuoteData | null
  routeInfo?: { path: string[]; hops: number; isDirectRoute: boolean; pools: string[] } | null
  /** Target chain ID derived from token selection */
  targetChainId?: number
  /** Ensure wallet is on the correct chain before executing */
  ensureChain?: (chainId: number) => Promise<boolean>
}

// =============================================================================
// COMPONENT
// =============================================================================

export function SwapExecuteModal({
  isOpen,
  onClose,
  fromToken,
  toToken,
  fromAmount,
  toAmount,
  lastEditedSideRef,
  trade,
  tradeState,
  currentSlippage,
  fromTokenUsdPrice,
  refetchFromTokenBalance,
  refetchToTokenBalance,
  source = "alphix",
  kyberswapData,
  routeInfo,
  targetChainId,
  ensureChain,
}: SwapExecuteModalProps) {
  const { generateSteps, executors, mapStepsToUI, buildPhase } = useSwapFlow({
    fromToken,
    toToken,
    fromAmount,
    toAmount,
    lastEditedSideRef,
    trade,
    currentSlippage,
    fromTokenUsdPrice,
    refetchFromTokenBalance,
    refetchToTokenBalance,
    source,
    kyberswapData,
    targetChainId,
  })

  const handleSuccess = (results: Map<number, { txHash?: string }>) => {
    // Extract txHash from step results (avoids stale closure over txInfo state)
    let hash: string | undefined
    for (const [, result] of results) {
      if (result.txHash) hash = result.txHash
    }

    const desc = `Swapped ${formatTokenAmountDisplay(fromAmount, fromToken)} ${fromToken.symbol} to ${formatTokenAmountDisplay(toAmount, toToken)} ${toToken.symbol}`
    toast.success("Swap successful", {
      id: hash ? `swap-success-${hash}` : undefined,
      description: desc,
      duration: 4000,
      action: hash
        ? { label: "View transaction", onClick: () => window.open(getExplorerTxUrl(hash!), "_blank") }
        : undefined,
    })
  }

  const onBeforeExecute = async (): Promise<boolean> => {
    if (tradeState && tradeState !== "ready") return false
    if (!trade) return false
    // Ensure wallet is on the correct chain before executing
    if (targetChainId && ensureChain) {
      const ok = await ensureChain(targetChainId)
      if (!ok) return false
    }
    return true
  }

  // Display values
  const displayFromAmount = formatTokenAmountDisplay(fromAmount, fromToken)
  const displayToAmount = formatTokenAmountDisplay(toAmount, toToken)
  const fromUsd = parseFloat(fromAmount || "0") * (fromToken.usdPrice || 0)
  const toUsd = parseFloat(toAmount || "0") * (toToken.usdPrice || 0)
  const fmtUsd = (v: number) =>
    v < 0.01 ? "<$0.01" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const statusText = buildPhase === "building"
    ? "Building Transaction..."
    : buildPhase === "confirming"
    ? "Confirm in wallet"
    : undefined

  return (
    <TransactionModal
      open={isOpen}
      onClose={onClose}
      title="Swap"
      confirmText="Swap"
      confirmDisabled={tradeState !== "ready" || !trade}
      generateSteps={generateSteps}
      executors={executors}
      mapStepsToUI={mapStepsToUI}
      onBeforeExecute={onBeforeExecute}
      onSuccess={handleSuccess}
      statusText={statusText}
    >
      <div className="flex flex-col gap-4">
        {/* From row */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-xl font-semibold text-white">
              {displayFromAmount} {fromToken.symbol}
            </span>
            {fromUsd > 0 && (
              <span className="text-sm text-muted-foreground">{fmtUsd(fromUsd)}</span>
            )}
          </div>
          {fromToken.icon ? (
            <TokenImage src={fromToken.icon} alt={fromToken.symbol} size={36} />
          ) : (
            <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white">
              {fromToken.symbol.charAt(0)}
            </div>
          )}
        </div>

        {/* Arrow divider */}
        <div className="flex justify-start -my-2">
          <ArrowDown className="h-4 w-4 text-muted-foreground" />
        </div>

        {/* To row */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-xl font-semibold text-white">
              {displayToAmount} {toToken.symbol}
            </span>
            {toUsd > 0 && (
              <span className="text-sm text-muted-foreground">{fmtUsd(toUsd)}</span>
            )}
          </div>
          {toToken.icon ? (
            <TokenImage src={toToken.icon} alt={toToken.symbol} size={36} />
          ) : (
            <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white">
              {toToken.symbol.charAt(0)}
            </div>
          )}
        </div>

        {/* Route */}
        <div className="border-t border-muted-foreground/20" />
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Route</span>
            <span className="flex items-center gap-1.5">
              {source === "kyberswap" ? (
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
            source={source}
            fromToken={fromToken}
            toToken={toToken}
            routeInfo={routeInfo}
            kyberswapRouteSummary={kyberswapData?.routeSummary}
            tokenMetadata={kyberswapData?.tokenMetadata}
            compact
          />
        </div>

        {/* Detail rows */}
        <div className="flex flex-col gap-2 py-2 px-3 rounded-lg bg-muted/30">
          {/* Price */}
          {(() => {
            const fromNum = parseFloat(fromAmount || "0")
            const toNum = parseFloat(toAmount || "0")
            if (fromNum > 0 && toNum > 0) {
              const rate = toNum / fromNum
              const rateDisplay = rate >= 0.01 ? rate.toFixed(rate >= 100 ? 2 : 4) : rate.toPrecision(4)
              return (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Price</span>
                  <span className="text-white">
                    1 {fromToken.symbol} = {rateDisplay} {toToken.symbol}
                  </span>
                </div>
              )
            }
            return null
          })()}

          {/* Slippage */}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Slippage</span>
            <span className="text-white">{currentSlippage}%</span>
          </div>

          {/* Minimum Received */}
          {(() => {
            const toNum = parseFloat(toAmount || "0")
            if (toNum > 0) {
              const minReceived = toNum * (1 - currentSlippage / 100)
              const minDisplay = minReceived >= 0.01
                ? minReceived.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })
                : minReceived.toPrecision(4)
              const minUsd = minReceived * (toToken.usdPrice || 0)
              return (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Min. received</span>
                  <span>
                    <span className="text-muted-foreground">
                      {minDisplay} {toToken.symbol}
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
    </TransactionModal>
  )
}
