/**
 * Zap Preview
 *
 * Computes a single-quote zap preview for the live USDC/USDT Unified Yield pool.
 *
 * Strategy (no binary search):
 *   1. Split input ~50/50.
 *   2. Get one Kyberswap quote for the swap half (USDC/USDT is pegged ~1:1).
 *   3. Query the Hook's previewAddFromAmount0/1 for the remaining half.
 *
 * The actual deposit reconciliation happens in `handleZapDynamicDepositStep`,
 * which queries on-chain balances after the swap and tries both deposit
 * directions to minimise dust. So preview accuracy beyond a few % is wasted.
 */

import { type PublicClient, type Address, formatUnits, parseUnits } from 'viem';
import { chainIdForMode, type NetworkMode } from '@/lib/network-mode';
import { previewAddFromAmount0, previewAddFromAmount1 } from '../unified-yield/buildUnifiedYieldDepositTx';
import { ZapError, ZapErrorCode, type ZapToken, type RouteDetails } from './types';
import type { ZapPoolConfig } from './constants';

// =============================================================================
// TYPES
// =============================================================================

export interface ZapPreviewInput {
  inputToken: ZapToken;
  inputAmount: bigint;
  hookAddress: Address;
  publicClient: PublicClient;
  poolConfig: ZapPoolConfig;
  userAddress?: Address;
  slippageBps?: number;
  networkMode?: NetworkMode;
}

export interface ZapPreviewOutput {
  /** Amount to swap (~half of input) */
  swapAmount: bigint;
  /** Expected output from the Kyberswap quote */
  swapOutput: bigint;
  /** Remaining input held for the deposit */
  remainingInput: bigint;
  /** Other-side amount required by the Hook for the deposit */
  requiredOther: bigint;
  /** Expected shares from the Hook deposit */
  expectedShares: bigint;
  /** Route metadata (always Kyberswap in the simplified flow) */
  route: RouteDetails;
}

// =============================================================================
// MAIN
// =============================================================================

export async function getZapPreview(params: ZapPreviewInput): Promise<ZapPreviewOutput> {
  const { inputToken, inputAmount, hookAddress, publicClient, poolConfig, userAddress, slippageBps, networkMode } = params;

  if (inputAmount <= 0n) {
    return {
      swapAmount: 0n,
      swapOutput: 0n,
      remainingInput: 0n,
      requiredOther: 0n,
      expectedShares: 0n,
      route: { type: 'kyberswap', priceImpact: 0, outputAmount: 0n },
    };
  }

  const isInputToken0 = inputToken === poolConfig.token0.symbol;
  const fromToken = isInputToken0 ? poolConfig.token0 : poolConfig.token1;
  const toToken = isInputToken0 ? poolConfig.token1 : poolConfig.token0;

  // Split ~50/50. For pegged pairs this is within a few bps of optimal.
  const swapAmount = inputAmount / 2n;
  const remainingInput = inputAmount - swapAmount;

  const swapOutput = await fetchKyberQuote(
    fromToken.address,
    toToken.address,
    swapAmount,
    fromToken.decimals,
    toToken.decimals,
    fromToken.symbol,
    toToken.symbol,
    slippageBps,
    userAddress,
    networkMode,
  );

  if (swapOutput === null) {
    throw new ZapError(ZapErrorCode.POOL_LIQUIDITY_LOW, 'Kyberswap unavailable for this pair');
  }

  const preview = isInputToken0
    ? await previewAddFromAmount0(hookAddress, remainingInput, publicClient)
    : await previewAddFromAmount1(hookAddress, remainingInput, publicClient);

  if (!preview) {
    throw new ZapError(ZapErrorCode.POOL_LIQUIDITY_LOW, 'Hook preview unavailable');
  }

  return {
    swapAmount,
    swapOutput,
    remainingInput,
    requiredOther: preview.otherAmount,
    expectedShares: preview.shares,
    route: { type: 'kyberswap', priceImpact: 0, outputAmount: swapOutput },
  };
}

// =============================================================================
// HELPERS
// =============================================================================

async function fetchKyberQuote(
  fromTokenAddress: string,
  toTokenAddress: string,
  amountWei: bigint,
  fromTokenDecimals: number,
  toTokenDecimals: number,
  fromSymbol: string,
  toSymbol: string,
  slippageBps?: number,
  userAddress?: string,
  networkMode?: NetworkMode,
): Promise<bigint | null> {
  try {
    const res = await fetch('/api/swap/get-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromTokenSymbol: fromSymbol,
        toTokenSymbol: toSymbol,
        fromTokenAddress,
        toTokenAddress,
        amountDecimalsStr: formatUnits(amountWei, fromTokenDecimals),
        fromTokenDecimals,
        toTokenDecimals,
        swapType: 'ExactIn',
        chainId: chainIdForMode(networkMode ?? 'base'),
        slippageBps: slippageBps ?? 50,
        userAddress,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success || !data.toAmount) return null;
    return parseUnits(data.toAmount, toTokenDecimals);
  } catch (e) {
    console.warn('[zap/preview] Kyberswap quote failed:', e);
    return null;
  }
}
