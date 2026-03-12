import { createElement, useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { IconCircleXmarkFilled } from "nucleo-micro-bold-essential"
import { BASE_CHAIN_ID, ARBITRUM_CHAIN_ID } from "@/lib/network-mode"

import type { AggregatorSource, KyberswapRouteSummary } from "@/lib/aggregators/types"

export type QuoteMode = "indicative" | "binding"

// Token metadata map returned from the server for Kyberswap route display
export type RouteTokenMetadata = Record<string, { symbol: string; logoURI?: string }>

// Kyberswap data returned from quote API when source is 'kyberswap'
export type KyberswapQuoteData = {
  routerAddress: string
  encodedSwapData?: string
  routeSummary?: KyberswapRouteSummary
  tokenMetadata?: RouteTokenMetadata
}

type Args = {
  fromToken: { symbol: string; address: string; decimals: number } | null
  toToken: { symbol: string; address: string; decimals: number } | null
  fromAmount: string
  toAmount: string
  setFromAmount: (v: string) => void
  setToAmount: (v: string) => void
  lastEditedSideRef: React.MutableRefObject<"from" | "to">
  setRouteInfo: (routeInfo: any | null) => void
  targetChainId: number
  // Aggregator integration params
  userAddress?: string // For Kyberswap executable calldata
  slippageBps?: number // Slippage tolerance in basis points
}

export function useSwapQuote({
  fromToken,
  toToken,
  fromAmount,
  toAmount,
  setFromAmount,
  setToAmount,
  lastEditedSideRef,
  setRouteInfo,
  targetChainId,
  userAddress,
  slippageBps = 50,
}: Args) {
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [priceImpact, setPriceImpact] = useState<number | null>(null)
  const [dynamicFeeBps, setDynamicFeeBps] = useState<number | null>(null)
  // Aggregator integration state
  const [source, setSource] = useState<AggregatorSource>("alphix")
  const [kyberswapData, setKyberswapData] = useState<KyberswapQuoteData | null>(null)
  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const fetchQuote = useCallback(
    async (amountStr: string, mode: QuoteMode = "indicative") => {
      const requestId = ++requestIdRef.current
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      if (!fromToken || !toToken) {
        if (requestId !== requestIdRef.current) return
        setToAmount("")
        setQuoteLoading(false)
        setQuoteError(null)
        setPriceImpact(null)
        setDynamicFeeBps(null)
        return
      }

      const parsed = parseFloat(amountStr)
      const isZeroOrInvalid = isNaN(parsed) || parsed <= 0
      if (isZeroOrInvalid) {
        if (requestId !== requestIdRef.current) return
        setToAmount("0")
        setQuoteLoading(false)
        setQuoteError(null)
        setPriceImpact(null)
        setDynamicFeeBps(null)
        return
      }

      setQuoteLoading(true)
      setQuoteError(null)

      try {
        const response = await fetch("/api/swap/get-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: mode === "binding" ? "no-store" : "default",
          body: JSON.stringify({
            fromTokenSymbol: fromToken.symbol,
            toTokenSymbol: toToken.symbol,
            amountDecimalsStr: amountStr,
            swapType: lastEditedSideRef.current === "to" ? "ExactOut" : "ExactIn",
            chainId: targetChainId,
            network: targetChainId === ARBITRUM_CHAIN_ID ? 'arbitrum' : 'base',
            debug: true,
            binding: mode === "binding",
            // cache-bust only for binding; harmless if backend ignores
            _t: mode === "binding" ? Date.now() : undefined,
            // Aggregator integration params
            userAddress,                          // For Kyberswap executable calldata
            slippageBps,                          // Slippage tolerance for comparison
            fromTokenAddress: fromToken.address,  // Token addresses for Kyberswap
            toTokenAddress: toToken.address,
            fromTokenDecimals: fromToken.decimals, // Decimals for proper amount conversion
            toTokenDecimals: toToken.decimals,
          }),
          signal: controller.signal,
        })

        let data: any = null
        try {
          data = await response.json()
        } catch {
          const text = await response.text().catch(() => "")
          console.error("❌ V4 Quoter Non-JSON response:", text?.slice(0, 200))
          data = { success: false, error: "Failed to get quote" }
        }

        if (response.ok && data.success) {
          if (requestId !== requestIdRef.current) return
          if (data.swapType === "ExactOut") {
            let amt = String(data.fromAmount ?? "")
            if (amt.length > 16) amt = amt.slice(0, 16).replace(/\.$/, '')
            setFromAmount(amt)
          } else {
            let amt = String(data.toAmount ?? "")
            if (amt.length > 16) amt = amt.slice(0, 16).replace(/\.$/, '')
            setToAmount(amt)
          }

          setRouteInfo(data.route || null)

          if (data.priceImpact !== undefined) {
            const impactValue = parseFloat(data.priceImpact)
            setPriceImpact(Number.isFinite(impactValue) ? impactValue : null)
          } else {
            setPriceImpact(null)
          }

          if (data.dynamicFeeBps !== undefined && data.dynamicFeeBps !== null) {
            setDynamicFeeBps(data.dynamicFeeBps)
          } else {
            setDynamicFeeBps(null)
          }

          // Store aggregator source and Kyberswap data
          setSource(data.source || "alphix")
          if (data.source === "kyberswap" && data.kyberswapData) {
            setKyberswapData(data.kyberswapData)
          } else {
            setKyberswapData(null)
          }

          setQuoteError(null)
          return
        }

        const errorMsg = data.error || "Failed to get quote"
        console.error("❌ V4 Quoter Error:", errorMsg)
        if (requestId !== requestIdRef.current) return

        if (errorMsg === "Amount exceeds available liquidity") {
          toast.error("Quote Error", {
            icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
            description: "Not enough liquidity. Try a smaller amount.",
            action: {
              label: "Open Ticket",
              onClick: () => window.open("https://discord.com/invite/NTXRarFbTr", "_blank"),
            },
          })
        } else if (errorMsg === "Cannot fulfill exact output amount") {
          toast.error("Quote Error", {
            icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
            description: "Exact Output failed. Reduce the amount or use exact input instead.",
            action: {
              label: "Open Ticket",
              onClick: () => window.open("https://discord.com/invite/NTXRarFbTr", "_blank"),
            },
          })
        } else {
          // Generic / transient server error — silently let polling retry
          console.warn("⏳ Transient quote server error, will retry on next poll:", errorMsg)
          return
        }

        setQuoteError(errorMsg)
        setPriceImpact(null)
        setDynamicFeeBps(null)
      } catch (error: any) {
        if (error?.name === "AbortError") return
        console.error("❌ V4 Quoter Exception:", error)
        if (requestId !== requestIdRef.current) return

        // Classify the error: transient network/timeout errors are silently retried
        // by the 10s polling loop. Only business errors get toasts.
        let isTransient = false

        if (error instanceof Error) {
          const errorStr = error.message.toLowerCase()
          if (
            errorStr.includes("network") || errorStr.includes("connection") ||
            errorStr.includes("timeout") || errorStr.includes("fetch") ||
            errorStr.includes("http") || errorStr.includes("failed to fetch") ||
            errorStr.includes("load failed") || errorStr.includes("aborted")
          ) {
            isTransient = true
          }
        }

        if (isTransient) {
          // Silently skip — polling will retry in ~10s, or user can click Swap
          console.warn("⏳ Transient quote error, will retry on next poll:", error?.message)
          return
        }

        let errorMsg = "Failed to fetch quote"
        let toastDescription = "No Quote received. Input a smaller amount and try again."

        if (error instanceof Error) {
          const errorStr = error.message.toLowerCase()
          if (
            errorStr.includes("call_exception") ||
            errorStr.includes("call revert exception") ||
            errorStr.includes("0x6190b2b0") ||
            errorStr.includes("0x486aa307")
          ) {
            if (lastEditedSideRef.current === "to") {
              errorMsg = "Amount exceeds available liquidity"
              toastDescription = "Not enough liquidity. Try a smaller amount."
            } else {
              errorMsg = "Not enough liquidity"
              toastDescription = "No Quote received. Input a smaller amount and try again."
            }
          }
        }

        toast.error("Quote Error", {
          icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
          description: toastDescription,
          action: {
            label: "Open Ticket",
            onClick: () => window.open("https://discord.com/invite/NTXRarFbTr", "_blank"),
          },
        })

        setQuoteError(errorMsg)
        setPriceImpact(null)
        setDynamicFeeBps(null)
      } finally {
        if (requestId === requestIdRef.current) setQuoteLoading(false)
      }
    },
    [fromToken?.symbol, toToken?.symbol, fromToken?.address, toToken?.address, targetChainId]
  )

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // Debounced auto-quote for Sell edits (ExactIn)
  useEffect(() => {
    if (lastEditedSideRef.current !== "from") return
    const handler = setTimeout(() => {
      if (fromAmount === "" || parseFloat(fromAmount) === 0) {
        setToAmount("")
        setQuoteLoading(false)
        setQuoteError(null)
        setPriceImpact(null)
        setDynamicFeeBps(null)
        return
      }
      fetchQuote(fromAmount, "indicative")
    }, 300)
    return () => clearTimeout(handler)
  }, [fromAmount, fetchQuote])

  // Debounced auto-quote for Buy edits (ExactOut)
  useEffect(() => {
    if (lastEditedSideRef.current !== "to") return
    const handler = setTimeout(() => {
      if (toAmount === "" || parseFloat(toAmount) === 0) {
        setQuoteLoading(false)
        setQuoteError(null)
        setPriceImpact(null)
        setDynamicFeeBps(null)
        return
      }
      fetchQuote(toAmount, "indicative")
    }, 300)
    return () => clearTimeout(handler)
  }, [toAmount, fetchQuote])

  const refreshBindingQuote = useCallback(async () => {
    const amountStr = lastEditedSideRef.current === "to" ? toAmount : fromAmount
    if (!amountStr || parseFloat(amountStr) <= 0) return false
    await fetchQuote(amountStr, "binding")
    return true
  }, [fetchQuote, fromAmount, toAmount])

  const clearQuote = useCallback(() => {
    setQuoteError(null)
    setPriceImpact(null)
    setDynamicFeeBps(null)
    setSource("alphix")
    setKyberswapData(null)
  }, [])

  return {
    quoteLoading,
    quoteError,
    setQuoteError,
    priceImpact,
    dynamicFeeBps,
    clearQuote,
    refreshBindingQuote,
    // Aggregator integration
    source,
    kyberswapData,
  }
}


