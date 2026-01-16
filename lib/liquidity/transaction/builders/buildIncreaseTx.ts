/**
 * Increase Liquidity Transaction Builder
 *
 * Extracts the V4 SDK transaction building logic from useIncreaseLiquidity.
 * Pure async function - no React hooks, no UI side effects.
 */

import { V4PositionManager, Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import { Token, Ether, CurrencyAmount, Percent } from '@uniswap/sdk-core';
import { getAddress, type Hex, parseUnits, encodeAbiParameters, keccak256 } from 'viem';
import JSBI from 'jsbi';

import { getToken, getTokenSymbolByAddress, type TokenSymbol } from '@/lib/pools-config';
import { getPositionDetails, getPoolState, preparePermit2BatchForPosition } from '@/lib/liquidity/liquidity-utils';
import type { NetworkMode } from '@/lib/network-mode';
import { DEFAULT_LP_SLIPPAGE } from '@/lib/slippage/slippage-constants';

// =============================================================================
// TYPES
// =============================================================================

export interface IncreasePositionData {
  tokenId: string | number | bigint;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  additionalAmount0: string;
  additionalAmount1: string;
  poolId: string;
  tickLower: number;
  tickUpper: number;
  salt?: string;
  feesForIncrease?: { amount0: string; amount1: string } | null;
}

/** @deprecated Use IncreasePositionData instead */
export type IncreasePositionParams = IncreasePositionData;

export interface BuildIncreaseOptions {
  slippageBps?: number;
  deadlineSeconds?: number;
  batchPermit?: {
    owner: `0x${string}`;
    permitBatch: any;
    signature: string;
  };
}

export interface BuildIncreaseTxResult {
  calldata: Hex;
  value: bigint;
  nftTokenId: bigint;
  position: {
    liquidity: string;
    amount0: string;
    amount1: string;
  };
}

export interface BuildIncreaseTxContext {
  accountAddress: `0x${string}`;
  chainId: number;
  networkMode: NetworkMode;
  signTypedDataAsync?: (params: any) => Promise<string>;
  publicClient?: any;
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

export function parseTokenIdFromPosition(tokenId: string | number | bigint): bigint {
  const raw = tokenId.toString();

  // If it's a pure number, use directly
  if (!raw.includes('-')) {
    const direct = BigInt(raw);
    if (direct > 0n) return direct;
  }

  // Composite ID with hyphens - take last segment
  const parts = raw.split('-');
  const last = parts[parts.length - 1];

  if (last.startsWith('0x') || last.startsWith('0X')) {
    const id = BigInt(last);
    if (id > 0n) return id;
  } else {
    const id = BigInt(last);
    if (id > 0n) return id;
  }

  throw new Error('Unable to determine NFT token ID from position data.');
}

// =============================================================================
// MAIN BUILDER
// =============================================================================

export async function buildIncreaseLiquidityTx(
  params: IncreasePositionData,
  options: BuildIncreaseOptions,
  context: BuildIncreaseTxContext
): Promise<BuildIncreaseTxResult> {
  const { accountAddress, chainId, networkMode, signTypedDataAsync, publicClient } = context;
  const { token0Symbol, token1Symbol, additionalAmount0, additionalAmount1 } = params;

  const token0Def = getToken(token0Symbol);
  const token1Def = getToken(token1Symbol);

  if (!token0Def || !token1Def) {
    throw new Error('Token definitions not found for one or both tokens in the position.');
  }
  if (!token0Def.address || !token1Def.address) {
    throw new Error('Token addresses are missing in definitions.');
  }

  const nftTokenId = parseTokenIdFromPosition(params.tokenId);

  // Fetch on-chain position details and pool state
  const details = await getPositionDetails(nftTokenId, chainId);

  // Build currencies strictly in poolKey order
  const symC0 = getTokenSymbolByAddress(getAddress(details.poolKey.currency0), networkMode);
  const symC1 = getTokenSymbolByAddress(getAddress(details.poolKey.currency1), networkMode);
  if (!symC0 || !symC1) throw new Error('Token symbols not found for pool currencies');

  const defC0 = getToken(symC0, networkMode)!;
  const defC1 = getToken(symC1, networkMode)!;
  const isNativeC0 = getAddress(details.poolKey.currency0) === '0x0000000000000000000000000000000000000000';

  const currency0 = isNativeC0
    ? Ether.onChain(chainId)
    : new Token(chainId, getAddress(defC0.address), defC0.decimals, defC0.symbol);
  const currency1 = new Token(chainId, getAddress(defC1.address), defC1.decimals, defC1.symbol);

  // Compute pool ID and fetch state
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

  // Build V4Pool
  const pool = new V4Pool(
    currency0 as any,
    currency1,
    details.poolKey.fee,
    details.poolKey.tickSpacing,
    details.poolKey.hooks,
    JSBI.BigInt(state.sqrtPriceX96.toString()),
    JSBI.BigInt(state.liquidity.toString()),
    state.tick,
  );

  // Parse amounts and handle out-of-range
  let amount0RawUser = safeParseUnits(additionalAmount0, token0Def.decimals);
  let amount1RawUser = safeParseUnits(additionalAmount1, token1Def.decimals);

  const outOfRangeBelow = state.tick < details.tickLower;
  const outOfRangeAbove = state.tick > details.tickUpper;

  if (outOfRangeBelow) {
    amount1RawUser = 0n;
  } else if (outOfRangeAbove) {
    amount0RawUser = 0n;
  }

  if (amount0RawUser === 0n && amount1RawUser === 0n) {
    throw new Error('Invalid amount: both amounts are zero after range adjustment.');
  }

  // Map user-entered amounts to poolKey order
  let amountC0Raw: bigint;
  let amountC1Raw: bigint;

  if (token0Symbol === symC0 && token1Symbol === symC1) {
    amountC0Raw = amount0RawUser;
    amountC1Raw = amount1RawUser;
  } else if (token0Symbol === symC1 && token1Symbol === symC0) {
    amountC0Raw = amount1RawUser;
    amountC1Raw = amount0RawUser;
  } else {
    throw new Error(`Token mapping error: position has ${token0Symbol}/${token1Symbol} but pool has ${symC0}/${symC1}`);
  }

  // Build V4Position using SDK
  let position: V4Position;

  const userProvidedAmount0 = amountC0Raw > 0n;
  const userProvidedAmount1 = amountC1Raw > 0n;

  if (userProvidedAmount0 && !userProvidedAmount1) {
    const amt0 = CurrencyAmount.fromRawAmount(currency0, amountC0Raw.toString());
    position = V4Position.fromAmount0({
      pool,
      tickLower: details.tickLower,
      tickUpper: details.tickUpper,
      amount0: amt0.quotient,
      useFullPrecision: true,
    });
  } else if (userProvidedAmount1 && !userProvidedAmount0) {
    const amt1 = CurrencyAmount.fromRawAmount(currency1, amountC1Raw.toString());
    position = V4Position.fromAmount1({
      pool,
      tickLower: details.tickLower,
      tickUpper: details.tickUpper,
      amount1: amt1.quotient,
    });
  } else {
    const amt0 = CurrencyAmount.fromRawAmount(currency0, amountC0Raw.toString());
    const amt1 = CurrencyAmount.fromRawAmount(currency1, amountC1Raw.toString());
    position = V4Position.fromAmounts({
      pool,
      tickLower: details.tickLower,
      tickUpper: details.tickUpper,
      amount0: amt0.quotient,
      amount1: amt1.quotient,
      useFullPrecision: true,
    });
  }

  if (JSBI.equal(position.liquidity, JSBI.BigInt(0))) {
    const err: any = new Error('ZERO_LIQUIDITY');
    err.__zero = true;
    throw err;
  }

  // Build options for addCallParameters
  // Use user-provided slippage or fall back to default LP slippage (Uniswap pattern)
  const slippageBps = options.slippageBps ?? (DEFAULT_LP_SLIPPAGE * 100); // DEFAULT_LP_SLIPPAGE is in %, convert to bps
  const slippage = new Percent(Math.max(0, Math.min(10_000, slippageBps)), 10_000);
  const deadline = (options.deadlineSeconds && options.deadlineSeconds > 0)
    ? Math.floor(Date.now() / 1000) + options.deadlineSeconds
    : Math.floor(Date.now() / 1000) + 20 * 60;

  let addOptionsBatch: any = {};

  if (options.batchPermit) {
    addOptionsBatch = { batchPermit: options.batchPermit };
  }

  const addOptions: any = {
    slippageTolerance: slippage,
    deadline: String(deadline),
    hookData: '0x',
    tokenId: nftTokenId.toString(),
    ...addOptionsBatch,
    ...(isNativeC0 ? { useNative: Ether.onChain(chainId) } : {}),
  };

  const { calldata, value } = V4PositionManager.addCallParameters(position, addOptions) as {
    calldata: Hex;
    value: string | number | bigint;
  };

  return {
    calldata,
    value: BigInt(value || 0),
    nftTokenId,
    position: {
      liquidity: position.liquidity.toString(),
      amount0: position.amount0.quotient.toString(),
      amount1: position.amount1.quotient.toString(),
    },
  };
}

// =============================================================================
// PERMIT PREPARATION
// =============================================================================

export interface PrepareIncreasePermitParams {
  nftTokenId: bigint;
  accountAddress: `0x${string}`;
  chainId: number;
  deadline: number;
  amountC0Raw: bigint;
  amountC1Raw: bigint;
}

export async function prepareIncreasePermit(
  params: PrepareIncreasePermitParams
): Promise<any | null> {
  const { nftTokenId, accountAddress, chainId, deadline, amountC0Raw, amountC1Raw } = params;

  const prepared = await preparePermit2BatchForPosition(
    nftTokenId,
    accountAddress,
    chainId,
    deadline,
    amountC0Raw,
    amountC1Raw
  );

  if (prepared?.message?.details && prepared.message.details.length > 0) {
    return prepared;
  }

  return null;
}
