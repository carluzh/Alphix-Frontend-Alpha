/**
 * On-Chain Data Utilities
 *
 * Pure on-chain data fetching functions with no caching.
 * These functions perform multicalls to fetch position and pool data directly from blockchain state.
 */

import { encodeAbiParameters, keccak256, type Hex, formatUnits, parseAbi, type Address } from 'viem';
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import { publicClient } from './viemClient';
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from './abis/state_view_abi';
import { getStateViewAddress, getPositionManagerAddress } from './pools-config';
import { getToken as getTokenConfig, getTokenSymbolByAddress, CHAIN_ID } from './pools-config';
import { position_manager_abi } from './abis/PositionManager_abi';

/**
 * Decoded position tick and subscription info from on-chain position data
 */
export interface DecodedPositionInfo {
  tickLower: number;
  tickUpper: number;
  hasSubscriber: boolean;
}

/**
 * Decode position info from packed bigint value
 * Format: 8 bits flags | 24 bits tickUpper | 24 bits tickLower
 */
export function decodePositionInfo(value: bigint): DecodedPositionInfo {
  const toSigned24 = (raw: number): number => (raw >= 0x800000 ? raw - 0x1000000 : raw);
  const rawLower = Number((value >> 8n) & 0xFFFFFFn);
  const rawUpper = Number((value >> 32n) & 0xFFFFFFn);
  const hasSub = (value & 0xFFn) !== 0n;
  return {
    tickLower: toSigned24(rawLower),
    tickUpper: toSigned24(rawUpper),
    hasSubscriber: hasSub,
  };
}

/**
 * Derive full position data from token IDs using current on-chain state
 *
 * Performs two multicalls:
 * 1. Get position info and liquidity for all token IDs
 * 2. Get pool state (sqrtPrice, tick, liquidity) for all unique pools
 *
 * Then assembles the data using Uniswap V4 SDK to calculate token amounts
 *
 * @param ownerAddress - Position owner address
 * @param tokenIds - Array of position token IDs
 * @param createdAtMap - Optional map of tokenId -> createdAt timestamp for age calculation
 * @returns Array of position data with amounts, ticks, and metadata
 */
