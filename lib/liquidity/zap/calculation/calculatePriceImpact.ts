/**
 * Price Impact Calculation for Zap
 *
 * Calculates the price impact of a swap to determine whether
 * to use the pool swap or PSM (1:1) fallback.
 */

import { PSM_PRICE_IMPACT_THRESHOLD, MAX_ACCEPTABLE_PRICE_IMPACT, PRICE_IMPACT_WARNING_THRESHOLD } from '../constants';

// =============================================================================
// PRICE IMPACT CALCULATION
// =============================================================================

/**
 * Calculate price impact from swap amounts.
 *
 * Price impact = how much worse the execution price is compared to fair value.
 * For stablecoins, fair value is 1:1.
 *
 * Formula: ((expectedOutput - actualOutput) / expectedOutput) * 100
 *
 * Positive impact = user receives less than expected (unfavorable)
 * Negative impact = user receives more than expected (favorable, rare)
 *
 * @param inputAmount - Amount being swapped (in wei)
 * @param outputAmount - Amount received from swap (in wei)
 * @param inputDecimals - Decimals of input token
 * @param outputDecimals - Decimals of output token
 * @returns Price impact as percentage (e.g., 0.01 = 0.01%)
 */
export function calculatePriceImpact(
  inputAmount: bigint,
  outputAmount: bigint,
  inputDecimals: number,
  outputDecimals: number
): number {
  if (inputAmount <= 0n) {
    return 0;
  }

  // Normalize both amounts to common base (e.g., USD value)
  const inputNormalized = Number(inputAmount) / 10 ** inputDecimals;
  const outputNormalized = Number(outputAmount) / 10 ** outputDecimals;

  // For stablecoins, expected output equals input in USD terms
  const expectedOutput = inputNormalized;

  if (expectedOutput === 0) {
    return 0;
  }

  // Calculate impact
  const impact = ((expectedOutput - outputNormalized) / expectedOutput) * 100;

  return impact;
}

/**
 * Calculate price impact from a swap quote.
 *
 * Alternative method using quote data that may include mid-price.
 *
 * @param inputAmount - Amount being swapped (in wei)
 * @param outputAmount - Amount received from swap (in wei)
 * @param midPrice - Current mid-price of the pool (output per input)
 * @returns Price impact as percentage
 */
export function calculatePriceImpactFromMidPrice(
  inputAmount: bigint,
  outputAmount: bigint,
  midPrice: number
): number {
  if (inputAmount <= 0n || midPrice <= 0) {
    return 0;
  }

  const expectedOutput = Number(inputAmount) * midPrice;
  const actualOutput = Number(outputAmount);

  if (expectedOutput === 0) {
    return 0;
  }

  const impact = ((expectedOutput - actualOutput) / expectedOutput) * 100;

  return impact;
}

// =============================================================================
// IMPACT ANALYSIS
// =============================================================================

/**
 * Price impact analysis result
 */
export interface PriceImpactAnalysis {
  /** Raw price impact percentage */
  impact: number;
  /** Absolute value of impact */
  absoluteImpact: number;
  /** Whether PSM should be used */
  shouldUsePSM: boolean;
  /** Whether to show warning to user */
  showWarning: boolean;
  /** Whether to block the transaction */
  shouldBlock: boolean;
  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Human-readable message */
  message: string;
}

/**
 * Analyze price impact and determine recommended action.
 *
 * @param priceImpact - Price impact percentage
 * @returns Analysis with recommendations
 */
export function analyzePriceImpact(priceImpact: number): PriceImpactAnalysis {
  const absoluteImpact = Math.abs(priceImpact);

  // Determine if PSM should be used
  const shouldUsePSM = absoluteImpact > PSM_PRICE_IMPACT_THRESHOLD;

  // Determine severity and messaging
  let severity: PriceImpactAnalysis['severity'];
  let showWarning: boolean;
  let shouldBlock: boolean;
  let message: string;

  if (absoluteImpact <= PSM_PRICE_IMPACT_THRESHOLD) {
    severity = 'low';
    showWarning = false;
    shouldBlock = false;
    message = 'Optimal swap via pool';
  } else if (absoluteImpact <= PRICE_IMPACT_WARNING_THRESHOLD) {
    severity = 'medium';
    showWarning = false;
    shouldBlock = false;
    message = 'Using PSM for 1:1 swap (better rate)';
  } else if (absoluteImpact <= MAX_ACCEPTABLE_PRICE_IMPACT) {
    severity = 'high';
    showWarning = true;
    shouldBlock = false;
    message = `High price impact (${absoluteImpact.toFixed(2)}%). Using PSM.`;
  } else {
    severity = 'critical';
    showWarning = true;
    shouldBlock = true;
    message = `Price impact too high (${absoluteImpact.toFixed(2)}%). Consider reducing amount.`;
  }

  return {
    impact: priceImpact,
    absoluteImpact,
    shouldUsePSM,
    showWarning,
    shouldBlock,
    severity,
    message,
  };
}

// =============================================================================
// SLIPPAGE HELPERS
// =============================================================================

/**
 * Calculate minimum output amount with slippage tolerance.
 *
 * @param expectedOutput - Expected output amount (in wei)
 * @param slippageTolerance - Slippage tolerance as percentage (e.g., 0.5 = 0.5%)
 * @returns Minimum acceptable output (in wei)
 */
export function calculateMinOutput(
  expectedOutput: bigint,
  slippageTolerance: number
): bigint {
  if (expectedOutput <= 0n || slippageTolerance < 0) {
    return 0n;
  }

  // Convert percentage to basis points for precision
  const slippageBps = Math.floor(slippageTolerance * 100);
  const minOutput = (expectedOutput * BigInt(10000 - slippageBps)) / 10000n;

  return minOutput;
}

/**
 * Calculate maximum input amount with slippage tolerance.
 *
 * Used for ExactOut swaps where output is fixed.
 *
 * @param expectedInput - Expected input amount (in wei)
 * @param slippageTolerance - Slippage tolerance as percentage
 * @returns Maximum acceptable input (in wei)
 */
export function calculateMaxInput(
  expectedInput: bigint,
  slippageTolerance: number
): bigint {
  if (expectedInput <= 0n || slippageTolerance < 0) {
    return 0n;
  }

  const slippageBps = Math.floor(slippageTolerance * 100);
  const maxInput = (expectedInput * BigInt(10000 + slippageBps)) / 10000n;

  return maxInput;
}

// =============================================================================
// FORMATTING
// =============================================================================

/**
 * Format price impact for display.
 *
 * @param priceImpact - Price impact percentage
 * @returns Formatted string (e.g., "0.01%", "<0.01%", ">1%")
 */
export function formatPriceImpact(priceImpact: number): string {
  const absoluteImpact = Math.abs(priceImpact);

  if (absoluteImpact < 0.01) {
    return '<0.01%';
  }

  if (absoluteImpact > 10) {
    return `>${priceImpact > 0 ? '' : '-'}10%`;
  }

  const sign = priceImpact > 0 ? '' : '-';
  return `${sign}${absoluteImpact.toFixed(2)}%`;
}

/**
 * Get color class for price impact display.
 *
 * @param severity - Severity from analysis
 * @returns Tailwind color class
 */
export function getPriceImpactColor(severity: PriceImpactAnalysis['severity']): string {
  switch (severity) {
    case 'low':
      return 'text-green-500';
    case 'medium':
      return 'text-yellow-500';
    case 'high':
      return 'text-orange-500';
    case 'critical':
      return 'text-red-500';
    default:
      return 'text-gray-500';
  }
}
