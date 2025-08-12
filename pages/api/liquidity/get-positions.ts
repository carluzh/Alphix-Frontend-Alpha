import { ethers } from "ethers";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "../../../lib/abis/state_view_abi";
import { publicClient } from "../../../lib/viemClient";
import { getAddress, parseAbi, parseAbiItem, type Address, type Abi, type Hex } from "viem";
import { getTokenSymbolByAddress, getAllPools, getStateViewAddress, getPositionManagerAddress, CHAIN_ID } from "../../../lib/pools-config";
import { position_manager_abi } from "../../../lib/abis/PositionManager_abi";

// Load environment variables - ensure .env is at the root or configure path
// dotenv.config({ path: '.env.local' }); // Removed: Next.js handles .env.local automatically

// Constants
const STATE_VIEW_ADDRESS = getStateViewAddress();
const POSITION_MANAGER_ADDRESS = getPositionManagerAddress();
const DEFAULT_CHAIN_ID = CHAIN_ID;
const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-test/version/latest";

// Minimal subgraph types and query
interface SubgraphToken { id: string; symbol: string; decimals: string }
interface SubgraphHookPosition {
    id: string;
    pool: string;
    owner: string;
    hook: string;
    currency0: SubgraphToken;
    currency1: SubgraphToken;
    tickLower: string;
    tickUpper: string;
    liquidity: string;
    blockNumber: string;
    blockTimestamp: string;
}
const GET_USER_POSITIONS_QUERY = `
  query GetUserPositions($owner: Bytes!) {
    hookPositions(first: 200, orderBy: liquidity, orderDirection: desc, where: { owner: $owner }) {
      id
      pool
      owner
      hook
      currency0 { id symbol decimals }
      currency1 { id symbol decimals }
      tickLower
      tickUpper
      liquidity
      blockNumber
      blockTimestamp
    }
  }
`;
// duplicate removed

// --- Interface for Processed Position Data ---
interface ProcessedPositionToken {
    address: string;
    symbol: string;
    amount: string;
    rawAmount: string;
}

export interface ProcessedPosition { // Export for frontend type usage
    positionId: string;
    poolId: string;
    token0: ProcessedPositionToken;
    token1: ProcessedPositionToken;
    tickLower: number;
    tickUpper: number;
    liquidityRaw: string;
    ageSeconds: number;
    blockTimestamp: string;
    isInRange: boolean;
}

// duplicate types/query removed

// Create lookups from pools.json for dynamic lookup
function createPoolLookups() {
    const pools = getAllPools();
    const bySubgraphIdTickSpacing: { [poolSubgraphId: string]: number } = {};
    const byKey: Record<string, { subgraphId: string; fee: number; tickSpacing: number; hooks: string; currency0: string; currency1: string } > = {};

    for (const p of pools) {
        const key = [getAddress(p.currency0.address), getAddress(p.currency1.address), String(p.fee), String(p.tickSpacing), getAddress(p.hooks)].join('-');
        bySubgraphIdTickSpacing[p.subgraphId.toLowerCase()] = p.tickSpacing;
        byKey[key] = {
            subgraphId: p.subgraphId,
            fee: p.fee,
            tickSpacing: p.tickSpacing,
            hooks: getAddress(p.hooks),
            currency0: getAddress(p.currency0.address),
            currency1: getAddress(p.currency1.address)
        };
    }
    return { bySubgraphIdTickSpacing, byKey };
}

function poolKeyToConfigKey(poolKey: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }): string {
    return [getAddress(poolKey.currency0), getAddress(poolKey.currency1), String(poolKey.fee), String(poolKey.tickSpacing), getAddress(poolKey.hooks)].join('-');
}

