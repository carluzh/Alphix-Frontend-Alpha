"use client"

/**
 * SwapRouteDisplay - Compact route visualization for the swap wizard modal.
 *
 * Shows the full swap path for both Alphix pool routes and Kyberswap
 * aggregator routes, including split-route percentages when applicable.
 */

import { useState, useMemo } from "react"
import { ChevronRight, ChevronDown, ChevronUp } from "lucide-react"
import { TokenImage } from "@/components/ui/token-image"
import { cn } from "@/lib/utils"
import { getToken } from "@/lib/pools-config"
import type { KyberswapRouteSummary, KyberswapRouteStep } from "@/lib/aggregators/types"
import type { AggregatorSource } from "@/lib/aggregators/types"
import type { Token } from "./swap-interface"
import type { RouteTokenMetadata } from "./useSwapQuote"

interface RouteInfo {
  path: string[]
  hops: number
  isDirectRoute: boolean
  pools: string[]
}

interface SwapRouteDisplayProps {
  source: AggregatorSource
  fromToken: Token
  toToken: Token
  routeInfo?: RouteInfo | null
  kyberswapRouteSummary?: KyberswapRouteSummary
  tokenMetadata?: RouteTokenMetadata
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a token symbol to its icon path using pools-config, from/to tokens, or server metadata */
export function resolveTokenIcon(
  symbol: string,
  fromToken: Token,
  toToken: Token,
  iconMap?: Record<string, string>,
): string {
  if (symbol === fromToken.symbol) return fromToken.icon
  if (symbol === toToken.symbol) return toToken.icon
  // Check pools-config for known tokens (ETH, USDC, USDS, WETH)
  const poolToken = getToken(symbol)
  if (poolToken?.icon) return poolToken.icon
  // Check server-provided icon map (CoinGecko logos from token registry)
  if (iconMap?.[symbol]) return iconMap[symbol]
  return "/placeholder-logo.svg"
}

/**
 * Build a best-effort address → symbol map for Kyberswap route steps.
 * Merges from/to tokens, pools-config, and optional server-provided token metadata.
 */
export function buildAddressSymbolMap(
  fromToken: Token,
  toToken: Token,
  serverMetadata?: RouteTokenMetadata,
): Record<string, string> {
  const map: Record<string, string> = {}

  // Server-provided metadata first (most complete, from CoinGecko token list)
  if (serverMetadata) {
    for (const [addr, meta] of Object.entries(serverMetadata)) {
      map[addr.toLowerCase()] = meta.symbol
    }
  }

  // From/to tokens (override server data — these are authoritative)
  map[fromToken.address.toLowerCase()] = fromToken.symbol
  map[toToken.address.toLowerCase()] = toToken.symbol

  // Known addresses from pools-config
  const knownSymbols = ["ETH", "USDC", "USDS", "WETH"]
  for (const sym of knownSymbols) {
    const t = getToken(sym)
    if (t) map[t.address.toLowerCase()] = t.symbol
  }

  // Kyberswap native ETH address
  map["0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"] = "ETH"
  map["0x0000000000000000000000000000000000000000"] = "ETH"

  return map
}

/**
 * Build a symbol → logoURI map from server metadata for icon resolution
 */
export function buildIconMap(serverMetadata?: RouteTokenMetadata): Record<string, string> {
  const map: Record<string, string> = {}
  if (!serverMetadata) return map
  for (const meta of Object.values(serverMetadata)) {
    if (meta.logoURI) map[meta.symbol] = meta.logoURI
  }
  return map
}

/** Resolve a Kyberswap address to a symbol using the map, with truncated address fallback */
export function resolveAddress(address: string, map: Record<string, string>): string {
  return map[address.toLowerCase()] || `${address.slice(0, 6)}...${address.slice(-4)}`
}

/** Parse a split route into a displayable structure */
export interface ParsedSplitRoute {
  percentage: number
  path: string[] // token symbols
  exchanges: string[] // DEX names per hop
}

export function parseSplitRoutes(
  routeSummary: KyberswapRouteSummary,
  addressMap: Record<string, string>,
): ParsedSplitRoute[] {
  const totalAmountIn = BigInt(routeSummary.amountIn || "0")
  if (totalAmountIn === 0n) return []

  return routeSummary.route.map((splitSteps) => {
    if (splitSteps.length === 0) return { percentage: 0, path: [], exchanges: [] }

    const firstStepAmount = BigInt(splitSteps[0].swapAmount || "0")
    const percentage = Number((firstStepAmount * 10000n) / totalAmountIn) / 100

    const path: string[] = [resolveAddress(splitSteps[0].tokenIn, addressMap)]
    const exchanges: string[] = []

    for (const step of splitSteps) {
      path.push(resolveAddress(step.tokenOut, addressMap))
      exchanges.push(step.exchange || "Unknown")
    }

    return { percentage, path, exchanges }
  })
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Inline token icon chain: [A] → [B] → [C] */
function TokenPathChain({
  symbols,
  fromToken,
  toToken,
  iconSize = 18,
  iconMap,
}: {
  symbols: string[]
  fromToken: Token
  toToken: Token
  iconSize?: number
  iconMap?: Record<string, string>
}) {
  return (
    <div className="flex items-center gap-1">
      {symbols.map((sym, i) => (
        <div key={`${sym}-${i}`} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
          <TokenImage
            src={resolveTokenIcon(sym, fromToken, toToken, iconMap)}
            alt={sym}
            size={iconSize}
          />
          <span className="text-xs text-muted-foreground">{sym}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function SwapRouteDisplay({
  source,
  fromToken,
  toToken,
  routeInfo,
  kyberswapRouteSummary,
  tokenMetadata,
}: SwapRouteDisplayProps) {
  const [expanded, setExpanded] = useState(false)

  const addressMap = useMemo(
    () => buildAddressSymbolMap(fromToken, toToken, tokenMetadata),
    [fromToken, toToken, tokenMetadata],
  )

  const iconMapResolved = useMemo(
    () => buildIconMap(tokenMetadata),
    [tokenMetadata],
  )

  const splitRoutes = useMemo(() => {
    if (source !== "kyberswap" || !kyberswapRouteSummary) return null
    const routes = parseSplitRoutes(kyberswapRouteSummary, addressMap)
    return routes.length > 0 ? routes : null
  }, [source, kyberswapRouteSummary, addressMap])

  const isSplitRoute = splitRoutes && splitRoutes.length > 1

  // Nothing to display if no route info at all
  if (source === "alphix" && !routeInfo) return null
  if (source === "kyberswap" && !splitRoutes && !routeInfo) return null

  return (
    <div className="mx-5 mt-2">
      {/* Header row - clickable to expand split routes */}
      <button
        type="button"
        onClick={() => isSplitRoute && setExpanded((p) => !p)}
        className={cn(
          "flex items-center justify-between w-full text-xs text-muted-foreground",
          isSplitRoute && "cursor-pointer hover:text-muted-foreground/80",
        )}
      >
        <div className="flex items-center gap-1.5">
          <span>Route</span>
          {source === "kyberswap" && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-500/20 text-purple-400 uppercase">
              Kyberswap
            </span>
          )}
          {isSplitRoute && (
            <span className="text-[10px] text-muted-foreground/60">
              {splitRoutes.length} splits
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Compact summary: just from → to icons */}
          {!expanded && (
            <div className="flex items-center gap-1">
              <TokenImage src={fromToken.icon} alt={fromToken.symbol} size={16} />
              <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
              <TokenImage src={toToken.icon} alt={toToken.symbol} size={16} />
            </div>
          )}
          {isSplitRoute && (
            expanded
              ? <ChevronUp className="h-3 w-3" />
              : <ChevronDown className="h-3 w-3" />
          )}
        </div>
      </button>

      {/* Expanded: show full path or split details */}
      {(expanded || !isSplitRoute) && (
        <div className="mt-1.5 space-y-1">
          {/* Alphix route */}
          {source === "alphix" && routeInfo && (
            <div className="space-y-1">
              <TokenPathChain
                symbols={routeInfo.path}
                fromToken={fromToken}
                toToken={toToken}
                iconMap={iconMapResolved}
              />
              {routeInfo.pools.length > 0 && (
                <div className="text-[10px] text-muted-foreground/60 pl-0.5">
                  {routeInfo.pools.join(" → ")}
                </div>
              )}
            </div>
          )}

          {/* Kyberswap single route */}
          {source === "kyberswap" && splitRoutes && !isSplitRoute && (
            <div className="space-y-1">
              <TokenPathChain
                symbols={splitRoutes[0].path}
                fromToken={fromToken}
                toToken={toToken}
                iconMap={iconMapResolved}
              />
              {splitRoutes[0].exchanges.length > 0 && (
                <div className="text-[10px] text-muted-foreground/60 pl-0.5">
                  {[...new Set(splitRoutes[0].exchanges)].join(" → ")}
                </div>
              )}
            </div>
          )}

          {/* Kyberswap split routes */}
          {source === "kyberswap" && isSplitRoute && expanded && (
            <div className="space-y-1.5">
              {splitRoutes.map((split, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md bg-sidebar-accent/50 px-2 py-1.5"
                >
                  <span className="text-[10px] font-medium text-muted-foreground w-9 shrink-0 text-right">
                    {Math.round(split.percentage)}%
                  </span>
                  <div className="flex-1 min-w-0">
                    <TokenPathChain
                      symbols={split.path}
                      fromToken={fromToken}
                      toToken={toToken}
                      iconSize={14}
                      iconMap={iconMapResolved}
                    />
                    {split.exchanges.length > 0 && (
                      <div className="text-[10px] text-muted-foreground/50 mt-0.5 truncate">
                        {[...new Set(split.exchanges)].join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
