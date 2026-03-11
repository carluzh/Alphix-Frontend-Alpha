import { formatUnits } from 'viem';
import {
  type AggregatorQuote,
  type QuoteRequest,
  type KyberswapRouteResponse,
  type KyberswapBuildResponse,
  type KyberswapError,
  NATIVE_TOKEN_ADDRESS_KYBER,
  isNativeToken,
} from './types';
import { getTokenSymbol } from './token-registry';
import { type NetworkMode } from '../network-mode';

const KYBER_BASE_URL = 'https://aggregator-api.kyberswap.com';
const DEFAULT_CLIENT_ID = 'alphix';
const REQUEST_TIMEOUT_MS = 5000;

/** Kyberswap chain path slug per network */
export function getKyberChainPath(mode?: NetworkMode): string {
  switch (mode) {
    case 'arbitrum': return 'arbitrum';
    default: return 'base';
  }
}

function getClientId(): string {
  return process.env.KYBERSWAP_CLIENT_ID || DEFAULT_CLIENT_ID;
}

function toKyberTokenAddress(address: string): string {
  if (isNativeToken(address)) {
    return NATIVE_TOKEN_ADDRESS_KYBER;
  }
  return address;
}

/**
 * Classify a Kyberswap API error code into a structured KyberswapError.
 */
function classifyApiError(code: number, message: string, extra?: { suggestedSlippage?: number }): KyberswapError {
  switch (code) {
    case 429:
      return { code, message, retryable: true, kind: 'rate_limit' };
    case 4990:
      return { code, message: message || 'Request canceled', retryable: true, kind: 'rate_limit' };
    case 4222:
      return { code, message: message || 'Quoted amount smaller than estimated', retryable: true, kind: 'stale_route' };
    case 4227:
      return {
        code, message: message || 'Gas estimation failed', retryable: true, kind: 'gas_estimation',
        suggestedSlippage: extra?.suggestedSlippage,
      };
    case 4011:
      return { code, message: message || 'Token not found', retryable: false, kind: 'token_not_found' };
    case 4008:
    case 4010:
    case 40011:
      return { code, message: message || 'No route found', retryable: false, kind: 'token_not_found' };
    case 4000:
    case 4001:
    case 4002:
      return { code, message: message || 'Bad request', retryable: false, kind: 'bad_request' };
    case 500:
      return { code, message: message || 'Internal server error', retryable: true, kind: 'server_error' };
    default:
      return { code, message, retryable: code >= 500 || code === 0, kind: 'server_error' };
  }
}

function classifyHttpError(status: number, statusText: string): KyberswapError {
  if (status === 429) {
    return { code: 429, message: 'Rate limited', retryable: true, kind: 'rate_limit' };
  }
  if (status === 404) {
    return { code: 404, message: `Chain not found: ${statusText}`, retryable: false, kind: 'bad_request' };
  }
  if (status >= 500) {
    return { code: status, message: statusText || 'Server error', retryable: true, kind: 'server_error' };
  }
  return { code: status, message: statusText, retryable: false, kind: 'bad_request' };
}

/**
 * Extract route path for display (token symbols from route)
 */
function extractRoutePath(routeSummary: KyberswapRouteResponse['data']['routeSummary']): string[] {
  const path: string[] = [];

  if (!routeSummary.route || routeSummary.route.length === 0) {
    if (routeSummary.tokenIn && routeSummary.tokenOut) {
      return [getTokenSymbol(routeSummary.tokenIn), getTokenSymbol(routeSummary.tokenOut)];
    }
    return path;
  }

  const firstRoute = routeSummary.route[0];
  if (!firstRoute || firstRoute.length === 0) {
    return path;
  }

  path.push(getTokenSymbol(firstRoute[0].tokenIn));
  for (const step of firstRoute) {
    path.push(getTokenSymbol(step.tokenOut));
  }

  return path;
}

/**
 * Fetch the best swap route from Kyberswap.
 * Returns KyberswapRouteResponse on success, KyberswapError on failure.
 */
