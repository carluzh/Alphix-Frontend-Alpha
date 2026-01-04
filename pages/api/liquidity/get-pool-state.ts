import type { NextApiRequest, NextApiResponse } from 'next';
import { parseAbi, type Hex } from 'viem';
import { getPoolSubgraphId, getAllPools, getStateViewAddress, getToken, getNetworkModeFromRequest } from '@/lib/pools-config';
import { createNetworkClient } from '@/lib/viemClient';
import { PoolStateSchema, validateApiResponse, GetPoolStateInputSchema, validateApiInput } from '@/lib/validation';

const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity)'
]);

const Q96n = 1n << 96n;
const Q192n = Q96n * Q96n;

const pow10 = (exp: number): bigint => {
  if (exp <= 0) return 1n;
  let r = 1n;
  for (let i = 0; i < exp; i++) r *= 10n;
  return r;
};

const formatFixed = (value: bigint, decimals: number): string => {
  const negative = value < 0n;
  const v = negative ? -value : value;
  if (decimals <= 0) return `${negative ? '-' : ''}${v.toString()}`;
  const base = pow10(decimals);
  const whole = v / base;
  const frac = v % base;
  let fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fracStr ? `.${fracStr}` : ''}`;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  // Get network mode from cookies
  const networkMode = getNetworkModeFromRequest(req.headers.cookie);

  // Input validation (Uniswap safeParse pattern)
  const inputValidation = validateApiInput(GetPoolStateInputSchema, req.query, 'get-pool-state');
  if (!inputValidation.success) {
    return res.status(400).json({ message: inputValidation.error });
  }
  const raw = inputValidation.data.poolId;

  // Accept either friendly route id or subgraph id (bytes32 hex)
  const all = getAllPools(networkMode);
  const maybe = all.find(p => String(p.id).toLowerCase() === raw.toLowerCase());
  let subgraphId = maybe?.subgraphId || getPoolSubgraphId(raw, networkMode);

  // If not found by friendly ID, check if raw is already a valid bytes32 hex
  if (!subgraphId && /^0x[a-fA-F0-9]{64}$/.test(raw)) {
    subgraphId = raw;
  }

  // Validate we have a proper bytes32 hex string
  if (!subgraphId || !/^0x[a-fA-F0-9]{64}$/.test(subgraphId)) {
    console.error('[get-pool-state] Pool not found:', raw, 'networkMode:', networkMode, 'available pools:', all.map(p => p.id));
    return res.status(404).json({
      message: 'Pool not found',
      poolId: raw,
      networkMode,
      hint: 'Check that the pool exists in the current network configuration'
    });
  }

  try {
    // No caching - pool state (sqrtPriceX96, tick, liquidity) must always be fresh for accurate quotes
    const poolIdHex = subgraphId as Hex;
    const address = getStateViewAddress(networkMode) as `0x${string}`;
    const client = createNetworkClient(networkMode);

    // Promise.allSettled pattern (identical to Uniswap getPool.ts)
    const [slot0Result, liquidityResult] = await Promise.allSettled([
      client.readContract({ address, abi: stateViewAbi, functionName: 'getSlot0', args: [poolIdHex] }) as Promise<readonly [bigint, number, number, number]>,
      client.readContract({ address, abi: stateViewAbi, functionName: 'getLiquidity', args: [poolIdHex] }) as Promise<bigint>,
    ]);

    // Extract results - both required for pool state
    if (slot0Result.status !== 'fulfilled' || liquidityResult.status !== 'fulfilled') {
      const error = slot0Result.status === 'rejected' ? slot0Result.reason : liquidityResult.status === 'rejected' ? liquidityResult.reason : 'Unknown error';
      console.error('[get-pool-state] RPC call failed:', error);
      return res.status(500).json({ message: 'Failed to read pool state', error: String(error?.message || error) });
    }

    const slot0 = slot0Result.value;
    const liquidity = liquidityResult.value;
    const [sqrtPriceX96, tick, protocolFee, lpFee] = slot0;

    // Compute price using bigint math (Number(sqrtPriceX96) loses precision; stable pools show as 1.00)
    // Uniswap convention: price = token1/token0 in Q192: (sqrtPriceX96^2) / 2^192
    const scale = 18; // enough precision for stable pools, cheap enough for API
    const sqrt = BigInt(sqrtPriceX96);
    let numerator = sqrt * sqrt * pow10(scale);
    let denominator = Q192n;

    try {
      const allPools = getAllPools(networkMode);
      const lowerRaw = raw.toLowerCase();
      const poolCfg = allPools.find(p => String(p.subgraphId).toLowerCase() === String(subgraphId).toLowerCase())
        || allPools.find(p => String(p.id).toLowerCase() === lowerRaw);
      if (poolCfg) {
        const token0Cfg = getToken(poolCfg.currency0.symbol, networkMode);
        const token1Cfg = getToken(poolCfg.currency1.symbol, networkMode);
        if (token0Cfg && token1Cfg) {
          const addr0 = token0Cfg.address.toLowerCase();
          const addr1 = token1Cfg.address.toLowerCase();
          const sorted0 = addr0 < addr1 ? token0Cfg : token1Cfg;
          const sorted1 = addr0 < addr1 ? token1Cfg : token0Cfg;
          const exp = (sorted0.decimals ?? 0) - (sorted1.decimals ?? 0);
          if (exp > 0) {
            numerator *= pow10(exp);
          } else if (exp < 0) {
            denominator *= pow10(-exp);
          }
        }
      }
    } catch {
      // ignore decimals adjustment failure; fallback to raw ratio
    }

    const priceScaled = denominator === 0n ? 0n : numerator / denominator;
    const currentPrice = formatFixed(priceScaled, scale);

    const responseData = {
      poolId: subgraphId,
      sqrtPriceX96: sqrtPriceX96.toString(),
      tick,
      protocolFee,
      lpFee,
      liquidity: liquidity.toString(),
      currentPoolTick: tick,
      currentPrice,
    };

    const validated = validateApiResponse(PoolStateSchema, responseData, 'get-pool-state', 'handler');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(validated);
  } catch (error: any) {
    console.error('[get-pool-state] Error for poolId:', raw, 'networkMode:', networkMode, 'error:', error);
    return res.status(500).json({ message: 'Failed to read pool state', error: String(error?.message || error) });
  }
} 