/**
 * Quote Comparison Logic
 *
 * Compares quotes from different sources and selects the best one,
 * preferring Alphix pools when they're competitive.
 */

import {
  type AggregatorQuote,
  type QuoteComparison,
  type QuoteSelectionReason,
} from './types';

/**
 * Compare two quotes and determine which is better
 *
 * @param alphixQuote - Quote from Alphix V4 pools
 * @param kyberQuote - Quote from Kyberswap aggregator
 * @param toleranceBps - Basis points tolerance for preferring Alphix (e.g., 50 = 0.5%)
 * @returns Comparison result with selected quote and reason
 */
export function compareQuotes(
  alphixQuote: AggregatorQuote | null,
  kyberQuote: AggregatorQuote | null,
  toleranceBps: number = 50
): QuoteComparison {
  // Case 1: Only Alphix available
  if (alphixQuote && !kyberQuote) {
    return {
      alphixQuote,
      kyberQuote: null,
      selectedQuote: alphixQuote,
      selectedSource: 'alphix',
      reason: 'alphix_only',
    };
  }

  // Case 2: Only Kyberswap available
  if (!alphixQuote && kyberQuote) {
    return {
      alphixQuote: null,
      kyberQuote,
      selectedQuote: kyberQuote,
      selectedSource: 'kyberswap',
      reason: 'aggregator_only',
    };
  }

  // Case 3: Neither available (shouldn't happen in practice)
  if (!alphixQuote && !kyberQuote) {
    throw new Error('No quotes available from any source');
  }

  // Case 4: Both available - compare outputs
  const alphixOutput = alphixQuote!.outputAmountWei;
  const kyberOutput = kyberQuote!.outputAmountWei;

  // Alphix has better or equal output
  if (alphixOutput >= kyberOutput) {
    return {
      alphixQuote,
      kyberQuote,
      selectedQuote: alphixQuote!,
      selectedSource: 'alphix',
      reason: 'alphix_best_price',
    };
  }

  // Check if Alphix is within tolerance of Kyberswap
  // Formula: alphixOutput >= kyberOutput * (10000 - toleranceBps) / 10000
  const toleranceMultiplier = BigInt(10000 - toleranceBps);
  const alphixWithinTolerance = alphixOutput * 10000n >= kyberOutput * toleranceMultiplier;

  if (alphixWithinTolerance) {
    return {
      alphixQuote,
      kyberQuote,
      selectedQuote: alphixQuote!,
      selectedSource: 'alphix',
      reason: 'alphix_within_tolerance',
    };
  }

  // Kyberswap is significantly better
  return {
    alphixQuote,
    kyberQuote,
    selectedQuote: kyberQuote!,
    selectedSource: 'kyberswap',
    reason: 'aggregator_better',
  };
}

/**
 * Calculate the percentage difference between two quotes
 * Returns positive if kyber is better, negative if alphix is better
 */
export function calculateQuoteDifference(
  alphixOutput: bigint,
  kyberOutput: bigint
): number {
  if (alphixOutput === 0n && kyberOutput === 0n) return 0;
  if (alphixOutput === 0n) return 100;

  // (kyber - alphix) / alphix * 100
  const diff = Number(kyberOutput - alphixOutput);
  const base = Number(alphixOutput);

  return (diff / base) * 100;
}

/**
 * Simple wrapper for selecting the best quote
 *
 * We apply a fixed 100bps (1%) Alphix preference. This means Alphix pools are
 * chosen unless Kyberswap returns more than 1% better output.
 *
 * Rationale: Alphix multi-hop routes (e.g. ETH→USDC→USDS) accumulate fees
 * across 2 hops, making them appear marginally worse than an aggregator's
 * optimised single-hop route.  A 1% preference keeps small/medium swaps
 * on-protocol while still falling through to Kyberswap for genuinely better
 * prices on large trades.
 */
export function selectBestQuote(
  alphixQuote: AggregatorQuote | null,
  kyberQuote: AggregatorQuote | null,
  _userSlippageBps?: number
): QuoteComparison {
  // Fixed 100bps (1%) Alphix preference
  return compareQuotes(alphixQuote, kyberQuote, 100);
}
