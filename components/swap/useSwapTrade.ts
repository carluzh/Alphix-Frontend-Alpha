import { useEffect, useMemo } from "react"
import { formatUnits, parseUnits } from "viem"

import { getAutoSlippage } from "@/lib/slippage/slippage-api"

import type { Token } from "./swap-interface"
import { useSwapQuote } from "./useSwapQuote"
import { useSwapRoutingFees } from "./useSwapRoutingFees"
import type { SwapRoute } from "@/lib/swap/routing-engine"

export type FeeDetail = {
  name: string
  value: string
  type: "percentage" | "usd"
}

export type CalculatedValues = {
  fromTokenAmount: string
  fromTokenValue: string
  toTokenAmount: string
  toTokenValue: string
  fees: FeeDetail[]
  slippage: string
  minimumReceived: string
}

export type PriceImpactWarning = { severity: "medium" | "high"; message: string } | null

export type ExecutionTradeParams = {
  swapType: "ExactIn" | "ExactOut"
  amountDecimalsStr: string
  limitAmountDecimalsStr: string
  dynamicSwapFee: number | null
  route: SwapRoute | null
}

export type TradeState = "idle" | "loading" | "no_route" | "error" | "ready"

// Uniswap-style: pass a single derived trade model through the component tree.
export type SwapTradeModel = ReturnType<typeof useSwapTrade>

type Args = {
  fromToken: Token
  toToken: Token
  fromAmount: string
  toAmount: string
  setFromAmount: (v: string) => void
  setToAmount: (v: string) => void
  lastEditedSideRef: React.MutableRefObject<"from" | "to">

  tokenDefinitions: Record<string, { address: string }>
  targetChainId: number
  isConnected: boolean
  currentChainId?: number

  currentRoute: SwapRoute | null
  setCurrentRoute: (r: SwapRoute | null) => void
  setSelectedPoolIndexForChart: (n: number) => void

  currentSlippage: number
  isAutoSlippage: boolean
  updateAutoSlippage: (v: number) => void
}

export const formatCurrency = (valueString: string): string => {
  const cleanedString = valueString.replace(/[$,~]/g, "")
  const numberValue = parseFloat(cleanedString)
  if (isNaN(numberValue)) return "$0.00"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numberValue)
}

// Uniswap-aligned token amount formatting
export const formatTokenAmountDisplay = (
  amountString: string,
  tokenOrDecimals?: { decimals: number } | number
): string => {
  try {
    const amount = parseFloat(amountString)
    if (isNaN(amount) || amount === 0) return "0"

    const maxDecimals =
      typeof tokenOrDecimals === "number"
        ? tokenOrDecimals
        : tokenOrDecimals?.decimals ?? 6
    const TOKEN_AMOUNT_DISPLAY_FLOOR = 0.00001

    if (amount > 0 && amount < TOKEN_AMOUNT_DISPLAY_FLOOR) {
      return `< ${TOKEN_AMOUNT_DISPLAY_FLOOR.toFixed(Math.min(5, maxDecimals))}`
    }

    if (amount < 0.1) {
      return amount.toPrecision(Math.min(6, maxDecimals + 1))
    }
    if (amount < 1) {
      const formatted = amount.toFixed(Math.min(5, maxDecimals))
      return parseFloat(formatted).toString()
    }
    if (amount < 10000) {
      const formatted = amount.toFixed(Math.min(2, maxDecimals))
      return parseFloat(formatted).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }

    return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  } catch {
    return amountString
  }
}

