import { formatUnits } from 'viem';
import {
  type AggregatorQuote,
  type QuoteRequest,
  type KyberswapRouteResponse,
  type KyberswapBuildResponse,
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
 * Extract route path for display (token symbols from route)
 * Converts addresses to symbols using the token registry
 */
function extractRoutePath(routeSummary: KyberswapRouteResponse['data']['routeSummary']): string[] {
  const path: string[] = [];

  if (!routeSummary.route || routeSummary.route.length === 0) {
    // Fallback to tokenIn/tokenOut from summary
    if (routeSummary.tokenIn && routeSummary.tokenOut) {
      return [getTokenSymbol(routeSummary.tokenIn), getTokenSymbol(routeSummary.tokenOut)];
    }
    return path;
  }

  // Route is an array of arrays (split routes)
  // For simplicity, we'll use the first route path
  const firstRoute = routeSummary.route[0];
  if (!firstRoute || firstRoute.length === 0) {
    return path;
  }

  // Add input token (convert address to symbol)
  path.push(getTokenSymbol(firstRoute[0].tokenIn));

  // Add each output token in the route (convert addresses to symbols)
  for (const step of firstRoute) {
    path.push(getTokenSymbol(step.tokenOut));
  }

  return path;
}

/**
 * Fetch the best swap route from Kyberswap
 */
export async function getKyberswapRoute(
  request: QuoteRequest
): Promise<KyberswapRouteResponse | null> {
  const url = new URL(`${KYBER_BASE_URL}/${getKyberChainPath(request.networkMode)}/api/v1/routes`);

  // Required parameters
  url.searchParams.set('tokenIn', toKyberTokenAddress(request.fromTokenAddress));
  url.searchParams.set('tokenOut', toKyberTokenAddress(request.toTokenAddress));
  url.searchParams.set('amountIn', request.amount);

  // Optional parameters for better routing
  url.searchParams.set('gasInclude', 'true');

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
      return null;
    }

    const data: KyberswapRouteResponse = await response.json();

    if (data.code !== 0 || !data.data?.routeSummary) {
      console.warn(`[Kyberswap] No route found: ${data.message}`);
      return null;
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('[Kyberswap] Route request timed out');
    } else {
      console.warn('[Kyberswap] Route request failed:', error);
    }
    return null;
  }
}

/**
 * Build executable swap calldata from a route
 */
export async function buildKyberswapSwap(
  routeSummary: KyberswapRouteResponse['data']['routeSummary'],
  userAddress: string,
  slippageBps: number,
  networkMode?: NetworkMode
): Promise<KyberswapBuildResponse | null> {
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
        slippageTolerance: slippageBps, // Kyberswap accepts bps directly
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[Kyberswap] Build request failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data: KyberswapBuildResponse = await response.json();

    if (data.code !== 0 || !data.data?.data) {
      console.warn(`[Kyberswap] Build failed: ${data.message}`);
      return null;
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('[Kyberswap] Build request timed out');
    } else {
      console.warn('[Kyberswap] Build request failed:', error);
    }
    return null;
  }
}

/**
 * Get a complete quote from Kyberswap including executable calldata
 *
 * This is the main function to call - it handles both route discovery and build.
 */
export async function getKyberswapQuote(
  request: QuoteRequest
): Promise<AggregatorQuote | null> {
  // ExactOut not supported by Kyberswap aggregator API (only ExactIn)
  if (!request.isExactIn) {
    console.warn('[Kyberswap] ExactOut not supported, skipping');
    return null;
  }

  // Step 1: Get the best route
  const routeResponse = await getKyberswapRoute(request);
  if (!routeResponse) {
    return null;
  }

  const { routeSummary, routerAddress } = routeResponse.data;

  // If no user address, return indicative quote without calldata
  if (!request.userAddress) {
    const outputWei = BigInt(routeSummary.amountOut);
    const inputWei = BigInt(routeSummary.amountIn);
    return {
      source: 'kyberswap',
      outputAmount: formatUnits(outputWei, request.toTokenDecimals),
      outputAmountWei: outputWei,
      inputAmount: formatUnits(inputWei, request.fromTokenDecimals),
      inputAmountWei: inputWei,
      priceImpact: null, // Kyberswap doesn't return this directly
      gasEstimate: BigInt(routeSummary.gas || '0'),
      routerAddress,
      routeSummary,
      routeDisplay: extractRoutePath(routeSummary),
    };
  }

  const buildResponse = await buildKyberswapSwap(
    routeSummary,
    request.userAddress,
    request.slippageBps,
    request.networkMode
  );

  if (!buildResponse) {
    // Return indicative quote if build fails
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

  const outputWei = BigInt(buildResponse.data.amountOut);
  const inputWei = BigInt(buildResponse.data.amountIn);
  return {
    source: 'kyberswap',
    outputAmount: formatUnits(outputWei, request.toTokenDecimals),
    outputAmountWei: outputWei,
    inputAmount: formatUnits(inputWei, request.fromTokenDecimals),
    inputAmountWei: inputWei,
    priceImpact: buildResponse.data.outputChange?.percent || null,
    gasEstimate: BigInt(buildResponse.data.gas || '0'),
    routerAddress: buildResponse.data.routerAddress,
    routeSummary,
    encodedSwapData: buildResponse.data.data,
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
