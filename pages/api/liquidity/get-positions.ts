import { ethers } from "ethers";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "../../../lib/abis/state_view_abi";
import { publicClient } from "../../../lib/viemClient";
import { getAddress, parseAbi, type Address, type Hex } from "viem";
import { getTokenSymbolByAddress, getAllPools, getStateViewAddress, CHAIN_ID } from "../../../lib/pools-config";

// Load environment variables - ensure .env is at the root or configure path
// dotenv.config({ path: '.env.local' }); // Removed: Next.js handles .env.local automatically

// Constants
const STATE_VIEW_ADDRESS = getStateViewAddress();
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
// Removed: on-chain pool lookups and key mapping (subgraph-only now)

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
    const owner = getAddress(ownerAddress);
    // Subgraph-only path
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
    // If the subgraph returns nothing or fails, return empty list (no on-chain fallback)
    return [];
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
      // Count via subgraph only
      try {
        const resp = await fetch(SUBGRAPH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: GET_USER_POSITIONS_QUERY, variables: { owner: ownerAddress.toLowerCase() } }),
        });
        if (!resp.ok) return res.status(200).json({ message: 'ok', count: 0 });
        const json = await resp.json() as { data?: { hookPositions: SubgraphHookPosition[] } };
        const raw = json?.data?.hookPositions ?? [];
        return res.status(200).json({ message: 'ok', count: raw.length });
      } catch {
        return res.status(200).json({ message: 'ok', count: 0 });
      }
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