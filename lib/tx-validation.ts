import { chainIdForMode, type NetworkMode } from './network-mode';

function getExpectedChainId(networkMode: NetworkMode): number {
  return chainIdForMode(networkMode);
}

export function validateChainId(chainId: number, networkMode: NetworkMode): string | null {
  const expected = getExpectedChainId(networkMode);
  if (chainId !== expected) {
    return `Chain ID mismatch: got ${chainId}, expected ${expected} for ${networkMode}`;
  }
  return null;
}

// Simple in-memory rate limiter for transaction APIs (per-IP)
const txRateLimits = new Map<string, { count: number; resetAt: number }>();
const TX_RATE_LIMIT = 10; // max requests
const TX_RATE_WINDOW_MS = 60_000; // per minute

export function checkTxRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = txRateLimits.get(ip);

  if (!record || now > record.resetAt) {
    txRateLimits.set(ip, { count: 1, resetAt: now + TX_RATE_WINDOW_MS });
    return { allowed: true };
  }

  if (record.count >= TX_RATE_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((record.resetAt - now) / 1000) };
  }

  record.count++;
  return { allowed: true };
}
