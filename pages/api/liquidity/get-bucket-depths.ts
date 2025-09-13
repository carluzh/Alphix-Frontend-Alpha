import type { NextApiRequest, NextApiResponse } from 'next';
import { getPoolSubgraphId } from '../../../lib/pools-config';

// Server-only subgraph URL (original, unswizzled)
const SUBGRAPH_ORIGINAL_URL = process.env.SUBGRAPH_ORIGINAL_URL as string;
if (!SUBGRAPH_ORIGINAL_URL) {
  throw new Error('SUBGRAPH_ORIGINAL_URL env var is required');
}

// In-memory cache (up to 24h), with incremental refresh window at 1h
const TTL_MS = 24 * 60 * 60 * 1000; // 24h hard cap
const INCREMENTAL_WINDOW_MS = 60 * 60 * 1000; // 1h: try cheap head refresh if older than this
type PositionRow = { id?: string; pool: string; tickLower: number; tickUpper: number; liquidity: string };
type CachedDepth = {
  ts: number;
  // Raw positions kept for incremental merging (ordered by liquidity desc from subgraph)
  positions?: PositionRow[];
  // Last aggregated buckets payload when bucket params are used
  data?: any;
  // a light-weight fingerprint of the head (top 10) to detect changes quickly
  headKeys?: string[];
};
const memCache = new Map<string, CachedDepth>();

