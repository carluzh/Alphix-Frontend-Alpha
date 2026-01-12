/**
 * Decrease Liquidity Transaction Builder
 *
 * Extracts the V4 SDK transaction building logic from useDecreaseLiquidity.
 * Pure async function - no React hooks, no UI side effects.
 */

import { V4PositionPlanner, V4PositionManager, Pool as V4Pool, Position as V4Position, toHex } from '@uniswap/v4-sdk';
import { TickMath } from '@uniswap/v3-sdk';
import { Token, Percent } from '@uniswap/sdk-core';
import { getAddress, type Hex, parseUnits, formatUnits, encodeAbiParameters, keccak256 } from 'viem';
import JSBI from 'jsbi';

import { getToken, getTokenSymbolByAddress, getTokenDefinitions, type TokenSymbol } from '@/lib/pools-config';
import { getPositionDetails, getPoolState } from '@/lib/liquidity-utils';
import { EMPTY_BYTES } from '@/lib/swap-constants';
import type { NetworkMode } from '@/lib/network-mode';

import { parseTokenIdFromPosition } from './buildIncreaseTx';

// =============================================================================
// TYPES
// =============================================================================

export interface DecreasePositionData {
  tokenId: string | number | bigint;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  decreaseAmount0: string;
  decreaseAmount1: string;
  isFullBurn: boolean;
  poolId: string;
  tickLower: number;
  tickUpper: number;
  salt?: string;
  collectOnly?: boolean;
  positionToken0Amount?: string;
  positionToken1Amount?: string;
  enteredSide?: 'token0' | 'token1';
  feesForWithdraw?: { amount0: string; amount1: string } | null;
}

/** @deprecated Use DecreasePositionData instead */
export type DecreasePositionParams = DecreasePositionData;

export interface BuildDecreaseOptions {
  slippageBps?: number;
  deadlineSeconds?: number;
  decreasePercentage?: number;
}

export interface BuildDecreaseTxResult {
  calldata: Hex;
  value: bigint;
  nftTokenId: bigint;
  functionName: 'multicall' | 'modifyLiquidities';
  args: any[];
}

export interface BuildDecreaseTxContext {
  accountAddress: `0x${string}`;
  chainId: number;
  networkMode: NetworkMode;
}

// =============================================================================
// HELPERS
// =============================================================================

const safeParseUnits = (amount: string, decimals: number): bigint => {
  let cleaned = (amount || '').toString().replace(/,/g, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '< 0.0001') return 0n;
  if (cleaned.includes('e')) {
    cleaned = parseFloat(cleaned).toFixed(decimals);
  }
  return parseUnits(cleaned, decimals);
};

// =============================================================================
// PERCENTAGE-BASED DECREASE (removeCallParameters path)
// =============================================================================

