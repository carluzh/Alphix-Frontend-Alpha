// Network mode utilities - SSR-safe (no "use client" directive)
// This file can be imported by both client and server code

import { CHAIN_REGISTRY, ALL_MODES } from './chain-registry';

/**
 * NetworkMode identifies which chain the app is operating on.
 * 'base' = Base (8453), 'arbitrum' = Arbitrum One (42161)
 */
export type NetworkMode = 'base' | 'arbitrum';

// Chain IDs — derived from registry for backwards compatibility
export const BASE_CHAIN_ID = CHAIN_REGISTRY.base.chainId;       // 8453
export const ARBITRUM_CHAIN_ID = CHAIN_REGISTRY.arbitrum.chainId; // 42161

/** All supported chain IDs */
export const SUPPORTED_CHAIN_IDS = ALL_MODES.map(m => CHAIN_REGISTRY[m].chainId);

/** Map NetworkMode to chain ID */
export function chainIdForMode(mode: NetworkMode): number {
  return CHAIN_REGISTRY[mode].chainId;
}

/** Map chain ID to NetworkMode */
export function modeForChainId(chainId: number): NetworkMode | null {
  const found = ALL_MODES.find(m => CHAIN_REGISTRY[m].chainId === chainId);
  return found ?? null;
}

/** Human-readable chain name for a network mode */
export function getChainDisplayName(mode: NetworkMode): string {
  return CHAIN_REGISTRY[mode].displayName;
}

/** Apollo/GraphQL chain label (e.g. 'BASE', 'ARBITRUM') */
export function apolloChainForMode(mode: NetworkMode): string {
  return CHAIN_REGISTRY[mode].apolloChain;
}

/** Backend network param (e.g. 'base', 'arbitrum') */
export function backendNetworkForMode(mode: NetworkMode): string {
  return CHAIN_REGISTRY[mode].backendNetwork;
}

/** Parse an untrusted string into a NetworkMode, defaulting to 'base' */
export function parseNetworkMode(value: string | null | undefined): NetworkMode {
  if (value && ALL_MODES.includes(value as NetworkMode)) return value as NetworkMode;
  return 'base';
}

// =============================================================================
// API REQUEST RESOLUTION
// =============================================================================

/**
 * Resolve NetworkMode from a Next.js API request.
 *
 * Resolution order (first match wins):
 * 1. body.chainId  → modeForChainId()   (most reliable — comes from the entity being acted on)
 * 2. body.networkMode → parseNetworkMode()
 * 3. query.networkMode or query.network → parseNetworkMode()
 * 4. Cookie header → getNetworkModeFromCookies()
 * 5. Default: 'base'
 *
 * Usage in any API route:
 *   import { resolveNetworkMode } from '@/lib/network-mode';
 *   const networkMode = resolveNetworkMode(req);
 */
export function resolveNetworkMode(req: {
  body?: Record<string, unknown>;
  query?: Record<string, string | string[] | undefined>;
  headers?: { cookie?: string };
}): NetworkMode {
  // 1. Explicit chainId in body (most reliable — derived from the pool/position being acted on)
  const bodyChainId = req.body?.chainId != null ? Number(req.body.chainId) : undefined;
  if (bodyChainId && !isNaN(bodyChainId)) {
    const mode = modeForChainId(bodyChainId);
    if (mode) return mode;
  }

  // 2. Explicit networkMode in body
  if (typeof req.body?.networkMode === 'string') {
    return parseNetworkMode(req.body.networkMode);
  }

  // 3. Query parameter (networkMode or network)
  const queryMode = req.query?.networkMode ?? req.query?.network;
  if (typeof queryMode === 'string' && queryMode) {
    return parseNetworkMode(queryMode);
  }

  // 4. Cookie fallback
  const cookieMode = getNetworkModeFromCookies(req.headers?.cookie);
  if (cookieMode) return cookieMode;

  // 5. Default
  return 'base';
}

export const NETWORK_STORAGE_KEY = 'alphix-network-mode';
export const NETWORK_COOKIE_NAME = 'alphix-network-mode';

/**
 * Parse network mode from a cookie string (for server-side usage)
 */
export function getNetworkModeFromCookies(cookieString: string | undefined | null): NetworkMode | null {
  if (!cookieString) return null;
  const match = cookieString.match(new RegExp(`(?:^|;\\s*)${NETWORK_COOKIE_NAME}=([^;]*)`));
  if (match && ALL_MODES.includes(match[1] as NetworkMode)) {
    return match[1] as NetworkMode;
  }
  return null;
}

export function getStoredNetworkMode(): NetworkMode {
  if (typeof window === 'undefined') return 'base';
  try {
    const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
    return parseNetworkMode(stored);
  } catch {}
  return 'base';
}

export function getStoredChainId(): number {
  return chainIdForMode(getStoredNetworkMode());
}

// Re-export registry types and values for convenience
export { CHAIN_REGISTRY, ALL_MODES } from './chain-registry';
