import { Token, Price } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import { TickMath, nearestUsableTick } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import { parseUnits, getAddress, parseAbi, type Hex } from "viem";
import { createNetworkClient } from "@/lib/viemClient";
import { STATE_VIEW_ABI } from "@/lib/abis/state_view_abi";
import { getToken, TokenSymbol, getStateViewAddress, getPoolByTokens } from "@/lib/pools-config";
import { MAINNET_CHAIN_ID, type NetworkMode } from "@/lib/network-mode";

interface CalculateLiquidityParams {
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  inputAmount: string;
  inputTokenSymbol: TokenSymbol;
  userTickLower?: number;
  userTickUpper?: number;
  fullRange?: boolean;
  tickRangeAmount?: number;
  chainId: number;
}

interface CalculateLiquidityResult {
  liquidity: string;
  finalTickLower: number;
  finalTickUpper: number;
  amount0: string;
  amount1: string;
  currentPoolTick: number;
  currentPrice: string;
  priceAtTickLower: string;
  priceAtTickUpper: string;
}

function normalizeAmountString(raw: string): string {
  let s = (raw ?? '').toString().trim().replace(/,/g, '.');
  if (!/e|E/.test(s)) return s;
  const m = s.match(/^([+-]?)(\d*\.?\d+)[eE]([+-]?\d+)$/);
  if (!m) return s;
  const sign = m[1] || '';
  const num = m[2];
  const exp = parseInt(m[3], 10);
  const parts = num.split('.');
  const intPart = parts[0] || '0';
  const fracPart = parts[1] || '';
  const digits = (intPart + fracPart).replace(/^0+/, '') || '0';
  const pointIndex = intPart.length;
  const newPoint = pointIndex + exp;
  if (exp >= 0) {
    if (newPoint >= digits.length) return sign + digits + '0'.repeat(newPoint - digits.length);
    return sign + digits.slice(0, newPoint) + '.' + digits.slice(newPoint);
  } else {
    if (newPoint <= 0) return sign + '0.' + '0'.repeat(-newPoint) + digits;
    return sign + digits.slice(0, newPoint) + '.' + digits.slice(newPoint);
  }
}

function calculatePriceString(
  sqrtPriceX96_JSBI: JSBI,
  poolSortedToken0: Token,
  poolSortedToken1: Token,
  desiredPriceOfToken: Token,
  desiredPriceInToken: Token
): string {
  const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));
  const rawToken1UnitsNumerator = JSBI.multiply(sqrtPriceX96_JSBI, sqrtPriceX96_JSBI);
  const rawToken0UnitsDenominator = JSBI.multiply(Q96, Q96);

  const priceToken1PerToken0 = new Price(
    poolSortedToken0,
    poolSortedToken1,
    rawToken0UnitsDenominator,
    rawToken1UnitsNumerator
  );

  let finalPriceObject: Price<Token, Token>;
  if (desiredPriceOfToken.equals(poolSortedToken1) && desiredPriceInToken.equals(poolSortedToken0)) {
    finalPriceObject = priceToken1PerToken0;
  } else if (desiredPriceOfToken.equals(poolSortedToken0) && desiredPriceInToken.equals(poolSortedToken1)) {
    finalPriceObject = priceToken1PerToken0.invert();
  } else {
    throw new Error('Desired price pair does not match sorted pool pair');
  }

  return finalPriceObject.toSignificant(8);
}

