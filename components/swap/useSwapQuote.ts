import { createElement, useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { IconCircleXmarkFilled } from "nucleo-micro-bold-essential"
import { MAINNET_CHAIN_ID } from "@/lib/network-mode"
import { POLLING_INTERVAL_L2_MS } from "@/hooks/usePollingIntervalByChain"

export type QuoteMode = "indicative" | "binding"

type Args = {
  fromToken: { symbol: string; address: string } | null
  toToken: { symbol: string; address: string } | null
  fromAmount: string
  toAmount: string
  setFromAmount: (v: string) => void
  setToAmount: (v: string) => void
  lastEditedSideRef: React.MutableRefObject<"from" | "to">
  setRouteInfo: (routeInfo: any | null) => void
  targetChainId: number
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
}: Args) {
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [priceImpact, setPriceImpact] = useState<number | null>(null)
  const [dynamicFeeBps, setDynamicFeeBps] = useState<number | null>(null)
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
            network: targetChainId === MAINNET_CHAIN_ID ? 'mainnet' : 'testnet',
            debug: true,
            binding: mode === "binding",
            // cache-bust only for binding; harmless if backend ignores
            _t: mode === "binding" ? Date.now() : undefined,
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
            setFromAmount(String(data.fromAmount ?? ""))
          } else {
            setToAmount(String(data.toAmount ?? ""))
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
          toast.error("Quote Error", {
            icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
            description: "No Quote received. Input a smaller amount and try again.",
            action: {
              label: "Open Ticket",
              onClick: () => window.open("https://discord.com/invite/NTXRarFbTr", "_blank"),
            },
          })
        }

        setQuoteError(errorMsg)
        setPriceImpact(null)
        setDynamicFeeBps(null)
      } catch (error: any) {
        if (error?.name === "AbortError") return
        console.error("❌ V4 Quoter Exception:", error)
        if (requestId !== requestIdRef.current) return

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
          } else if (errorStr.includes("network") || errorStr.includes("connection") || errorStr.includes("timeout")) {
            errorMsg = "Network error - please try again"
            toastDescription = "Network error while fetching quote. Please try again."
          } else if (errorStr.includes("fetch") || errorStr.includes("http")) {
            errorMsg = "Connection error - please try again"
            toastDescription = "Network error while fetching quote. Please try again."
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

  // S10: Quote polling - refresh every 3s (L2) like Uniswap
  // @see interface/packages/uniswap/src/features/transactions/swap/hooks/useTrade/useTradeQuery.ts
  useEffect(() => {
    // Skip polling if no tokens or loading
    if (!fromToken || !toToken) return
    if (quoteLoading) return

    // Get the current amount to poll
    const amountStr = lastEditedSideRef.current === "to" ? toAmount : fromAmount
    if (!amountStr || parseFloat(amountStr) <= 0) return

    const interval = setInterval(() => {
      fetchQuote(amountStr, "indicative")
    }, POLLING_INTERVAL_L2_MS) // 3000ms for L2 (Base)

    return () => clearInterval(interval)
  }, [fromToken, toToken, fromAmount, toAmount, fetchQuote, quoteLoading])

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
  }, [])

  return {
    quoteLoading,
    quoteError,
    setQuoteError,
    priceImpact,
    dynamicFeeBps,
    clearQuote,
    refreshBindingQuote,
  }
}


