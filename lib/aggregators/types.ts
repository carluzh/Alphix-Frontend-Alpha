/**
 * Aggregator Integration Types
 *
 * Shared types for DEX aggregator integrations (Kyberswap, etc.)
 */

export type AggregatorSource = 'alphix' | 'kyberswap';

/**
 * Normalized quote response from any aggregator
 */
export interface AggregatorQuote {
  source: AggregatorSource;
  outputAmount: string;           // Human-readable decimal string
  outputAmountWei: bigint;        // Raw amount in smallest units
  inputAmount: string;            // Human-readable decimal string
  inputAmountWei: bigint;         // Raw amount in smallest units
  priceImpact: number | null;     // Percentage (e.g., 0.5 = 0.5%)
  gasEstimate: bigint;
  routerAddress: string;          // Contract to send tx to
  dynamicFeeBps?: number;         // Pool fee in basis points (Alphix only)
  // Kyberswap-specific fields
  routeSummary?: KyberswapRouteSummary;
  encodedSwapData?: string;       // Hex calldata for execution
  // Route info for display
  routeDisplay?: string[];        // e.g., ["ETH", "USDC", "DAI"]
}

/**
 * Request parameters for fetching a quote
 */
export interface QuoteRequest {
  fromTokenAddress: string;       // Token address (use native token address for ETH)
  toTokenAddress: string;
  fromTokenDecimals: number;
  toTokenDecimals: number;
  amount: string;                 // Amount in smallest units (wei)
  slippageBps: number;            // Slippage tolerance in basis points
  userAddress?: string;           // Required for building executable calldata
  isExactIn: boolean;             // true = ExactIn, false = ExactOut
}

/**
 * Result of comparing multiple aggregator quotes
 */
export interface QuoteComparison {
  alphixQuote: AggregatorQuote | null;
  kyberQuote: AggregatorQuote | null;
  selectedQuote: AggregatorQuote;
  selectedSource: AggregatorSource;
  reason: QuoteSelectionReason;
}

export type QuoteSelectionReason =
  | 'alphix_best_price'           // Alphix has better or equal output
  | 'alphix_within_tolerance'     // Alphix is within slippage tolerance of best
  | 'aggregator_better'           // Aggregator has significantly better price
  | 'alphix_only'                 // Aggregator unavailable, using Alphix
  | 'aggregator_only';            // Alphix route unavailable

/**
 * Kyberswap-specific types
 */
export interface KyberswapRouteSummary {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountInUsd: string;
  amountOut: string;
  amountOutUsd: string;
  gas: string;
  gasPrice: string;
  gasUsd: string;
  extraFee: {
    feeAmount: string;
    chargeFeeBy: string;
    isInBps: boolean;
    feeReceiver: string;
  };
  route: KyberswapRouteStep[][];
}

export interface KyberswapRouteStep {
  pool: string;
  tokenIn: string;
  tokenOut: string;
  limitReturnAmount: string;
  swapAmount: string;
  amountOut: string;
  exchange: string;
  poolLength: number;
  poolType: string;
  poolExtra: any;
  extra: any;
}

export interface KyberswapRouteResponse {
  code: number;
  message: string;
  data: {
    routeSummary: KyberswapRouteSummary;
    routerAddress: string;
  };
}

export interface KyberswapBuildResponse {
  code: number;
  message: string;
  data: {
    amountIn: string;
    amountInUsd: string;
    amountOut: string;
    amountOutUsd: string;
    gas: string;
    gasUsd: string;
    outputChange: {
      amount: string;
      percent: number;
      level: number;
    };
    data: string;              // Encoded calldata
    routerAddress: string;
  };
}

/**
 * Approval status for a token
 */
export interface ApprovalStatus {
  needsApproval: boolean;
  spender: string;
  token: string;
  currentAllowance: bigint;
  requiredAmount: bigint;
}

/**
 * Native token address constant (used by Kyberswap for ETH)
 */
export const NATIVE_TOKEN_ADDRESS_KYBER = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/**
 * Check if an address represents native ETH
 */
export function isNativeToken(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === '0x0000000000000000000000000000000000000000' ||
    normalized === NATIVE_TOKEN_ADDRESS_KYBER.toLowerCase()
  );
}
