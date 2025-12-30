/**
 * Retry utilities with three-tier exponential backoff
 *
 * Identical to Uniswap's retry.ts implementation.
 *
 * @see interface/apps/web/src/state/activity/polling/retry.ts
 */

/**
 * Retry options for the three-tier backoff strategy
 */
export interface RetryOptions {
  /** Total number of retry attempts */
  n: number
  /** Minimum wait between retries in ms (used for first 1/3 of attempts) */
  minWait: number
  /** Medium wait between retries in ms (used for middle 1/3 of attempts) */
  medWait: number
  /** Maximum wait between retries in ms (caps the exponential backoff) */
  maxWait: number
}

/**
 * Default retry options for transaction polling
 * Matches Uniswap's DEFAULT_RETRY_OPTIONS
 *
 * @see interface/packages/uniswap/src/features/chains/evm/rpc.ts
 */
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  n: 10,
  minWait: 250,
  medWait: 500,
  maxWait: 1000,
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Thrown if the function is canceled before resolving. */
export class CanceledError extends Error {
  name = 'CanceledError'
  message = 'Retryable was canceled'
}

/** May be thrown to force a retry. */
export class RetryableError extends Error {
  name = 'RetryableError'
}

/**
 * Retries a function until its returned promise successfully resolves, up to n times.
 * Uses three-tier exponential backoff:
 * - First 1/3 of attempts: uses minWait (250ms default)
 * - Middle 1/3 of attempts: uses medWait (500ms default)
 * - Final 1/3 of attempts: exponential backoff from medWait, capped at maxWait
 *
 * @param fn function to retry
 * @param options retry options (n, minWait, medWait, maxWait)
 * @returns Promise with cancel function
 *
 * @example
 * const { promise, cancel } = retry(
 *   () => publicClient.getTransactionReceipt({ hash }),
 *   DEFAULT_RETRY_OPTIONS
 * )
 *
 * // Cancel if needed
 * cancel()
 *
 * // Or await the result
 * const receipt = await promise
 */
export function retry<T>(
  fn: () => Promise<T>,
  { n, minWait, medWait, maxWait }: RetryOptions,
): { promise: Promise<T>; cancel: () => void } {
  const totalAttempts = n
  let completed = false
  let rejectCancelled: (error: Error) => void

  const promise = new Promise<T>(async (resolve, reject) => {
    let currentAttempt = 0
    rejectCancelled = reject

    while (true) {
      currentAttempt++
      let result: T

      try {
        result = await fn()
        if (!completed) {
          resolve(result)
          completed = true
        }
        break
      } catch (error) {
        if (completed) {
          break
        }
        if (n <= 0 || !(error instanceof RetryableError)) {
          reject(error)
          completed = true
          break
        }
        n--
      }

      let baseDelay: number

      // Three-tier backoff:
      // - First 1/3: minWait (fixed 250ms)
      // - Middle 1/3: medWait (fixed 500ms)
      // - Final 1/3: exponential from medWait, capped at maxWait
      if (totalAttempts < 3 || currentAttempt <= Math.ceil(totalAttempts / 3)) {
        baseDelay = minWait
      } else if (currentAttempt <= Math.ceil((totalAttempts / 3) * 2)) {
        baseDelay = medWait
      } else {
        const backoffStartAttempt = Math.ceil((totalAttempts / 3) * 2)
        const exponentialDelay = medWait * Math.pow(2, currentAttempt - backoffStartAttempt)
        baseDelay = Math.min(exponentialDelay, maxWait)
      }

      // Add jitter to prevent thundering herd (±12.5% of baseDelay)
      const jitter = baseDelay * 0.25 * (Math.random() - 0.5)
      const finalDelay = Math.max(0, baseDelay + jitter)

      await wait(finalDelay)
    }
  })

  return {
    promise,
    cancel: () => {
      if (completed) {
        return
      }
      completed = true
      rejectCancelled(new CanceledError())
    },
  }
}
