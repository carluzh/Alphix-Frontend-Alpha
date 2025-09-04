import { setToCache, getFromCache, setToLongCache, getFromLongCache, getPoolStatsCacheKey } from './client-cache';
import { getAllPools } from './pools-config';

interface PrefetchQueue {
  priority: number;
  operation: () => Promise<void>;
  key: string;
}

class PrefetchService {
  private queue: PrefetchQueue[] = [];
  private isProcessing = false;
  private maxConcurrent = 3; // Limit concurrent prefetch requests
  private activeRequests = 0;

  // --- Positions refresh (centralized) ---
  private positionsListeners: Array<{ owner?: string; cb: (payload: { owner: string; reason?: string; poolIds?: string[]; tokenIds?: string[] }) => void }>= [];
  private positionsDebounceTimers: Map<string, any> = new Map();
  private positionsPending: Map<string, { owner: string; poolIds?: Set<string>; tokenIds?: Set<string>; reason?: string }>= new Map();

  addPositionsListener(owner: string | undefined, cb: (payload: { owner: string; reason?: string; poolIds?: string[]; tokenIds?: string[] }) => void): () => void {
    const entry = { owner, cb };
    this.positionsListeners.push(entry);
    return () => {
      this.positionsListeners = this.positionsListeners.filter(x => x !== entry);
    };
  }

  requestPositionsRefresh(params: { owner?: string; reason?: string; poolIds?: string[]; tokenIds?: string[]; debounceMs?: number }) {
    const owner = (params.owner || '').toLowerCase();
    if (!owner) return;
    const debounceMs = typeof params.debounceMs === 'number' ? Math.max(0, params.debounceMs) : 300;
    const existing = this.positionsPending.get(owner) || { owner, poolIds: new Set<string>(), tokenIds: new Set<string>(), reason: undefined as string | undefined };
    if (params.poolIds) params.poolIds.forEach(p => existing.poolIds!.add(p));
    if (params.tokenIds) params.tokenIds.forEach(t => existing.tokenIds!.add(t));
    existing.reason = existing.reason || params.reason;
    this.positionsPending.set(owner, existing);

    // reset debounce timer
    if (this.positionsDebounceTimers.has(owner)) {
      clearTimeout(this.positionsDebounceTimers.get(owner));
    }
    this.positionsDebounceTimers.set(owner, setTimeout(() => {
      this.positionsDebounceTimers.delete(owner);
      const pending = this.positionsPending.get(owner);
      if (!pending) return;
      this.positionsPending.delete(owner);
      const payload = {
        owner,
        reason: pending.reason,
        poolIds: pending.poolIds && pending.poolIds.size > 0 ? Array.from(pending.poolIds) : undefined,
        tokenIds: pending.tokenIds && pending.tokenIds.size > 0 ? Array.from(pending.tokenIds) : undefined,
      };
      // notify listeners (owner-specific first, then global)
      for (const l of this.positionsListeners) {
        if (!l.owner || l.owner.toLowerCase() === owner) {
          try { l.cb(payload); } catch {}
        }
      }
    }, debounceMs));
  }

  /**
   * Add a pool data prefetch operation to the queue
   */
  prefetchPoolData(poolId: string, priority: number = 1): void {
    const key = `prefetch_pool_${poolId}`;
    
    // Don't prefetch if already cached
    if (getFromCache(getPoolStatsCacheKey(poolId))) {
      return;
    }

    const operation = async () => {
      try {
        console.log(`[Prefetch] Loading pool ${poolId}`);
        const resp = await fetch(`/api/liquidity/get-pools-batch`, { cache: 'no-store' as any } as any);
        if (resp.ok) {
          const json = await resp.json();
          const match = Array.isArray(json?.pools) ? json.pools.find((p: any) => String(p?.poolId || '').toLowerCase() === String(poolId).toLowerCase()) : null;
          if (match) {
            // Do not write TVL/volume to client cache; rely on server response on-demand to avoid stale overrides
          }
        }
      } catch (error) {
        console.warn(`[Prefetch] Failed to load pool data for ${poolId}:`, error);
      }
    };

    this.addToQueue({ priority, operation, key });
  }

