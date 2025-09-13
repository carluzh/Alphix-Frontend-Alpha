import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUserPositions } from '@/components/data/hooks';

// Create a test wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity, // Category 2 uses Infinity staleTime
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('useUserPositions', () => {
  it('should return user positions data', async () => {
    const mockAddress = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

    const { result } = renderHook(() => useUserPositions(mockAddress), {
      wrapper: createWrapper(),
    });

    // Wait for the query to resolve
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeDefined();
    // The data should be an array of positions or null
    expect(Array.isArray(result.current.data) || result.current.data === null).toBe(true);
  });

  it('should handle loading state', async () => {
    const mockAddress = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

    const { result } = renderHook(() => useUserPositions(mockAddress), {
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

  it('should handle empty address gracefully', async () => {
    const { result } = renderHook(() => useUserPositions(''), {
      wrapper: createWrapper(),
    });

    // Should not attempt to fetch with empty address
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should be in idle state
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should cache data with Infinity staleTime', async () => {
    const mockAddress = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';

    const { result, rerender } = renderHook(() => useUserPositions(mockAddress), {
      wrapper: createWrapper(),
    });

    // Wait for first fetch
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const firstData = result.current.data;

    // Rerender - should use cache
    rerender();

    // Should still have the same data immediately
    expect(result.current.data).toBe(firstData);
    expect(result.current.isStale).toBe(false);
  });
});


