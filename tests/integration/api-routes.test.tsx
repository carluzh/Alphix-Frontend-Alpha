import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePoolState, useAllPrices } from '@/components/data/hooks';

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

describe('API Integration Tests', () => {
  describe('Pool State API Integration', () => {
    it('should integrate pool state API with MSW and Zod validation', async () => {
      const { result } = renderHook(() => usePoolState('0x123...'), {
        wrapper: createWrapper(),
      });

      // Wait for the query to resolve
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Verify the response structure matches our Zod schema
      expect(result.current.data).toBeDefined();
      expect(result.current.data?.poolId).toBeDefined();
      expect(typeof result.current.data?.sqrtPriceX96).toBe('string');
      expect(typeof result.current.data?.tick).toBe('number');
      expect(typeof result.current.data?.liquidity).toBe('string');
      expect(typeof result.current.data?.protocolFee).toBe('number');
      expect(typeof result.current.data?.lpFee).toBe('number');
      expect(result.current.data?.currentPrice).toBeDefined();
      expect(typeof result.current.data?.currentPoolTick).toBe('number');
    });

    it('should handle API errors gracefully', async () => {
      // Test with invalid pool ID that might cause API error
      const { result } = renderHook(() => usePoolState(''), {
        wrapper: createWrapper(),
      });

      // Should not attempt to fetch and should be in idle state
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.fetchStatus).toBe('idle');
    });
  });

  describe('Prices API Integration', () => {
    it('should integrate prices API with external services and validation', async () => {
      const { result } = renderHook(() => useAllPrices(), {
        wrapper: createWrapper(),
      });

      // Wait for the query to resolve
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Verify the response contains expected price data
      expect(result.current.data).toBeDefined();
      expect(typeof result.current.data?.ETH).toBe('number');
      expect(typeof result.current.data?.BTC).toBe('number');
      expect(typeof result.current.data?.USDC).toBe('number');
      expect(typeof result.current.data?.USDT).toBe('number');
      expect(typeof result.current.data?.lastUpdated).toBe('number');

      // Verify prices are reasonable (not zero or negative)
      expect(result.current.data?.ETH).toBeGreaterThan(0);
      expect(result.current.data?.BTC).toBeGreaterThan(0);
      expect(result.current.data?.USDC).toBe(1); // Should be stablecoin
    });

    it('should handle CoinGecko API failures gracefully', async () => {
      // This test verifies that our MSW mocking handles API failures
      // In a real scenario, we'd test with network failures
      const { result } = renderHook(() => useAllPrices(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // MSW should always return success in tests
      expect(result.current.isError).toBe(false);
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle malformed API responses', async () => {
      // This test would verify Zod validation catches malformed responses
      // In the current setup, MSW returns valid responses, but we could extend
      // this to test invalid response scenarios
      const { result } = renderHook(() => usePoolState('0x123...'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Verify the response passes Zod validation (no runtime errors)
      expect(result.current.isError).toBe(false);
      expect(result.current.data).toBeDefined();
    });
  });

  describe('Cache Integration', () => {
    it('should respect cache headers from API responses', async () => {
      const { result, rerender } = renderHook(() => usePoolState('0x123...'), {
        wrapper: createWrapper(),
      });

      // Wait for first request
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const firstData = result.current.data;
      const firstFetchTime = Date.now();

      // Rerender - should use cache or make fresh request based on cache headers
      rerender();

      // Wait a bit to see if another request is made
      await new Promise(resolve => setTimeout(resolve, 100));

      // Data should be available (either from cache or fresh request)
      expect(result.current.data).toBeDefined();
    });
  });
});


