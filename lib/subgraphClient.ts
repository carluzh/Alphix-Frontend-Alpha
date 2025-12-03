// Server-side Subgraph client with concurrency cap, retry, jitter, rate limiting, and timeout

import { withRateLimitRetry, rateLimitMiddleware } from './rateLimiter';
import { getBaseSubgraphUrl } from './subgraph-url-helper';

type GraphQLRequest = {
  query: string;
  variables?: Record<string, any>;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string; [k: string]: any }>;
};

// Use network-aware subgraph URL
const SUBGRAPH_URL: string = getBaseSubgraphUrl();
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

async function executeSubgraphQueryInternal<T>(req: GraphQLRequest, options: ExecuteGraphOptions = {}): Promise<T> {
  if (!SUBGRAPH_URL) {
    throw new Error('SUBGRAPH_URL env var is required for subgraph requests');
  }

  const timeoutMs = typeof options.timeoutMs === 'number' ? Math.max(1000, options.timeoutMs) : 10000;

  let lastError: unknown = undefined;

  // Single attempt with rate limiting handled at higher level
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await acquire();
    const resp = await fetch(SUBGRAPH_URL, {
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
      if (resp.status === 429 || (resp.status >= 500 && resp.status <= 599)) {
        lastError = new Error(`Subgraph HTTP ${resp.status}`);
        throw lastError;
      } else {
        const text = await resp.text();
        throw new Error(`Subgraph error ${resp.status}: ${text}`);
      }
    } else {
      const json = (await resp.json()) as GraphQLResponse<T>;
      if (json.errors && json.errors.length > 0) {
        const first = json.errors[0]?.message || 'GraphQL error';
        const transient = /timeout|rate|limit|temporar|overload|unavailable/i.test(first);
        if (transient) {
          lastError = new Error(first);
          throw lastError;
        } else {
          throw new Error(first);
        }
      } else if (json.data) {
        return json.data;
      } else {
        throw new Error('Subgraph returned no data');
      }
    }
  } catch (err) {
    clearTimeout(timeout);
    try { release(); } catch {}
    throw err;
  }

  throw lastError instanceof Error ? lastError : new Error('Subgraph request failed');
}

export async function executeSubgraphQuery<T>(req: GraphQLRequest, options: ExecuteGraphOptions = {}): Promise<T> {
  const maxRetries = typeof options.maxRetries === 'number' ? Math.max(0, options.maxRetries) : 3;

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


