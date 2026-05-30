/**
 * Canonical V4 position assembly: pure SDK math + formatting shared by fetchUserPositions
 * and derivePositionsFromIds. Each position renders identically regardless of fetcher.
 *
 * Caller-specific divergences via params:
 *  - configMode: token symbol/decimals config lookup only.
 *  - mathTick* vs displayTick* / displayLiquidityRaw: math drives construction & isInRange; display is emitted (default to math).
 *  - ageSeconds: caller-computed; handled per caller's zero-timestamp semantics.
 *  - formatAmount: ethers vs viem formatter (preserves on-the-wire output exactly).
 */

import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import { type Address } from 'viem';
import {
  getTokenSymbolByAddress,
  getToken as getTokenConfig,
  type NetworkMode,
} from '@/lib/pools-config';

/** Resolved current pool state, as decimal strings + numeric tick. */
export interface AssemblyPoolState {
  sqrtPriceX96: string;
  tick: number;
  poolLiquidity: string;
}

export type AmountFormatter = (rawAmount: string, decimals: number) => string;

export interface AssembleV4PositionParams {
  chainId: number;
  /** Network mode used for token symbol/decimals config lookup. */
  configMode: NetworkMode;
  poolKey: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string };
  poolId: string;
  poolState: AssemblyPoolState;
  liquidity: string;
  mathTickLower: number;
  mathTickUpper: number;
  /** Emitted on output; default to mathTick* when omitted. */
  displayTickLower?: number;
  displayTickUpper?: number;
  /** liquidityRaw emitted on output; default to liquidity when omitted. */
  displayLiquidityRaw?: string;
  positionId: string;
  owner: string;
  blockTimestamp: number;
  lastTimestamp: number;
  /** Caller-computed; preserves each caller's zero-timestamp semantics. */
  ageSeconds: number;
  /** Caller-provided formatter: ethers.utils.formatUnits vs viem formatUnits produce different output. */
  formatAmount: AmountFormatter;
  token0UncollectedFees?: string;
  token1UncollectedFees?: string;
}

export interface AssembledV4Position {
  type: 'v4';
  positionId: string;
  owner: string;
  poolId: string;
  token0: { address: string; symbol: string; amount: string; rawAmount: string };
  token1: { address: string; symbol: string; amount: string; rawAmount: string };
  tickLower: number;
  tickUpper: number;
  liquidityRaw: string;
  ageSeconds: number;
  blockTimestamp: number;
  lastTimestamp: number;
  isInRange: boolean;
  token0UncollectedFees?: string;
  token1UncollectedFees?: string;
}

/**
 * Build the canonical processed V4 position from fully-resolved inputs.
 * Pure: deterministic given its params (only reads static token config).
 */
export function assembleV4Position(params: AssembleV4PositionParams): AssembledV4Position {
  const {
    chainId,
    configMode,
    poolKey,
    poolId,
    poolState,
    liquidity,
    mathTickLower,
    mathTickUpper,
    positionId,
    owner,
    blockTimestamp,
    lastTimestamp,
    ageSeconds,
    formatAmount,
    token0UncollectedFees,
    token1UncollectedFees,
  } = params;

  const t0Addr = poolKey.currency0 as Address;
  const t1Addr = poolKey.currency1 as Address;
  const sym0 = getTokenSymbolByAddress(t0Addr, configMode) || 'T0';
  const sym1 = getTokenSymbolByAddress(t1Addr, configMode) || 'T1';
  const cfg0 = sym0 ? getTokenConfig(sym0, configMode) : undefined;
  const cfg1 = sym1 ? getTokenConfig(sym1, configMode) : undefined;
  const dec0 = cfg0?.decimals ?? 18;
  const dec1 = cfg1?.decimals ?? 18;
  const t0 = new Token(chainId, t0Addr, dec0, sym0);
  const t1 = new Token(chainId, t1Addr, dec1, sym1);

  const v4Pool = new V4Pool(
    t0,
    t1,
    poolKey.fee,
    poolKey.tickSpacing,
    poolKey.hooks,
    JSBI.BigInt(poolState.sqrtPriceX96),
    JSBI.BigInt(poolState.poolLiquidity),
    poolState.tick,
  );

  const v4Position = new V4Position({
    pool: v4Pool,
    tickLower: mathTickLower,
    tickUpper: mathTickUpper,
    liquidity: JSBI.BigInt(liquidity),
  });

  const raw0 = v4Position.amount0.quotient.toString();
  const raw1 = v4Position.amount1.quotient.toString();

  return {
    type: 'v4',
    positionId,
    owner,
    poolId,
    token0: { address: t0.address, symbol: t0.symbol || 'T0', amount: formatAmount(raw0, t0.decimals), rawAmount: raw0 },
    token1: { address: t1.address, symbol: t1.symbol || 'T1', amount: formatAmount(raw1, t1.decimals), rawAmount: raw1 },
    tickLower: params.displayTickLower ?? mathTickLower,
    tickUpper: params.displayTickUpper ?? mathTickUpper,
    liquidityRaw: params.displayLiquidityRaw ?? liquidity,
    ageSeconds,
    blockTimestamp,
    lastTimestamp: lastTimestamp || blockTimestamp,
    isInRange: poolState.tick >= mathTickLower && poolState.tick < mathTickUpper,
    token0UncollectedFees,
    token1UncollectedFees,
  };
}