export async function derivePositionsFromIds(
  ownerAddress: string,
  tokenIds: Array<string | number | bigint>,
  createdAtMap?: Map<string, number>
): Promise<any[]> {
  if (!Array.isArray(tokenIds) || tokenIds.length === 0) return [];

  const pmAddress = getPositionManagerAddress() as Address;
  const stateViewAddr = getStateViewAddress() as Address;

  // 1. First Multicall: Get position info and liquidity for all tokenIds
  const positionDetailsContracts = tokenIds.flatMap(id => ([
    {
      address: pmAddress,
      abi: position_manager_abi as any,
      functionName: 'getPoolAndPositionInfo',
      args: [BigInt(String(id))],
    },
    {
      address: pmAddress,
      abi: position_manager_abi as any,
      functionName: 'getPositionLiquidity',
      args: [BigInt(String(id))],
    },
  ]));

  const positionDetailsResults = await publicClient.multicall({
    contracts: positionDetailsContracts,
    allowFailure: true,
  });

  // 2. Process first multicall results and gather unique pool keys
  const poolKeys = new Map<string, any>();
  const positionDataMap = new Map<string, any>();

  for (let i = 0; i < tokenIds.length; i++) {
    const tokenId = String(tokenIds[i]);
    const infoResult = positionDetailsResults[i * 2];
    const liquidityResult = positionDetailsResults[i * 2 + 1];

    if (infoResult.status === 'success' && liquidityResult.status === 'success') {
      const [poolKey, infoValue] = infoResult.result as any;
      const liquidity = liquidityResult.result as bigint;

      const encodedPoolKey = encodeAbiParameters(
        [{ type: 'tuple', components: [
          { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ]}],
        [poolKey]
      );
      const poolIdHex = keccak256(encodedPoolKey) as Hex;

      if (!poolKeys.has(poolIdHex)) {
        poolKeys.set(poolIdHex, poolKey);
      }

      positionDataMap.set(tokenId, {
        poolId: poolIdHex,
        poolKey,
        infoValue,
        liquidity,
      });
    }
  }

  // 3. Second Multicall: Get state for all unique pools
  const uniquePoolIds = Array.from(poolKeys.keys());
  const poolStateContracts = uniquePoolIds.flatMap(poolId => ([
    {
      address: stateViewAddr,
      abi: parseAbi(STATE_VIEW_HUMAN_READABLE_ABI as any),
      functionName: 'getSlot0',
      args: [poolId],
    },
    {
      address: stateViewAddr,
      abi: parseAbi(STATE_VIEW_HUMAN_READABLE_ABI as any),
      functionName: 'getLiquidity',
      args: [poolId],
    },
  ]));

  const poolStateResults = await publicClient.multicall({
    contracts: poolStateContracts,
    allowFailure: true,
  });

  // 4. Process second multicall results
  const poolStateMap = new Map<string, any>();
  for (let i = 0; i < uniquePoolIds.length; i++) {
    const poolId = uniquePoolIds[i];
    const slot0Result = poolStateResults[i * 2];
    const liquidityResult = poolStateResults[i * 2 + 1];

    if (slot0Result.status === 'success' && liquidityResult.status === 'success') {
      const [sqrtPriceX96, tick] = slot0Result.result as any;
      const poolLiquidity = liquidityResult.result as bigint;
      poolStateMap.set(poolId, {
        sqrtPriceX96: sqrtPriceX96.toString(),
        tick: Number(tick),
        poolLiquidity: poolLiquidity.toString(),
      });
    }
  }

  // 5. Final Assembly: Construct V4Position objects and derive amounts
  const out: any[] = [];
  for (const tokenIdStr of tokenIds.map(String)) {
    try {
      const positionData = positionDataMap.get(tokenIdStr);
      if (!positionData) continue;

      const poolState = poolStateMap.get(positionData.poolId);
      if (!poolState) continue;

      const { poolKey, infoValue, liquidity } = positionData;

      const t0Addr = poolKey.currency0 as Address;
      const t1Addr = poolKey.currency1 as Address;
      const sym0 = getTokenSymbolByAddress(t0Addr) || 'T0';
      const sym1 = getTokenSymbolByAddress(t1Addr) || 'T1';
      const cfg0 = sym0 ? getTokenConfig(sym0) : undefined;
      const cfg1 = sym1 ? getTokenConfig(sym1) : undefined;
      const dec0 = cfg0?.decimals ?? 18;
      const dec1 = cfg1?.decimals ?? 18;
      const tok0 = new Token(CHAIN_ID, t0Addr, dec0, sym0);
      const tok1 = new Token(CHAIN_ID, t1Addr, dec1, sym1);

      const v4Pool = new V4Pool(
        tok0, tok1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks,
        JSBI.BigInt(poolState.sqrtPriceX96),
        JSBI.BigInt(poolState.poolLiquidity),
        poolState.tick
      );

      const { tickLower, tickUpper } = decodePositionInfo(infoValue);

      const v4Position = new V4Position({
        pool: v4Pool,
        tickLower,
        tickUpper,
        liquidity: JSBI.BigInt(liquidity.toString()),
      });

      const raw0 = BigInt(v4Position.amount0.quotient.toString());
      const raw1 = BigInt(v4Position.amount1.quotient.toString());

      let created = createdAtMap?.get(tokenIdStr) || 0;
      if (created > 1e12) created = Math.floor(created / 1000);

      out.push({
        positionId: tokenIdStr,
        poolId: positionData.poolId,
        owner: ownerAddress,
        token0: { address: tok0.address, symbol: tok0.symbol || 'T0', amount: formatUnits(raw0, tok0.decimals), rawAmount: raw0.toString() },
        token1: { address: tok1.address, symbol: tok1.symbol || 'T1', amount: formatUnits(raw1, tok1.decimals), rawAmount: raw1.toString() },
        tickLower,
        tickUpper,
        liquidityRaw: liquidity.toString(),
        ageSeconds: created > 0 ? Math.max(0, Math.floor(Date.now() / 1000) - created) : 0,
        blockTimestamp: String(created || '0'),
        isInRange: poolState.tick >= tickLower && poolState.tick < tickUpper,
      });
    } catch (e) {
      console.warn(`[derivePositionsFromIds] Error processing tokenId ${tokenIdStr}:`, e);
    }
  }
  return out;
}
