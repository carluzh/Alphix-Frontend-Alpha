/**
 * Centralized fetch client with rate-limit handling and in-flight dedup.
 *
 * Features:
 * - Automatic retry on 429 (rate limit) with Retry-After header support
 * - In-flight request deduplication (same URL+method = shared promise)
 * - Single retry on 5xx errors
 */

// In-flight request dedup map: key → pending promise
const inflight = new Map<string, Promise<Response>>();

interface ApiFetchOptions extends RequestInit {
  /** Skip in-flight deduplication (for mutations) */
  skipDedup?: boolean;
  /** Max retries for server errors (default: 1) */
  maxRetries?: number;
}

/**
 * Fetch wrapper with rate-limit retry and in-flight deduplication.
 *
 * For GET requests (default), identical concurrent calls share a single
 * network request. For mutations (POST/PUT/DELETE), set skipDedup: true.
 */
export async function apiFetch(
  url: string,
  opts: ApiFetchOptions = {}
): Promise<Response> {
  const { skipDedup = false, maxRetries = 1, ...fetchOpts } = opts;
  const method = (fetchOpts.method || 'GET').toUpperCase();
  const dedupKey = `${method}:${url}`;

  // Dedup GET requests — mutations always go through
  if (!skipDedup && method === 'GET') {
    const pending = inflight.get(dedupKey);
    if (pending) return pending.then(r => r.clone());
  }

  const execute = async (): Promise<Response> => {
    let lastResponse: Response | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(url, fetchOpts);
      lastResponse = response;

      // Rate limited — respect Retry-After header
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10);
        const delayMs = Math.min(retryAfter * 1000, 30_000);
        console.warn(`[apiFetch] 429 on ${url}, retrying in ${delayMs}ms`);
        await new Promise(res => setTimeout(res, delayMs));
        continue;
      }

      // Server error — retry once
      if (response.status >= 500 && attempt < maxRetries) {
        console.warn(`[apiFetch] ${response.status} on ${url}, retry ${attempt + 1}/${maxRetries}`);
        await new Promise(res => setTimeout(res, 1000 * (attempt + 1)));
        continue;
      }

      return response;
    }

    // All retries exhausted — return last response
    return lastResponse!;
  };

  const promise = execute().finally(() => {
    inflight.delete(dedupKey);
  });

  if (!skipDedup && method === 'GET') {
    inflight.set(dedupKey, promise);
  }

  return promise;
}
