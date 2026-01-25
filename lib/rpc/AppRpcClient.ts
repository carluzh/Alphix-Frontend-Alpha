/**
 * Application RPC Client with Fallback and Exponential Backoff
 *
 * This client implements Uniswap's AppJsonRpcProvider pattern:
 * - Multiple RPC endpoints with automatic fallback
 * - Exponential backoff on errors
 * - Intelligent provider sorting (enabled first)
 * - Automatic re-enabling of disabled providers
 *
 * @see interface/apps/web/src/rpc/AppJsonRpcProvider.ts (Uniswap original)
 */

import { AVERAGE_L2_BLOCK_TIME_MS } from '@/hooks/usePollingIntervalByChain'

/**
 * A controller which marks itself disabled on an error, and re-enables itself using exponential backoff.
 * After each retry, it will wait twice as long to retry again. After a success, it will reset the backoff.
 */
class Controller {
  private isEnabled = true
  private timeout: ReturnType<typeof setTimeout> | undefined
  private exponentialBackoffFactor = 1
  /** Track consecutive rate limit errors to apply longer backoffs */
  private rateLimitStreak = 0

  constructor(private minimumBackoffTime: number) {}

  private reset() {
    this.isEnabled = true

    clearTimeout(this.timeout)
    this.timeout = undefined
  }

  onSuccess() {
    this.reset()
    this.exponentialBackoffFactor = 1
    this.rateLimitStreak = 0
  }

  /**
   * Called onError.
   * Idempotent - calling this multiple times will *not* reset the exponential backoff timer.
   */
  onError(isRateLimited = false) {
    this.isEnabled = false

    if (isRateLimited) {
      this.rateLimitStreak++
    }

    if (!this.timeout) {
      // Apply extra backoff multiplier for rate limits (4x base, doubling each streak)
      const rateLimitMultiplier = isRateLimited ? Math.pow(4, Math.min(this.rateLimitStreak, 3)) : 1
      const backoffTime = this.minimumBackoffTime * this.exponentialBackoffFactor * rateLimitMultiplier

      this.timeout = setTimeout(() => {
        this.reset()
        this.exponentialBackoffFactor *= 2
      }, backoffTime)
    }
  }

  get enabled() {
    return this.isEnabled
  }

  destroy() {
    clearTimeout(this.timeout)
  }
}

interface ControlledEndpoint {
  url: string
  controller: Controller
}

interface AppRpcClientOptions {
  /** Minimum backoff time in ms. Defaults to L2 block time (3000ms) */
  minimumBackoffTime?: number
  /** Timeout for individual requests in ms */
  timeout?: number
}

interface RPCRequest {
  method: string
  params?: unknown[]
  id?: number
}

interface RPCResponse<T = unknown> {
  jsonrpc: string
  id: number
  result?: T
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/**
 * Application-specific RPC client with intelligent fallback.
 *
 * This client will instantiate controllers for all supported RPC URLs, so that it may use them as fallbacks.
 * It will use the first (primary) RPC URL unless there is an issue, at which point it will fallback to the next,
 * retrying the former using exponential backoff. This prevents secondary URLs from permanently overtaking primary URLs.
 */
export class AppRpcClient {
  private endpoints: ReadonlyArray<ControlledEndpoint>
  private timeout: number

  constructor(
    urls: string[],
    { minimumBackoffTime = AVERAGE_L2_BLOCK_TIME_MS, timeout = 10000 }: AppRpcClientOptions = {},
  ) {
    if (urls.length === 0) {
      throw new Error('Missing URLs for AppRpcClient')
    }
    this.timeout = timeout
    this.endpoints = urls.map((url) => ({
      url,
      controller: new Controller(minimumBackoffTime),
    }))
  }

