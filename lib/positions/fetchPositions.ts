/**
 * fetchUserPositions
 *
 * Core position fetching logic extracted into a shared module so both the
 * REST API handler (pages/api/liquidity/get-positions.ts) and the GraphQL
 * resolver (app/api/graphql/resolvers.ts) can call it directly.
 *
 * Previously the GraphQL resolver made an HTTP self-call to the REST API,
 * which on Vercel spawns a second serverless function. Cold starts + RPC
 * latency caused frequent silent timeouts → empty positions in production.
 */

import { ethers } from "ethers";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import JSBI from 'jsbi';
import { getAddress, type Address, type Hex, encodeAbiParameters, keccak256, parseAbi } from "viem";
import { getTokenSymbolByAddress, getToken as getTokenConfig, getChainId, getPositionManagerAddress, getStateViewAddress, type NetworkMode } from "@/lib/pools-config";
import { getPositionDetails, getPoolState, calculateUnclaimedFeesV4 } from "@/lib/liquidity/liquidity-utils";
import { getAlphixSubgraphUrl } from "@/lib/subgraph-url-helper";
import { STATE_VIEW_ABI } from "@/lib/abis/state_view_abi";
import { createNetworkClient } from "@/lib/viemClient";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SubgraphPosition {
    id: string;
    owner: string;
    tickLower: string;
    tickUpper: string;
    liquidity: string;
    creationTimestamp: string;
    lastTimestamp: string;
    poolId: string;
}

interface ProcessedPositionToken {
    address: string;
    symbol: string;
    amount: string;
    rawAmount: string;
}

export interface V4ProcessedPosition {
    type: 'v4';
    positionId: string;
    owner: string;
    poolId: string;
    token0: ProcessedPositionToken;
    token1: ProcessedPositionToken;
    tickLower: number;
    tickUpper: number;
    liquidityRaw: string;
    ageSeconds: number;
    blockTimestamp: number;
    lastTimestamp: number;
    isInRange: boolean;
    token0UncollectedFees?: string;
    token1UncollectedFees?: string;
    isPending?: boolean;
    isRemoving?: boolean;
    isOptimisticallyUpdating?: boolean;
    isUnifiedYield?: boolean;
    hookAddress?: string;
    shareBalance?: string;
}

export type Position = V4ProcessedPosition;

// ---------------------------------------------------------------------------
// Subgraph queries
// ---------------------------------------------------------------------------

const GET_USER_HOOK_POSITIONS_QUERY = `
  query GetUserPositions($owner: Bytes!) {
    hookPositions(first: 200, orderBy: id, orderDirection: desc, where: { owner: $owner, liquidity_gt: 0 }) {
      id
      owner
      tickLower
      tickUpper
      liquidity
      creationTimestamp
      lastTimestamp
      poolId
    }
  }
`;

