const SECONDS_IN_MINUTE = 60
const MINUTES_IN_HOUR = 60
const HOURS_IN_DAY = 24
export const ONE_SECOND_MS = 1000
export const ONE_MINUTE_MS = SECONDS_IN_MINUTE * ONE_SECOND_MS
const ONE_HOUR_MS = MINUTES_IN_HOUR * ONE_MINUTE_MS
export const ONE_DAY_MS = HOURS_IN_DAY * ONE_HOUR_MS
/** Max age for localStorage query persistence (5 minutes).
 * Kept short so stale server-state doesn't survive across sessions.
 * Genuinely-static queries (aave rates, token metadata) are still
 * persisted — volatile ones are excluded via dehydrateOptions. */
export const MAX_REACT_QUERY_CACHE_TIME_MS = 5 * ONE_MINUTE_MS
