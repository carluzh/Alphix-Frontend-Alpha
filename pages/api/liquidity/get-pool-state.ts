import type { NextApiRequest, NextApiResponse } from 'next';
import { parseAbi, type Hex } from 'viem';
import { getPoolSubgraphId, getAllPools, getStateViewAddress, getToken } from '@/lib/pools-config';
import { publicClient } from '@/lib/viemClient';
import { PoolStateSchema, validateApiResponse } from '@/lib/validation';

const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity)'
]);

// Simple in-memory server cache for this endpoint
const serverCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL_MS = 15 * 1000; // 15 seconds

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const raw = String(req.query.poolId || '');
  if (!raw) return res.status(400).json({ message: 'poolId is required' });

  // Accept either friendly route id or subgraph id
  const all = getAllPools();
  const maybe = all.find(p => String(p.id).toLowerCase() === raw.toLowerCase());
  const subgraphId = (maybe?.subgraphId || getPoolSubgraphId(raw) || raw) as string;
  const cacheKey = `pool-state:${subgraphId}`;

  try {
    const poolIdHex = subgraphId as Hex;
    const address = getStateViewAddress() as `0x${string}`;

    const [slot0, liquidity] = await Promise.all([
      publicClient.readContract({ address, abi: stateViewAbi, functionName: 'getSlot0', args: [poolIdHex] }) as Promise<readonly [bigint, number, number, number]>,
      publicClient.readContract({ address, abi: stateViewAbi, functionName: 'getLiquidity', args: [poolIdHex] }) as Promise<bigint>,
    ]);

    const [sqrtPriceX96, tick, protocolFee, lpFee] = slot0;

    const twoPow96 = 2 ** 96;
    const sqrtAsNumber = Number(sqrtPriceX96) / twoPow96;
    let currentPrice = Number.isFinite(sqrtAsNumber) ? (sqrtAsNumber * sqrtAsNumber) : 0;

    try {
      const allPools = getAllPools();
      const lowerRaw = raw.toLowerCase();
      const poolCfg = allPools.find(p => String(p.subgraphId).toLowerCase() === String(subgraphId).toLowerCase())
        || allPools.find(p => String(p.id).toLowerCase() === lowerRaw);
      if (poolCfg) {
        const token0Cfg = getToken(poolCfg.currency0.symbol);
        const token1Cfg = getToken(poolCfg.currency1.symbol);
        if (token0Cfg && token1Cfg) {
          const addr0 = token0Cfg.address.toLowerCase();
          const addr1 = token1Cfg.address.toLowerCase();
          const sorted0 = addr0 < addr1 ? token0Cfg : token1Cfg;
          const sorted1 = addr0 < addr1 ? token1Cfg : token0Cfg;
          const exp = (sorted0.decimals ?? 0) - (sorted1.decimals ?? 0);
          currentPrice = currentPrice * Math.pow(10, exp);
        }
      }
    } catch {
      // ignore decimals adjustment failure; fallback to raw ratio
    }
    const currentPriceString = String(currentPrice);

    const responseData = {
      poolId: subgraphId,
      sqrtPriceX96: sqrtPriceX96.toString(),
      tick,
      protocolFee,
      lpFee,
      liquidity: liquidity.toString(),
      currentPoolTick: tick,
      currentPrice: currentPriceString,
    };

    const validatedData = validateApiResponse(PoolStateSchema, responseData, 'get-pool-state');
    
    // On success, update cache
    serverCache.set(cacheKey, { data: validatedData, ts: Date.now() });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(validatedData);
  } catch (error: any) {
    // On failure, try to serve from cache
    const cached = serverCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
      console.warn(`[get-pool-state] Serving stale state for ${subgraphId} due to fetch error.`);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(cached.data);
    }
    return res.status(500).json({ message: 'Failed to read pool state', error: String(error?.message || error) });
  }
} 