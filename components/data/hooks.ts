/**
 * Data Hooks Re-export
 *
 * This file re-exports Apollo hooks for backward compatibility.
 * The actual implementations are in lib/apollo/hooks/
 *
 * @deprecated Import directly from '@/lib/apollo/hooks' in new code
 */

export {
  useAllPrices,
  useUserPositions,
  usePoolState,
} from '@/lib/apollo/hooks'