async function buildPercentageDecrease(
  params: DecreasePositionData,
  options: BuildDecreaseOptions,
  context: BuildDecreaseTxContext,
  nftTokenId: bigint,
  adjustedPositionData: DecreasePositionData
): Promise<BuildDecreaseTxResult | null> {
  const { chainId, networkMode } = context;
  const { token0Symbol, token1Symbol } = params;
  const decreasePercentage = options.decreasePercentage ?? 0;

  const token0Def = getToken(token0Symbol);
  const token1Def = getToken(token1Symbol);
  if (!token0Def || !token1Def) return null;

  try {
    const details = await getPositionDetails(nftTokenId, chainId);
    const symC0 = getTokenSymbolByAddress(getAddress(details.poolKey.currency0), networkMode);
    const symC1 = getTokenSymbolByAddress(getAddress(details.poolKey.currency1), networkMode);
    if (!symC0 || !symC1) throw new Error('Token definitions not found for pool currencies');

    const defC0 = getToken(symC0);
    const defC1 = getToken(symC1);
    if (!defC0 || !defC1) throw new Error('Token configs missing for pool currencies');

    const t0 = new Token(chainId, getAddress(details.poolKey.currency0), defC0.decimals, defC0.symbol);
    const t1 = new Token(chainId, getAddress(details.poolKey.currency1), defC1.decimals, defC1.symbol);

    const keyTuple = [{
      currency0: getAddress(details.poolKey.currency0),
      currency1: getAddress(details.poolKey.currency1),
      fee: Number(details.poolKey.fee),
      tickSpacing: Number(details.poolKey.tickSpacing),
      hooks: getAddress(details.poolKey.hooks),
    }];
    const encoded = encodeAbiParameters([
      {
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
    ], keyTuple as any);
    const poolId = keccak256(encoded) as Hex;
    const state = await getPoolState(poolId, chainId);

    const pool = new V4Pool(
      t0, t1,
      Number(details.poolKey.fee),
      Number(details.poolKey.tickSpacing),
      getAddress(details.poolKey.hooks),
      JSBI.BigInt(state.sqrtPriceX96.toString()),
      JSBI.BigInt(state.liquidity.toString()),
      state.tick,
    );

    const position = new V4Position({
      pool,
      tickLower: Number(details.tickLower),
      tickUpper: Number(details.tickUpper),
      liquidity: JSBI.BigInt(details.liquidity.toString()),
    });

    // Calculate percentage
    const desired0Raw = safeParseUnits(adjustedPositionData.decreaseAmount0 || '0', token0Def.decimals);
    const desired1Raw = safeParseUnits(adjustedPositionData.decreaseAmount1 || '0', token1Def.decimals);

    const sqrtP = JSBI.BigInt(state.sqrtPriceX96.toString());
    const sqrtA = TickMath.getSqrtRatioAtTick(details.tickLower);
    const sqrtB = TickMath.getSqrtRatioAtTick(details.tickUpper);
    const L = JSBI.BigInt(details.liquidity.toString());

    let amount0Full = JSBI.BigInt(0);
    let amount1Full = JSBI.BigInt(0);
    const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));

    if (JSBI.lessThanOrEqual(sqrtP, sqrtA)) {
      const num = JSBI.multiply(JSBI.multiply(L, JSBI.subtract(sqrtB, sqrtA)), Q96);
      const den = JSBI.multiply(sqrtA, sqrtB);
      amount0Full = JSBI.divide(num, den);
    } else if (JSBI.greaterThanOrEqual(sqrtP, sqrtB)) {
      amount1Full = JSBI.divide(JSBI.multiply(L, JSBI.subtract(sqrtB, sqrtA)), Q96);
    } else {
      const num0 = JSBI.multiply(JSBI.multiply(L, JSBI.subtract(sqrtB, sqrtP)), Q96);
      const den0 = JSBI.multiply(sqrtP, sqrtB);
      amount0Full = JSBI.divide(num0, den0);
      amount1Full = JSBI.divide(JSBI.multiply(L, JSBI.subtract(sqrtP, sqrtA)), Q96);
    }

    const SCALE = JSBI.BigInt(10_000);
    const uiT0Addr = getAddress(token0Def.address);
    const poolC0Addr = getAddress(details.poolKey.currency0);
    const desiredPool0Raw = uiT0Addr === poolC0Addr ? desired0Raw : desired1Raw;
    const desiredPool1Raw = uiT0Addr === poolC0Addr ? desired1Raw : desired0Raw;

    const ceilRatioToBps = (desiredRaw: bigint, fullJSBI: JSBI) => {
      if (desiredRaw <= 0n || JSBI.equal(fullJSBI, JSBI.BigInt(0))) return JSBI.BigInt(0);
      const mul = JSBI.multiply(JSBI.BigInt(desiredRaw.toString()), SCALE);
      const ceil = JSBI.add(mul, JSBI.subtract(fullJSBI, JSBI.BigInt(1)));
      return JSBI.divide(ceil, fullJSBI);
    };

    const userSpecifiedAmounts = (
      (adjustedPositionData.decreaseAmount0 && parseFloat(adjustedPositionData.decreaseAmount0) > 0) ||
      (adjustedPositionData.decreaseAmount1 && parseFloat(adjustedPositionData.decreaseAmount1) > 0)
    );
    const isPercentage = (decreasePercentage > 0 && decreasePercentage <= 100) && !userSpecifiedAmounts;

    let pctBpsJSBI: JSBI;
    if (isPercentage) {
      const bps = Math.max(1, Math.min(10000, Math.floor(decreasePercentage * 100)));
      pctBpsJSBI = JSBI.BigInt(bps.toString());
    } else {
      if (adjustedPositionData.enteredSide === 'token0') {
        pctBpsJSBI = ceilRatioToBps(desiredPool0Raw, amount0Full);
      } else if (adjustedPositionData.enteredSide === 'token1') {
        pctBpsJSBI = ceilRatioToBps(desiredPool1Raw, amount1Full);
      } else {
        const r0 = ceilRatioToBps(desiredPool0Raw, amount0Full);
        const r1 = ceilRatioToBps(desiredPool1Raw, amount1Full);
        pctBpsJSBI = JSBI.greaterThan(r0, r1) ? r0 : r1;
      }
    }

    const pctBps = Math.max(1, Math.min(10000, Number(pctBpsJSBI.toString()) || 1));
    const liquidityPercentage = new Percent(pctBps, 10_000);
    const slippagePct = new Percent(Math.max(0, Math.min(10_000, options.slippageBps ?? 50)), 10_000);
    const deadline = (options.deadlineSeconds && options.deadlineSeconds > 0)
      ? Math.floor(Date.now() / 1000) + options.deadlineSeconds
      : Math.floor(Date.now() / 1000) + 20 * 60;

    const removeOptions = {
      slippageTolerance: slippagePct,
      deadline: String(deadline),
      hookData: '0x' as Hex,
      tokenId: nftTokenId.toString(),
      liquidityPercentage,
      burnToken: pctBps === 10000 && !!adjustedPositionData.isFullBurn,
    } as const;

    const { calldata, value } = V4PositionManager.removeCallParameters(position, removeOptions) as {
      calldata: Hex;
      value: string | number | bigint;
    };

    return {
      calldata,
      value: BigInt(value || 0),
      nftTokenId,
      functionName: 'multicall',
      args: [[calldata] as Hex[]],
    };
  } catch (e) {
    console.warn('removeCallParameters path failed:', e);
    return null;
  }
}