export async function getKyberswapRoute(
  request: QuoteRequest
): Promise<KyberswapRouteResponse | KyberswapError> {
  const url = new URL(`${KYBER_BASE_URL}/${getKyberChainPath(request.networkMode)}/api/v1/routes`);

  url.searchParams.set('tokenIn', toKyberTokenAddress(request.fromTokenAddress));
  url.searchParams.set('tokenOut', toKyberTokenAddress(request.toTokenAddress));
  url.searchParams.set('amountIn', request.amount);
  url.searchParams.set('gasInclude', 'true');
  url.searchParams.set('source', getClientId());

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'x-client-id': getClientId(),
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Kyberswap] Route request failed: ${response.status} ${response.statusText}`);
      return classifyHttpError(response.status, response.statusText);
    }

    const data = await response.json();

    if (data.code !== 0 || !data.data?.routeSummary) {
      console.warn(`[Kyberswap] No route found: code=${data.code} message=${data.message}`);
      return classifyApiError(data.code, data.message);
    }

    return data as KyberswapRouteResponse;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('[Kyberswap] Route request timed out');
      return { code: 0, message: 'Route request timed out', retryable: true, kind: 'timeout' };
    }
    console.warn('[Kyberswap] Route request failed:', error);
    return { code: 0, message: String(error), retryable: true, kind: 'server_error' };
  }
}

/**
 * Build executable swap calldata from a route.
 * Returns KyberswapBuildResponse on success, KyberswapError on failure.
 */
export async function buildKyberswapSwap(
  routeSummary: KyberswapRouteResponse['data']['routeSummary'],
  userAddress: string,
  slippageBps: number,
  networkMode?: NetworkMode
): Promise<KyberswapBuildResponse | KyberswapError> {
  const url = `${KYBER_BASE_URL}/${getKyberChainPath(networkMode)}/api/v1/route/build`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'x-client-id': getClientId(),
      },
      body: JSON.stringify({
        routeSummary,
        sender: userAddress,
        recipient: userAddress,
        slippageTolerance: slippageBps,
        source: getClientId(),
        enableGasEstimation: true,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Kyberswap] Build request failed: ${response.status} ${response.statusText}`);
      return classifyHttpError(response.status, response.statusText);
    }

    const data = await response.json();

    if (data.code !== 0 || !data.data?.data) {
      console.warn(`[Kyberswap] Build failed: code=${data.code} message=${data.message}`);
      return classifyApiError(data.code, data.message, { suggestedSlippage: data.suggestedSlippage });
    }

    return data as KyberswapBuildResponse;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('[Kyberswap] Build request timed out');
      return { code: 0, message: 'Build request timed out', retryable: true, kind: 'timeout' };
    }
    console.warn('[Kyberswap] Build request failed:', error);
    return { code: 0, message: String(error), retryable: true, kind: 'server_error' };
  }
}

/**
 * Get an indicative quote from Kyberswap (route only, no build).
 * Used for display/polling — build happens server-side in build-tx at execution time.
 */
export async function getKyberswapQuote(
  request: QuoteRequest
): Promise<AggregatorQuote | null> {
  if (!request.isExactIn) {
    return null;
  }

  const routeResult = await getKyberswapRoute(request);

  // If it's an error, log and return null (quote is best-effort for display)
  if ('kind' in routeResult) {
    console.warn(`[Kyberswap] Quote failed: [${routeResult.code}] ${routeResult.message}`);
    return null;
  }

  const { routeSummary, routerAddress } = routeResult.data;
  const outputWei = BigInt(routeSummary.amountOut);
  const inputWei = BigInt(routeSummary.amountIn);

  return {
    source: 'kyberswap',
    outputAmount: formatUnits(outputWei, request.toTokenDecimals),
    outputAmountWei: outputWei,
    inputAmount: formatUnits(inputWei, request.fromTokenDecimals),
    inputAmountWei: inputWei,
    priceImpact: null,
    gasEstimate: BigInt(routeSummary.gas || '0'),
    routerAddress,
    routeSummary,
    routeDisplay: extractRoutePath(routeSummary),
  };
}

/** Kyberswap MetaAggregationRouterV2 address per chain */
export function getKyberswapRouterAddress(networkMode?: NetworkMode): string {
  switch (networkMode) {
    case 'arbitrum': return '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
    default: return '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
  }
}
