import { ALL_MODES } from './chain-registry';
import { fetchPoolsMetrics } from './backend-client';

/** Time to keep prefetched pools in memory before allowing re-prefetch (5 minutes) */
const PREFETCH_CACHE_TTL = 5 * 60 * 1000;

/**
 * Simplified prefetch service for liquidity pools.
 * Only retains pool-detail prefetch (hover-to-prefetch pattern).
 */
class SimplePrefetchService {
  /** Track prefetched pools to avoid duplicate calls */
  private static prefetchedPools = new Map<string, number>();

  /**
   * Prefetch pool detail page data (chart data, pool state)
   * Called on hover to make pool detail navigation instant
   */
  static async prefetchPoolDetailData(poolId: string): Promise<void> {
    // Check if already prefetched recently
    const lastPrefetch = this.prefetchedPools.get(poolId);
    if (lastPrefetch && Date.now() - lastPrefetch < PREFETCH_CACHE_TTL) {
      return;
    }

    // Mark as prefetched
    this.prefetchedPools.set(poolId, Date.now());

    try {
      // Prefetch pool chart data in parallel — fetch metrics for all chains
      await Promise.all([
        ...ALL_MODES.map(m => fetchPoolsMetrics(m).catch(() => {})),
        // Pool chart data (60 days of history)
        fetch(`/api/liquidity/pool-chart-data?poolId=${poolId}&days=60`).catch(() => {}),
      ]);
    } catch {
      // Silent failure - prefetch is not critical
    }
  }
}

// Export singleton instance
export const prefetchService = SimplePrefetchService;
