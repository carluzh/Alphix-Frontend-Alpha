/**
 * Aggregator Module Exports
 */

// Types
export {
  type AggregatorSource,
  type AggregatorQuote,
  type QuoteRequest,
  type QuoteComparison,
  type QuoteSelectionReason,
  type KyberswapError,
  type KyberswapRouteSummary,
  type KyberswapRouteStep,
  type KyberswapRouteResponse,
  type KyberswapBuildResponse,
  NATIVE_TOKEN_ADDRESS_KYBER,
  isNativeToken,
  isKyberswapError,
} from './types';

// Kyberswap client
export {
  getKyberswapQuote,
  getKyberswapRoute,
  buildKyberswapSwap,
  getKyberswapRouterAddress,
} from './kyberswap';

// Quote comparison utility
export { compareQuotes, selectBestQuote } from './comparison';

// Token registry
export {
  type TokenInfo,
  ensureTokenListLoaded,
  getTokenInfoSync,
  getTokenSymbol,
  getPopularTokens,
  searchTokens,
  getAllTokens,
} from './token-registry';
