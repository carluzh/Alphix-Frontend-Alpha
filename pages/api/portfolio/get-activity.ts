import type { NextApiRequest, NextApiResponse } from 'next';
import { publicClient } from '../../../lib/viemClient';
import { parseUnits } from 'viem';
import { getAllPools, getAllTokens } from '../../../lib/pools-config';

type ErrorResponse = { error: string; details?: any };

type Row = {
  id?: string;
  type: 'Swap' | 'Add' | 'Withdraw';
  ts: number;
  tx?: string;
  poolId: string;
  poolSymbols: string;
  amount0?: string;
  amount1?: string;
  sender?: string;
  tickLower?: string;
  tickUpper?: string;
  liquidity?: string;
  blockNumber?: number;
  token0Addr?: string;
  token1Addr?: string;
};

const getSubgraphUrl = () => process.env.SUBGRAPH_URL as string | undefined;
const getGraphHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = process.env.THEGRAPH_API_KEY || process.env.THE_GRAPH_API_KEY || process.env.GRAPH_API_KEY || process.env.SUBGRAPH_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
};

// 10-min in-memory cache + in-flight dedupe
const TTL_MS = 10 * 60 * 1000;
const CACHE = new Map<string, { ts: number; data: Row[] }>();
const INFLIGHT = new Map<string, Promise<Row[]>>();

const ACTIVITY_QUERY = `
  query GetActivity($owner: Bytes!, $poolIds: [Bytes!], $first: Int!) {
    swaps(first: $first, orderBy: timestamp, orderDirection: desc, where: { origin: $owner, pool_in: $poolIds }) {
      id
      timestamp
      sender
      origin
      amount0
      amount1
      pool { id }
    }
    modifyLiquidities(first: $first, orderBy: timestamp, orderDirection: desc, where: { origin: $owner, pool_in: $poolIds }) {
      id
      timestamp
      amount
      amount0
      amount1
      tickLower
      tickUpper
      sender
      origin
      transaction { id }
      pool { id }
    }
  }
`;

