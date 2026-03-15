/**
 * Token Search API
 *
 * GET /api/tokens/search?q=<query>&limit=<limit>
 *
 * Returns tokens matching the search query (symbol, name, or address).
 * Used by the token selector modal for searching tokens.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  searchTokens,
  getPopularTokens,
  type TokenInfo,
} from '@/lib/aggregators';
import { resolveNetworkMode } from '@/lib/network-mode';

interface SearchResponse {
  success: boolean;
  tokens?: TokenInfo[];
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SearchResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { q, limit = '50' } = req.query;
    const query = typeof q === 'string' ? q : '';
    const limitNum = Math.min(parseInt(limit as string) || 50, 100);
    const networkMode = resolveNetworkMode(req);

    // If no query, return popular tokens
    if (!query.trim()) {
      const popularTokens = getPopularTokens(networkMode);
      return res.status(200).json({
        success: true,
        tokens: popularTokens,
      });
    }

    // Search tokens (synchronous - static token list)
    const tokens = searchTokens(query, limitNum, networkMode);

    return res.status(200).json({
      success: true,
      tokens,
    });
  } catch (error) {
    console.error('[Token Search] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to search tokens',
    });
  }
}
