import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { isAddress, getAddress } from 'viem';

import { getAllPools } from '@/lib/pools-config';
import { resolveNetworkMode } from '@/lib/network-mode';
import { validateChainId, checkTxRateLimit } from '@/lib/tx-validation';
import { getPositionDetails } from '@/lib/liquidity/liquidity-utils';
import { findPoolByPoolKey, isUnifiedYieldPool } from '@/lib/liquidity/utils/pool-type-guards';
import { uniswapLPAPI, UniswapLPAPIError, UniswapLPAPIRateLimitError } from '@/lib/liquidity/uniswap-api/client';

interface PrepareCollectTxRequest extends NextApiRequest {
  body: {
    userAddress: string;
    tokenId: string;
    chainId: number;
  };
}

interface CollectTxResponse { to: string; data: string; value: string; gasFee?: string }
interface ErrorResponse { error?: string; message?: string }

export default async function handler(
  req: PrepareCollectTxRequest,
  res: NextApiResponse<CollectTxResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { userAddress, tokenId, chainId } = req.body;
    const networkMode = resolveNetworkMode(req);

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket?.remoteAddress || 'unknown';
    const rateCheck = checkTxRateLimit(clientIp);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfter || 60));
      return res.status(429).json({ message: 'Too many requests. Please try again later.' });
    }

    if (!userAddress || !isAddress(userAddress)) return res.status(400).json({ message: 'Invalid userAddress' });
    if (!tokenId) return res.status(400).json({ message: 'Missing tokenId' });
    if (!chainId || typeof chainId !== 'number') return res.status(400).json({ message: 'Missing or invalid chainId' });

    const chainIdError = validateChainId(chainId, networkMode);
    if (chainIdError) return res.status(400).json({ message: chainIdError });

    const details = await getPositionDetails(BigInt(tokenId), chainId);
    const poolConfig = findPoolByPoolKey(getAllPools(networkMode), details.poolKey);

    if (!poolConfig) {
      return res.status(400).json({ message: 'Position is not in an Alphix pool.' });
    }
    if (isUnifiedYieldPool(poolConfig)) {
      return res.status(400).json({ message: 'Unified Yield positions use a separate withdraw flow.' });
    }

    try {
      const response = await uniswapLPAPI.claimFees({
        walletAddress: getAddress(userAddress),
        chainId,
        protocol: 'V4',
        tokenId,
        simulateTransaction: true,
      });
      return res.status(200).json({
        to: response.claim.to,
        data: response.claim.data,
        value: response.claim.value,
        gasFee: response.gasFee,
      });
    } catch (e) {
      if (e instanceof UniswapLPAPIRateLimitError) {
        console.warn('[prepare-collect-tx] Rate limit exhausted after retries');
        res.setHeader('Retry-After', '2');
        return res.status(429).json({ message: 'Busy — please retry in a moment.' });
      }
      if (e instanceof UniswapLPAPIError) {
        console.error('[prepare-collect-tx] Uniswap LP API error:', e.status, e.message);
        Sentry.captureException(e, {
          tags: { route: 'prepare-collect-tx', source: 'uniswap_lp_api', uniswap_status: String(e.status) },
          extra: { userAddress: req.body?.userAddress, tokenId: req.body?.tokenId, chainId: req.body?.chainId },
        });
        return res.status(e.status >= 500 ? 502 : 400).json({ message: `Uniswap LP API: ${e.message}` });
      }
      throw e;
    }
  } catch (error: any) {
    console.error('[prepare-collect-tx] Error:', error);
    Sentry.captureException(error, {
      tags: { route: 'prepare-collect-tx', source: 'internal' },
      extra: { userAddress: req.body?.userAddress, tokenId: req.body?.tokenId, chainId: req.body?.chainId },
    });
    return res.status(500).json({
      error: 'Failed to prepare collect transaction',
      message: error?.message || 'Unknown error',
    });
  }
}
