import { isAddress } from 'viem';
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID, type NetworkMode } from './network-mode';

export function getExpectedChainId(networkMode: NetworkMode): number {
  return networkMode === 'mainnet' ? MAINNET_CHAIN_ID : TESTNET_CHAIN_ID;
}

export function validateChainId(chainId: number, networkMode: NetworkMode): string | null {
  const expected = getExpectedChainId(networkMode);
  if (chainId !== expected) {
    return `Chain ID mismatch: got ${chainId}, expected ${expected} for ${networkMode}`;
  }
  return null;
}

export function validateAddress(address: string, fieldName: string): string | null {
  if (!address || !isAddress(address)) {
    return `Invalid ${fieldName}: ${address}`;
  }
  return null;
}

export const MAX_DEADLINE_SECONDS = 3600;
export const MIN_AMOUNT_WEI = 1n;

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
