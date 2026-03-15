/**
 * Shared swap error classification.
 *
 * Maps raw RPC / contract error messages to user-friendly strings.
 * Used by both get-quote and build-tx API routes.
 */
export function classifySwapError(
  errorMessage: string,
  swapType?: string
): string {
  const s = errorMessage.toLowerCase();

  // Smart contract call exceptions (common in ExactOut multihop)
  if (
    s.includes('call_exception') ||
    s.includes('call revert exception') ||
    s.includes('0x6190b2b0') ||
    s.includes('0x486aa307')
  ) {
    return swapType === 'ExactOut'
      ? 'Amount exceeds available liquidity'
      : 'Not enough liquidity';
  }

  // Liquidity depth errors
  if (
    s.includes('insufficient liquidity') ||
    s.includes('not enough liquidity') ||
    s.includes('pool has no liquidity')
  ) {
    return 'Not enough liquidity';
  }

  // Slippage / price-impact errors
  if (
    s.includes('price impact too high') ||
    s.includes('slippage') ||
    s.includes('price moved too much')
  ) {
    return 'Price impact too high';
  }

  // Permit nonce / signature errors (build-tx specific, but harmless to check everywhere)
  if (s.includes('nonce') || s.includes('invalid signature')) {
    return 'Permit signature invalid or expired. Please try again.';
  }

  // Generic revert
  if (s.includes('revert') || s.includes('execution reverted')) {
    return swapType === 'ExactOut'
      ? 'Cannot fulfill exact output amount'
      : 'Transaction would revert';
  }

  // Balance / amount errors
  if (
    s.includes('exceeds balance') ||
    s.includes('insufficient balance') ||
    s.includes('amount too large')
  ) {
    return 'Amount exceeds available liquidity';
  }

  // Kyberswap transient / API errors
  if (s.includes('kyberswap')) {
    if (s.includes('stale_route') || s.includes('unprocessable') || s.includes('422')) {
      return 'Swap route expired. Please try again.';
    }
    if (s.includes('rate_limit') || s.includes('429')) {
      return 'Rate limited — please wait a moment and retry.';
    }
    if (s.includes('gas_estimation')) {
      return 'Gas estimation failed. Try increasing slippage.';
    }
    if (s.includes('server_error') || s.includes('500')) {
      return 'Swap provider is temporarily unavailable. Please try again.';
    }
    if (s.includes('bad_request')) {
      return 'Could not build swap. Please try again.';
    }
    // Generic kyberswap fallback
    return 'Swap routing failed. Please try again.';
  }

  return ''; // no match — caller uses its own default
}
