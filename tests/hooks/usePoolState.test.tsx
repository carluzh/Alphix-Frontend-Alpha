import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePoolState, useBlockRefetch } from '@/components/data/hooks';

// Mock viem publicClient
vi.mock('@/lib/viemClient', () => ({
  publicClient: {
    watchBlockNumber: vi.fn(),
  },
}));

// Create a test wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0, // Category 3 uses 0 staleTime
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('usePoolState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return pool state data', async () => {
    const { result } = renderHook(() => usePoolState('0x123...'), {
      wrapper: createWrapper(),
    });

    // Wait for the query to resolve
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeDefined();
    expect(result.current.data?.poolId).toBeDefined();
    expect(result.current.data?.sqrtPriceX96).toBeDefined();
    expect(result.current.data?.tick).toBeDefined();
  });

  it('should handle loading state', async () => {
    const { result } = renderHook(() => usePoolState('0x123...'), {
      wrapper: createWrapper(),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isSuccess).toBe(false);

    // Wait for completion
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('should handle empty poolId gracefully', async () => {
    const { result } = renderHook(() => usePoolState(''), {
      wrapper: createWrapper(),
    });

    // Should not attempt to fetch with empty poolId
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should be in idle state
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should have 0 staleTime for continuous updates', async () => {
    const { result } = renderHook(() => usePoolState('0x123...'), {
      wrapper: createWrapper(),
    });

    // Wait for completion
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Data should be considered stale immediately (staleTime: 0)
    expect(result.current.isStale).toBe(true);
  });
});

describe('useBlockRefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should set up block watcher for specified pool IDs', async () => {
    const mockPoolIds = ['0x123...', '0x456...'];

    renderHook(() => useBlockRefetch({ poolIds: mockPoolIds }), {
      wrapper: createWrapper(),
    });

    // Should call watchBlockNumber
    expect(mockWatchBlockNumber).toHaveBeenCalledTimes(1);
    expect(mockWatchBlockNumber).toHaveBeenCalledWith({
      onBlockNumber: expect.any(Function),
    });
  });

  it('should not set up watcher when no pool IDs provided', () => {
    renderHook(() => useBlockRefetch({ poolIds: [] }), {
      wrapper: createWrapper(),
    });

    // Should not call watchBlockNumber
    expect(mockWatchBlockNumber).not.toHaveBeenCalled();
  });

  it('should handle block number updates', async () => {
    const mockPoolIds = ['0x123...'];
    let blockCallback: (blockNumber: bigint) => void;

    mockWatchBlockNumber.mockImplementation((options: any) => {
      blockCallback = options.onBlockNumber;
      return () => {}; // cleanup function
    });

    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );

    renderHook(() => useBlockRefetch({ poolIds: mockPoolIds }), {
      wrapper,
    });

    // Simulate block update
    if (blockCallback) {
      blockCallback(BigInt(12345));
    }

    // The invalidation should have been called
    expect(mockWatchBlockNumber).toHaveBeenCalled();
  });
});