  /**
   * Sort endpoints so enabled ones come first.
   * Note that we do not filter out disabled endpoints.
   */
  private sortEndpoints(): Array<ControlledEndpoint> {
    return [...this.endpoints].sort(({ controller: { enabled: a } }, { controller: { enabled: b } }) => {
      if (a && !b) {
        return -1
      } else if (!a && b) {
        return 1
      } else {
        return 0 // sort is stable
      }
    })
  }

  /**
   * Execute an RPC request with automatic fallback and exponential backoff.
   */
  async request<T>(request: RPCRequest): Promise<T> {
    const sortedEndpoints = this.sortEndpoints()
    let lastError: Error | undefined

    for (const { url, controller } of sortedEndpoints) {
      try {
        const result = await this.fetchRpc<T>(url, request)
        controller.onSuccess()
        return result
      } catch (error) {
        lastError = error as Error
        const isRateLimited = lastError.message.includes('429')
        // Only log non-429 errors to reduce noise (429s are expected under load)
        if (!isRateLimited) {
          console.warn(`[AppRpcClient] ${url} failed: ${lastError.message}`)
        }
        controller.onError(isRateLimited)
      }
    }

    throw lastError || new Error(`All RPC endpoints failed to perform: ${request.method}`)
  }

  /**
   * Execute a batch of RPC requests.
   */
  async batchRequest<T extends unknown[]>(requests: RPCRequest[]): Promise<T> {
    const sortedEndpoints = this.sortEndpoints()
    let lastError: Error | undefined

    for (const { url, controller } of sortedEndpoints) {
      try {
        const results = await this.fetchRpcBatch<T>(url, requests)
        controller.onSuccess()
        return results
      } catch (error) {
        lastError = error as Error
        const isRateLimited = lastError.message.includes('429')
        if (!isRateLimited) {
          console.warn(`[AppRpcClient] Batch ${url} failed: ${lastError.message}`)
        }
        controller.onError(isRateLimited)
      }
    }

    throw lastError || new Error('All RPC endpoints failed to perform batch request')
  }

  private async fetchRpc<T>(url: string, request: RPCRequest): Promise<T> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: request.id || Math.floor(Math.random() * 1000000),
          method: request.method,
          params: request.params || [],
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const json: RPCResponse<T> = await response.json()

      if (json.error) {
        throw new Error(`RPC error: ${json.error.message}`)
      }

      if (json.result === undefined) {
        throw new Error('RPC response missing result')
      }

      return json.result
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  private async fetchRpcBatch<T extends unknown[]>(url: string, requests: RPCRequest[]): Promise<T> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout * 1.5)

    try {
      const payloads = requests.map((req, index) => ({
        jsonrpc: '2.0',
        id: req.id || index + 1,
        method: req.method,
        params: req.params || [],
      }))

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloads),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const json: RPCResponse[] = await response.json()

      // Check for errors
      const errors = json.filter((resp) => resp.error)
      if (errors.length > 0) {
        const firstError = errors[0].error!
        throw new Error(`RPC batch error: ${firstError.message}`)
      }

      // Extract results in order
      const results = json.sort((a, b) => a.id - b.id).map((resp) => resp.result)

      return results as T
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  /**
   * Get the status of all endpoints.
   */
  getEndpointStatus(): Array<{ url: string; enabled: boolean }> {
    return this.endpoints.map(({ url, controller }) => ({
      url,
      enabled: controller.enabled,
    }))
  }

  /**
   * Destroy the client and cleanup timers.
   */
  destroy() {
    this.endpoints.forEach(({ controller }) => controller.destroy())
  }
}

/**
 * Create a custom Viem transport that uses AppRpcClient.
 * This can be used as a drop-in replacement for Viem's http or fallback transports.
 */
export function createAppRpcTransport(urls: string[], options?: AppRpcClientOptions) {
  const client = new AppRpcClient(urls, options)

  return {
    type: 'custom' as const,
    async request({ method, params }: { method: string; params?: unknown[] }) {
      return client.request({ method, params })
    },
  }
}
