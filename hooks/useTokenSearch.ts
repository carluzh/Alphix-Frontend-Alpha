/**
 * Hook for searching and fetching tokens from the API
 *
 * Provides:
 * - Popular tokens for quick selection
 * - Search functionality with debouncing
 * - All tokens list with pagination
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { TokenInfo } from '@/lib/aggregators';

interface UseTokenSearchOptions {
  debounceMs?: number;
}

interface TokenSearchResult {
  tokens: TokenInfo[];
  popularTokens: TokenInfo[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  total: number;
}

export function useTokenSearch(options: UseTokenSearchOptions = {}): TokenSearchResult {
  const { debounceMs = 200 } = options;

  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [popularTokens, setPopularTokens] = useState<TokenInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQueryState] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch initial token list
  useEffect(() => {
    const fetchInitialTokens = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('/api/tokens/list?limit=100');
        const data = await response.json();

        if (data.success) {
          setTokens(data.tokens || []);
          setPopularTokens(data.popularTokens || []);
          setTotal(data.total || 0);
          setHasMore((data.offset || 0) + (data.tokens?.length || 0) < (data.total || 0));
        } else {
          setError(data.error || 'Failed to load tokens');
        }
      } catch (err) {
        setError('Failed to load tokens');
      } finally {
        setIsLoading(false);
      }
    };

    fetchInitialTokens();
  }, []);

  // Search handler with debouncing
  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryState(query);

    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // If empty query, reset to full list
    if (!query.trim()) {
      setOffset(0);
      setHasMore(true);

      const fetchTokenList = async () => {
        try {
          setIsLoading(true);
          const response = await fetch('/api/tokens/list?limit=100');
          const data = await response.json();

          if (data.success) {
            setTokens(data.tokens || []);
            setTotal(data.total || 0);
            setHasMore((data.offset || 0) + (data.tokens?.length || 0) < (data.total || 0));
          }
        } catch (err) {
          // Ignore abort errors
        } finally {
          setIsLoading(false);
        }
      };

      fetchTokenList();
      return;
    }

    // Debounce the search
    debounceTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        setIsLoading(true);
        const response = await fetch(
          `/api/tokens/search?q=${encodeURIComponent(query)}&limit=50`,
          { signal: controller.signal }
        );
        const data = await response.json();

        if (data.success) {
          setTokens(data.tokens || []);
          setTotal(data.tokens?.length || 0);
          setHasMore(false); // Search results are not paginated
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError('Search failed');
        }
      } finally {
        setIsLoading(false);
      }
    }, debounceMs);
  }, [debounceMs]);

  // Load more tokens (pagination)
  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading || searchQuery.trim()) return;

    const newOffset = offset + 100;

    try {
      setIsLoading(true);
      const response = await fetch(`/api/tokens/list?offset=${newOffset}&limit=100`);
      const data = await response.json();

      if (data.success) {
        setTokens(prev => [...prev, ...(data.tokens || [])]);
        setOffset(newOffset);
        setHasMore(newOffset + (data.tokens?.length || 0) < (data.total || 0));
      }
    } catch (err) {
      setError('Failed to load more tokens');
    } finally {
      setIsLoading(false);
    }
  }, [hasMore, isLoading, offset, searchQuery]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    tokens,
    popularTokens,
    isLoading,
    error,
    searchQuery,
    setSearchQuery,
    loadMore,
    hasMore,
    total,
  };
}
