import type { NextApiRequest, NextApiResponse } from 'next';
import { isAddress, getAddress } from 'viem';

import { resolveNetworkMode } from '@/lib/network-mode';
import { validateChainId, checkTxRateLimit } from '@/lib/tx-validation';
import { uniswapLPAPI, UniswapLPAPIError, UniswapLPAPIRateLimitError } from '@/lib/liquidity/uniswap-api/client';
import { reportError, reportMessage, addReportBreadcrumb } from '@/lib/observability';
import { resolveAlphixPositionPool } from '@/lib/liquidity/api/prepare-tx-shared';

interface PrepareCollectTxRequest extends NextApiRequest {
  body: {
    userAddress: string;
    tokenId: string;
    chainId: number;
  };
}

interface CollectTxResponse { to: string; data: string; value: string; gasFee?: string }
interface ErrorResponse { message: string; error?: any }

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
    if (!chainId) return res.status(400).json({ message: 'Missing chainId' });

    const chainIdError = validateChainId(chainId, networkMode);
    if (chainIdError) return res.status(400).json({ message: chainIdError });

    const resolved = await resolveAlphixPositionPool({
      tokenId,
      chainId,
      networkMode,
      uyMessage: 'Unified Yield positions use a separate withdraw flow.',
    });
    if (!resolved.ok) return res.status(400).json({ message: resolved.message });

    // No retry. The Uniswap Data API is eventually consistent — freshly-minted or
    // freshly-modified positions can return 404 ResourceNotFound ("Unable to derive
    // uncollected fees from Data API for V4 position") until the indexer catches up.
    // We surface a clear "please try again" message instead of papering over with a
    // retry loop; loud failure is the explicit project convention here.
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
        // Rate limits are expected — do NOT capture; leave a breadcrumb trail only.
        addReportBreadcrumb({ domain: 'liquidity', action: 'collect', level: 'warning', message: 'rate limited' });
        res.setHeader('Retry-After', '2');
        return res.status(429).json({ message: 'Busy — please retry in a moment.' });
      }
      if (e instanceof UniswapLPAPIError) {
        console.error('[prepare-collect-tx] Uniswap LP API error:', e.status, e.message);
        if (e.status === 404) {
          // Eventual-consistency indexing delay (ResourceNotFound) — expected, NOT an
          // exception worth capturing. Report as a soft warning so it stays queryable
          // without paging anyone, then surface the existing 503 retry message.
          reportMessage('indexing delay: uncollected fees not yet derivable', {
            domain: 'liquidity',
            action: 'collect',
            component: 'prepare-collect-tx',
            level: 'warning',
            chainId: req.body?.chainId,
            networkMode,
            tags: { isIndexingDelay: 'true', uniswapStatus: e.status, uniswapErrorCode: e.code },
            extras: { userAddress: req.body?.userAddress, tokenId: req.body?.tokenId },
          });
          res.setHeader('Retry-After', '5');
          return res.status(503).json({
            message: 'Uncollected fees are still being indexed by Uniswap. Please try again in a few seconds.',
          });
        }
        reportError(e, {
          domain: 'liquidity',
          action: 'collect',
          component: 'prepare-collect-tx',
          chainId: req.body?.chainId,
          networkMode,
          tags: { uniswapStatus: e.status, uniswapErrorCode: e.code },
          extras: { userAddress: req.body?.userAddress, tokenId: req.body?.tokenId, uniswapDetails: e.details },
        });
        // Upstream/gateway/timeout (5xx) is the API's fault, not the user's — say so
        // plainly and don't leak the internal path/message. 4xx keeps its detail.
        const isUpstream = e.status >= 500;
        return res.status(isUpstream ? 502 : 400).json({
          message: isUpstream
            ? "Our API failed to process the request. Please try again — sorry for the inconvenience."
            : `Uniswap LP API: ${e.message}`,
        });
      }
      throw e;
    }
  } catch (error: any) {
    console.error('[prepare-collect-tx] Error:', error);
    reportError(error, {
      domain: 'liquidity',
      action: 'collect',
      component: 'prepare-collect-tx',
      chainId: req.body?.chainId,
      extras: { userAddress: req.body?.userAddress, tokenId: req.body?.tokenId },
    });
    return res.status(500).json({ message: error?.message || 'Failed to prepare collect transaction' });
  }
}
