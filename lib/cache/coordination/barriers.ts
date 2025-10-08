/**
 * Indexing barrier coordination
 * Prevents reading stale data while subgraph is indexing recent transactions
 */

interface Barrier {
  promise: Promise<boolean>
  createdAt: number
}

// Map of owner address -> barrier promise
const barriers = new Map<string, Barrier>()

const BARRIER_TIMEOUT = 15000 // 15 seconds
const BARRIER_MIN_WAIT = 800 // 800ms minimum wait
const BARRIER_MAX_INTERVAL = 1200 // Max polling interval

/**
 * Set a barrier to block cache reads until subgraph indexes target block
 */
export function setIndexingBarrier(
  ownerAddress: string,
  targetBlock: number
): Promise<boolean> {
  const key = ownerAddress.toLowerCase()

  // Create barrier promise
  const barrier = waitForSubgraphBlock(targetBlock, {
    timeoutMs: BARRIER_TIMEOUT,
    minWaitMs: BARRIER_MIN_WAIT,
    maxIntervalMs: BARRIER_MAX_INTERVAL,
  })

  // Store barrier
  barriers.set(key, {
    promise: barrier,
    createdAt: Date.now(),
  })

  // Auto-cleanup when barrier resolves
  barrier.finally(() => {
    const current = barriers.get(key)
    if (current && current.promise === barrier) {
      barriers.delete(key)
    }
  })

  return barrier
}

/**
 * Check if a barrier exists for an owner
 * Returns the barrier promise if it exists, null otherwise
 */
export function getIndexingBarrier(ownerAddress: string): Promise<boolean> | null {
  const key = ownerAddress.toLowerCase()
  const barrier = barriers.get(key)

  if (!barrier) return null

  // Check if barrier is too old (stale)
  const age = Date.now() - barrier.createdAt
  if (age > BARRIER_TIMEOUT + 5000) {
    // Barrier timeout + grace period
    barriers.delete(key)
    return null
  }

  return barrier.promise
}

/**
 * Wait for barrier to resolve (if exists)
 * Returns true if no barrier or barrier resolved successfully
 * Returns false if barrier timed out
 */
export async function waitForBarrier(ownerAddress: string): Promise<boolean> {
  const barrier = getIndexingBarrier(ownerAddress)
  if (!barrier) return true

  try {
    return await barrier
  } catch {
    return false
  }
}

/**
 * Clear barrier for an owner (for manual intervention)
 */
export function clearBarrier(ownerAddress: string): void {
  const key = ownerAddress.toLowerCase()
  barriers.delete(key)
}

/**
 * Clear all barriers (for testing/debugging)
 */
export function clearAllBarriers(): void {
  barriers.clear()
}

/**
 * Wait for subgraph to index a specific block number
 */
async function waitForSubgraphBlock(
  targetBlock: number,
  opts?: {
    timeoutMs?: number
    minWaitMs?: number
    maxIntervalMs?: number
  }
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? BARRIER_TIMEOUT
  const minWaitMs = opts?.minWaitMs ?? BARRIER_MIN_WAIT
  const maxIntervalMs = opts?.maxIntervalMs ?? BARRIER_MAX_INTERVAL

  const start = Date.now()
  let interval = 250
  const jitter = () => Math.floor(Math.random() * 80)

  try {
    // Initial wait to smooth indexing jitter
    await new Promise((resolve) => setTimeout(resolve, minWaitMs))

    // Poll subgraph head
    while (true) {
      if (Date.now() - start > timeoutMs) {
        console.warn('[Barrier] Timeout waiting for subgraph to index block', targetBlock)
        return false
      }

      const resp = await fetch('/api/liquidity/subgraph-head', {
        cache: 'no-store' as any,
      } as any)

      if (resp.ok) {
        const { subgraphHead } = await resp.json()
        if (typeof subgraphHead === 'number' && subgraphHead >= targetBlock) {
          return true
        }
      }

      // Exponential backoff with jitter
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(maxIntervalMs, interval) + jitter())
      )
      interval = Math.min(maxIntervalMs, Math.floor(interval * 1.6))
    }
  } catch (error) {
    console.error('[Barrier] Error waiting for subgraph:', error)
    return false
  }
}

/**
 * Get current barrier state (for debugging)
 */
export function getBarrierState(): Record<
  string,
  { age: number; timeout: number }
> {
  const state: Record<string, { age: number; timeout: number }> = {}

  for (const [key, barrier] of barriers.entries()) {
    state[key] = {
      age: Date.now() - barrier.createdAt,
      timeout: BARRIER_TIMEOUT,
    }
  }

  return state
}