export async function calculateLiquidityParameters(
  params: CalculateLiquidityParams
): Promise<CalculateLiquidityResult> {
  const {
    token0Symbol,
    token1Symbol,
    inputAmount,
    inputTokenSymbol,
    userTickLower,
    userTickUpper,
    fullRange,
    tickRangeAmount,
    chainId,
  } = params;

  // Derive network mode from chainId
  const networkMode: NetworkMode = chainId === MAINNET_CHAIN_ID ? 'mainnet' : 'testnet';
  const publicClient = createNetworkClient(networkMode);

  const token0Config = getToken(token0Symbol, networkMode);
  const token1Config = getToken(token1Symbol, networkMode);
  const inputTokenConfig = getToken(inputTokenSymbol, networkMode);

  if (!token0Config || !token1Config || !inputTokenConfig) {
    throw new Error("Invalid token configuration");
  }

  const poolConfig = getPoolByTokens(token0Symbol, token1Symbol, networkMode);
  if (!poolConfig) {
    throw new Error(`No pool found for ${token0Symbol}/${token1Symbol}`);
  }

  const sdkToken0 = new Token(chainId, getAddress(token0Config.address), token0Config.decimals, token0Config.symbol);
  const sdkToken1 = new Token(chainId, getAddress(token1Config.address), token1Config.decimals, token1Config.symbol);
  const sdkInputToken = new Token(chainId, getAddress(inputTokenConfig.address), inputTokenConfig.decimals, inputTokenConfig.symbol);

  const parsedInputAmount = parseUnits(normalizeAmountString(inputAmount), sdkInputToken.decimals);

  const [sortedToken0, sortedToken1] = sdkToken0.sortsBefore(sdkToken1)
    ? [sdkToken0, sdkToken1]
    : [sdkToken1, sdkToken0];

  const poolId = V4Pool.getPoolId(
    sortedToken0,
    sortedToken1,
    poolConfig.fee,
    poolConfig.tickSpacing,
    getAddress(poolConfig.hooks) as `0x${string}`
  );

  const stateViewAbiViem = parseAbi(STATE_VIEW_ABI);
  const stateViewAddress = getStateViewAddress(networkMode);

  const [slot0, liquidity] = await Promise.all([
    publicClient.readContract({
      address: stateViewAddress,
      abi: stateViewAbiViem,
      functionName: 'getSlot0',
      args: [poolId as Hex]
    }) as Promise<readonly [bigint, number, number, number]>,
    publicClient.readContract({
      address: stateViewAddress,
      abi: stateViewAbiViem,
      functionName: 'getLiquidity',
      args: [poolId as Hex]
    }) as Promise<bigint>
  ]);

  const currentSqrtPriceX96_JSBI = JSBI.BigInt(slot0[0].toString());
  const currentTickFromSlot0 = Number(slot0[1]);

  let tickLower: number, tickUpper: number;
  if (fullRange) {
    tickLower = nearestUsableTick(TickMath.MIN_TICK, poolConfig.tickSpacing);
    tickUpper = nearestUsableTick(TickMath.MAX_TICK, poolConfig.tickSpacing);
  } else if (typeof tickRangeAmount === 'number' && isFinite(tickRangeAmount)) {
    tickLower = nearestUsableTick(currentTickFromSlot0 - tickRangeAmount, poolConfig.tickSpacing);
    tickUpper = nearestUsableTick(currentTickFromSlot0 + tickRangeAmount, poolConfig.tickSpacing);
  } else {
    if (typeof userTickLower !== 'number' || typeof userTickUpper !== 'number') {
      throw new Error("userTickLower and userTickUpper required when not using fullRange/tickRangeAmount");
    }
    tickLower = nearestUsableTick(userTickLower, poolConfig.tickSpacing);
    tickUpper = nearestUsableTick(userTickUpper, poolConfig.tickSpacing);
  }

  const v4Pool = new V4Pool(
    sortedToken0,
    sortedToken1,
    poolConfig.fee,
    poolConfig.tickSpacing,
    poolConfig.hooks,
    currentSqrtPriceX96_JSBI,
    JSBI.BigInt(liquidity.toString()),
    currentTickFromSlot0
  );

  let position: V4Position;
  if (sdkInputToken.equals(sortedToken0)) {
    position = V4Position.fromAmount0({ pool: v4Pool, tickLower, tickUpper, amount0: JSBI.BigInt(parsedInputAmount.toString()), useFullPrecision: true });
  } else {
    position = V4Position.fromAmount1({ pool: v4Pool, tickLower, tickUpper, amount1: JSBI.BigInt(parsedInputAmount.toString()) });
  }

  // SDK returns amounts in sorted order - map back to form's token order
  const sortedAmount0 = position.amount0.quotient.toString();
  const sortedAmount1 = position.amount1.quotient.toString();
  const liquidityStr = position.liquidity.toString();

  // Check if form order matches sorted order
  const isSortedOrder = sdkToken0.sortsBefore(sdkToken1);
  // Return amounts in form token order (token0Symbol, token1Symbol), not sorted order
  const finalAmount0 = isSortedOrder ? sortedAmount0 : sortedAmount1;
  const finalAmount1 = isSortedOrder ? sortedAmount1 : sortedAmount0;

  const currentPrice = calculatePriceString(currentSqrtPriceX96_JSBI, sortedToken0, sortedToken1, sdkToken1, sdkToken0);
  const sqrtPriceLowerX96 = JSBI.BigInt(TickMath.getSqrtRatioAtTick(tickLower).toString());
  const sqrtPriceUpperX96 = JSBI.BigInt(TickMath.getSqrtRatioAtTick(tickUpper).toString());
  const priceAtTickLower = calculatePriceString(sqrtPriceLowerX96, sortedToken0, sortedToken1, sdkToken1, sdkToken0);
  const priceAtTickUpper = calculatePriceString(sqrtPriceUpperX96, sortedToken0, sortedToken1, sdkToken1, sdkToken0);

  return {
    liquidity: liquidityStr,
    finalTickLower: tickLower,
    finalTickUpper: tickUpper,
    amount0: finalAmount0,
    amount1: finalAmount1,
    currentPoolTick: currentTickFromSlot0,
    currentPrice,
    priceAtTickLower,
    priceAtTickUpper,
  };
}
