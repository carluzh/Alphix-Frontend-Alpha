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
        console.log(`[Prefetch] Loading pool data for ${poolId}`);
        
        // Fetch both 24h and 7d data in parallel
        const [res24h, res7d, resTvl] = await Promise.all([
          fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${poolId}&days=1`),
          fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${poolId}&days=7`),
          fetch(`/api/liquidity/get-pool-tvl?poolId=${poolId}`)
        ]);

        if (res24h.ok && res7d.ok && resTvl.ok) {
          const [data24h, data7d, dataTvl] = await Promise.all([
            res24h.json(),
            res7d.json(),
            resTvl.json()
          ]);

          const poolStats = {
            volume24hUSD: parseFloat(data24h.volumeUSD),
            fees24hUSD: parseFloat(data24h.feesUSD),
            volume7dUSD: parseFloat(data7d.volumeUSD),
            fees7dUSD: parseFloat(data7d.feesUSD),
            tvlUSD: parseFloat(dataTvl.tvlUSD),
          };

          setToCache(getPoolStatsCacheKey(poolId), poolStats);
          console.log(`[Prefetch] Cached pool data for ${poolId}`);
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
        
        const response = await fetch(
          `/api/liquidity/get-pool-batch-data?poolIds=${uncachedPools.join(',')}&days=7`
        );

        if (response.ok) {
          const data = await response.json();
          
          for (const poolData of data.pools) {
            const poolStats = {
              volume24hUSD: parseFloat(poolData.volumeUSD_24h),
              fees24hUSD: parseFloat(poolData.feesUSD_24h),
              volume7dUSD: parseFloat(poolData.volumeUSD_7d),
              fees7dUSD: parseFloat(poolData.feesUSD_7d),
              tvlUSD: parseFloat(poolData.tvlUSD),
            };

            setToCache(getPoolStatsCacheKey(poolData.poolId), poolStats);
          }
          
          console.log(`[Prefetch] Batch cached ${data.pools.length} pools`);
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