function cacheKey(poolId: string, first: number) { return `hookpos:${poolId.toLowerCase()}:${first}`; }
const PER_PAGE = 100; // full (cold) paging
const INCR_PAGE = 10; // incremental paging size
const BACKOFFS_MS = [0, 2000, 5000, 10000];
const HEAD_COMPARE = 10; // compare top 10 for head-stability
const MAX_KEEP = 5000; // cap positions stored per pool to bound memory
const makeKey = (p: PositionRow) => (p && typeof p.id === 'string' && p.id.length > 0)
  ? p.id
  : `${p.tickLower}:${p.tickUpper}:${p.liquidity}`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { poolId, first, tickLower, tickUpper, tickSpacing, bucketCount, inverted } = req.body ?? {};
    if (!poolId || typeof poolId !== 'string') {
      return res.status(400).json({ error: 'Missing poolId in body' });
    }
    // total desired items (cap for safety)
    const totalTarget = Number(first) && Number(first) > 0 ? Math.min(Number(first), 10000) : 2000;

    const apiId = getPoolSubgraphId(poolId) || poolId;
    // Determine if this request asks for bucket aggregation; used to scope cache keys
    const hasBucketParamsEarly = [tickLower, tickUpper, tickSpacing].every((v) => v !== undefined && v !== null);
    const key = cacheKey(apiId, totalTarget) + (hasBucketParamsEarly
      ? `:b:${String(tickLower)}:${String(tickUpper)}:${String(tickSpacing)}:${String(bucketCount ?? '')}`
      : ':p');

    const forceRevalidate = String(req.headers['x-internal-revalidate'] || '').trim() === '1' || String((req.query as any)?.revalidate || '').trim() === '1';
    const cached = memCache.get(key);

    // Helper: incremental merge fetcher
    const fetchPageWithOrder = async (skip: number, pageFirst: number, orderByField: string) => {
      // Only query hookPositions; filter to active liquidity
      const qHook = `
        query GetHookPositions($pool: Bytes!, $first: Int!, $skip: Int!) {
          hookPositions(
            first: $first, skip: $skip,
            orderBy: ${orderByField}, orderDirection: desc,
            where: { pool: $pool, liquidity_gt: "0" }
          ) { id pool tickLower tickUpper liquidity }
        }
      `;
      const resp = await fetch(SUBGRAPH_ORIGINAL_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: qHook, variables: { pool: apiId.toLowerCase(), first: pageFirst, skip } }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`Subgraph query failed: ${resp.status} ${resp.statusText}: ${txt}`);
      }
      const json = await resp.json();
      if (json?.errors) throw new Error(`Subgraph error: ${JSON.stringify(json.errors)}`);
      const pageItems: any[] = Array.isArray(json?.data?.hookPositions) ? json.data.hookPositions : [];
      return pageItems as PositionRow[];
    };

    // Tries blockTimestamp, then createdAtTimestamp, then liquidity
    const fetchPageSmart = async (skip: number, pageFirst: number): Promise<{ rows: PositionRow[]; orderUsed: 'blockTimestamp' | 'createdAtTimestamp' | 'liquidity' }> => {
      try {
        const r = await fetchPageWithOrder(skip, pageFirst, 'blockTimestamp');
        return { rows: r, orderUsed: 'blockTimestamp' };
      } catch {}
      try {
        const r = await fetchPageWithOrder(skip, pageFirst, 'createdAtTimestamp');
        return { rows: r, orderUsed: 'createdAtTimestamp' };
      } catch {}
      const r = await fetchPageWithOrder(skip, pageFirst, 'liquidity');
      return { rows: r, orderUsed: 'liquidity' };
    };

    // Fetch a full list up to total, paging with the chosen order
    const fetchFullPositions = async (total: number, pageSize: number) => {
      const first = await fetchPageSmart(0, Math.min(pageSize, total));
      const out: PositionRow[] = [...first.rows];
      let skip = out.length;
      while (out.length < total) {
        const remain = total - out.length;
        const page = await fetchPageWithOrder(skip, Math.min(pageSize, remain), first.orderUsed);
        out.push(...page);
        if (page.length < Math.min(pageSize, remain)) break;
        skip += page.length;
      }
      return { rows: out, orderUsed: first.orderUsed } as const;
    };

    const sumLiquidity = (rows: PositionRow[] | undefined) => {
      let s = 0n;
      if (!rows) return s;
      for (const p of rows) {
        try { s += BigInt(String(p.liquidity)); } catch {}
      }
      return s;
    };

    // If cache is present, fresh (<1h): serve directly unless it's undersized vs requested 'first'
    if (!forceRevalidate && cached && (Date.now() - cached.ts) < INCREMENTAL_WINDOW_MS && cached.data) {
      const enough = Array.isArray(cached.positions) ? cached.positions.length >= totalTarget : true;
      if (enough) {
        res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=3600');
        return res.status(200).json(cached.data);
      }
      // else fall through to refresh to fill up to totalTarget
    }

    // Incremental path: if we have a cache older than 1h (or forced), fetch the head and merge until overlap
    let positions: PositionRow[] = [];
    // Incremental update if we have a cache and either forced or older than the incremental window, but not past the hard TTL
    if (cached && cached.positions && !forceRevalidate && (Date.now() - cached.ts) >= INCREMENTAL_WINDOW_MS && (Date.now() - cached.ts) < TTL_MS) {
      try {
        // Fetch head page with backoff; prefer time order
        let head: PositionRow[] = [];
        let orderUsed: 'blockTimestamp' | 'createdAtTimestamp' | 'liquidity' = 'liquidity';
        for (let i = 0; i < BACKOFFS_MS.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, BACKOFFS_MS[i]));
          const { rows, orderUsed: ou } = await fetchPageSmart(0, Math.min(INCR_PAGE, totalTarget));
          head = rows;
          orderUsed = ou;
          const headKeys = head.slice(0, HEAD_COMPARE).map(makeKey);
          const cachedHead = (cached.headKeys || []).slice(0, HEAD_COMPARE);
          const headStableTry = headKeys.length && cachedHead.length && headKeys.every((k, j) => k === cachedHead[j]);
          if (!headStableTry) break;
          // else continue backoff attempts
        }
        const headKeys = head.slice(0, HEAD_COMPARE).map(makeKey);
        const cachedHead = (cached.headKeys || []).slice(0, HEAD_COMPARE);
        const headStable = headKeys.length && cachedHead.length && headKeys.every((k, i) => k === cachedHead[i]);
        if (headStable) {
          // No significant change: reuse cached positions
          positions = cached.positions.slice(0, Math.min(cached.positions.length, totalTarget));
        } else {
          // Merge new head with cached body until overlap
          const existingKeys = new Set<string>(cached.positions.map(makeKey));
          const merged: PositionRow[] = [];
          let skip = 0;
          while (merged.length < totalTarget) {
            const page = skip === 0
              ? head
              : (await fetchPageWithOrder(skip, Math.min(INCR_PAGE, totalTarget - merged.length), orderUsed)).map(p => p);
            if (!page.length) break;
            for (const p of page) {
              const k = makeKey(p);
              if (!existingKeys.has(k)) {
                merged.push(p);
              } else {
                // hit overlap: append cached tail excluding already merged keys and stop
                const mergedKeys = new Set<string>(merged.map(makeKey));
                for (const cp of cached.positions) {
                  const ck = makeKey(cp);
                  if (!mergedKeys.has(ck)) merged.push(cp);
                  if (merged.length >= totalTarget) break;
                }
                skip = -1; // signal to break outer loop
                break;
              }
              if (merged.length >= totalTarget) break;
            }
            if (skip < 0 || page.length < INCR_PAGE) break;
            skip += page.length;
          }
          // fallback: if still empty (full overlap at head), reuse full cached set; else use head
          positions = merged.length
            ? merged.slice(0, totalTarget)
            : cached.positions.slice(0, Math.min(cached.positions.length, totalTarget));
          // Ensure chart prioritizes largest liquidity: sort desc by liquidity
          try { positions.sort((a,b) => (BigInt(b.liquidity) > BigInt(a.liquidity) ? 1 : -1)); } catch {}
          // update cache core fields
          const newHeadKeys = positions.slice(0, HEAD_COMPARE).map(makeKey);
          memCache.set(key, { ts: Date.now(), positions: positions.slice(0, Math.min(positions.length, MAX_KEEP)), headKeys: newHeadKeys, data: cached.data });
        }
      } catch {
        // On failure, serve the old cache data
        res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=3600');
        return res.status(200).json(cached.data);
      }
    }

    // Cold path or forced: fetch pages fully up to target
    if (!positions.length) {
      if (forceRevalidate) {
        // Backoff until total liquidity differs vs cached
        const cachedSum = sumLiquidity(cached?.positions);
        let settled: PositionRow[] | null = null;
        for (let i = 0; i < BACKOFFS_MS.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, BACKOFFS_MS[i]));
          const full = await fetchFullPositions(Math.min(totalTarget, 2000), 100);
          const cur = sumLiquidity(full.rows);
          const changed = cachedSum === 0n ? (full.rows.length > 0) : (cur !== cachedSum);
          if (changed) { settled = full.rows; break; }
        }
        positions = (settled || cached?.positions || []).slice(0, totalTarget);
      } else {
        const full = await fetchFullPositions(totalTarget, PER_PAGE);
        positions = full.rows;
      }
      // Ensure chart prioritizes largest liquidity: sort desc by liquidity
      try { positions.sort((a,b) => (BigInt(b.liquidity) > BigInt(a.liquidity) ? 1 : -1)); } catch {}
      const newHeadKeys = positions.slice(0, HEAD_COMPARE).map(makeKey);
      memCache.set(key, { ts: Date.now(), positions: positions.slice(0, Math.min(positions.length, MAX_KEEP)), headKeys: newHeadKeys });
    }

    // If bucket parameters are provided, compute aggregated bucket depths (server-side)
    const hasBucketParams = hasBucketParamsEarly;
    if (hasBucketParams) {
      const lo = Math.floor(Number(tickLower));
      const hi = Math.ceil(Number(tickUpper));
      const spacing = Math.max(1, Math.floor(Number(tickSpacing)) || 1);
      const desiredBuckets = Math.max(1, Math.min(1000, Math.floor(Number(bucketCount)) || 25));

      if (!isFinite(lo) || !isFinite(hi) || lo >= hi) {
        return res.status(400).json({ error: 'Invalid tick range' });
      }

      // Compute aligned bucket size similar to client logic
      const range = hi - lo;
      const MIN_VISUAL_BIN = 30; // ticks
      const minBin = Math.max(MIN_VISUAL_BIN, spacing);
      const rawBucketSize = Math.max(range / desiredBuckets, spacing);
      const targetBucketSize = Math.max(rawBucketSize, minBin);
      const alignedBucketSize = Math.ceil(targetBucketSize / spacing) * spacing;

      const buckets: Array<{ tickLower: number; tickUpper: number; midTick: number; liquidityToken0: string }> = [];
      
      // Align the starting point to tick spacing for consistent bucket boundaries
      const alignedStart = Math.floor(lo / spacing) * spacing;
      let cursor = alignedStart;
      
      while (cursor < hi) {
        const upper = cursor + alignedBucketSize;
        // Only include buckets that have some overlap with the requested range
        if (upper > lo && cursor < hi) {
          const bucketLower = Math.max(cursor, lo);
          const bucketUpper = Math.min(upper, hi);
          buckets.push({ 
            tickLower: bucketLower, 
            tickUpper: bucketUpper, 
            midTick: Math.floor((bucketLower + bucketUpper) / 2), 
            liquidityToken0: '0' 
          });
        }
        cursor = upper;
      }

      // Build proper step function: compute net liquidity changes at each tick boundary
      const tickEvents = new Map<number, bigint>();
      
      for (const pos of positions) {
        const pLo = Number(pos.tickLower);
        const pHi = Number(pos.tickUpper);
        if (!isFinite(pLo) || !isFinite(pHi) || pLo >= pHi) continue;
        let L: bigint = 0n;
        try { L = BigInt(String(pos.liquidity)); } catch { L = 0n; }
        if (L <= 0n) continue;
        
        // Add liquidity at lower tick, remove at upper tick
        const currentLower = tickEvents.get(pLo) || 0n;
        const currentUpper = tickEvents.get(pHi) || 0n;
        tickEvents.set(pLo, currentLower + L);
        tickEvents.set(pHi, currentUpper - L);
      }
      
      // Sort all tick events and build cumulative liquidity
      const sortedTicks = Array.from(tickEvents.keys()).sort((a, b) => a - b);
      const tickToLiquidity = new Map<number, bigint>();
      let cumulativeLiquidity = 0n;
      
      for (const tick of sortedTicks) {
        cumulativeLiquidity += tickEvents.get(tick) || 0n;
        tickToLiquidity.set(tick, cumulativeLiquidity);
      }


      
      // Sample the step function at bucket start (tickLower) to capture active liquidity for the entire bucket range
      for (const bucket of buckets) {
        const sampleTick = bucket.tickLower;
        
        // Find the active liquidity at bucket start by looking at the last tick event <= sampleTick
        let activeLiquidity = 0n;
        for (let i = sortedTicks.length - 1; i >= 0; i--) {
          if (sortedTicks[i] <= sampleTick) {
            activeLiquidity = tickToLiquidity.get(sortedTicks[i]) || 0n;
            break;
          }
        }
        
        bucket.liquidityToken0 = activeLiquidity < 0n ? "0" : activeLiquidity.toString();
      }
      
      // Debug: Check if the massive position is dominating
      const debugRequested = String(req.headers['x-debug-depth'] || '').trim() === '1' || String((req.query as any)?.debug || '').trim() === '1';
      if (debugRequested) {
        const massivePositions = positions.filter(p => Math.abs(Number(p.tickUpper) - Number(p.tickLower)) > 1000000);
        console.log('[get-bucket-depths][debug] Found', massivePositions.length, 'massive positions (>1M tick range)');
        if (massivePositions.length > 0) {
          console.log('[get-bucket-depths][debug] Largest position:', {
            tickLower: massivePositions[0].tickLower,
            tickUpper: massivePositions[0].tickUpper,
            liquidity: massivePositions[0].liquidity,
            range: Number(massivePositions[0].tickUpper) - Number(massivePositions[0].tickLower)
          });
        }
      }

      // Optional debug: log positions and per-bucket net changes when requested
      let debugInfo: any = undefined;
      if (debugRequested) {
        try {
          const existing = memCache.get(key)?.data as any;
          const prevBuckets = Array.isArray(existing?.buckets) ? existing.buckets : [];
          const prevByMid = new Map<number, bigint>();
          for (const pb of prevBuckets) {
            try { prevByMid.set(Number(pb?.midTick), BigInt(String(pb?.liquidityToken0 || '0'))); } catch {}
          }
          const deltas: Array<{ midTick: number; before: string; after: string; delta: string }> = [];
          for (const b of buckets) {
            const before = prevByMid.get(b.midTick) ?? 0n;
            let after: bigint = 0n;
            try { after = BigInt(b.liquidityToken0); } catch { after = 0n; }
            deltas.push({ midTick: b.midTick, before: before.toString(), after: after.toString(), delta: (after - before).toString() });
          }
          // Sample a few positions to avoid log bloat
          const samplePositions = positions.slice(0, 20);
          
          // Debug step function: sample some tick events in our range
          const rangeEvents = Array.from(tickEvents.entries())
            .filter(([tick]) => tick >= lo && tick <= hi)
            .sort(([a], [b]) => a - b)
            .slice(0, 20);
          
          debugInfo = { 
            samplePositions, 
            deltasSample: deltas.slice(0, 50),
            tickEventsInRange: rangeEvents.map(([tick, change]) => ({ tick, change: change.toString() })),
            totalTickEvents: tickEvents.size,
            rangeStats: { lo, hi, spacing, bucketCount: buckets.length }
          };
          // Emit to server logs as well
          console.log('[get-bucket-depths][debug] samplePositions count=', samplePositions.length);
          console.log('[get-bucket-depths][debug] deltasSample count=', Math.min(deltas.length, 50));
          console.log('[get-bucket-depths][debug] tickEvents total=', tickEvents.size, 'in range=', rangeEvents.length);
        } catch {}
      }

      const bucketPayload = { success: true, buckets, poolId: apiId, ...(debugInfo ? { debug: debugInfo } : {}) };
      const existing = memCache.get(key) || { ts: 0 };
      memCache.set(key, { ts: Date.now(), positions: existing.positions, headKeys: existing.headKeys, data: bucketPayload });
      // TTL 24h, allow SWR
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
      return res.status(200).json(bucketPayload);
    } else {
      // Legacy: return raw positions
      const payload = { success: true, positions, totalPositions: positions.length, poolId: apiId };
      const existing = memCache.get(key) || { ts: 0 };
      memCache.set(key, { ts: Date.now(), positions, headKeys: positions.slice(0, HEAD_COMPARE).map(makeKey), data: payload });
      // TTL 24h, allow SWR
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=86400');
      return res.status(200).json(payload);
    }
  } catch (err: any) {
    return res.status(500).json({ error: 'Internal server error', details: err?.message || String(err) });
  }
}

