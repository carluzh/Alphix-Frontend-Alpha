/**
 * Shared error classification for all transaction flows (swap, zap, liquidity).
 *
 * Single source of truth — imported by both useSwapStepExecutor and useSwapExecution.
 * Handles wallet rejections, Kyberswap API errors, permit errors, and on-chain reverts.
 */

export interface ClassifiedError {
  kind: 'rejected' | 'backend' | 'revert' | 'unknown';
  title: string;
  description: string;
}

/** Check if a wallet/signing error is a user rejection. */
export function isUserRejected(err: any): boolean {
  const name = err?.name || err?.cause?.name;
  if (name === 'UserRejectedRequestError') return true;
  const code = err?.code || err?.cause?.code;
  if (code === 4001 || code === 5750 || code === 'ACTION_REJECTED') return true;
  const msg = String(err?.shortMessage || err?.message || err?.cause?.message || '');
  return (
    (/request/i.test(msg) && /reject/i.test(msg)) ||
    /declined/i.test(msg) ||
    /cancell?ed by user/i.test(msg) ||
    /user cancell?ed/i.test(msg) ||
    /user denied/i.test(msg) ||
    /user rejected/i.test(msg) ||
    /closed modal/i.test(msg) ||
    /connection rejected/i.test(msg) ||
    /transaction cancelled/i.test(msg) ||
    /denied transaction signature/i.test(msg)
  );
}

/** Classify a raw error into a user-friendly { kind, title, description }. */
export function classifySwapError(err: any): ClassifiedError {
  if (isUserRejected(err)) {
    return { kind: 'rejected', title: 'Cancelled', description: 'You cancelled the request in your wallet.' };
  }

  const msg = String(err?.shortMessage || err?.message || err?.cause?.message || '');
  const msgLc = msg.toLowerCase();

  // Kyberswap-specific errors (cause carries the error kind from build-tx)
  const causeKind = typeof err?.cause === 'string' ? err.cause : err?.cause?.kind;
  if (causeKind === 'stale_route') {
    return { kind: 'backend', title: 'Route Expired', description: 'Swap prices changed. Please try again for a fresh route.' };
  }
  if (causeKind === 'rate_limit') {
    return { kind: 'backend', title: 'Rate Limited', description: 'Too many requests. Please wait a moment and try again.' };
  }
  if (causeKind === 'gas_estimation') {
    return { kind: 'backend', title: 'Gas Estimation Failed', description: 'The swap simulation failed. Try adjusting your slippage or amount.' };
  }
  if (causeKind === 'token_not_found') {
    return { kind: 'backend', title: 'Token Not Found', description: 'This token is not supported on the selected chain.' };
  }

  if (msgLc.includes('permit nonce') || msgLc.includes('nonce changed') || msgLc.includes('nonce stale')) {
    return { kind: 'backend', title: 'Permit Expired', description: msg || 'Your permit was already used. Please sign again.' };
  }
  if (msgLc.includes('signature invalid') || msgLc.includes('invalid signature') || msgLc.includes('signature expired')) {
    return { kind: 'backend', title: 'Signature Invalid', description: msg || 'Your signature is invalid or expired. Please sign again.' };
  }
  if (msgLc.includes('timed out') || msgLc.includes('timeout') || msgLc.includes('aborted')) {
    return { kind: 'backend', title: 'Request Timed Out', description: 'The route request timed out. Please try again.' };
  }
  if (msgLc.includes('failed to fetch permit data') || msgLc.includes('failed to build transaction') || msgLc.includes('backend')) {
    return { kind: 'backend', title: 'Backend Error', description: msg || 'Something went wrong on our end.' };
  }
  if (msgLc.includes('revert') || msgLc.includes('executionfailed') || msgLc.includes('call revert exception')) {
    return { kind: 'revert', title: 'Transaction Reverted', description: msg || 'The transaction reverted on-chain.' };
  }

  return { kind: 'unknown', title: 'Transaction Error', description: msg || 'The transaction failed.' };
}
