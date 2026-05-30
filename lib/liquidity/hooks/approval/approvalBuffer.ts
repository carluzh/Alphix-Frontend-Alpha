/**
 * Unified-Yield approval buffer (single source of truth).
 *
 * UY required amounts drift UP between approval and deposit because the Aave
 * share price moves (a ~5min cushion). We therefore approve slightly more than
 * the exact amount, and the allowance sufficiency check must accept that same
 * buffered amount. If the producer (buildApprovalCalldata) and the consumer
 * (useUnifiedYieldApprovals) disagree on the buffer, the check rejects the
 * granted allowance forever and the approval UI loops.
 *
 * Both sides MUST go through this helper so the buffer is defined exactly once.
 *
 * NOTE: This is NOT the V4 Permit2 buffer. The Permit2 path (see
 * lib/liquidity/liquidity-utils.ts) uses a fixed `+ 1n` wei bump on an EIP-712
 * uint160 allowance and is a different mechanism — do not route it through here.
 *
 * Pure TypeScript: no React, no server-only imports. Safe to import from both a
 * `'use client'` hook and a calldata builder.
 */

/**
 * Divisor applied to the amount to produce the over-approval buffer.
 * `amount / 100_000n` == a 0.001% cushion.
 */
export const APPROVAL_BUFFER_DIVISOR = 100_000n;

/**
 * Apply the UY over-approval buffer to an amount.
 *
 * Returns `amount + amount / APPROVAL_BUFFER_DIVISOR`.
 *
 * Integer division floors the buffer term, so for `amount < APPROVAL_BUFFER_DIVISOR`
 * the buffer is 0 and the original amount is returned unchanged — this matches the
 * prior inline expression exactly.
 *
 * @param amount Exact required amount, in wei.
 * @returns The buffered amount to approve / to check the allowance against.
 */
export function applyApprovalBuffer(amount: bigint): bigint {
  return amount + amount / APPROVAL_BUFFER_DIVISOR;
}