// Decode ticks from PositionManager tokenURI metadata (base64 JSON)
function parseTicksFromTokenURI(tokenUri: string): { tickLower: number | null; tickUpper: number | null } {
    try {
        const commaIdx = tokenUri.indexOf(',');
        const payload = commaIdx >= 0 ? tokenUri.slice(commaIdx + 1) : tokenUri;
        const jsonStr = Buffer.from(payload, 'base64').toString('utf8');
        const data = JSON.parse(jsonStr);
        // Try attributes array first
        if (Array.isArray(data?.attributes)) {
            let lower: number | null = null;
            let upper: number | null = null;
            for (const attr of data.attributes) {
                const t = String(attr?.trait_type || attr?.traitType || '').toLowerCase();
                if (t.includes('tick lower') || t.includes('ticklower')) lower = Number(attr?.value);
                if (t.includes('tick upper') || t.includes('tickupper')) upper = Number(attr?.value);
            }
            return { tickLower: Number.isFinite(lower as number) ? (lower as number) : null, tickUpper: Number.isFinite(upper as number) ? (upper as number) : null };
        }
        // Fallback: direct properties
        const lower = Number((data?.tickLower ?? data?.tick_lower));
        const upper = Number((data?.tickUpper ?? data?.tick_upper));
        return {
            tickLower: Number.isFinite(lower) ? lower : null,
            tickUpper: Number.isFinite(upper) ? upper : null,
        };
    } catch {
        return { tickLower: null, tickUpper: null };
    }
}

