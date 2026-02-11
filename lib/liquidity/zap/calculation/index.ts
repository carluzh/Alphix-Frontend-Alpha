/**
 * Zap Calculation Module
 *
 * Pure calculation functions for zap operations.
 * All functions are stateless and easily testable.
 */

export {
  calculateOptimalSwapAmount,
  calculatePoolRatio,
  calculatePoolRatioFromToken1,
  calculatePostSwapAmounts,
  calculatePSMOutput,
  estimateLeftover,
  calculateLeftoverPercent,
} from './calculateOptimalSwapAmount';

export {
  calculatePriceImpact,
  calculatePriceImpactFromMidPrice,
  analyzePriceImpact,
  calculateMinOutput,
  calculateMaxInput,
  formatPriceImpact,
  getPriceImpactColor,
  type PriceImpactAnalysis,
} from './calculatePriceImpact';

export {
  findOptimalSwapAmount,
  type OptimalSwapResult,
  type FindOptimalSwapParams,
} from './findOptimalSwapAmount';
