/**
 * swapRouteHelpers - Pure helper functions for swap route resolution and parsing.
 *
 * Extracted from the former SwapRouteDisplay component. Only the helpers are
 * used by SwapRoutePreview; the UI component was dead code and has been removed.
 */

import { getToken, resolveTokenIcon as resolveTokenIconBySymbol } from "@/lib/pools-config"
import type { NetworkMode } from "@/lib/network-mode"
import type { KyberswapRouteSummary } from "@/lib/aggregators/types"
import type { Token } from "./swap-interface"
import type { RouteTokenMetadata } from "./useSwapQuote"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a token symbol to its icon path using from/to tokens, server metadata, or static assets */
export function resolveTokenIcon(
  symbol: string,
  fromToken: Token,
  toToken: Token,
  iconMap?: Record<string, string>,
): string {
  if (symbol === fromToken.symbol) return fromToken.icon
  if (symbol === toToken.symbol) return toToken.icon
  // Check server-provided icon map (CoinGecko logos from token registry)
  if (iconMap?.[symbol]) return iconMap[symbol]
  // Static icon lookup by symbol (chain-independent)
  return resolveTokenIconBySymbol(symbol)
}

/**
 * Build a best-effort address → symbol map for Kyberswap route steps.
 * Merges from/to tokens, pools-config, and optional server-provided token metadata.
 */
export function buildAddressSymbolMap(
  fromToken: Token,
  toToken: Token,
  serverMetadata?: RouteTokenMetadata,
  networkMode?: NetworkMode,
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
    const t = getToken(sym, networkMode)
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
