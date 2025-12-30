import { WatchQueryFetchPolicy } from '@apollo/client'
import { useCallback, useEffect, useState } from 'react'

const ONE_SECOND_MS = 1000
const WINDOW_FOCUS_DEBOUNCE_MS = 30 * ONE_SECOND_MS

type Props = {
  fetchPolicy: WatchQueryFetchPolicy | undefined
  pollInterval: number | undefined
}

/**
 * Hook to detect if window is focused with a debounce delay.
 *
 * We add a 30s delay before we trigger the `windowNotFocused` state to avoid
 * unnecessary state changes when the user is quickly switching back-and-forth
 * between windows. Without this delay, we could end up triggering too many
 * unnecessary API calls every time the window regains focus.
 *
 * @see interface/packages/uniswap/src/utils/usePlatformBasedValue.ts
 */
function useIsWindowFocusedWithTimeout(timeoutMs: number = WINDOW_FOCUS_DEBOUNCE_MS): boolean {
  const [isFocused, setIsFocused] = useState(true)

  const handleVisibilityChange = useCallback(() => {
    const isVisible = document.visibilityState === 'visible'
    if (isVisible) {
      // Immediately mark as focused when window becomes visible
      setIsFocused(true)
    }
    // When becoming hidden, we'll rely on the timeout logic below
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return

    // Initial state
    setIsFocused(document.visibilityState === 'visible')

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [handleVisibilityChange])

  // Debounced unfocus - only set to unfocused after timeout
  useEffect(() => {
    if (typeof document === 'undefined') return

    if (document.visibilityState !== 'visible') {
      const timeout = setTimeout(() => {
        if (document.visibilityState !== 'visible') {
          setIsFocused(false)
        }
      }, timeoutMs)
      return () => clearTimeout(timeout)
    }
  }, [timeoutMs])

  return isFocused
}

/**
 * Adapts fetch policy and polling interval based on window visibility.
 *
 * When window is not focused (after 30s debounce):
 * - Uses cache-only fetch policy (still reads cached data, no network)
 * - Disables polling (pollInterval: 0)
 *
 * This matches Uniswap's pattern for reducing unnecessary API calls.
 *
 * @see interface/packages/uniswap/src/utils/usePlatformBasedFetchPolicy.ts
 */
export function usePlatformBasedFetchPolicy(props: Props): Props {
  const isWindowFocused = useIsWindowFocusedWithTimeout()

  if (!isWindowFocused) {
    return {
      fetchPolicy: 'cache-only',
      pollInterval: 0,
    }
  }

  return props
}