export function useSwapTrade({
  fromToken,
  toToken,
  fromAmount,
  toAmount,
  setFromAmount,
  setToAmount,
  lastEditedSideRef,
  tokenDefinitions,
  targetChainId,
  isConnected,
  currentChainId,
  currentRoute,
  setCurrentRoute,
  setSelectedPoolIndexForChart,
  currentSlippage,
  isAutoSlippage,
  updateAutoSlippage,
}: Args) {
  const {
    routeInfo,
    setRouteInfo,
    routeError,
  } = useSwapRoutingFees({
    fromToken,
    toToken,
    tokenDefinitions,
    currentRoute,
    setCurrentRoute,
    setSelectedPoolIndexForChart,
  })

  const { quoteLoading, quoteError, setQuoteError, priceImpact, dynamicFeeBps, clearQuote, refreshBindingQuote } = useSwapQuote({
    fromToken,
    toToken,
    fromAmount,
    toAmount,
    setFromAmount,
    setToAmount,
    lastEditedSideRef,
    setRouteInfo,
    targetChainId,
  })

  const tryParseUnits = (amountStr: string, decimals: number): bigint | null => {
    if (!amountStr) return 0n
    // Preserve the UI's permissive typing (e.g. trailing ".") by treating it as "not ready"
    if (amountStr === "." || amountStr.endsWith(".")) return null
    try {
      return parseUnits(amountStr, decimals)
    } catch {
      return null
    }
  }

  const tradeState: TradeState = useMemo(() => {
    if (!fromAmount && !toAmount) return "idle"

    if (quoteError) return "error"
    if (routeError && !routeError.toLowerCase().includes("no route")) return "error"

    const inParsed = tryParseUnits(fromAmount, fromToken.decimals)
    const outParsed = tryParseUnits(toAmount, toToken.decimals)
    const wantsTrade = (inParsed !== null && inParsed > 0n) || (outParsed !== null && outParsed > 0n)
    if (!wantsTrade) return "idle"

    if (quoteLoading) return "loading"

    if (quoteError) return "error"

    if (!currentRoute || currentRoute.pools.length === 0) return "no_route"
    if (routeError && routeError.toLowerCase().includes("no route")) return "no_route"

    const hasQuote = inParsed !== null && inParsed > 0n && outParsed !== null && outParsed > 0n
    if (!hasQuote) return "loading"

    if (dynamicFeeBps === null) return "loading"

    return "ready"
  }, [
    currentRoute,
    dynamicFeeBps,
    routeError,
    fromAmount,
    fromToken.decimals,
    quoteError,
    quoteLoading,
    toAmount,
    toToken.decimals,
  ])

  const tradeError: string | null = useMemo(() => {
    if (tradeState !== "error" && tradeState !== "no_route") return null
    if (tradeState === "no_route") return "No route found"
    return quoteError || routeError || "Trade error"
  }, [routeError, quoteError, tradeState])

  const execution: ExecutionTradeParams = useMemo(() => {
    const swapType: ExecutionTradeParams["swapType"] = lastEditedSideRef.current === "to" ? "ExactOut" : "ExactIn"
    const amountDecimalsStr = swapType === "ExactOut" ? toAmount : fromAmount

    // Slippage-adjusted limit amount for build-tx.
    // For ExactIn: limit is minimum output.
    // For ExactOut: limit is maximum input.
    let limitAmountDecimalsStr = "0"
    try {
      const toDecimals = toToken.decimals
      const fromDecimals = fromToken.decimals
      const quotedOutBigInt = parseUnits(toAmount || "0", toDecimals)
      const quotedInBigInt = parseUnits(fromAmount || "0", fromDecimals)
      const minOutBigInt = (quotedOutBigInt * BigInt(Math.floor((100 - currentSlippage) * 100))) / BigInt(10000)
      const maxInBigInt = (quotedInBigInt * BigInt(Math.floor((100 + currentSlippage) * 100))) / BigInt(10000)
      limitAmountDecimalsStr =
        swapType === "ExactOut" ? formatUnits(maxInBigInt, fromDecimals) : formatUnits(minOutBigInt, toDecimals)
    } catch {
      const quotedOutNum = parseFloat(toAmount || "0")
      const quotedInNum = parseFloat(fromAmount || "0")
      const minOut = quotedOutNum > 0 ? quotedOutNum * (1 - currentSlippage / 100) : 0
      const maxIn = quotedInNum > 0 ? quotedInNum * (1 + currentSlippage / 100) : 0
      limitAmountDecimalsStr = swapType === "ExactOut" ? String(maxIn) : String(minOut)
    }

    return {
      swapType,
      amountDecimalsStr,
      limitAmountDecimalsStr,
      dynamicSwapFee: dynamicFeeBps,
      route: currentRoute,
    }
  }, [currentRoute, currentSlippage, dynamicFeeBps, fromAmount, fromToken.decimals, lastEditedSideRef, toAmount, toToken.decimals])

  // Auto-slippage: update when we have a fresh quote (Uniswap-style derived risk control)
  useEffect(() => {
    if (!isAutoSlippage) return
    if (!fromAmount || !toAmount || quoteError) return
    if (!fromToken || !toToken) return

    getAutoSlippage({
      sellToken: fromToken.address,
      buyToken: toToken.address,
      chainId: currentChainId || targetChainId,
      fromAmount,
      toAmount,
      fromTokenSymbol: fromToken.symbol,
      toTokenSymbol: toToken.symbol,
      routeHops: routeInfo?.hops || 1,
    })
      .then((calculated) => updateAutoSlippage(calculated))
      .catch((error) => console.error("[useSwapTrade] Failed to fetch auto-slippage:", error))
  }, [
    currentChainId,
    fromAmount,
    fromToken,
    isAutoSlippage,
    quoteError,
    routeInfo?.hops,
    targetChainId,
    toAmount,
    toToken,
    updateAutoSlippage,
  ])

  const calculatedValues: CalculatedValues = useMemo(() => {
    const fromValueNum = parseFloat(fromAmount || "0")
    const fromTokenUsdPrice = fromToken.usdPrice || 0
    const canQuoteOnTargetChain = currentChainId === targetChainId || !isConnected

    if (quoteError) {
      return {
        fromTokenAmount: formatTokenAmountDisplay(fromAmount),
        fromTokenValue: formatCurrency(
          String(!isNaN(fromValueNum) && fromValueNum >= 0 && fromTokenUsdPrice ? fromValueNum * fromTokenUsdPrice : 0)
        ),
        toTokenAmount: formatTokenAmountDisplay(toAmount),
        toTokenValue: formatCurrency("0"),
        fees: [{ name: "Fee", value: "-", type: "percentage" }],
        slippage: "-",
        minimumReceived: "-",
      }
    }

    const updatedFeesArray: FeeDetail[] = []

    if (canQuoteOnTargetChain) {
      if (quoteLoading) {
        updatedFeesArray.push({ name: "Fee", value: "...", type: "percentage" })
      } else if (routeError) {
        updatedFeesArray.push({
          name: "Fee",
          value: routeError.includes("No route") ? "No Route Available" : "Fee N/A",
          type: "percentage",
        })
      } else if (dynamicFeeBps !== null) {
        updatedFeesArray.push({
          name: "Fee",
          value: `${(dynamicFeeBps / 100).toFixed(2)}%`,
          type: "percentage",
        })
      } else {
        updatedFeesArray.push({ name: "Fee", value: "N/A", type: "percentage" })
      }
    } else {
      updatedFeesArray.push({ name: "Fee", value: "N/A", type: "percentage" })
    }

    if (fromValueNum > 0 && canQuoteOnTargetChain && dynamicFeeBps !== null) {
      const feeRate = dynamicFeeBps / 100
      const totalFeeInUsd = fromValueNum * fromTokenUsdPrice * (feeRate / 100)
      const feeValueDisplay =
        totalFeeInUsd > 0 && totalFeeInUsd < 0.01 ? "< $0.01" : formatCurrency(totalFeeInUsd.toString())
      updatedFeesArray.push({
        name: "Fee Value (USD)",
        value: feeValueDisplay,
        type: "usd",
      })
    }

    const newFromTokenValue =
      !isNaN(fromValueNum) && fromValueNum >= 0 && fromToken.usdPrice ? fromValueNum * fromToken.usdPrice : 0
    const toValueNum = parseFloat(toAmount)
    const newToTokenValue = !isNaN(toValueNum) && toValueNum >= 0 && toToken.usdPrice ? toValueNum * toToken.usdPrice : 0

    const quotedAmount = parseFloat(toAmount || "0")
    const minReceivedAmount = quotedAmount > 0 ? quotedAmount * (1 - currentSlippage / 100) : 0

    return {
      fromTokenAmount: formatTokenAmountDisplay(fromAmount),
      fromTokenValue: formatCurrency(newFromTokenValue.toString()),
      toTokenAmount: formatTokenAmountDisplay(toAmount),
      toTokenValue: formatCurrency(newToTokenValue.toString()),
      fees: updatedFeesArray,
      slippage: `${currentSlippage}%`,
      minimumReceived: formatTokenAmountDisplay(minReceivedAmount.toString()),
    }
  }, [
    currentChainId,
    currentSlippage,
    dynamicFeeBps,
    routeError,
    quoteLoading,
    fromAmount,
    fromToken.usdPrice,
    isConnected,
    quoteError,
    targetChainId,
    toAmount,
    toToken.usdPrice,
  ])

  const priceImpactWarning: PriceImpactWarning = useMemo(() => {
    if (priceImpact === null) return null
    if (priceImpact >= 5) return { severity: "high", message: `Very high price impact: ${priceImpact.toFixed(2)}%` }
    if (priceImpact >= 3) return { severity: "medium", message: `High price impact: ${priceImpact.toFixed(2)}%` }
    return null
  }, [priceImpact])

  return {
    quoteLoading,
    quoteError,
    setQuoteError,
    clearQuote,
    refreshBindingQuote,
    priceImpact,
    priceImpactWarning,

    routeInfo,
    setRouteInfo,
    dynamicFeeBps,

    calculatedValues,

    formatCurrency,
    formatTokenAmountDisplay,

    execution,

    tradeState,
    tradeError,
  }
}


