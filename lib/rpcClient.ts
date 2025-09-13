// Rate-limited RPC client for blockchain calls

import { withRateLimitRetry } from './rateLimiter';

interface RPCRequest {
  method: string;
  params?: any[];
  id?: number;
}

interface RPCResponse<T = any> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

// Rate-limited fetch wrapper for RPC endpoints
async function fetchRPC(url: string, body: string, options: { timeout?: number; signal?: AbortSignal } = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || 10000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
      signal: options.signal || controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Execute single RPC call with rate limiting
export async function executeRPCCall<T>(
  url: string,
  request: RPCRequest,
  options: {
    timeout?: number;
    maxRetries?: number;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const { timeout = 10000, maxRetries = 2, signal } = options;

  return withRateLimitRetry(
    async () => {
      const rpcPayload = {
        jsonrpc: '2.0',
        id: request.id || Math.floor(Math.random() * 1000000),
        method: request.method,
        params: request.params || [],
      };

      const response = await fetchRPC(url, JSON.stringify(rpcPayload), { timeout, signal });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(`RPC rate limited: ${response.status}`);
        } else if (response.status >= 500) {
          throw new Error(`RPC server error: ${response.status}`);
        } else {
          const text = await response.text();
          throw new Error(`RPC error ${response.status}: ${text}`);
        }
      }

      const json: RPCResponse<T> = await response.json();

      if (json.error) {
        // Check for rate limiting errors
        if (json.error.code === -32005 || /rate.?limit/i.test(json.error.message)) {
          throw new Error(`RPC rate limited: ${json.error.message}`);
        }
        throw new Error(`RPC error: ${json.error.message}`);
      }

      if (json.result === undefined) {
        throw new Error('RPC response missing result');
      }

      return json.result;
    },
    {
      type: 'rpc',
      maxAttempts: maxRetries + 1,
      signal,
      onRateLimit: (attempt, retryAfter) => {
        console.warn(`[RPC] Rate limited, retrying in ${retryAfter}s (attempt ${attempt + 1})`);
      },
    }
  );
}

// Batch RPC calls with rate limiting
export async function executeRPCBatch<T extends any[]>(
  url: string,
  requests: RPCRequest[],
  options: {
    timeout?: number;
    maxRetries?: number;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const { timeout = 15000, maxRetries = 2, signal } = options;

  return withRateLimitRetry(
    async () => {
      const rpcPayloads = requests.map((req, index) => ({
        jsonrpc: '2.0',
        id: req.id || index + 1,
        method: req.method,
        params: req.params || [],
      }));

      const response = await fetchRPC(url, JSON.stringify(rpcPayloads), { timeout, signal });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(`RPC batch rate limited: ${response.status}`);
        } else if (response.status >= 500) {
          throw new Error(`RPC batch server error: ${response.status}`);
        } else {
          const text = await response.text();
          throw new Error(`RPC batch error ${response.status}: ${text}`);
        }
      }

      const json: RPCResponse[] = await response.json();

      // Check for errors in batch response
      const errors = json.filter(resp => resp.error);
      if (errors.length > 0) {
        const firstError = errors[0].error!;
        if (firstError.code === -32005 || /rate.?limit/i.test(firstError.message)) {
          throw new Error(`RPC batch rate limited: ${firstError.message}`);
        }
        throw new Error(`RPC batch error: ${firstError.message}`);
      }

      // Extract results in order
      const results = json
        .sort((a, b) => a.id - b.id)
        .map(resp => resp.result);

      return results as T;
    },
    {
      type: 'rpc',
      maxAttempts: maxRetries + 1,
      signal,
      onRateLimit: (attempt, retryAfter) => {
        console.warn(`[RPC Batch] Rate limited, retrying in ${retryAfter}s (attempt ${attempt + 1})`);
      },
    }
  );
}