function keyFor(owner: string, poolIds: string[], first: number) {
  const pid = (poolIds || []).map((p) => String(p).toLowerCase()).sort().join(',');
  return JSON.stringify({ k: 'activity', owner: String(owner || '').toLowerCase(), pid, first });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Row[] | ErrorResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { owner, poolIds } = (req.body || {}) as { owner?: string; poolIds?: string[] };
    const ownerLc = String(owner || '').toLowerCase();
    const pools = Array.isArray(poolIds) ? poolIds.map((p) => String(p).toLowerCase()) : [];
    const SUBGRAPH_FETCH_COUNT = 20;
    const FINAL_EVENT_COUNT = 20;

    const cacheKey = keyFor(ownerLc, pools, FINAL_EVENT_COUNT);
    const cached = CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < TTL_MS) {
      return res.status(200).json(cached.data);
    }

    if (INFLIGHT.has(cacheKey)) {
      const p = INFLIGHT.get(cacheKey)!;
      const data = await p;
      return res.status(200).json(data);
    }

    const promise = (async () => {
      // Fetch swaps and user modify liquidity events
      const subgraphUrl = getSubgraphUrl();
      if (!subgraphUrl) throw new Error('SUBGRAPH_URL env var is required');
      const resp = await fetch(subgraphUrl, {
        method: 'POST',
        headers: getGraphHeaders(),
        body: JSON.stringify({ query: ACTIVITY_QUERY, variables: { owner: ownerLc, poolIds: pools, first: SUBGRAPH_FETCH_COUNT } }),
      });
      const text = await resp.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch {}
      if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      if (json?.errors?.length) throw new Error(json.errors.map((e: any) => e.message).join('; '));

      const swapsRaw = (json?.data?.swaps || []) as any[];
      const modsRaw = (json?.data?.modifyLiquidities || []) as any[];
      
      const parseTxHash = (id: string | undefined) => {
        if (!id) return undefined;
        const h = String(id).split('-')[0];
        return h && h.startsWith('0x') && h.length === 66 ? (h as `0x${string}`) : undefined;
      };

      // Map poolId to symbols/decimals from pools.json
      const poolMeta = (() => {
        try {
          const poolsCfg = getAllPools();
          const tokenMeta: Record<string, { decimals: number }> = {};
          const allTokens = getAllTokens();
          for (const t of Object.values(allTokens)) {
            tokenMeta[String(t.symbol || '').toLowerCase()] = { decimals: t.decimals };
          }

          const map: Record<string, { s0: string; s1: string; d0: number; d1: number }> = {};
          for (const p of poolsCfg || []) {
            const pid = String(p?.subgraphId || '').toLowerCase();
            const s0 = String(p?.currency0?.symbol || '');
            const s1 = String(p?.currency1?.symbol || '');

            const d0 = tokenMeta[s0.toLowerCase()]?.decimals ?? 18;
            const d1 = tokenMeta[s1.toLowerCase()]?.decimals ?? 18;

            if (pid) map[pid] = { s0, s1, d0: Number.isFinite(d0) ? d0 : 18, d1: Number.isFinite(d1) ? d1 : 18 };
          }
          return map;
        } catch { return {}; }
      })();

      const rows: Row[] = [];
      const userLc = ownerLc;
      for (const r of swapsRaw) {
        const idStr = String(r?.id || '');
        const poolId = String(r?.pool?.id || '').toLowerCase();
        const meta = poolMeta[poolId];
        const poolSymbols = meta ? `${meta.s0}/${meta.s1}` : '';
        const txh = parseTxHash(idStr);
        // Normalize amounts to wei using token decimals
        const norm = (val: any, dec: number) => {
          const raw = String(val ?? '0');
          const neg = raw.startsWith('-');
          const abs = neg ? raw.slice(1) : raw;
          let bi = 0n;
          try { bi = parseUnits(abs, dec); } catch { bi = 0n; }
          return (neg ? ('-' + bi.toString()) : bi.toString());
        };
        const a0 = meta ? norm(r?.amount0, meta.d0) : String(r?.amount0 ?? '0');
        const a1 = meta ? norm(r?.amount1, meta.d1) : String(r?.amount1 ?? '0');
        rows.push({
          id: idStr,
          type: 'Swap',
          ts: Number(r?.timestamp || 0),
          tx: txh,
          poolId,
          poolSymbols,
          amount0: a0,
          amount1: a1,
          sender: r?.sender,
        });
      }

      // Add/Withdraw from modify liquidity
      for (const r of modsRaw) {
        const poolId = String(r?.pool?.id || '').toLowerCase();
        if (pools.length && !pools.includes(poolId)) continue;
        const meta = poolMeta[poolId];
        const poolSymbols = meta ? `${meta.s0}/${meta.s1}` : '';
        const amtStr = String(r?.amount || '0');
        let amt: bigint = 0n;
        try { amt = BigInt(amtStr); } catch {}
        const type: Row['type'] = amt < 0n ? 'Withdraw' : 'Add';
        
        // For modifyLiquidity, amounts are already in wei, but as BigDecimal strings.
        // We just need to parse them as BigInt, stripping any ".0"
        const normWei = (val: any) => {
          const raw = String(val ?? '0').split('.')[0];
          const neg = raw.startsWith('-');
          const abs = neg ? raw.slice(1) : raw;
          let bi = 0n;
          try { bi = BigInt(abs); } catch {}
          return (neg ? ('-' + bi.toString()) : bi.toString());
        };

        const a0 = normWei(r?.amount0);
        const a1 = normWei(r?.amount1);
        rows.push({
          id: String(r?.id || ''),
          type,
          ts: Number(r?.timestamp || 0),
          tx: r?.transaction?.id,
          poolId,
          poolSymbols,
          amount0: a0,
          amount1: a1,
          sender: r?.sender,
          tickLower: String(r?.tickLower ?? ''),
          tickUpper: String(r?.tickUpper ?? ''),
        });
      }

      // Sort desc by ts and cap length
      const out = rows.sort((a, b) => b.ts - a.ts).slice(0, FINAL_EVENT_COUNT);
      CACHE.set(cacheKey, { ts: Date.now(), data: out });
      return out;
    })();

    INFLIGHT.set(cacheKey, promise);
    try {
      const data = await promise;
      return res.status(200).json(data);
    } finally {
      INFLIGHT.delete(cacheKey);
    }
  } catch (e: any) {
    return res.status(500).json({ error: 'Internal server error', details: e?.message || String(e) });
  }
}


