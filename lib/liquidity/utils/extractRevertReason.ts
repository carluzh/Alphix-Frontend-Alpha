/**
 * Shared on-chain revert-reason probe.
 *
 * SINGLE SOURCE OF TRUTH for decoding a failed transaction's revert reason. This
 * was previously copy-pasted into both lib/observability/sentry.ts (reportFailedTx)
 * and lib/liquidity/transaction/executor/handlers/positionHandler.ts; both now
 * delegate here.
 *
 * READ-ONLY: replays the failed call via viem publicClient.call (eth_call). It does
 * NOT mutate state, does NOT touch any audited send path, swallows ALL of its own
 * errors, and NEVER throws. Runs AFTER a confirmed revert to enrich diagnostics
 * with decoded names like 'PriceLimitReached', 'TickSlippage',
 * 'PermitSignatureExpired'. Isomorphic (viem only) — safe on both server and client.
 */

import type { Hex } from 'viem';
import { BaseError, createPublicClient } from 'viem';

import { baseMainnet, arbitrumOne } from '@/lib/chains';
import { createFallbackTransport } from '@/lib/viemClient';
import { BASE_CHAIN_ID, ARBITRUM_CHAIN_ID } from '@/lib/network-mode';

/** Decoded revert diagnostics. All fields optional; populated best-effort. */
export interface RevertInfo {
  shortMessage?: string;
  details?: string;
  rawMessage?: string;
  probeError?: string;
}

/**
 * Replay a failed tx via eth_call to extract the decoded revert reason.
 *
 * Any failure here is swallowed; callers fall back to a generic message.
 *
 * @param args.to     Target contract.
 * @param args.data   Calldata of the failed tx.
 * @param args.value  Value sent with the failed tx (optional).
 * @param args.from   Sender — used as `account` in the eth_call probe.
 * @param args.chainId Chain id (8453 | 42161); defaults to Base for legacy callers.
 */
export async function extractRevertReason(args: {
  to: Hex;
  data: Hex;
  value?: bigint;
  from: Hex;
  chainId?: number;
}): Promise<RevertInfo> {
  try {
    const chain =
      args.chainId === ARBITRUM_CHAIN_ID
        ? arbitrumOne
        : args.chainId === BASE_CHAIN_ID
          ? baseMainnet
          : baseMainnet; // default for legacy callers
    const publicClient = createPublicClient({
      chain,
      transport: createFallbackTransport(chain),
    });
    await publicClient.call({
      account: args.from,
      to: args.to,
      data: args.data,
      value: args.value,
    });
    // No throw means the call succeeded on the latest block — the on-chain revert
    // was state-dependent at submission time and we can't reproduce it.
    return { rawMessage: 'eth_call replay did not revert (state-dependent failure)' };
  } catch (err) {
    if (err instanceof BaseError) {
      return {
        shortMessage: err.shortMessage,
        details: err.details,
        rawMessage: err.message,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { probeError: msg };
  }
}
