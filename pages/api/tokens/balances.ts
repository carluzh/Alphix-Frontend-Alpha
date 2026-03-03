import type { NextApiRequest, NextApiResponse } from 'next';
import { cacheService } from '@/lib/cache/CacheService';

/**
 * Token Balances API - Using Uniswap's Portfolio API
 *
 * Fetches user token balances from Uniswap's backend (same API their interface uses).
 * Returns pre-filtered, vetted tokens with balances, logos, and USD values.
 *
 * This replaces the old Alchemy + vetted list approach which was too restrictive.
 */

// Uniswap Data API endpoint (same as their interface uses)
const UNISWAP_DATA_API = 'https://interface.gateway.uniswap.org/v2/data.v1.DataApiService/GetPortfolio';

// Headers to look like Uniswap interface
const UNISWAP_HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://app.uniswap.org',
  'Referer': 'https://app.uniswap.org/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Connect-Protocol-Version': '1',
};

// Cache TTL: 30s fresh, 60s stale
const CACHE_TTL = { fresh: 30, stale: 60 };

export interface TokenBalance {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  rawBalance: string;
  logo: string | null;
  // Additional fields from Uniswap API
  balanceUSD?: number | null;
}

interface SuccessResponse {
  success: true;
  tokens: TokenBalance[];
  totalFound: number;
  filtered: number;
  totalValueUSD?: number | null;
}

interface ErrorResponse {
  success: false;
  error: string;
}

type ApiResponse = SuccessResponse | ErrorResponse;

interface UniswapPortfolioResponse {
  portfolio?: {
    balances?: Array<{
      token?: {
        address?: string;
        symbol?: string;
        name?: string;
        decimals?: number;
        chainId?: number;
        metadata?: {
          logoUrl?: string;
          protectionInfo?: {
            result?: string;
          };
        };
      };
      amount?: {
        amount?: number;
      };
      valueUsd?: number;
      isHidden?: boolean;
    }>;
    totalValueUsd?: number;
  };
}

async function fetchUniswapPortfolio(address: string): Promise<UniswapPortfolioResponse> {
  const requestPayload = {
    walletAccount: {
      platformAddresses: [
        { platform: 'EVM', address: address },
      ],
    },
    chainIds: [8453], // Base mainnet
    modifier: {
      includeSmallBalances: true,
      includeSpamTokens: false,
    },
  };

  const response = await fetch(UNISWAP_DATA_API, {
    method: 'POST',
    headers: UNISWAP_HEADERS,
    body: JSON.stringify(requestPayload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Uniswap API returned ${response.status}: ${text}`);
  }

  return response.json();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { address: rawAddress } = req.query;

  if (!rawAddress || typeof rawAddress !== 'string') {
    return res.status(400).json({ success: false, error: 'Address is required' });
  }

  // Validate address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(rawAddress)) {
    return res.status(400).json({ success: false, error: 'Invalid address format' });
  }

  // Use lowercase address (Uniswap API prefers it)
  const address = rawAddress.toLowerCase();
  const cacheKey = `portfolio:base:${address}`;

  try {
    const result = await cacheService.cachedApiCall(
      cacheKey,
      CACHE_TTL,
      () => fetchUniswapPortfolio(address),
      { shouldCache: (data) => !!(data as UniswapPortfolioResponse)?.portfolio?.balances?.length }
    );

    const portfolio = result.data.portfolio;
    const balances = portfolio?.balances || [];

    // Filter and map balances - exclude spam and low-value tokens
    const tokens: TokenBalance[] = balances
      .filter((bal) => {
        if (!bal.token) return false;
        if (bal.isHidden) return false;
        const amount = bal.amount?.amount || 0;
        if (amount <= 0) return false;

        // Filter out tokens marked as malicious/spam by Uniswap
        const protectionResult = bal.token.metadata?.protectionInfo?.result?.toLowerCase();
        if (protectionResult === 'malicious' || protectionResult === 'spam') {
          return false;
        }

        // Filter out very low value tokens (< $0.01) as they're likely dust/spam
        const usdValue = bal.valueUsd || 0;
        if (usdValue < 0.01 && usdValue > 0) {
          return false;
        }

        return true;
      })
      .map((bal) => {
        const token = bal.token!;
        const amount = bal.amount?.amount || 0;
        const decimals = token.decimals || 18;

        // Calculate raw balance (amount * 10^decimals)
        // The API returns the human-readable balance, we need to convert back
        const rawBalance = BigInt(Math.floor(amount * Math.pow(10, decimals))).toString();

        return {
          address: token.address || '0x0000000000000000000000000000000000000000',
          symbol: token.symbol || 'UNKNOWN',
          name: token.name || 'Unknown Token',
          decimals,
          balance: String(amount),
          rawBalance,
          logo: token.metadata?.logoUrl || null,
          balanceUSD: bal.valueUsd || null,
        };
      });

    // Sort by USD value descending
    tokens.sort((a, b) => (b.balanceUSD || 0) - (a.balanceUSD || 0));

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

    return res.status(200).json({
      success: true,
      tokens,
      totalFound: balances.length,
      filtered: 0, // Uniswap already filters spam
      totalValueUSD: portfolio?.totalValueUsd || null,
    });
  } catch (error) {
    console.error('[balances] Error fetching portfolio:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch token balances',
    });
  }
}
