/**
 * Adapt an Uniswap-supplied approval transaction to the wagmi/viem request shape.
 *
 * ERC-20 `approve()` is never payable — `value` is hardcoded to `0n` regardless
 * of what the upstream API returned.
 */

import type { Address } from 'viem';
import type { ValidatedTransactionRequest } from '@/lib/liquidity/types';

export function toApproveRequest(
  tx: { to: string; data: string } | undefined,
  chainId: number,
): ValidatedTransactionRequest | undefined {
  if (!tx) return undefined;
  return {
    to: tx.to as Address,
    data: tx.data as `0x${string}`,
    value: 0n,
    chainId,
  };
}
