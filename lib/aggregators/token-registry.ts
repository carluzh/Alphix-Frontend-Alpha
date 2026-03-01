/**
 * Token Registry - Token Metadata Provider
 *
 * Provides token metadata for route display and decimals lookup.
 * Uses pools-config for known pool tokens, and lazily fetches the CoinGecko
 * Base token list (cached 6h) for all other tokens Kyberswap routes through.
 *
 * For full token balances + metadata, use the Uniswap API at /api/tokens/balances
 */

import { getAllTokens as getPoolTokens, getToken as getPoolToken } from '../pools-config';

export interface TokenInfo {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

// Build lookup map from pools-config (only pool tokens: ETH, USDC, USDS)
const tokenMap = new Map<string, TokenInfo>();

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

// Initialize the token map from pools-config
function initializeTokenMap(): void {
  const poolTokens = getPoolTokens();

  for (const [symbol, token] of Object.entries(poolTokens)) {
    const normalized = normalizeAddress(token.address);
    tokenMap.set(normalized, {
      chainId: 8453, // Base
      address: token.address,
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      logoURI: token.icon,
    });
  }

  // Add the Kyberswap native token address mapping to ETH
  const ethToken = tokenMap.get('0x0000000000000000000000000000000000000000');
  if (ethToken) {
    tokenMap.set('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', ethToken);
  }

  // Add WETH mapping
  tokenMap.set('0x4200000000000000000000000000000000000006', {
    chainId: 8453,
    address: '0x4200000000000000000000000000000000000006',
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    logoURI: '/tokens/ETH.png',
  });
}

// Initialize on module load
initializeTokenMap();

// ---------------------------------------------------------------------------
// Lazy-loaded CoinGecko Base token list (fetched once, cached in-memory)
// ---------------------------------------------------------------------------

const COINGECKO_BASE_LIST_URL = 'https://tokens.coingecko.com/base/all.json';
const TOKEN_LIST_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
let tokenListFetchedAt = 0;
let tokenListPromise: Promise<void> | null = null;

/**
 * Ensure the full Base token list is loaded into the registry.
 * Fetches from CoinGecko once, then serves from cache for 6 hours.
 * Safe to call multiple times — deduplicates concurrent requests.
 */
export async function ensureTokenListLoaded(): Promise<void> {
  if (Date.now() - tokenListFetchedAt < TOKEN_LIST_CACHE_TTL) return;
  if (tokenListPromise) return tokenListPromise;

  tokenListPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(COINGECKO_BASE_LIST_URL, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        console.warn(`[TokenRegistry] CoinGecko list fetch failed: ${res.status}`);
        return;
      }

      const data = await res.json() as { tokens?: Array<{ chainId?: number; address: string; symbol: string; name: string; decimals: number; logoURI?: string }> };
      const tokens = data.tokens;
      if (!Array.isArray(tokens)) return;

      let added = 0;
      for (const t of tokens) {
        const addr = normalizeAddress(t.address);
        // Don't overwrite pool tokens (they have local icons)
        if (!tokenMap.has(addr)) {
          tokenMap.set(addr, {
            chainId: 8453,
            address: t.address,
            name: t.name,
            symbol: t.symbol,
            decimals: t.decimals,
            logoURI: t.logoURI,
          });
          added++;
        }
      }

      tokenListFetchedAt = Date.now();
      console.log(`[TokenRegistry] Loaded ${added} tokens from CoinGecko Base list (${tokenMap.size} total)`);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.warn('[TokenRegistry] Failed to fetch CoinGecko token list:', err?.message);
      }
    } finally {
      tokenListPromise = null;
    }
  })();

  return tokenListPromise;
}

/**
 * Initialize the token registry (no-op, kept for API compatibility)
 */
export function initTokenRegistry(): void {
  // No-op
}

/**
 * Get full token info by address
 */
export async function getTokenInfo(address: string): Promise<TokenInfo | null> {
  return getTokenInfoSync(address);
}

/**
 * Get token info synchronously
 * Returns null for unknown tokens (caller should handle gracefully)
 */
export function getTokenInfoSync(address: string): TokenInfo | null {
  return tokenMap.get(normalizeAddress(address)) || null;
}

/**
 * Get token symbol by address
 * Returns shortened address if not found
 */
export function getTokenSymbol(address: string): string {
  const info = getTokenInfoSync(address);
  if (info) {
    return info.symbol;
  }
  // Return shortened address for unknown tokens
  const normalized = normalizeAddress(address);
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

/**
 * Get token logo URL by address
 */
export function getTokenLogoURI(address: string): string | undefined {
  const info = getTokenInfoSync(address);
  return info?.logoURI;
}

/**
 * Get token decimals by address
 * Returns null for unknown tokens (caller should default to 18)
 */
export function getTokenDecimals(address: string): number | null {
  const info = getTokenInfoSync(address);
  return info?.decimals ?? null;
}

/**
 * Convert route addresses to symbols for display
 */
export function routeAddressesToSymbols(addresses: string[]): string[] {
  return addresses.map(getTokenSymbol);
}

/**
 * Check if we have metadata for a token
 */
export function hasTokenInfo(address: string): boolean {
  return getTokenInfoSync(address) !== null;
}

/**
 * Get the token count
 */
export function getTokenCacheSize(): number {
  return tokenMap.size;
}

/**
 * Popular tokens for quick selection UI (pool tokens only)
 */
export const POPULAR_TOKEN_ADDRESSES: string[] = [
  '0x0000000000000000000000000000000000000000', // ETH
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
  '0x820c137fa70c8691f0e44dc420a5e53c168921dc', // USDS
  '0x4200000000000000000000000000000000000006', // WETH
];

/**
 * Get popular tokens for quick selection
 */
export function getPopularTokens(): TokenInfo[] {
  return POPULAR_TOKEN_ADDRESSES
    .map(addr => getTokenInfoSync(addr))
    .filter((t): t is TokenInfo => t !== null);
}

/**
 * Search tokens - returns only pool tokens now
 * For full token search, use Alchemy API
 */
export function searchTokens(query: string, limit = 50): TokenInfo[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results: TokenInfo[] = [];

  // Check if it's an address search
  if (q.startsWith('0x')) {
    const normalized = normalizeAddress(q);
    const exactMatch = tokenMap.get(normalized);
    if (exactMatch) {
      return [exactMatch];
    }
    return [];
  }

  // Symbol/name search
  for (const token of tokenMap.values()) {
    const symbol = token.symbol.toLowerCase();
    const name = token.name.toLowerCase();

    if (symbol.includes(q) || name.includes(q)) {
      results.push(token);
    }

    if (results.length >= limit) break;
  }

  return results;
}

/**
 * Get all tokens from the registry (pool tokens only)
 * For full token list, use Alchemy API
 */
export function getAllTokens(): TokenInfo[] {
  const seen = new Set<string>();
  const tokens: TokenInfo[] = [];

  for (const token of tokenMap.values()) {
    const key = `${token.symbol}-${token.address.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(token);
    }
  }

  return tokens;
}

/**
 * Get token count
 */
export async function getTokenCount(): Promise<number> {
  return tokenMap.size;
}
