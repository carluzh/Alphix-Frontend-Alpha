/**
 * Token List API
 *
 * GET /api/tokens/list?offset=<offset>&limit=<limit>
 *
 * Returns paginated list of tokens from the CoinGecko Base token list.
 * Used by the token selector modal for browsing tokens.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getAllTokens,
  getPopularTokens,
  type TokenInfo,
} from '@/lib/aggregators';

interface ListResponse {
  success: boolean;
  tokens?: TokenInfo[];
  popularTokens?: TokenInfo[];
  total?: number;
  offset?: number;
  limit?: number;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ListResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { offset = '0', limit = '100' } = req.query;
    const offsetNum = parseInt(offset as string) || 0;
    const limitNum = Math.min(parseInt(limit as string) || 100, 500);

    // Get all tokens (synchronous - static token list)
    const allTokens = getAllTokens();
    const total = allTokens.length;

    // Sort by symbol for consistent ordering
    allTokens.sort((a, b) => a.symbol.localeCompare(b.symbol));

    // Paginate
    const paginatedTokens = allTokens.slice(offsetNum, offsetNum + limitNum);

    // Also include popular tokens for quick selection
    const popularTokens = getPopularTokens();

    return res.status(200).json({
      success: true,
      tokens: paginatedTokens,
      popularTokens,
      total,
      offset: offsetNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error('[Token List] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get token list',
    });
  }
}