async function fetchAndProcessUserPositionsForApi(ownerAddress: string): Promise<ProcessedPosition[]> {
    const reqId = Math.random().toString(36).slice(2, 8);
    const log = (...args: any[]) => console.log(`API:get-positions#${reqId} ▶`, ...args);
    const timeStart = (label: string) => ({ label, t: Date.now() });
    const timeEnd = (ctx: { label: string; t: number }) => log(`${ctx.label} took ${Date.now() - ctx.t}ms`);
    async function withTimeout<T>(p: Promise<T>, ms: number, step: string): Promise<T> {
        const start = Date.now();
        let t: any;
        const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms); });
        try {
            const res = await Promise.race([p, timeout]);
            log(`${step} ok in ${Date.now() - start}ms`);
            return res as T;
        } finally {
            clearTimeout(t);
        }
    }
    const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);
    const pmAbi: Abi = position_manager_abi as unknown as Abi;

    const owner = getAddress(ownerAddress);
    // Simple subgraph log of position IDs (requested)
    try {
        const resp = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: GET_USER_POSITIONS_QUERY, variables: { owner: owner.toLowerCase() } }),
        });
        if (resp.ok) {
            const json = await resp.json() as { data?: { hookPositions: SubgraphHookPosition[] } };
            const raw = json?.data?.hookPositions ?? [];
            console.log('Subgraph position IDs:', raw.map(r => r.id));
            // Also return processed results using live slot0 for balances
            if (raw.length > 0) {
                const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);
                const processed: ProcessedPosition[] = [];
                const slot0Cache = new Map<string, { sqrtPriceX96: string; tick: number }>();
                for (const r of raw) {
                    try {
                        const poolCfg = getAllPools().find(p => p.subgraphId?.toLowerCase() === r.pool.toLowerCase());
                        if (!poolCfg) continue;
                        let slot0 = slot0Cache.get(r.pool);
                        if (!slot0) {
                            const s = await publicClient.readContract({
                                address: STATE_VIEW_ADDRESS,
                                abi: stateViewAbiViem,
                                functionName: 'getSlot0',
                                args: [r.pool as unknown as Hex],
                            }) as readonly [bigint, number, number, number];
                            slot0 = { sqrtPriceX96: s[0].toString(), tick: Number(s[1]) };
                            slot0Cache.set(r.pool, slot0);
                        }
                        const t0Addr = (r.currency0 && r.currency0.id) ? (r.currency0.id as Address) : (getAllPools().find(p => p.subgraphId?.toLowerCase() === r.pool.toLowerCase())?.currency0.address as Address);
                        const t1Addr = (r.currency1 && r.currency1.id) ? (r.currency1.id as Address) : (getAllPools().find(p => p.subgraphId?.toLowerCase() === r.pool.toLowerCase())?.currency1.address as Address);
                        const t0Dec = r.currency0?.decimals ? parseInt(r.currency0.decimals, 10) : 18;
                        const t1Dec = r.currency1?.decimals ? parseInt(r.currency1.decimals, 10) : 18;
                        const t0Sym = r.currency0?.symbol || 'T0';
                        const t1Sym = r.currency1?.symbol || 'T1';
                        const t0 = new Token(DEFAULT_CHAIN_ID, t0Addr, t0Dec, t0Sym);
                        const t1 = new Token(DEFAULT_CHAIN_ID, t1Addr, t1Dec, t1Sym);
                        const v4Pool = new V4Pool(t0, t1, poolCfg.fee, poolCfg.tickSpacing, poolCfg.hooks, slot0.sqrtPriceX96, JSBI.BigInt(0), slot0.tick);
                        const v4Position = new V4Position({ pool: v4Pool, tickLower: Number(r.tickLower), tickUpper: Number(r.tickUpper), liquidity: JSBI.BigInt(r.liquidity) });
                        const raw0 = v4Position.amount0.quotient.toString();
                        const raw1 = v4Position.amount1.quotient.toString();
                        processed.push({
                            positionId: r.id || '',
                            poolId: r.pool || '',
                            token0: { address: t0.address, symbol: t0.symbol || 'T0', amount: ethers.utils.formatUnits(raw0, t0.decimals), rawAmount: raw0 },
                            token1: { address: t1.address, symbol: t1.symbol || 'T1', amount: ethers.utils.formatUnits(raw1, t1.decimals), rawAmount: raw1 },
                            tickLower: Number(r.tickLower),
                            tickUpper: Number(r.tickUpper),
                            liquidityRaw: r.liquidity,
                            ageSeconds: Math.max(0, Math.floor(Date.now()/1000) - Number(r.blockTimestamp)),
                            blockTimestamp: r.blockTimestamp,
                            isInRange: slot0.tick >= Number(r.tickLower) && slot0.tick < Number(r.tickUpper),
                        });
                    } catch {}
                }
                return processed;
            }
        }
    } catch {}
    // Fall back to previous logic below if subgraph path fails
    log(`start for ${owner}`);

    // Enumerate ownership strictly via Transfer logs using balanceOf target
    let ownedTokenIds: bigint[] = [];
    let balance: bigint | null = null;
    try {
        balance = await withTimeout(publicClient.readContract({
            address: POSITION_MANAGER_ADDRESS,
            abi: pmAbi,
            functionName: 'balanceOf',
            args: [owner]
        }) as Promise<bigint>, 20000, 'balanceOf(owner)') as bigint;
        log(`balanceOf = ${balance}`);
        if (balance === 0n) {
            log('no NFTs owned, returning []');
            return [];
        }
    } catch (e) {
        log('balanceOf failed; cannot proceed efficiently');
        throw e;
    }

    // Scan Transfer logs backwards until we reach balance
    {
        const targetCount = Number(balance);
        const transferEvent = parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 id)');
        const latestBlock = await withTimeout(publicClient.getBlockNumber(), 15000, 'getBlockNumber');
        log(`log-scan latestBlock=${latestBlock}`);
        const chunkSize = 35000n;
        const seen = new Set<bigint>();
        const ownedSet = new Set<bigint>();
        let end = latestBlock;
        let iterations = 0;
        const maxIterations = 200; // safety cap
        while (ownedSet.size < targetCount && end > 0n && iterations < maxIterations) {
            const start = end > chunkSize ? (end - chunkSize) : 0n;
            log(`log-scan chunk #${iterations + 1} [${start}..${end}]`);
            let logsTo: any[] = [];
            let logsFrom: any[] = [];
            try {
                [logsTo, logsFrom] = await Promise.all([
                    withTimeout(publicClient.getLogs({ address: POSITION_MANAGER_ADDRESS, event: transferEvent, args: { to: owner }, fromBlock: start, toBlock: end }), 20000, `getLogs(to) [${start}..${end}]`),
                    withTimeout(publicClient.getLogs({ address: POSITION_MANAGER_ADDRESS, event: transferEvent, args: { from: owner }, fromBlock: start, toBlock: end }), 20000, `getLogs(from) [${start}..${end}]`),
                ]);
            } catch (err) {
                log('getLogs failed, continuing');
                end = start === 0n ? 0n : (start - 1n);
                iterations += 1;
                continue;
            }
            const merged = [...logsTo, ...logsFrom].sort((a, b) => {
                const bnA = (a.blockNumber ?? 0n) as bigint;
                const bnB = (b.blockNumber ?? 0n) as bigint;
                if (bnA !== bnB) return bnA > bnB ? -1 : 1;
                const liA = (a.logIndex ?? 0) as number;
                const liB = (b.logIndex ?? 0) as number;
                return liA > liB ? -1 : (liA < liB ? 1 : 0);
            });
            for (const ev of merged) {
                const id = ev.args?.id as bigint;
                if (seen.has(id)) continue;
                seen.add(id);
                const toAddr = ev.args?.to ? getAddress(ev.args.to as string) : undefined;
                const fromAddr = ev.args?.from ? getAddress(ev.args.from as string) : undefined;
                if (toAddr === owner) ownedSet.add(id);
                else if (fromAddr === owner) ownedSet.delete(id);
                if (ownedSet.size >= targetCount) break;
            }
            end = start === 0n ? 0n : (start - 1n);
            iterations += 1;
        }
        ownedTokenIds = Array.from(ownedSet);
        log(`log-scan found tokenIds = [${ownedTokenIds.join(', ')}]`);
    }
    if (ownedTokenIds.length === 0) {
        log('no tokenIds discovered, returning []');
        return [];
    }

    // Read pool keys, liquidity and tokenURIs for each tokenId
    type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
    const { bySubgraphIdTickSpacing, byKey } = createPoolLookups();

    // Batch calls
    const poolAndInfoCalls = ownedTokenIds.map((id) => ({
        address: POSITION_MANAGER_ADDRESS,
        abi: pmAbi,
        functionName: 'getPoolAndPositionInfo',
        args: [id],
    }));
    const liqCalls = ownedTokenIds.map((id) => ({
        address: POSITION_MANAGER_ADDRESS,
        abi: pmAbi,
        functionName: 'getPositionLiquidity',
        args: [id],
    }));
    const uriCalls = ownedTokenIds.map((id) => ({
        address: POSITION_MANAGER_ADDRESS,
        abi: pmAbi,
        functionName: 'tokenURI',
        args: [id],
    }));

    log(`reading pool/info for ${ownedTokenIds.length} tokenIds...`);
    const poolAndInfoResults = await Promise.all(
        poolAndInfoCalls.map((c) => publicClient.readContract(c as any).then(
            (res) => ({ status: 'success' as const, result: res }),
            (err) => { log('getPoolAndPositionInfo failed'); return ({ status: 'error' as const, result: null as any }); }
        ))
    );
    log('reading position liquidity...');
    const liqResults = await Promise.all(
        liqCalls.map((c) => publicClient.readContract(c as any).then(
            (res) => ({ status: 'success' as const, result: res }),
            (err) => { log('getPositionLiquidity failed'); return ({ status: 'error' as const, result: null as any }); }
        ))
    );
    log('reading tokenURI...');
    const uriResults = await Promise.all(
        uriCalls.map((c) => publicClient.readContract(c as any).then(
            (res) => ({ status: 'success' as const, result: res }),
            (err) => { log('tokenURI failed'); return ({ status: 'error' as const, result: null as any }); }
        ))
    );

    // Prepare processed positions
    const processedPositions: ProcessedPosition[] = [];
    const poolStateCache = new Map<string, { sqrtPriceX96: string; tick: number }>();

    for (let i = 0; i < ownedTokenIds.length; i += 1) {
        try {
            const tokenId = ownedTokenIds[i];
            const poolAndInfo = poolAndInfoResults[i];
            const liqRes = liqResults[i];
            const uriRes = uriResults[i];

            if (poolAndInfo.status !== 'success' || liqRes.status !== 'success' || uriRes.status !== 'success') {
                console.warn(`Skipping tokenId ${tokenId} due to failed multicall result`);
                continue;
            }

            const [poolKey /*, info*/] = poolAndInfo.result as unknown as [PoolKey, bigint];
            const liquidity = liqRes.result as bigint;
            const tokenUri = uriRes.result as string;
            log(`tokenId=${tokenId} poolKey={c0:${poolKey.currency0}, c1:${poolKey.currency1}, fee:${poolKey.fee}, ts:${poolKey.tickSpacing}, hooks:${poolKey.hooks}} liquidity=${liquidity} tokenURI.length=${tokenUri?.length ?? 0}`);

            // Map poolKey to configured pool (to get subgraphId & verify allowed pools)
            const lookupKey = poolKeyToConfigKey(poolKey);
            const poolCfg = byKey[lookupKey];
            if (!poolCfg) {
                log(`tokenId=${tokenId} poolKey not in pools.json, skipping`);
                continue; 
            }

            // Parse ticks from tokenURI metadata
            const { tickLower, tickUpper } = parseTicksFromTokenURI(tokenUri);
            if (tickLower === null || tickUpper === null) {
                log(`tokenId=${tokenId} ticks not found in tokenURI; skipping`);
                continue;
            }
            log(`tokenId=${tokenId} ticks [${tickLower}, ${tickUpper}]`);

            // Fetch live slot0 for this pool
            let slot0 = poolStateCache.get(poolCfg.subgraphId);
            if (!slot0) {
                    const slot0Data = await publicClient.readContract({
                        address: STATE_VIEW_ADDRESS,
                        abi: stateViewAbiViem,
                        functionName: 'getSlot0',
                    args: [poolCfg.subgraphId as unknown as Hex],
                }) as readonly [bigint, number, number, number];
                slot0 = { sqrtPriceX96: slot0Data[0].toString(), tick: Number(slot0Data[1]) };
                poolStateCache.set(poolCfg.subgraphId, slot0);
                log(`pool ${poolCfg.subgraphId} slot0.tick=${slot0.tick}`);
            }

            // SDK tokens
            const sdkToken0 = new Token(DEFAULT_CHAIN_ID, poolCfg.currency0, getTokenSymbolByAddress(poolCfg.currency0)?.toString() ? (getAllPools().find(p => getAddress(p.currency0.address) === poolCfg.currency0)?.currency0 ? (getAllPools().find(p => getAddress(p.currency0.address) === poolCfg.currency0) as any).currency0.decimals : 18) : 18, (getAllPools().find(p => getAddress(p.currency0.address) === poolCfg.currency0)?.currency0?.symbol as string) || getTokenSymbolByAddress(poolCfg.currency0) || 'T0');
            const sdkToken1 = new Token(DEFAULT_CHAIN_ID, poolCfg.currency1, (getAllPools().find(p => getAddress(p.currency1.address) === poolCfg.currency1)?.currency1 ? (getAllPools().find(p => getAddress(p.currency1.address) === poolCfg.currency1) as any).currency1.decimals : 18), (getAllPools().find(p => getAddress(p.currency1.address) === poolCfg.currency1)?.currency1?.symbol as string) || getTokenSymbolByAddress(poolCfg.currency1) || 'T1');

            // Above, decimals discovery via pools.json tokens would be more reliable; do that instead
            const tokensCfg = (await import('../../../lib/pools-config')).getAllTokens();
            const t0Meta = Object.values(tokensCfg).find(t => getAddress(t.address) === poolCfg.currency0);
            const t1Meta = Object.values(tokensCfg).find(t => getAddress(t.address) === poolCfg.currency1);
            const sdk0 = new Token(DEFAULT_CHAIN_ID, poolCfg.currency0, t0Meta?.decimals ?? 18, t0Meta?.symbol ?? 'T0');
            const sdk1 = new Token(DEFAULT_CHAIN_ID, poolCfg.currency1, t1Meta?.decimals ?? 18, t1Meta?.symbol ?? 'T1');

            // Build V4 pool and position
            const v4Pool = new V4Pool(
                sdk0,
                sdk1,
                poolCfg.fee,
                poolCfg.tickSpacing,
                poolCfg.hooks,
                slot0.sqrtPriceX96,
                JSBI.BigInt(0),
                slot0.tick
            );
            const v4Position = new V4Position({ pool: v4Pool, tickLower, tickUpper, liquidity: JSBI.BigInt(liquidity.toString()) });

            const rawAmount0 = v4Position.amount0.quotient.toString();
            const rawAmount1 = v4Position.amount1.quotient.toString();
            const formattedAmount0 = ethers.utils.formatUnits(rawAmount0, sdk0.decimals);
            const formattedAmount1 = ethers.utils.formatUnits(rawAmount1, sdk1.decimals);
            const isInRange = slot0.tick >= tickLower && slot0.tick < tickUpper;
            log(`tokenId=${tokenId} amounts {${sdk0.symbol}:${formattedAmount0}, ${sdk1.symbol}:${formattedAmount1}} inRange=${isInRange}`);

            processedPositions.push({
                positionId: tokenId.toString(),
                poolId: poolCfg.subgraphId,
                token0: {
                    address: sdk0.address,
                    symbol: t0Meta?.symbol ?? getTokenSymbolByAddress(sdk0.address) ?? 'N/A',
                    amount: formattedAmount0,
                    rawAmount: rawAmount0,
                },
                token1: {
                    address: sdk1.address,
                    symbol: t1Meta?.symbol ?? getTokenSymbolByAddress(sdk1.address) ?? 'N/A',
                    amount: formattedAmount1,
                    rawAmount: rawAmount1,
                },
                tickLower,
                tickUpper,
                liquidityRaw: liquidity.toString(),
                ageSeconds: 0, // Unknown without subgraph; omit
                blockTimestamp: '0',
                isInRange,
            });
        } catch (err) {
            log(`error processing tokenId ${ownedTokenIds[i]}`);
        }
    }

    log(`done, total positions ${processedPositions.length}`);
    return processedPositions;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProcessedPosition[] | { message: string; count?: number; error?: any }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const { ownerAddress, countOnly } = req.query as { ownerAddress?: string; countOnly?: string };

  if (!ownerAddress || typeof ownerAddress !== 'string' || !ethers.utils.isAddress(ownerAddress)) { // Keep ethers for isAddress for now, or switch to viem's isAddress
    return res.status(400).json({ message: 'Valid ownerAddress query parameter is required.' });
  }

  try {
    if (countOnly === '1') {
      // Lightweight count from onchain logs
      const transferEvent = parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 id)');
      const [logsTo, logsFrom] = await Promise.all([
        publicClient.getLogs({ address: POSITION_MANAGER_ADDRESS, event: transferEvent, args: { to: getAddress(ownerAddress) }, fromBlock: 0n }),
        publicClient.getLogs({ address: POSITION_MANAGER_ADDRESS, event: transferEvent, args: { from: getAddress(ownerAddress) }, fromBlock: 0n }),
      ]);
      const tokenIdToDelta = new Map<bigint, number>();
      for (const l of logsTo) tokenIdToDelta.set(l.args?.id as bigint, (tokenIdToDelta.get(l.args?.id as bigint) || 0) + 1);
      for (const l of logsFrom) tokenIdToDelta.set(l.args?.id as bigint, (tokenIdToDelta.get(l.args?.id as bigint) || 0) - 1);
      const count = Array.from(tokenIdToDelta.values()).filter((d) => d > 0).length;
      return res.status(200).json({ message: 'ok', count });
    }

      const positions = await fetchAndProcessUserPositionsForApi(ownerAddress);
      return res.status(200).json(positions);
  } catch (error: any) {
    console.error(`API Error in /api/liquidity/get-positions for ${ownerAddress}:`, error);
    // Ensure error is serializable
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred while fetching positions.";
    const errorDetails = error instanceof Error ? { name: error.name, stack: error.stack } : {}; // Include more details if needed, carefully for prod
    // Check if running in development to provide more details
    const detailedError = process.env.NODE_ENV === 'development' ? errorDetails : {};
    return res.status(500).json({ message: errorMessage, error: detailedError });
  }
} 