// =============================================================================
// PLANNER-BASED DECREASE
// =============================================================================

async function buildPlannerDecrease(
  params: DecreasePositionData,
  options: BuildDecreaseOptions,
  context: BuildDecreaseTxContext,
  nftTokenId: bigint,
  adjustedPositionData: DecreasePositionData
): Promise<BuildDecreaseTxResult> {
  const { accountAddress, chainId, networkMode } = context;
  const { token0Symbol, token1Symbol, isFullBurn, collectOnly } = params;
  const tokenDefinitions = getTokenDefinitions(networkMode);

  const token0Def = getToken(token0Symbol);
  const token1Def = getToken(token1Symbol);

  if (!token0Def || !token1Def) {
    throw new Error('Token definitions not found for one or both tokens in the position.');
  }

  const sdkToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals, token0Def.symbol);
  const sdkToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals, token1Def.symbol);
  const [sortedSdkToken0, sortedSdkToken1] = sdkToken0.sortsBefore(sdkToken1)
    ? [sdkToken0, sdkToken1]
    : [sdkToken1, sdkToken0];

  const planner = new V4PositionPlanner();
  // Uniswap SDK parity: use toHex() for tokenId (ref: PositionManager.ts:342)
  const tokenIdHex = toHex(nftTokenId.toString());

  if (isFullBurn) {
    // Full burn path
    const amount0MinJSBI = JSBI.BigInt(0);
    const amount1MinJSBI = JSBI.BigInt(0);
    planner.addBurn(tokenIdHex, amount0MinJSBI, amount1MinJSBI, EMPTY_BYTES || '0x');
  } else {
    // Partial decrease or collect-only
    let liquidityJSBI: JSBI;

    if (collectOnly) {
      liquidityJSBI = JSBI.BigInt(0);
    } else {
      // Calculate liquidity to remove
      const details = await getPositionDetails(nftTokenId, chainId);
      const keyTuple = [{
        currency0: getAddress(details.poolKey.currency0),
        currency1: getAddress(details.poolKey.currency1),
        fee: Number(details.poolKey.fee),
        tickSpacing: Number(details.poolKey.tickSpacing),
        hooks: getAddress(details.poolKey.hooks),
      }];
      const encoded = encodeAbiParameters([
        {
          type: 'tuple',
          components: [
            { name: 'currency0', type: 'address' },
            { name: 'currency1', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'hooks', type: 'address' },
          ],
        },
      ], keyTuple as any);
      const poolId = keccak256(encoded) as Hex;
      const state = await getPoolState(poolId, chainId);

      const inRange = state.tick >= details.tickLower && state.tick <= details.tickUpper;

      if (inRange) {
        const sqrtP = JSBI.BigInt(state.sqrtPriceX96.toString());
        const sqrtA = TickMath.getSqrtRatioAtTick(details.tickLower);
        const sqrtB = TickMath.getSqrtRatioAtTick(details.tickUpper);
        const L = JSBI.BigInt(details.liquidity.toString());

        let amount0Full = JSBI.BigInt(0);
        let amount1Full = JSBI.BigInt(0);
        const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));

        if (JSBI.lessThanOrEqual(sqrtP, sqrtA)) {
          const n = JSBI.multiply(JSBI.multiply(L, JSBI.subtract(sqrtB, sqrtA)), Q96);
          const d = JSBI.multiply(sqrtA, sqrtB);
          amount0Full = JSBI.divide(n, d);
        } else if (JSBI.greaterThanOrEqual(sqrtP, sqrtB)) {
          amount1Full = JSBI.divide(JSBI.multiply(L, JSBI.subtract(sqrtB, sqrtA)), Q96);
        } else {
          const n0 = JSBI.multiply(JSBI.multiply(L, JSBI.subtract(sqrtB, sqrtP)), Q96);
          const d0 = JSBI.multiply(sqrtP, sqrtB);
          amount0Full = JSBI.divide(n0, d0);
          amount1Full = JSBI.divide(JSBI.multiply(L, JSBI.subtract(sqrtP, sqrtA)), Q96);
        }

        const userDesired0Raw = safeParseUnits(adjustedPositionData.decreaseAmount0 || '0', token0Def.decimals);
        const userDesired1Raw = safeParseUnits(adjustedPositionData.decreaseAmount1 || '0', token1Def.decimals);
        const poolC0 = getAddress(details.poolKey.currency0);
        const uiT0Addr = getAddress(token0Def.address);
        const desiredPool0Raw = uiT0Addr === poolC0 ? userDesired0Raw : userDesired1Raw;
        const desiredPool1Raw = uiT0Addr === poolC0 ? userDesired1Raw : userDesired0Raw;

        const SCALE = JSBI.BigInt(1_000_000_000);
        const zero = JSBI.BigInt(0);
        let r0 = zero;
        let r1 = zero;

        if (!JSBI.equal(amount0Full, zero) && desiredPool0Raw > 0n) {
          r0 = JSBI.divide(JSBI.multiply(JSBI.BigInt(desiredPool0Raw.toString()), SCALE), amount0Full);
        }
        if (!JSBI.equal(amount1Full, zero) && desiredPool1Raw > 0n) {
          r1 = JSBI.divide(JSBI.multiply(JSBI.BigInt(desiredPool1Raw.toString()), SCALE), amount1Full);
        }

        let ratio = r0;
        if (adjustedPositionData.enteredSide === 'token1') {
          ratio = r1;
        } else if (adjustedPositionData.enteredSide === 'token0') {
          ratio = r0;
        } else {
          ratio = JSBI.greaterThan(r0, r1) ? r0 : r1;
        }

        const num = JSBI.multiply(L, ratio);
        liquidityJSBI = JSBI.divide(num, SCALE);

        if (JSBI.equal(liquidityJSBI, zero) && (desiredPool0Raw > 0n || desiredPool1Raw > 0n)) {
          liquidityJSBI = JSBI.BigInt(1);
        }
      } else {
        // Out of range - use estimate
        const amount0Raw = safeParseUnits(adjustedPositionData.decreaseAmount0 || '0', token0Def.decimals);
        const amount1Raw = safeParseUnits(adjustedPositionData.decreaseAmount1 || '0', token1Def.decimals);
        const maxAmountRaw = amount0Raw > amount1Raw ? amount0Raw : amount1Raw;
        const estimated = JSBI.divide(JSBI.BigInt(maxAmountRaw.toString()), JSBI.BigInt(10));
        liquidityJSBI = JSBI.greaterThan(estimated, JSBI.BigInt(1)) ? estimated : JSBI.BigInt(1);
      }
    }

    // Calculate minimums
    const details = await getPositionDetails(nftTokenId, chainId);
    const keyTuple = [{
      currency0: getAddress(details.poolKey.currency0),
      currency1: getAddress(details.poolKey.currency1),
      fee: Number(details.poolKey.fee),
      tickSpacing: Number(details.poolKey.tickSpacing),
      hooks: getAddress(details.poolKey.hooks),
    }];
    const encoded = encodeAbiParameters([
      {
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
    ], keyTuple as any);
    const poolId = keccak256(encoded) as Hex;
    const state = await getPoolState(poolId, chainId);

    const outOfRangeBelow = state.tick < details.tickLower;
    const outOfRangeAbove = state.tick > details.tickUpper;

    const userDesired0Raw = safeParseUnits(adjustedPositionData.decreaseAmount0 || '0', token0Def.decimals);
    const userDesired1Raw = safeParseUnits(adjustedPositionData.decreaseAmount1 || '0', token1Def.decimals);
    const poolC0 = getAddress(details.poolKey.currency0);
    const poolC1 = getAddress(details.poolKey.currency1);
    const uiT0Addr = getAddress(token0Def.address);
    const desiredPool0Raw = uiT0Addr === poolC0 ? userDesired0Raw : userDesired1Raw;
    const desiredPool1Raw = uiT0Addr === poolC0 ? userDesired1Raw : userDesired0Raw;

    const applyTolerance = (desired: bigint): bigint => {
      if (desired <= 0n) return 0n;
      const pct01bp = desired / 10000n;
      const cushion = pct01bp > 3n ? pct01bp : 3n;
      return desired > cushion ? desired - cushion : 0n;
    };

    let minPool0Raw: bigint = 0n;
    let minPool1Raw: bigint = 0n;

    if (outOfRangeBelow) {
      minPool0Raw = applyTolerance(desiredPool0Raw);
      minPool1Raw = 0n;
    } else if (outOfRangeAbove) {
      minPool0Raw = 0n;
      minPool1Raw = applyTolerance(desiredPool1Raw);
    } else {
      if (adjustedPositionData.enteredSide === 'token0') {
        const enteredDesired = uiT0Addr === poolC0 ? desiredPool0Raw : desiredPool1Raw;
        if (enteredDesired > 0n) {
          if (uiT0Addr === poolC0) {
            minPool0Raw = applyTolerance(enteredDesired);
          } else {
            minPool1Raw = applyTolerance(enteredDesired);
          }
        }
      } else if (adjustedPositionData.enteredSide === 'token1') {
        const enteredDesired = uiT0Addr === poolC0 ? desiredPool1Raw : desiredPool0Raw;
        if (enteredDesired > 0n) {
          if (uiT0Addr === poolC0) {
            minPool1Raw = applyTolerance(enteredDesired);
          } else {
            minPool0Raw = applyTolerance(enteredDesired);
          }
        }
      }
    }

    const sorted0IsPool0 = getAddress(sortedSdkToken0.address) === poolC0;
    const amountMinSorted0 = JSBI.BigInt((sorted0IsPool0 ? minPool0Raw : minPool1Raw).toString());
    const amountMinSorted1 = JSBI.BigInt((sorted0IsPool0 ? minPool1Raw : minPool0Raw).toString());

    planner.addDecrease(tokenIdHex, liquidityJSBI, amountMinSorted0, amountMinSorted1, EMPTY_BYTES || '0x');
  }

  // Take tokens back
  const hasNativeETH = token0Def.address === '0x0000000000000000000000000000000000000000' ||
    token1Def.address === '0x0000000000000000000000000000000000000000';

  planner.addTakePair(sortedSdkToken0, sortedSdkToken1, accountAddress);

  if (hasNativeETH && getAddress(sortedSdkToken0.address) === '0x0000000000000000000000000000000000000000') {
    planner.addSweep(sortedSdkToken0, accountAddress);
  } else if (hasNativeETH && getAddress(sortedSdkToken1.address) === '0x0000000000000000000000000000000000000000') {
    planner.addSweep(sortedSdkToken1, accountAddress);
  }

  const deadline = Math.floor(Date.now() / 1000) + 60;
  const unlockData = planner.finalize();

  return {
    calldata: unlockData as Hex,
    value: 0n,
    nftTokenId,
    functionName: 'modifyLiquidities',
    args: [unlockData as Hex, deadline],
  };
}

