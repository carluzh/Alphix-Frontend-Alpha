import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import type { TokenBalance } from '@/pages/api/tokens/balances';

interface UseUserTokensResult {
  tokens: TokenBalance[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Hook to fetch user's token balances with metadata from Alchemy
 * Returns tokens with balance > 0, including name, symbol, decimals, and logo
 */
export function useUserTokens(): UseUserTokensResult {
  const { address, isConnected } = useAccount();
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    if (!address || !isConnected) {
      setTokens([]);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tokens/balances?address=${address}`);
      const data = await response.json();

      if (data.success) {
        setTokens(data.tokens);
      } else {
        setError(data.error || 'Failed to fetch tokens');
        setTokens([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tokens');
      setTokens([]);
    } finally {
      setIsLoading(false);
    }
  }, [address, isConnected]);

  // Fetch on mount and when address changes
  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  // Listen for balance refresh events
  useEffect(() => {
    const handleRefresh = () => fetchTokens();
    window.addEventListener('walletBalancesRefresh', handleRefresh);
    return () => window.removeEventListener('walletBalancesRefresh', handleRefresh);
  }, [fetchTokens]);

  return {
    tokens,
    isLoading,
    error,
    refetch: fetchTokens,
  };
}
