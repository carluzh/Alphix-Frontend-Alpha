/**
 * Hook to get USD price of tokens by quoting against aUSDC
 * Follows Uniswap's approach: quote a fixed amount of stablecoin against the token
 */

import { useState, useEffect, useCallback } from 'react';
import { TokenSymbol } from '@/lib/pools-config';

const QUOTE_AMOUNT_USDC = 100; // Quote 100 aUSDC against token (like Uniswap uses 1000)
const CACHE_DURATION_MS = 30 * 1000; // Cache for 30 seconds

interface PriceCache {
  price: number;
  timestamp: number;
}

const priceCache = new Map<TokenSymbol, PriceCache>();

export function useTokenUSDPrice(tokenSymbol: TokenSymbol | null | undefined): {
  price: number | null;
  isLoading: boolean;
} {
  const [price, setPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPrice = useCallback(async (symbol: TokenSymbol) => {
    // Check cache first
    const cached = priceCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
      setPrice(cached.price);
      return;
    }

    setIsLoading(true);
    try {
      // Quote 100 aUSDC -> token (ExactOut to get how much token we'd get for 100 USDC)
      const response = await fetch('/api/swap/get-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromTokenSymbol: 'aUSDC',
          toTokenSymbol: symbol,
          amountDecimalsStr: QUOTE_AMOUNT_USDC.toString(),
          swapType: 'ExactIn',
          chainId: 84532, // Base Sepolia
          debug: false,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch price quote');
      }

      const data = await response.json();
      if (data.success && data.toAmount) {
        // Price = 100 USDC / amount of token received
        const tokenAmount = parseFloat(data.toAmount);
        if (tokenAmount > 0) {
          const calculatedPrice = QUOTE_AMOUNT_USDC / tokenAmount;
          setPrice(calculatedPrice);
          priceCache.set(symbol, { price: calculatedPrice, timestamp: Date.now() });
        } else {
          setPrice(null);
        }
      } else {
        setPrice(null);
      }
    } catch (error) {
      console.error(`[useTokenUSDPrice] Error fetching price for ${symbol}:`, error);
      setPrice(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!tokenSymbol) {
      setPrice(null);
      setIsLoading(false);
      return;
    }

    // Skip if token is aUSDC itself
    if (tokenSymbol === 'aUSDC') {
      setPrice(1);
      setIsLoading(false);
      return;
    }

    fetchPrice(tokenSymbol);
  }, [tokenSymbol, fetchPrice]);

  return { price, isLoading };
}

/**
 * Hook to get USD value of a token amount
 */
export function useTokenUSDValue(
  tokenSymbol: TokenSymbol | null | undefined,
  amount: string | null | undefined
): {
  value: number | null;
  isLoading: boolean;
} {
  const { price, isLoading } = useTokenUSDPrice(tokenSymbol);
  const amountNum = amount ? parseFloat(amount) : null;

  return {
    value: price !== null && amountNum !== null ? price * amountNum : null,
    isLoading,
  };
}

