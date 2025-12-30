import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * useEvent - Stable callback hook
 *
 * Returns a stable callback function which always invokes the latest version
 * of the provided callback. Eliminates dependency array issues and prevents
 * O(n) re-renders when used in map loops.
 *
 * @example
 * // Instead of inline callbacks in map:
 * // items.map(item => <Card onClick={() => handleClick(item)} />)
 *
 * // Use useEvent inside extracted child component:
 * function ItemCard({ item }) {
 *   const handleClick = useEvent(() => doSomething(item))
 *   return <Card onClick={handleClick} />
 * }
 *
 * @see interface/packages/utilities/src/react/hooks.ts (Uniswap's implementation)
 */
export function useEvent<A extends unknown[], R>(callback: (...args: A) => R): (...args: A) => R {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  return useCallback((...args: A) => callbackRef.current(...args), [])
}

const ONE_SECOND_MS = 1000

/**
 * useThrottledCallback - Hook to throttle button clicks and prevent multiple submissions
 *
 * Copied from Uniswap's implementation to ensure parity.
 *
 * @param callback The function to execute when button is clicked
 * @param throttleTimeMs Time in milliseconds to wait before allowing another click
 * @returns [throttledCallback, isDebouncing] - The throttled callback and a boolean indicating if debouncing is active
 *
 * @see interface/packages/utilities/src/react/useThrottledCallback.tsx
 */
export function useThrottledCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  throttleTimeMs = ONE_SECOND_MS,
): [(...args: Parameters<T>) => Promise<void>, boolean] {
  const isDebouncingRef = useRef(false)
  const [isDebouncing, setIsDebouncing] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const throttledCallback = useEvent(async (...args: Parameters<T>) => {
    if (isDebouncingRef.current) {
      return
    }

    isDebouncingRef.current = true
    setIsDebouncing(true)

    try {
      await callback(...args)
    } catch (e) {
      console.error('[useThrottledCallback] Error in callback:', e)
    } finally {
      timeoutRef.current = setTimeout(() => {
        isDebouncingRef.current = false
        setIsDebouncing(false)
      }, throttleTimeMs)
    }
  })

  return [throttledCallback, isDebouncing]
}

/**
 * useDebouncedCallback - Hook to debounce function calls
 *
 * Delays execution until user stops interacting for the specified delay.
 * Perfect for search/filter operations.
 *
 * @param callback The function to debounce
 * @param delay Time in milliseconds to wait before executing
 * @returns Debounced callback function
 */
export function useDebouncedCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay = ONE_SECOND_MS,
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args)
    }, delay)
  }, [delay])
}
