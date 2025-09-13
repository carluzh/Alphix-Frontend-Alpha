import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePoolStats } from '@/components/data/hooks';

// Create a test wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('usePoolStats', () => {
  it('should return pool stats data', async () => {
    const { result } = renderHook(() => usePoolStats('0x123...'), {
      wrapper: createWrapper(),
    });

    // Wait for the query to resolve
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeDefined();
    expect(result.current.data?.pools).toBeDefined();
    expect(Array.isArray(result.current.data?.pools)).toBe(true);
    expect(result.current.data?.pools?.length).toBeGreaterThan(0);
  });

  it('should handle loading state', async () => {
    const { result } = renderHook(() => usePoolStats('0x123...'), {
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

  it('should handle different pool IDs', async () => {
    const { result: result1 } = renderHook(() => usePoolStats('0x123...'), {
      wrapper: createWrapper(),
    });

    const { result: result2 } = renderHook(() => usePoolStats('0x456...'), {
      wrapper: createWrapper(),
    });

    // Both should resolve
    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true);
    });

    await waitFor(() => {
      expect(result2.current.isSuccess).toBe(true);
    });

    // Should have same structure but potentially different data
    expect(result1.current.data).toBeDefined();
    expect(result2.current.data).toBeDefined();
  });
});