const GET_USER_LEGACY_POSITIONS_QUERY = `
  query GetUserPositions($owner: Bytes!) {
    positions(first: 200, orderBy: tokenId, orderDirection: desc, where: { owner: $owner }) {
      id
      tokenId
      owner
      createdAtTimestamp
    }
  }
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPoolIdFromPosition(pos: SubgraphPosition): string {
    return pos.poolId || '';
}

function parseTokenIdFromHexId(idHex: string): bigint | null {
    try {
        if (!idHex || !idHex.startsWith('0x')) return null;
        return BigInt(idHex);
    } catch { return null; }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function fetchUserPositions(ownerAddress: string, networkMode: NetworkMode): Promise<Position[]> {
    console.log('[fetchUserPositions] called with', { ownerAddress, networkMode });
    const owner = getAddress(ownerAddress);
    const hookPositionsQuery = GET_USER_HOOK_POSITIONS_QUERY;
    const chainId = getChainId(networkMode);

    // Build list of subgraph URLs to query
    const subgraphUrls: string[] = [];
    const primaryUrl = getAlphixSubgraphUrl(networkMode);
    if (primaryUrl) subgraphUrls.push(primaryUrl);
    console.log('[fetchUserPositions] subgraph URLs:', subgraphUrls);

    if (subgraphUrls.length === 0) {
        console.error('[fetchUserPositions] no subgraph URLs - returning empty');
        return [];
    }

    // Fetch from all subgraphs in parallel
    const subgraphResults = await Promise.allSettled(subgraphUrls.map(async (subgraphUrl) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const resp = await fetch(subgraphUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: hookPositionsQuery, variables: { owner: owner.toLowerCase() } }), signal: controller.signal });
            clearTimeout(timeoutId);
            if (!resp.ok) {
                console.error('[fetchUserPositions] subgraph response not ok:', resp.status, resp.statusText);
                return [];
            }
            const json = await resp.json() as any;
            let raw = json?.data?.hookPositions ?? [] as SubgraphPosition[];
            console.log('[fetchUserPositions] subgraph returned', raw.length, 'hookPositions');
            // Fallback to legacy positions if hookPositions empty (testnet only)
            if (networkMode === 'testnet' && (!Array.isArray(raw) || raw.length === 0)) {
                try {
                    const legacyController = new AbortController();
                    const legacyTimeoutId = setTimeout(() => legacyController.abort(), 10000);
                    const respLegacy = await fetch(subgraphUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: GET_USER_LEGACY_POSITIONS_QUERY, variables: { owner: owner.toLowerCase() } }), signal: legacyController.signal });
                    clearTimeout(legacyTimeoutId);
                    if (respLegacy.ok) {
                        const jsonLegacy = await respLegacy.json() as any;
                        const legacy = (jsonLegacy?.data?.positions || []) as Array<{ id: string; tokenId?: string; owner: string; createdAtTimestamp?: string }>;
                        raw = legacy.map(p => ({ id: p.id, owner: p.owner, tickLower: '0', tickUpper: '0', liquidity: '0', creationTimestamp: p.createdAtTimestamp || '0', lastTimestamp: undefined as any, poolId: '' }));
                    }
                } catch {}
            }
            return raw;
        } catch (error: any) {
            clearTimeout(timeoutId);
            console.error('[fetchUserPositions] subgraph fetch threw:', error?.message || error);
            throw error;
        }
    }));

    // Extract fulfilled results and deduplicate
    let allRawPositions: SubgraphPosition[] = [];
    const seenPositionIds = new Set<string>();
    for (const result of subgraphResults) {
        if (result.status !== 'fulfilled') {
            console.error('[fetchUserPositions] subgraph promise rejected:', (result as PromiseRejectedResult).reason?.message || (result as PromiseRejectedResult).reason);
            continue;
        }
        for (const pos of result.value) { if (!seenPositionIds.has(pos.id)) { seenPositionIds.add(pos.id); allRawPositions.push(pos); } }
    }
    console.log('[fetchUserPositions] total raw positions after dedup:', allRawPositions.length);

    // Process all positions
    try {
        if (allRawPositions.length > 0) {
            console.log('[fetchUserPositions] processing', allRawPositions.length, 'positions, chainId:', chainId);
            // Step 1: Batch fetch all position details in parallel
            const positionDetailPromises = allRawPositions.map(async (r) => {
                try {
                    const tokenId = parseTokenIdFromHexId(r.id);
                    if (tokenId === null) return null;
                    const details = await getPositionDetails(tokenId, chainId);
                    return { r, tokenId, details };
                } catch (e: any) {
                    console.error('[fetchUserPositions] failed to fetch details for id', r?.id, 'error:', e?.message || e);
                    return null;
                }
            });

            const positionDetailResults = await Promise.all(positionDetailPromises);
            console.log('[fetchUserPositions] position details fetched:', positionDetailResults.filter(Boolean).length, '/', allRawPositions.length, 'succeeded');
            const positionsWithDetails = positionDetailResults.filter(Boolean) as Array<{
                r: SubgraphPosition;
                tokenId: bigint;
                details: Awaited<ReturnType<typeof getPositionDetails>>;
            }>;

            // Step 2: Determine unique pool IDs and batch fetch pool states
            const poolIdMap = new Map<string, Hex>();
            for (const { r, details } of positionsWithDetails) {
                let poolIdHex = getPoolIdFromPosition(r) as Hex;
                if (!poolIdHex || !poolIdHex.startsWith('0x')) {
                    const encodedPoolKey = encodeAbiParameters([
                        { type: 'tuple', components: [
                            { name: 'currency0', type: 'address' },
                            { name: 'currency1', type: 'address' },
                            { name: 'fee', type: 'uint24' },
                            { name: 'tickSpacing', type: 'int24' },
                            { name: 'hooks', type: 'address' },
                        ]}
                    ], [{
                        currency0: details.poolKey.currency0 as `0x${string}`,
                        currency1: details.poolKey.currency1 as `0x${string}`,
                        fee: Number(details.poolKey.fee),
                        tickSpacing: Number(details.poolKey.tickSpacing),
                        hooks: details.poolKey.hooks as `0x${string}`,
                    }]);
                    poolIdHex = keccak256(encodedPoolKey) as Hex;
                }
                poolIdMap.set(poolIdHex, poolIdHex);
            }

            // Batch fetch all unique pool states in parallel
            const uniquePoolIds = Array.from(poolIdMap.values());
            const poolStatePromises = uniquePoolIds.map(async (poolId) => {
                try {
                    const state = await getPoolState(poolId, chainId);
                    return { poolId, state };
                } catch (e: any) {
                    console.error('[fetchUserPositions] failed to fetch pool state for', poolId, 'error:', e?.message || e);
                    return null;
                }
            });

            const poolStates = (await Promise.all(poolStatePromises)).filter(Boolean) as Array<{
                poolId: Hex;
                state: { sqrtPriceX96: bigint; tick: number; liquidity: bigint };
            }>;

            const stateCache = new Map<string, { sqrtPriceX96: string; tick: number; poolLiquidity: string }>();
            for (const { poolId, state } of poolStates) {
                stateCache.set(poolId, {
                    sqrtPriceX96: state.sqrtPriceX96.toString(),
                    tick: Number(state.tick),
                    poolLiquidity: state.liquidity.toString(),
                });
            }

            // Step 3: Batch fetch uncollected fees for all positions
            const feeCache = new Map<string, { token0UncollectedFees: string; token1UncollectedFees: string }>();
            try {
                const client = createNetworkClient(networkMode);
                const stateView = getStateViewAddress(networkMode);
                const pmAddress = getPositionManagerAddress(networkMode);
                const stateViewAbiParsed = parseAbi(STATE_VIEW_ABI);

                const feeCalls: Array<{ address: `0x${string}`; abi: any; functionName: string; args: any[] }> = [];
                const feeMetadata: Array<{ positionId: string; poolIdBytes32: `0x${string}`; tickLower: number; tickUpper: number; salt: `0x${string}` }> = [];

                for (const { r, details } of positionsWithDetails) {
                    let poolIdBytes32 = getPoolIdFromPosition(r) as `0x${string}`;
                    if (!poolIdBytes32 || !poolIdBytes32.startsWith('0x')) {
                        const encodedPoolKey = encodeAbiParameters([
                            { type: 'tuple', components: [
                                { name: 'currency0', type: 'address' },
                                { name: 'currency1', type: 'address' },
                                { name: 'fee', type: 'uint24' },
                                { name: 'tickSpacing', type: 'int24' },
                                { name: 'hooks', type: 'address' },
                            ]}
                        ], [{
                            currency0: details.poolKey.currency0 as `0x${string}`,
                            currency1: details.poolKey.currency1 as `0x${string}`,
                            fee: Number(details.poolKey.fee),
                            tickSpacing: Number(details.poolKey.tickSpacing),
                            hooks: details.poolKey.hooks as `0x${string}`,
                        }]);
                        poolIdBytes32 = keccak256(encodedPoolKey) as `0x${string}`;
                    }

                    const tokenIdStr = r.id.includes('-') ? r.id.split('-').pop()! : r.id;
                    const salt = `0x${BigInt(tokenIdStr).toString(16).padStart(64, '0')}` as `0x${string}`;

                    feeMetadata.push({
                        positionId: r.id,
                        poolIdBytes32,
                        tickLower: details.tickLower,
                        tickUpper: details.tickUpper,
                        salt,
                    });

                    feeCalls.push({
                        address: stateView as `0x${string}`,
                        abi: stateViewAbiParsed,
                        functionName: 'getPositionInfo',
                        args: [poolIdBytes32, pmAddress as `0x${string}`, details.tickLower, details.tickUpper, salt],
                    });

                    feeCalls.push({
                        address: stateView as `0x${string}`,
                        abi: stateViewAbiParsed,
                        functionName: 'getFeeGrowthInside',
                        args: [poolIdBytes32, details.tickLower, details.tickUpper],
                    });
                }

                if (feeCalls.length > 0) {
                    const feeResults = await client.multicall({ contracts: feeCalls });

                    for (let i = 0; i < feeMetadata.length; i++) {
                        try {
                            const meta = feeMetadata[i];
                            const posInfoResult = feeResults[i * 2];
                            const feeInsideResult = feeResults[i * 2 + 1];

                            if (posInfoResult.status === 'failure' || feeInsideResult.status === 'failure') continue;

                            const posInfo = posInfoResult.result as readonly [bigint, bigint, bigint];
                            const feeInside = feeInsideResult.result as readonly [bigint, bigint];

                            const { token0Fees, token1Fees } = calculateUnclaimedFeesV4(
                                posInfo[0],
                                feeInside[0],
                                feeInside[1],
                                posInfo[1],
                                posInfo[2],
                            );

                            feeCache.set(meta.positionId, {
                                token0UncollectedFees: token0Fees.toString(),
                                token1UncollectedFees: token1Fees.toString(),
                            });
                        } catch (e) {
                            // Skip fee calculation for this position on error
                        }
                    }
                }
            } catch (e: any) {
                console.error('[fetchUserPositions] failed to batch fetch fees:', e?.message || e);
            }

            // Step 4: Process positions with fetched data
            const processed: Position[] = [];
            for (const { r, details } of positionsWithDetails) {
                try {
                    if (details.liquidity <= 0n) {
                        continue;
                    }

                    let poolIdHex = getPoolIdFromPosition(r) as Hex;
                    if (!poolIdHex || !poolIdHex.startsWith('0x')) {
                        const encodedPoolKey = encodeAbiParameters([
                            { type: 'tuple', components: [
                                { name: 'currency0', type: 'address' },
                                { name: 'currency1', type: 'address' },
                                { name: 'fee', type: 'uint24' },
                                { name: 'tickSpacing', type: 'int24' },
                                { name: 'hooks', type: 'address' },
                            ]}
                        ], [{
                            currency0: details.poolKey.currency0 as `0x${string}`,
                            currency1: details.poolKey.currency1 as `0x${string}`,
                            fee: Number(details.poolKey.fee),
                            tickSpacing: Number(details.poolKey.tickSpacing),
                            hooks: details.poolKey.hooks as `0x${string}`,
                        }]);
                        poolIdHex = keccak256(encodedPoolKey) as Hex;
                    }
                    const poolIdStr = poolIdHex;
                    const state = stateCache.get(poolIdStr);
                    if (!state) {
                        console.warn('[fetchUserPositions] no pool state found for', poolIdStr, '- skipping');
                        continue;
                    }

                    const t0Addr = details.poolKey.currency0 as Address;
                    const t1Addr = details.poolKey.currency1 as Address;
                    const sym0 = getTokenSymbolByAddress(t0Addr, networkMode) || 'T0';
                    const sym1 = getTokenSymbolByAddress(t1Addr, networkMode) || 'T1';
                    const cfg0 = sym0 ? getTokenConfig(sym0, networkMode) : undefined;
                    const cfg1 = sym1 ? getTokenConfig(sym1, networkMode) : undefined;
                    const dec0 = cfg0?.decimals ?? 18;
                    const dec1 = cfg1?.decimals ?? 18;
                    const t0 = new Token(chainId, t0Addr, dec0, sym0);
                    const t1 = new Token(chainId, t1Addr, dec1, sym1);

                    const v4Pool = new V4Pool(
                        t0, t1,
                        details.poolKey.fee,
                        details.poolKey.tickSpacing,
                        details.poolKey.hooks,
                        state.sqrtPriceX96,
                        JSBI.BigInt(state.poolLiquidity),
                        state.tick
                    );
                    const v4Position = new V4Position({
                        pool: v4Pool,
                        tickLower: details.tickLower,
                        tickUpper: details.tickUpper,
                        liquidity: JSBI.BigInt(details.liquidity.toString()),
                    });
                    const raw0 = v4Position.amount0.quotient.toString();
                    const raw1 = v4Position.amount1.quotient.toString();
                    const createdTs = Number(r.creationTimestamp || (r as any).createdAtTimestamp || 0);
                    const lastTs = Number(r.lastTimestamp || 0);

                    const feeData = feeCache.get(r.id);

                    const positionIdDecimal = r.id && r.id.startsWith('0x')
                        ? BigInt(r.id).toString()
                        : (r.id || '');

                    processed.push({
                        type: 'v4',
                        positionId: positionIdDecimal,
                        owner: r.owner,
                        poolId: poolIdStr,
                        token0: { address: t0.address, symbol: t0.symbol || 'T0', amount: ethers.utils.formatUnits(raw0, t0.decimals), rawAmount: raw0 },
                        token1: { address: t1.address, symbol: t1.symbol || 'T1', amount: ethers.utils.formatUnits(raw1, t1.decimals), rawAmount: raw1 },
                        tickLower: Number((r as any).tickLower ?? details.tickLower),
                        tickUpper: Number((r as any).tickUpper ?? details.tickUpper),
                        liquidityRaw: ((r as any).liquidity ?? details.liquidity.toString()).toString(),
                        ageSeconds: Math.max(0, Math.floor(Date.now()/1000) - createdTs),
                        blockTimestamp: createdTs || 0,
                        lastTimestamp: lastTs || createdTs || 0,
                        isInRange: state.tick >= details.tickLower && state.tick < details.tickUpper,
                        token0UncollectedFees: feeData?.token0UncollectedFees,
                        token1UncollectedFees: feeData?.token1UncollectedFees,
                    });
                } catch (e: any) {
                    console.error('[fetchUserPositions] failed to process position id', r?.id, 'error:', e?.message || e);
                }
            }

            console.log('[fetchUserPositions] returning', processed.length, 'processed positions');
            return processed;
        } else {
            console.log('[fetchUserPositions] no raw positions to process - returning empty');
        }
    } catch (error: any) {
        console.error('[fetchUserPositions] position processing failed:', error?.message || error);
        return [];
    }

    return [];
}
