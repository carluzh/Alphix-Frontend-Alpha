/**
 * useZapQuote Hook
 *
 * Handles zap quote fetching and price impact calculation for single-token liquidity provision.
 * Extracts zap logic from AddLiquidityForm for cleaner separation of concerns.
 */

import { useState, useCallback } from 'react';
import * as Sentry from '@sentry/nextjs';
import { DEFAULT_LP_SLIPPAGE } from '@/lib/slippage-constants';
import { cleanAmountForAPI } from '@/lib/liquidity/utils/parsing/amountParsing';
import { TokenSymbol } from '@/lib/pools-config';

export interface ZapQuoteData {
  swapAmount: string;
  expectedToken0Amount: string;
  expectedToken1Amount: string;
  expectedLiquidity: string;
  priceImpact: string;
  leftoverToken0?: string;
  leftoverToken1?: string;
}

export interface ZapTransactionData {
  amount0: string;
  amount1: string;
  liquidity: string;
  finalTickLower: number;
  finalTickUpper: number;
}

export interface UseZapQuoteParams {
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  chainId: number | undefined;
  zapSlippageToleranceBps: number;
  updateAutoSlippage: (value: number) => void;
}

export interface UseZapQuoteResult {
  /** Zap quote data from API */
  zapQuote: ZapQuoteData | null;
  /** Zap transaction data for execution */
  zapTransactionData: ZapTransactionData | null;
  /** Price impact percentage */
  priceImpact: number | null;
  /** Loading state while fetching quote */
  isPreparingZap: boolean;
  /** Fetch zap quote from API */
  fetchZapQuote: (params: FetchZapQuoteParams) => Promise<boolean>;
  /** Reset zap state */
  resetZapState: () => void;
  /** Set price impact directly */
  setPriceImpact: (value: number | null) => void;
  /** Set zap quote directly */
  setZapQuote: (value: ZapQuoteData | null) => void;
}

export interface FetchZapQuoteParams {
  zapInputToken: 'token0' | 'token1';
  inputAmount: string;
  tickLower: string;
  tickUpper: string;
  accountAddress: string | undefined;
}

/**
 * Hook for managing zap quote fetching and price impact calculation.
 */
export function useZapQuote(params: UseZapQuoteParams): UseZapQuoteResult {
  const {
    token0Symbol,
    token1Symbol,
    chainId,
    zapSlippageToleranceBps,
    updateAutoSlippage,
  } = params;

  const [zapQuote, setZapQuote] = useState<ZapQuoteData | null>(null);
  const [zapTransactionData, setZapTransactionData] = useState<ZapTransactionData | null>(null);
  const [priceImpact, setPriceImpact] = useState<number | null>(null);
  const [isPreparingZap, setIsPreparingZap] = useState(false);

  const resetZapState = useCallback(() => {
    setZapQuote(null);
    setZapTransactionData(null);
    setPriceImpact(null);
  }, []);

  const fetchZapQuote = useCallback(async (fetchParams: FetchZapQuoteParams): Promise<boolean> => {
    const { zapInputToken, inputAmount, tickLower, tickUpper, accountAddress } = fetchParams;

    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      return false;
    }

    setIsPreparingZap(true);
    try {
      const tl = parseInt(tickLower);
      const tu = parseInt(tickUpper);
      const primaryTokenSymbol = zapInputToken === 'token0' ? token0Symbol : token1Symbol;
      const primaryAmount = cleanAmountForAPI(inputAmount);

      const response = await fetch('/api/liquidity/prepare-zap-mint-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: accountAddress || '0x0000000000000000000000000000000000000001',
          token0Symbol,
          token1Symbol,
          inputAmount: primaryAmount,
          inputTokenSymbol: primaryTokenSymbol,
          userTickLower: tl,
          userTickUpper: tu,
          chainId,
          slippageTolerance: zapSlippageToleranceBps,
        }),
      });

      if (response.ok) {
        const data = await response.json();

        if ('zapQuote' in data) {
          // Capture price impact from API response
          const priceImpactNum = parseFloat(data.zapQuote.priceImpact || "0");
          if (!isNaN(priceImpactNum) && priceImpactNum > 0) {
            setPriceImpact(priceImpactNum);
          } else {
            setPriceImpact(null);
          }

          // Set zap quote for display
          setZapQuote(data.zapQuote);

          // Derive auto slippage suggestion from price impact with buffer
          const priceImpactPercent = Number.parseFloat(data.zapQuote.priceImpact ?? '');
          const bufferedTarget = Number.isFinite(priceImpactPercent)
            ? priceImpactPercent + 0.3
            : DEFAULT_LP_SLIPPAGE;
          const MAX_SLIPPAGE_FOR_ZAP = 5.0;
          const suggestedAutoSlippage = Math.min(
            MAX_SLIPPAGE_FOR_ZAP,
            Math.max(DEFAULT_LP_SLIPPAGE, bufferedTarget)
          );
          updateAutoSlippage(Number(suggestedAutoSlippage.toFixed(2)));

          // Update zap transaction data with actual amounts (only if details exist)
          if ('details' in data && data.details) {
            setZapTransactionData({
              amount0: data.details.token0.amount,
              amount1: data.details.token1.amount,
              liquidity: data.details.liquidity,
              finalTickLower: data.details.finalTickLower,
              finalTickUpper: data.details.finalTickUpper,
            });
          }

          return true;
        } else {
          setPriceImpact(null);
          setZapQuote(null);
          return false;
        }
      } else {
        const error = await response.json();
        setPriceImpact(null);
        setZapQuote(null);

        Sentry.captureMessage('Zap quote API failed', {
          level: 'warning',
          tags: { operation: 'zap_quote' },
          extra: {
            token0Symbol,
            token1Symbol,
            inputToken: zapInputToken === 'token0' ? token0Symbol : token1Symbol,
            inputAmount,
            tickLower,
            tickUpper,
            apiError: error.message,
          }
        });

        throw new Error(error.message || 'Failed to calculate zap quote');
      }
    } catch (error: any) {
      console.error('[useZapQuote] Error fetching zap quote:', error);
      setPriceImpact(null);
      setZapQuote(null);

      if (!error.message?.includes('Zap quote API failed')) {
        Sentry.captureException(error, {
          tags: { operation: 'zap_quote' },
          extra: {
            token0Symbol,
            token1Symbol,
            inputToken: fetchParams.zapInputToken === 'token0' ? token0Symbol : token1Symbol,
            inputAmount: fetchParams.inputAmount,
            tickLower: fetchParams.tickLower,
            tickUpper: fetchParams.tickUpper,
          }
        });
      }

      throw error;
    } finally {
      setIsPreparingZap(false);
    }
  }, [token0Symbol, token1Symbol, chainId, zapSlippageToleranceBps, updateAutoSlippage]);

  return {
    zapQuote,
    zapTransactionData,
    priceImpact,
    isPreparingZap,
    fetchZapQuote,
    resetZapState,
    setPriceImpact,
    setZapQuote,
  };
}
