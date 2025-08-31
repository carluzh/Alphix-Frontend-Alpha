import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateAfterTx } from '@/lib/invalidation';

// Mock prefetchService
vi.mock('@/lib/prefetch-service', () => ({
  prefetchService: {
    requestPositionsRefresh: vi.fn(),
  },
}));

// Import the mocked module to access the mock
import { prefetchService } from '@/lib/prefetch-service';

describe('invalidateAfterTx', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
  });

  it('should invalidate user positions query', async () => {
    const mockAddress = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

    // Set up a query in the cache
    queryClient.setQueryData(['user', 'positions', mockAddress.toLowerCase()], []);

    // Call invalidateAfterTx
    await invalidateAfterTx(queryClient, {
      owner: mockAddress,
      reason: 'test transaction',
    });

    // Check that the query was invalidated (data should be undefined)
    const queryData = queryClient.getQueryData(['user', 'positions', mockAddress.toLowerCase()]);
    expect(queryData).toBeUndefined();
  });

  it('should invalidate uncollected fees queries', async () => {
    const mockAddress = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

    // Set up fee queries in cache
    queryClient.setQueryData(['user', 'uncollectedFees', 'position-1'], { amount0: '100', amount1: '200' });
    queryClient.setQueryData(['user', 'uncollectedFeesBatch', 'key-1'], [{ amount0: '100', amount1: '200' }]);

    // Call invalidateAfterTx
    await invalidateAfterTx(queryClient, {
      owner: mockAddress,
      positionIds: ['position-1'],
      reason: 'test transaction',
    });

    // Check that fee queries were invalidated
    expect(queryClient.getQueryData(['user', 'uncollectedFees', 'position-1'])).toBeUndefined();
    expect(queryClient.getQueryData(['user', 'uncollectedFeesBatch', 'key-1'])).toBeUndefined();
  });

  it('should invalidate pool state queries', async () => {
    const mockPoolId = '0x123...';

    // Set up pool state query in cache
    queryClient.setQueryData(['pools', 'state', mockPoolId], {
      poolId: mockPoolId,
      sqrtPriceX96: '12345',
      tick: 123,
      liquidity: '1000',
    });

    // Call invalidateAfterTx
    await invalidateAfterTx(queryClient, {
      owner: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      poolId: mockPoolId,
      reason: 'test transaction',
    });

    // Check that pool state query was invalidated
    expect(queryClient.getQueryData(['pools', 'state', mockPoolId])).toBeUndefined();
  });

  it('should invalidate dynamic fee queries', async () => {
    const mockPoolId = '0x123...';

    // Set up dynamic fee query in cache
    queryClient.setQueryData(['pools', 'feeNow', mockPoolId], {
      dynamicFee: '3000',
      dynamicFeeBps: 3000,
    });

    // Call invalidateAfterTx
    await invalidateAfterTx(queryClient, {
      owner: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      poolId: mockPoolId,
      reason: 'test transaction',
    });

    // Check that dynamic fee query was invalidated
    expect(queryClient.getQueryData(['pools', 'feeNow', mockPoolId])).toBeUndefined();
  });

  it('should call prefetchService.requestPositionsRefresh', async () => {
    const mockAddress = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

    await invalidateAfterTx(queryClient, {
      owner: mockAddress,
      reason: 'test transaction',
    });

    // Check that prefetchService was called
    expect(prefetchService.requestPositionsRefresh).toHaveBeenCalledWith({
      owner: mockAddress,
      reason: 'test transaction',
    });
  });

  it('should handle missing owner gracefully', async () => {
    // Call invalidateAfterTx without owner
    await invalidateAfterTx(queryClient, {
      reason: 'test transaction',
    });

    // Should not call prefetchService
    expect(prefetchService.requestPositionsRefresh).not.toHaveBeenCalled();
  });

  it('should handle multiple position IDs', async () => {
    const mockAddress = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
    const positionIds = ['position-1', 'position-2', 'position-3'];

    // Set up fee queries for multiple positions
    positionIds.forEach(id => {
      queryClient.setQueryData(['user', 'uncollectedFees', id], { amount0: '100', amount1: '200' });
    });

    // Call invalidateAfterTx
    await invalidateAfterTx(queryClient, {
      owner: mockAddress,
      positionIds,
      reason: 'test transaction',
    });

    // Check that all fee queries were invalidated
    positionIds.forEach(id => {
      expect(queryClient.getQueryData(['user', 'uncollectedFees', id])).toBeUndefined();
    });
  });
});