  /**
   * Prefetch pool data using the new batch API for better performance
   */
  prefetchMultiplePoolData(poolIds: string[], priority: number = 1): void {
    const key = `prefetch_batch_${poolIds.sort().join('_')}`;
    
    // Filter out already cached pools
    const uncachedPools = poolIds.filter(poolId => 
      !getFromCache(getPoolStatsCacheKey(poolId))
    );

    if (uncachedPools.length === 0) {
      return;
    }

    const operation = async () => {
      try {
        console.log(`[Prefetch] Batch loading ${uncachedPools.length} pools`);
        
        const response = await fetch(`/api/liquidity/get-pools-batch`, { cache: 'no-store' as any } as any);

        if (response.ok) {
          const data = await response.json();
          
          const map = new Map<string, any>();
          for (const p of (data?.pools || [])) map.set(String(p.poolId).toLowerCase(), p);
          // Do not write batch-derived TVL/volume to client cache; avoid stale client-state overriding fresh server data
          
          console.log(`[Prefetch] Batch cached minimal stats`);
        }
      } catch (error) {
        console.warn(`[Prefetch] Failed to batch load pools:`, error);
      }
    };

    this.addToQueue({ priority, operation, key });
  }

  /**
   * Prefetch chart data for a specific pool
   */
  prefetchChartData(poolId: string, priority: number = 2): void {
    const key = `prefetch_chart_${poolId}`;
    
    const operation = async () => {
      try {
        console.log(`[Prefetch] Loading chart data for ${poolId}`);
        
        const response = await fetch(`/api/liquidity/chart-data/${poolId}`);
        if (response.ok) {
          const data = await response.json();
          // Chart data is cached internally by the API route
          console.log(`[Prefetch] Chart data loaded for ${poolId}`);
        }
      } catch (error) {
        console.warn(`[Prefetch] Failed to load chart data for ${poolId}:`, error);
      }
    };

    this.addToQueue({ priority, operation, key });
  }

  /**
   * Prefetch all pool configurations on app start
   */
  prefetchAllPoolData(): void {
    const allPools = getAllPools();
    const poolIds = allPools.map(pool => pool.id);
    
    // Use batch prefetch for better performance
    this.prefetchMultiplePoolData(poolIds, 3);
  }

  /**
   * Smart prefetch based on user navigation patterns
   */
  prefetchLikelyNext(currentPage: string, currentPoolId?: string): void {
    switch (currentPage) {
      case 'home':
        // Prefetch liquidity page data
        this.prefetchAllPoolData();
        break;
        
      case 'liquidity':
        // Prefetch chart data for top pools
        const topPools = getAllPools().slice(0, 3);
        topPools.forEach(pool => this.prefetchChartData(pool.id, 2));
        break;
        
      case 'pool-detail':
        // Prefetch related pool data if viewing a specific pool
        if (currentPoolId) {
          const allPools = getAllPools();
          const otherPools = allPools.filter(p => p.id !== currentPoolId).slice(0, 5);
          otherPools.forEach(pool => this.prefetchPoolData(pool.id, 2));
        }
        break;
    }
  }

  private addToQueue(item: PrefetchQueue): void {
    // Remove duplicate operations
    this.queue = this.queue.filter(existing => existing.key !== item.key);
    
    // Add new operation
    this.queue.push(item);
    
    // Sort by priority (higher priority first)
    this.queue.sort((a, b) => b.priority - a.priority);
    
    // Start processing if not already running
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
      const item = this.queue.shift();
      if (!item) continue;

      this.activeRequests++;
      
      // Execute operation without blocking the queue
      item.operation()
        .catch(error => console.warn('[Prefetch] Operation failed:', error))
        .finally(() => {
          this.activeRequests--;
          // Continue processing if there are more items and available slots
          if (this.queue.length > 0 && this.activeRequests < this.maxConcurrent) {
            setTimeout(() => this.processQueue(), 100); // Small delay to prevent overwhelming
          }
        });
    }

    // Wait for all active requests to complete
    const checkComplete = () => {
      if (this.activeRequests === 0) {
        this.isProcessing = false;
        // Process any remaining items
        if (this.queue.length > 0) {
          setTimeout(() => this.processQueue(), 500);
        }
      } else {
        setTimeout(checkComplete, 100);
      }
    };

    checkComplete();
  }

  /**
   * Clear the prefetch queue
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Get queue status for debugging
   */
  getStatus(): { queueLength: number; activeRequests: number; isProcessing: boolean } {
    return {
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      isProcessing: this.isProcessing
    };
  }
}

// Export singleton instance
export const prefetchService = new PrefetchService();

// Auto-start prefetching common data when service is imported
if (typeof window !== 'undefined') {
  // Only run in browser
  setTimeout(() => {
    prefetchService.prefetchLikelyNext('home');
  }, 1000); // Wait 1 second after page load
} 