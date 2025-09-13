import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAllPrices } from '@/components/data/hooks';

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

describe('useAllPrices', () => {
  it('should return mock price data', async () => {
    const { result } = renderHook(() => useAllPrices(), {
      wrapper: createWrapper(),
    });

    // Wait for the query to resolve
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBeDefined();
    expect(result.current.data?.ETH).toBe(3500);
    expect(result.current.data?.BTC).toBe(65000);
    expect(result.current.data?.USDC).toBe(1);
  });
});