// =============================================================================
// MAIN BUILDER
// =============================================================================

export async function buildDecreaseLiquidityTx(
  params: DecreasePositionData,
  options: BuildDecreaseOptions,
  context: BuildDecreaseTxContext
): Promise<BuildDecreaseTxResult> {
  const { token0Symbol, token1Symbol, isFullBurn, feesForWithdraw } = params;
  const tokenDefinitions = getTokenDefinitions(context.networkMode);

  // Adjust amounts with fees
  let finalDecreaseAmount0 = params.decreaseAmount0 || '0';
  let finalDecreaseAmount1 = params.decreaseAmount1 || '0';

  if (feesForWithdraw) {
    try {
      const token0Decimals = tokenDefinitions[token0Symbol]?.decimals || 18;
      const token1Decimals = tokenDefinitions[token1Symbol]?.decimals || 18;

      const fee0Amount = formatUnits(BigInt(feesForWithdraw.amount0 || '0'), token0Decimals);
      const fee1Amount = formatUnits(BigInt(feesForWithdraw.amount1 || '0'), token1Decimals);

      const currentDecrease0Raw = safeParseUnits(params.decreaseAmount0 || '0', token0Decimals);
      const currentDecrease1Raw = safeParseUnits(params.decreaseAmount1 || '0', token1Decimals);
      const fee0Raw = safeParseUnits(fee0Amount, token0Decimals);
      const fee1Raw = safeParseUnits(fee1Amount, token1Decimals);

      const totalDecrease0Raw = currentDecrease0Raw + fee0Raw;
      const totalDecrease1Raw = currentDecrease1Raw + fee1Raw;

      finalDecreaseAmount0 = formatUnits(totalDecrease0Raw, token0Decimals);
      finalDecreaseAmount1 = formatUnits(totalDecrease1Raw, token1Decimals);
    } catch {
      // Fall back to original amounts
    }
  }

  const adjustedPositionData = {
    ...params,
    decreaseAmount0: finalDecreaseAmount0,
    decreaseAmount1: finalDecreaseAmount1,
  };

  const nftTokenId = parseTokenIdFromPosition(params.tokenId);

  // Only use percentage path if user did NOT specify explicit token amounts
  const userSpecifiedAmounts = (
    (adjustedPositionData.decreaseAmount0 && parseFloat(adjustedPositionData.decreaseAmount0) > 0) ||
    (adjustedPositionData.decreaseAmount1 && parseFloat(adjustedPositionData.decreaseAmount1) > 0)
  );
  const isPercentage = (options.decreasePercentage ?? 0) > 0 && !userSpecifiedAmounts;

  // Try percentage path first for percentage-based decreases
  if (isPercentage && !userSpecifiedAmounts && !isFullBurn) {
    const percentageResult = await buildPercentageDecrease(
      params, options, context, nftTokenId, adjustedPositionData
    );
    if (percentageResult) return percentageResult;
  }

  // Fall back to planner path
  return buildPlannerDecrease(params, options, context, nftTokenId, adjustedPositionData);
}

