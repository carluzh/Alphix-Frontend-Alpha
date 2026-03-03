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
  type ApprovalStatus,
  type KyberswapRouteSummary,
  type KyberswapRouteStep,
  type KyberswapRouteResponse,
  type KyberswapBuildResponse,
  NATIVE_TOKEN_ADDRESS_KYBER,
  isNativeToken,
} from './types';

// Kyberswap client
export {
  getKyberswapQuote,
  getKyberswapRoute,
  buildKyberswapSwap,
  getKyberswapRouterAddress,
} from './kyberswap';

// Approval utilities
export {
  checkKyberswapApproval,
  buildApprovalData,
  buildInfiniteApprovalData,
  MAX_UINT256,
} from './approval';

// Quote comparison utility
export { compareQuotes, selectBestQuote } from './comparison';

// Token registry (static - no API calls)
export {
  type TokenInfo,
  initTokenRegistry,
  getTokenInfo,
  getTokenInfoSync,
  getTokenSymbol,
  getTokenLogoURI,
  getTokenDecimals,
  routeAddressesToSymbols,
  hasTokenInfo,
  getPopularTokens,
  searchTokens,
  getAllTokens,
  getTokenCount,
  POPULAR_TOKEN_ADDRESSES,
} from './token-registry';
