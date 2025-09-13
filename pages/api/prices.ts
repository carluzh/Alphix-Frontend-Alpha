import type { NextApiRequest, NextApiResponse } from 'next';

const COINGECKO_PRICE_ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price';

// Simple in-memory cache + dedupe for the proxy to avoid hammering CoinGecko
let cached: { ts: number; data: any } | null = null;
let ongoing: Promise<any> | null = null;
const TTL_MS = Number(process.env.PRICE_CACHE_TTL_MS || 20 * 1000); // 20s default

async function fetchFromCoinGecko(ids: string, vs: string, includeChange: boolean) {
  const url = `${COINGECKO_PRICE_ENDPOINT}?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vs)}${includeChange ? '&include_24hr_change=true' : ''}`;
  const resp = await fetch(url, { cache: 'no-store' });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    const err = new Error(`CoinGecko responded ${resp.status}: ${txt}`);
    // attach status for caller
    (err as any).status = resp.status;
    throw err;
  }
  return await resp.json();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const ids = String(req.query.ids || 'bitcoin,usd-coin,ethereum,tether');
    const vs = String(req.query.vs || 'usd');
    const includeChange = String(req.query.include_24hr_change || 'true') === 'true';

    // Serve cached if fresh
    if (cached && Date.now() - cached.ts < TTL_MS) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', `public, s-maxage=${Math.floor(TTL_MS / 1000)}`);
      return res.status(200).json(cached.data);
    }

    // Deduplicate concurrent fetches
    if (ongoing) {
      const data = await ongoing;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', `public, s-maxage=${Math.floor(TTL_MS / 1000)}`);
      return res.status(200).json(data);
    }

    ongoing = (async () => {
      try {
        const data = await fetchFromCoinGecko(ids, vs, includeChange);
        cached = { ts: Date.now(), data };
        return data;
      } catch (err: any) {
        console.error('[prices API] fetch error', err);
        // If rate-limited and we have cached data, return cached instead of erroring
        if ((err?.status === 429 || err?.message?.includes('429')) && cached) {
          return cached.data;
        }
        throw err;
      } finally {
        ongoing = null;
      }
    })();

    const result = await ongoing;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', `public, s-maxage=${Math.floor(TTL_MS / 1000)}`);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[prices API] proxy error', err);
    // As a last resort, return fallback minimal shape
    return res.status(502).json({ error: String(err?.message || err) });
  }
}


