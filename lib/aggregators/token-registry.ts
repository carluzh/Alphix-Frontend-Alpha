import { getAllTokens as getPoolTokens, resolveTokenIcon } from '../pools-config';
import { getStoredNetworkMode, chainIdForMode, type NetworkMode } from '../network-mode';

export interface TokenInfo {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
}

// Per-chain token maps
const chainTokenMaps = new Map<string, Map<string, TokenInfo>>();

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

// WETH addresses per chain
const WETH_ADDRESSES: Record<string, { address: string; chainId: number }> = {
  base: { address: '0x4200000000000000000000000000000000000006', chainId: 8453 },
  arbitrum: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', chainId: 42161 },
};

function getTokenMapForChain(mode?: NetworkMode): Map<string, TokenInfo> {
  const networkMode = mode ?? getStoredNetworkMode();
  let map = chainTokenMaps.get(networkMode);
  if (map) return map;

  map = new Map<string, TokenInfo>();
  const chainId = chainIdForMode(networkMode);
  const poolTokens = getPoolTokens(networkMode);

  for (const [, token] of Object.entries(poolTokens)) {
    map.set(normalizeAddress(token.address), {
      chainId,
      address: token.address,
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      logoURI: resolveTokenIcon(token.symbol),
    });
  }

  // Kyberswap native ETH alias
  const ethToken = map.get('0x0000000000000000000000000000000000000000');
  if (ethToken) {
    map.set('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', ethToken);
  }

  // WETH
  const weth = WETH_ADDRESSES[networkMode];
  if (weth) {
    map.set(normalizeAddress(weth.address), {
      chainId: weth.chainId,
      address: weth.address,
      name: 'Wrapped Ether',
      symbol: 'WETH',
      decimals: 18,
      logoURI: '/tokens/ETH.png',
    });
  }

  chainTokenMaps.set(networkMode, map);
  return map;
}

// Legacy alias: default tokenMap points at stored mode
const tokenMap = getTokenMapForChain();

const COINGECKO_LIST_URLS: Record<string, string> = {
  base: 'https://tokens.coingecko.com/base/all.json',
  arbitrum: 'https://tokens.coingecko.com/arbitrum-one/all.json',
};

const TOKEN_LIST_CACHE_TTL = 6 * 60 * 60 * 1000;
const tokenListFetchedAt: Record<string, number> = {};
let tokenListPromise: Promise<void> | null = null;

export async function ensureTokenListLoaded(mode?: NetworkMode): Promise<void> {
  const networkMode = mode ?? getStoredNetworkMode();
  const lastFetched = tokenListFetchedAt[networkMode] ?? 0;
  if (Date.now() - lastFetched < TOKEN_LIST_CACHE_TTL) return;
  if (tokenListPromise) return tokenListPromise;

  const listUrl = COINGECKO_LIST_URLS[networkMode];
  if (!listUrl) return;

  const map = getTokenMapForChain(networkMode);
  const chainId = chainIdForMode(networkMode);

  tokenListPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(listUrl, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timeoutId);

      if (!res.ok) return;

      const data = await res.json() as { tokens?: Array<{ address: string; symbol: string; name: string; decimals: number; logoURI?: string }> };
      if (!Array.isArray(data.tokens)) return;

      let added = 0;
      for (const t of data.tokens) {
        const addr = normalizeAddress(t.address);
        if (!map.has(addr)) {
          map.set(addr, {
            chainId,
            address: t.address,
            name: t.name,
            symbol: t.symbol,
            decimals: t.decimals,
            logoURI: t.logoURI,
          });
          added++;
        }
      }

      tokenListFetchedAt[networkMode] = Date.now();
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.warn('[TokenRegistry] CoinGecko fetch failed:', err?.message);
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

const POPULAR_ADDRESSES_BY_CHAIN: Record<string, string[]> = {
  base: [
    '0x0000000000000000000000000000000000000000', // ETH
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0x820c137fa70c8691f0e44dc420a5e53c168921dc', // USDS
    '0x4200000000000000000000000000000000000006', // WETH
  ],
  arbitrum: [
    '0x0000000000000000000000000000000000000000', // ETH
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', // WETH
  ],
};

// Legacy export
export const POPULAR_TOKEN_ADDRESSES = POPULAR_ADDRESSES_BY_CHAIN.base;

export function getPopularTokens(mode?: NetworkMode): TokenInfo[] {
  const networkMode = mode ?? getStoredNetworkMode();
  const addresses = POPULAR_ADDRESSES_BY_CHAIN[networkMode] ?? POPULAR_ADDRESSES_BY_CHAIN.base;
  return addresses
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
