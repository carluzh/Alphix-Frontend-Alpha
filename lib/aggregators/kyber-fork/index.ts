// Public surface of the vendored KyberSwap aggregator fork (v2.4.0, MIT).
// Source: github.com/KyberNetwork/kyberswap-interface/tree/main/packages/swap-widgets

export {
  NATIVE_TOKEN_ADDRESS,
  NATIVE_TOKEN,
  WRAPPED_NATIVE_TOKEN,
  ZERO_ADDRESS,
  AGGREGATOR_PATH,
  SCAN_LINK,
  DefaultRpcUrl,
  SUPPORTED_NETWORKS,
  MULTICALL_ADDRESS,
  DEFAULT_TOKENS,
} from './constants';
export type { TokenInfo } from './constants';

export { Web3Provider, useActiveWeb3, useRpcTarget } from './hooks/useWeb3Provider';

// TxData — used by integrators for the onSubmitTx callback. Defined in v2.4.0
// Widget/index.tsx (the top-level component) and not exported from any hook.
export type TxData = {
  from: string;
  to: string;
  value: string;
  data: string;
  gasLimit: string;
};

export { TokenListProvider, useTokens, useTokensLoading } from './hooks/useTokens';
export { useToken } from './hooks/useToken';
export { default as useTokenBalances } from './hooks/useTokenBalances';
export { useErc20Approvals, APPROVAL_STATE } from './hooks/useApprovals';
export { default as useApproval } from './hooks/useApproval';
export { default as useSwap, useDexes } from './hooks/useSwap';
export type { Trade, Dex } from './hooks/useSwap';
export { useBuildSwap } from './hooks/useBuildSwap';
export type { BuildResult } from './hooks/useBuildSwap';
export { useDebounce } from './hooks/useDebounce';

export { getTradeComposition } from './utils/aggregationRouting';
export type { SwapRouteV2, SwapPool } from './utils/aggregationRouting';
export { friendlyError } from './utils/errorMessage';
export { isSameTokenAddress } from './utils/sameToken';
export { formatCurrency, formatTokenAmountDisplay } from './format';
