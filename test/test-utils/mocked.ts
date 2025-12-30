/**
 * Vitest Mock Utility
 *
 * Copied from Uniswap's test-utils/mocked.tsx
 * @see interface/apps/web/src/test-utils/mocked.tsx
 */

import type { MockedFunction } from 'vitest'
import { vi } from 'vitest'

/**
 * Casts the passed function as a vitest Mock.
 * Use this in combination with vi.mock() to safely access functions from mocked modules.
 *
 * @example
 *
 *  import { useExample } from 'example'
 *  vi.mock('example', () => ({ useExample: vi.fn() }))
 *  beforeEach(() => {
 *    mocked(useExample).mockImplementation(() => ...)
 *  })
 */
export function mocked<T extends (...args: any) => any>(fn: T) {
  const isMock = typeof vi !== 'undefined' && vi.isMockFunction(fn)

  if (!isMock) {
    throw new Error('fn is not a mock')
  }

  return fn as MockedFunction<T>
}