// =============================================================================
// COLLECT FEES BUILDER
// =============================================================================

export async function buildCollectFeesTx(
  tokenId: string | number | bigint,
  context: BuildDecreaseTxContext
): Promise<BuildDecreaseTxResult> {
  const { accountAddress, chainId, networkMode } = context;

  const nftTokenId = parseTokenIdFromPosition(tokenId);
  const details = await getPositionDetails(nftTokenId, chainId);

  const token0Sym = getTokenSymbolByAddress(getAddress(details.poolKey.currency0), networkMode);
  const token1Sym = getTokenSymbolByAddress(getAddress(details.poolKey.currency1), networkMode);
  if (!token0Sym || !token1Sym) throw new Error('Token symbols not found');

  const token0Def = getToken(token0Sym);
  const token1Def = getToken(token1Sym);
  if (!token0Def || !token1Def) throw new Error('Token definitions missing');

  const sdkToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals, token0Def.symbol);
  const sdkToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals, token1Def.symbol);
  const [sortedSdkToken0, sortedSdkToken1] = sdkToken0.sortsBefore(sdkToken1)
    ? [sdkToken0, sdkToken1]
    : [sdkToken1, sdkToken0];

  const planner = new V4PositionPlanner();
  // Uniswap SDK parity: use toHex() for tokenId (ref: PositionManager.ts:342)
  const tokenIdHex = toHex(nftTokenId.toString());
  const zero = JSBI.BigInt(0);

  planner.addDecrease(tokenIdHex, zero, zero, zero, EMPTY_BYTES || '0x');
  planner.addTakePair(sortedSdkToken0, sortedSdkToken1, accountAddress);

  const hasNativeETH = getAddress(details.poolKey.currency0) === '0x0000000000000000000000000000000000000000' ||
    getAddress(details.poolKey.currency1) === '0x0000000000000000000000000000000000000000';

  if (hasNativeETH && getAddress(sortedSdkToken0.address) === '0x0000000000000000000000000000000000000000') {
    planner.addSweep(sortedSdkToken0, accountAddress);
  } else if (hasNativeETH && getAddress(sortedSdkToken1.address) === '0x0000000000000000000000000000000000000000') {
    planner.addSweep(sortedSdkToken1, accountAddress);
  }

  const deadline = Math.floor(Date.now() / 1000) + 600;
  const unlockData = planner.finalize();

  return {
    calldata: unlockData as Hex,
    value: 0n,
    nftTokenId,
    functionName: 'modifyLiquidities',
    args: [unlockData as Hex, deadline],
  };
}
