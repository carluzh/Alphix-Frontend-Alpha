/**
 * Global Cache Key Factory - Future-ready architecture
 * Provides consistent key generation across the application
 */

interface CacheKeyConfig {
  domain: string;        // 'pools', 'user', 'swap', 'portfolio'
  resource: string;      // 'stats', 'positions', 'fees', 'chart'
  identifier?: string;   // poolId, ownerAddress, etc.
  params?: string[];     // additional parameters
  version?: string;      // for future versioning
}

class CacheKeyFactory {
  /**
   * Create a standardized cache key
   * Format: domain:resource:identifier:param1:param2
   */
  static create(config: CacheKeyConfig): string {
    const { domain, resource, identifier, params = [], version } = config;

    const parts = [domain, resource];
    if (identifier) parts.push(identifier);
    parts.push(...params);

    let key = parts.join(':');
    if (version) key += `:v${version}`;

    return key;
  }

  /**
   * Pools domain cache keys
   */
  static pools = {
    stats: (poolId: string) =>
      CacheKeyFactory.create({ domain: 'pools', resource: 'stats', identifier: poolId }),

    chart: (poolId: string, days?: number) =>
      CacheKeyFactory.create({
        domain: 'pools',
        resource: 'chart',
        identifier: poolId,
        params: days ? [days.toString()] : []
      }),

    state: (poolId: string) =>
      CacheKeyFactory.create({ domain: 'pools', resource: 'state', identifier: poolId }),

    fees: (poolId: string, days?: number) =>
      CacheKeyFactory.create({
        domain: 'pools',
        resource: 'fees',
        identifier: poolId,
        params: days ? [days.toString()] : []
      }),

    dynamicFee: (fromSymbol: string, toSymbol: string, chainId: number) =>
      CacheKeyFactory.create({
        domain: 'pools',
        resource: 'dynamicFee',
        identifier: `${fromSymbol}_${toSymbol}`,
        params: [chainId.toString()]
      }),

    batch: (poolIds: string[]) =>
      CacheKeyFactory.create({
        domain: 'pools',
        resource: 'batch',
        identifier: poolIds.sort().join('_')
      }),
  };

  /**
   * User domain cache keys
   */
  static user = {
    positions: (ownerAddress: string) =>
      CacheKeyFactory.create({
        domain: 'user',
        resource: 'positions',
        identifier: (ownerAddress || '').toLowerCase()
      }),

    positionIds: (ownerAddress: string) =>
      CacheKeyFactory.create({
        domain: 'user',
        resource: 'positionIds',
        identifier: (ownerAddress || '').toLowerCase()
      }),

    fees: (positionId: string) =>
      CacheKeyFactory.create({
        domain: 'user',
        resource: 'fees',
        identifier: positionId
      }),

    feesBatch: (positionIds: string[]) =>
      CacheKeyFactory.create({
        domain: 'user',
        resource: 'feesBatch',
        identifier: positionIds.slice().sort().join(',')
      }),

    activity: (ownerAddress: string, first?: number) =>
      CacheKeyFactory.create({
        domain: 'user',
        resource: 'activity',
        identifier: (ownerAddress || '').toLowerCase(),
        params: first ? [first.toString()] : []
      }),
  };

  /**
   * Swap domain cache keys
   */
  static swap = {
    quote: (fromSymbol: string, toSymbol: string, amount: string) =>
      CacheKeyFactory.create({
        domain: 'swap',
        resource: 'quote',
        identifier: `${fromSymbol}_${toSymbol}`,
        params: [amount]
      }),

    route: (fromSymbol: string, toSymbol: string, amount: string) =>
      CacheKeyFactory.create({
        domain: 'swap',
        resource: 'route',
        identifier: `${fromSymbol}_${toSymbol}`,
        params: [amount]
      }),
  };

  /**
   * Portfolio domain cache keys (for future use)
   */
  static portfolio = {
    summary: (ownerAddress: string) =>
      CacheKeyFactory.create({
        domain: 'portfolio',
        resource: 'summary',
        identifier: (ownerAddress || '').toLowerCase()
      }),

    performance: (ownerAddress: string, timeframe?: string) =>
      CacheKeyFactory.create({
        domain: 'portfolio',
        resource: 'performance',
        identifier: (ownerAddress || '').toLowerCase(),
        params: timeframe ? [timeframe] : []
      }),
  };
}

/**
 * Export factory and convenience instance
 */
export { CacheKeyFactory };
export const CacheKeys = CacheKeyFactory;

// Make globally available for debugging/console access
if (typeof window !== 'undefined' && window) {
  try {
    Object.defineProperty(window, 'CacheKeys', {
      value: CacheKeys,
      writable: false,
      enumerable: true,
      configurable: true
    });
  } catch (e) {
    console.warn('Failed to set global CacheKeys:', e);
  }
}

// Type for cache key functions
export type CacheKeyGenerator = (...args: any[]) => string;
