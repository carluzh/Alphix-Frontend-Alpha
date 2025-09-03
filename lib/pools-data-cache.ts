// Single source of truth for all pool data across the application
// This cache is shared between the liquidity list page and pool detail pages

interface PoolData {
  poolId: string;
  tvlUSD: number;
  tvlYesterdayUSD?: number;
  volume24hUSD: number;
  volumePrev24hUSD?: number;
  fees24hUSD?: number;
  apr?: string;
  volumeChangeDirection?: 'up' | 'down' | 'neutral' | 'loading';
  tvlChangeDirection?: 'up' | 'down' | 'neutral' | 'loading';
}

interface CacheEntry {
  data: PoolData[];
  timestamp: number;
  version: number;
}

class PoolsDataCache {
  private cache: CacheEntry | null = null;
  private listeners: Set<() => void> = new Set();
  private version = 0;

  // Get current cached data
  getData(): PoolData[] | null {
    return this.cache?.data || null;
  }

  // Set new data and notify all listeners
  setData(data: PoolData[]): void {
    this.version++;
    this.cache = {
      data,
      timestamp: Date.now(),
      version: this.version
    };
    
    console.log('[PoolsDataCache] Updated cache with', data.length, 'pools, version', this.version);
    
    // Notify all listeners
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        console.error('[PoolsDataCache] Error in listener:', error);
      }
    });
  }

  // Subscribe to data changes
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Force invalidate cache
  invalidate(): void {
    console.log('[PoolsDataCache] Cache invalidated');
    this.cache = null;
    this.version++;
    
    // Notify listeners that cache is now invalid
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        console.error('[PoolsDataCache] Error in listener:', error);
      }
    });
  }

  // Check if cache is fresh (less than 5 minutes old)
  isFresh(): boolean {
    if (!this.cache) return false;
    const age = Date.now() - this.cache.timestamp;
    return age < 5 * 60 * 1000; // 5 minutes
  }

  // Get cache age in seconds
  getAge(): number {
    if (!this.cache) return Infinity;
    return Math.floor((Date.now() - this.cache.timestamp) / 1000);
  }

  // Get specific pool data
  getPoolData(poolId: string): PoolData | null {
    if (!this.cache) return null;
    const normalizedId = poolId.toLowerCase();
    return this.cache.data.find(p => p.poolId.toLowerCase() === normalizedId) || null;
  }
}

// Export singleton instance
export const poolsDataCache = new PoolsDataCache();

// Helper to fetch fresh data from server
export async function fetchPoolsData(force = false): Promise<PoolData[]> {
  const bust = force ? `?bust=${Date.now()}` : '';
  const response = await fetch(`/api/liquidity/get-pools-batch${bust}`, {
    cache: 'no-store' as any
  } as any);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch pools data: ${response.status}`);
  }
  
  const data = await response.json();
  if (!data.success || !Array.isArray(data.pools)) {
    throw new Error('Invalid response format');
  }
  
  return data.pools.map((pool: any) => ({
    poolId: pool.poolId,
    tvlUSD: Number(pool.tvlUSD) || 0,
    tvlYesterdayUSD: typeof pool.tvlYesterdayUSD === 'number' ? pool.tvlYesterdayUSD : undefined,
    volume24hUSD: Number(pool.volume24hUSD) || 0,
    volumePrev24hUSD: typeof pool.volumePrev24hUSD === 'number' ? pool.volumePrev24hUSD : undefined,
    fees24hUSD: typeof pool.fees24hUSD === 'number' ? pool.fees24hUSD : undefined,
    apr: pool.apr || 'N/A',
    volumeChangeDirection: pool.volumeChangeDirection || 'loading',
    tvlChangeDirection: pool.tvlChangeDirection || 'loading',
  }));
}

// Helper to invalidate cache and trigger revalidation
export async function invalidateAndRefresh(): Promise<void> {
  console.log('[PoolsDataCache] Invalidating and refreshing...');
  
  // Clear cache first
  poolsDataCache.invalidate();
  
  // Trigger server revalidation
  try {
    await fetch('/api/internal/revalidate-pools', { method: 'POST' });
  } catch (error) {
    console.error('[PoolsDataCache] Failed to trigger server revalidation:', error);
  }
  
  // Fetch fresh data
  try {
    const freshData = await fetchPoolsData(true);
    poolsDataCache.setData(freshData);
  } catch (error) {
    console.error('[PoolsDataCache] Failed to fetch fresh data:', error);
    throw error;
  }
}
