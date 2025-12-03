import { getAllPools } from './pools-config';

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

  /**
   * Simple pool data prefetch
   * Cache checks removed - Redis handles all server-side caching
   */
  static async prefetchPoolData(poolId: string): Promise<void> {
    try {
      // Get cache version for fresh data
      const versionResponse = await fetch('/api/cache-version', { cache: 'no-store' });
      if (!versionResponse.ok) return;

      const versionData = await versionResponse.json();
      const response = await fetch(versionData.cacheUrl); // Allow browser caching

      if (response.ok) {
        await response.json(); // Just fetch, let API handle caching
      }
    } catch (error) {
      // Silent failure - prefetch is not critical
    }
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