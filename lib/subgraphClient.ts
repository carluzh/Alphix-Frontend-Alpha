// Server-side Subgraph client with concurrency cap, retry, jitter, rate limiting, and timeout

import { withRateLimitRetry, rateLimitMiddleware } from './rateLimiter';
import { getSubgraphUrlsWithFallback } from './subgraph-url-helper';

type GraphQLRequest = {
  query: string;
  variables?: Record<string, any>;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string; [k: string]: any }>;
};

// Get subgraph URLs with fallback support
const SUBGRAPH_URLS: string[] = getSubgraphUrlsWithFallback();
const SUBGRAPH_API_KEY: string | undefined = process.env.SUBGRAPH_API_KEY;

if (typeof window !== 'undefined') {
  // This client is server-only by design
  // Intentionally do not throw to avoid breaking client bundles
}

// Concurrency control (simple semaphore)
const MAX_CONCURRENCY = Math.max(1, Number(process.env.SUBGRAPH_MAX_CONCURRENCY || 4));
let activeRequests = 0;
const waitQueue: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (activeRequests < MAX_CONCURRENCY) {
    activeRequests++;
    return;
  }
  await new Promise<void>(resolve => waitQueue.push(resolve));
  activeRequests++;
}

function release(): void {
  activeRequests = Math.max(0, activeRequests - 1);
  const next = waitQueue.shift();
  if (next) next();
}

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

function computeBackoffMs(attempt: number, baseMs = 300, maxMs = 4000): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * 150);
  return Math.min(maxMs, exp + jitter);
}

export interface ExecuteGraphOptions {
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function trySubgraphUrl<T>(url: string, req: GraphQLRequest, options: ExecuteGraphOptions): Promise<T> {
  const timeoutMs = typeof options.timeoutMs === 'number' ? Math.max(1000, options.timeoutMs) : 10000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await acquire();
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SUBGRAPH_API_KEY ? { 'x-api-key': SUBGRAPH_API_KEY } : {}),
        ...options.headers,
      },
      body: JSON.stringify({ query: req.query, variables: req.variables || {} }),
      signal: options.signal || controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeout);
    release();

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Subgraph HTTP ${resp.status}: ${text}`);
    }

    const json = (await resp.json()) as GraphQLResponse<T>;
    if (json.errors && json.errors.length > 0) {
      throw new Error(json.errors[0]?.message || 'GraphQL error');
    }
    if (!json.data) {
      throw new Error('Subgraph returned no data');
    }
    return json.data;
  } catch (err) {
    clearTimeout(timeout);
    try { release(); } catch {}
    throw err;
  }
}

async function executeSubgraphQueryInternal<T>(req: GraphQLRequest, options: ExecuteGraphOptions = {}): Promise<T> {
  if (SUBGRAPH_URLS.length === 0) {
    throw new Error('No subgraph URLs configured');
  }

  let lastError: Error | null = null;

  for (let i = 0; i < SUBGRAPH_URLS.length; i++) {
    const url = SUBGRAPH_URLS[i];
    try {
      const result = await trySubgraphUrl<T>(url, req, options);
      if (i > 0) {
        console.log(`[Subgraph] Fallback succeeded (URL index ${i})`);
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isLastUrl = i === SUBGRAPH_URLS.length - 1;
      if (!isLastUrl) {
        console.warn(`[Subgraph] Primary failed, trying fallback: ${lastError.message}`);
      }
    }
  }

  throw lastError || new Error('All subgraph URLs failed');
}

export async function executeSubgraphQuery<T>(req: GraphQLRequest, options: ExecuteGraphOptions = {}): Promise<T> {
  // Conservative retry strategy (Uniswap pattern: max 2 attempts for 5xx errors only)
  const maxRetries = typeof options.maxRetries === 'number' ? Math.max(0, options.maxRetries) : 1;

  return withRateLimitRetry(
    () => executeSubgraphQueryInternal<T>(req, { ...options, maxRetries: 0 }),
    {
      type: 'subgraph',
      maxAttempts: maxRetries + 1,
      signal: options.signal,
      onRateLimit: (attempt, retryAfter) => {
        console.warn(`[Subgraph] Rate limited, retrying in ${retryAfter}s (attempt ${attempt + 1})`);
      },
    }
  );
}

export function getConcurrencyStatus(): { active: number; queued: number; max: number } {
  return { active: activeRequests, queued: waitQueue.length, max: MAX_CONCURRENCY };
}


