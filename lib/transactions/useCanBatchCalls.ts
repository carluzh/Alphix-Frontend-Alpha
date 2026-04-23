/**
 * useCanBatchCalls
 *
 * Detects whether the connected wallet supports EIP-5792 atomic batching
 * (`wallet_sendCalls`) on the given chain. Returns `true` when the wallet's
 * reported `atomic.status` is either `supported` (native) or `ready`
 * (upgradeable via EIP-7702).
 *
 * Used by the increase-liquidity flow to collapse ERC20 approvals + the
 * async mint tx into a single wallet prompt.
 */

import { useCapabilities } from 'wagmi';

/**
 * Pure capability check — exposed so tests don't have to render the hook.
 * Looks up `capabilities[chainId].atomic.status` and returns true for
 * `'supported'` (native EIP-5792) or `'ready'` (upgradeable via EIP-7702).
 */
export function canBatchFromCapabilities(
  capabilities: unknown,
  chainId: number | undefined,
): boolean {
  if (capabilities == null || typeof capabilities !== 'object' || chainId == null) return false;
  // Wallets may key by decimal number OR hex string OR stringified number.
  // Try all three representations so a quirky connector doesn't disable batching.
  const bag = capabilities as Record<string | number, unknown>;
  const lookups = [chainId, String(chainId), `0x${chainId.toString(16)}`];
  for (const key of lookups) {
    const entry = bag[key] as { atomic?: { status?: string } } | undefined;
    const status = entry?.atomic?.status;
    if (status === 'supported' || status === 'ready') return true;
  }
  return false;
}

export function useCanBatchCalls(chainId?: number): boolean {
  const { data: capabilities } = useCapabilities({
    query: { enabled: chainId != null },
  });
  return canBatchFromCapabilities(capabilities, chainId);
}
