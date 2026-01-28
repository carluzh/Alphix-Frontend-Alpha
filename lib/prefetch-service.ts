import { getAllPools } from './pools-config';
import { getStoredNetworkMode } from './network-mode';
import { fetchPoolsMetrics } from './backend-client';

/** Time to keep prefetched pools in memory before allowing re-prefetch (5 minutes) */
const PREFETCH_CACHE_TTL = 5 * 60 * 1000;

/**
 * Simplified prefetch service for liquidity pools
 * Removed over-engineering: no queues, no priorities, no complex listeners
 *
 * NOTE: Cache checks removed - all caching now handled by Redis on server side
 */
class SimplePrefetchService {
  private static positionsListeners: Array<{
    owner?: string;
    cb: (payload: { owner: string; reason?: string }) => void
  }> = [];

  /** Track prefetched pools to avoid duplicate calls */
  private static prefetchedPools = new Map<string, number>();

  /**
   * Simple pool data prefetch
   * Uses backend /pools/metrics endpoint
   */
  static async prefetchPoolData(poolId: string): Promise<void> {
    try {
      const networkMode = getStoredNetworkMode();
      await fetchPoolsMetrics(networkMode); // Just fetch, caching handled by backend
    } catch (error) {
      // Silent failure - prefetch is not critical
    }
  }

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
      const networkMode = getStoredNetworkMode();

      // Prefetch pool chart data in parallel
      await Promise.all([
        // Pool batch data (includes TVL, volume, fees, APR) - from backend
        fetchPoolsMetrics(networkMode).catch(() => {}),
        // Pool chart data (60 days of history)
        fetch(`/api/liquidity/pool-chart-data?poolId=${poolId}&days=60`).catch(() => {}),
      ]);
    } catch {
      // Silent failure - prefetch is not critical
    }
  }

  /**
   * Clear prefetch cache for a specific pool (e.g., after transaction)
   */
  static clearPoolPrefetchCache(poolId: string): void {
    this.prefetchedPools.delete(poolId);
  }

  /**
   * Prefetch featured pool data on app start (reduce API calls)
   */
  static prefetchAllPoolData(): void {
    // Prefetch disabled to prevent unnecessary API calls
    // Only fetch data when explicitly needed
  }

  /**
   * Simple positions refresh notification
   */
  static addPositionsListener(owner: string | undefined, cb: (payload: { owner: string; reason?: string }) => void): () => void {
    const entry = { owner, cb };
    this.positionsListeners.push(entry);
    return () => {
      this.positionsListeners = this.positionsListeners.filter(x => x !== entry);
    };
  }

  /**
   * Notify listeners of position changes
   */
  static notifyPositionsRefresh(owner: string, reason?: string): void {
    for (const listener of this.positionsListeners) {
      if (!listener.owner || listener.owner.toLowerCase() === owner.toLowerCase()) {
        try {
          listener.cb({ owner, reason });
        } catch (error) {
          console.warn('[Prefetch] Listener error:', error);
        }
      }
    }
  }

  /**
   * Initialize prefetch on app start
   */
  static initialize(): void {
    if (typeof window === 'undefined') return;

    // Simple prefetch on app load
    setTimeout(() => {
      this.prefetchAllPoolData();
    }, 1000);
  }
}

// Export singleton instance
export const prefetchService = SimplePrefetchService;

// Auto-initialize
if (typeof window !== 'undefined') {
  SimplePrefetchService.initialize();
}