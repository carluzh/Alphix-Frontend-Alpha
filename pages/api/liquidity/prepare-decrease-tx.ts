/**
 * prepare-decrease-tx.ts — thin pass-through to Uniswap's LP API for non-UY V4 decreases.
 *
 * No approvals needed (user is withdrawing). No server-side computation.
 * Validates input, forwards to /lp/decrease, and returns the response verbatim.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAddress, getAddress } from 'viem';

import { getAllPools } from '@/lib/pools-config';
import { resolveNetworkMode } from '@/lib/network-mode';
import { validateChainId, checkTxRateLimit } from '@/lib/tx-validation';
import { getPositionDetails } from '@/lib/liquidity/liquidity-utils';
import { findPoolByPoolKey, isUnifiedYieldPool } from '@/lib/liquidity/utils/pool-type-guards';
import { uniswapLPAPI, UniswapLPAPIError, UniswapLPAPIRateLimitError } from '@/lib/liquidity/uniswap-api/client';
import { reportError, addReportBreadcrumb } from '@/lib/observability';

interface PrepareDecreaseTxRequest extends NextApiRequest {
  body: {
    userAddress: string;
    tokenId: string;
    /** 1-100. */
    decreasePercentage: number;
    chainId: number;
    slippageBps?: number;
    deadlineMinutes?: number;
  };
}

interface TransactionPreparedResponse {
  needsApproval: false;
  create: { to: string; from?: string; data: string; value: string; chainId: number; gasLimit?: string };
  isFullBurn: boolean;
  /** Estimated gas cost in wei from /lp/decrease simulation. */
  gasFee?: string;
  details: { token0: { amount: string }; token1: { amount: string } };
}

type PrepareDecreaseTxResponse = TransactionPreparedResponse | { message: string; error?: any };

export default async function handler(
  req: PrepareDecreaseTxRequest,
  res: NextApiResponse<PrepareDecreaseTxResponse>,
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const rateCheck = checkTxRateLimit(clientIp);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', String(rateCheck.retryAfter || 60));
    return res.status(429).json({ message: 'Too many requests. Please try again later.' });
  }

  const networkMode = resolveNetworkMode(req);

  try {
    const {
      userAddress,
      tokenId,
      decreasePercentage,
      chainId,
      slippageBps,
      deadlineMinutes = 30,
    } = req.body;

    // --- 1. Validate request -------------------------------------------------
    const chainIdError = validateChainId(chainId, networkMode);
    if (chainIdError) return res.status(400).json({ message: chainIdError });
    if (!isAddress(userAddress)) return res.status(400).json({ message: 'Invalid userAddress.' });
    if (!tokenId) return res.status(400).json({ message: 'Missing tokenId.' });
    if (typeof decreasePercentage !== 'number' || decreasePercentage < 1 || decreasePercentage > 100) {
      return res.status(400).json({ message: 'decreasePercentage must be between 1 and 100.' });
    }

    const nftTokenId = BigInt(tokenId);
    const pct = Math.round(decreasePercentage);

    // Breadcrumb before the on-chain position lookup; if it throws it bubbles to the
    // outer catch where reportError captures it.
    addReportBreadcrumb({ domain: 'liquidity', action: 'fetchPositionDetails', data: { tokenId, chainId } });
    const positionDetails = await getPositionDetails(nftTokenId, chainId);
    const poolConfig = findPoolByPoolKey(getAllPools(networkMode), positionDetails.poolKey);
    if (!poolConfig) {
      return res.status(400).json({ message: 'Position is not in an Alphix pool.' });
    }
    if (isUnifiedYieldPool(poolConfig)) {
      return res.status(400).json({ message: 'Unified Yield positions use a separate withdraw flow.' });
    }

    const deadlineSeconds = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;

    // --- 2. Call /lp/decrease -----------------------------------------------
    const response = await uniswapLPAPI.decrease({
      walletAddress: getAddress(userAddress),
      chainId,
      protocol: 'V4',
      token0Address: positionDetails.poolKey.currency0,
      token1Address: positionDetails.poolKey.currency1,
      nftTokenId: nftTokenId.toString(),
      liquidityPercentageToDecrease: pct,
      // Omit slippageTolerance unless the caller pins one — Uniswap then applies its own.
      ...(typeof slippageBps === 'number' ? { slippageTolerance: slippageBps / 100 } : {}),
      deadline: deadlineSeconds,
      simulateTransaction: true,
    });

    // --- 3. Return ----------------------------------------------------------
    return res.status(200).json({
      needsApproval: false,
      create: {
        to: response.decrease.to,
        from: response.decrease.from,
        data: response.decrease.data,
        value: response.decrease.value,
        chainId,
      },
      isFullBurn: pct === 100,
      gasFee: response.gasFee,
      details: {
        token0: { amount: response.token0.amount },
        token1: { amount: response.token1.amount },
      },
    });
  } catch (error: any) {
    if (error instanceof UniswapLPAPIRateLimitError) {
      console.warn('[prepare-decrease-tx] Rate limit exhausted after retries');
      // Rate limits are expected — do NOT capture; leave a breadcrumb trail only.
      addReportBreadcrumb({ domain: 'liquidity', action: 'decrease', level: 'warning', message: 'rate limited' });
      res.setHeader('Retry-After', '2');
      return res.status(429).json({ message: 'Busy — please retry in a moment.' });
    }
    if (error instanceof UniswapLPAPIError) {
      console.error('[prepare-decrease-tx] Uniswap LP API error:', error.status, error.message);
      reportError(error, {
        domain: 'liquidity',
        action: 'decrease',
        component: 'prepare-decrease-tx',
        chainId: req.body?.chainId,
        networkMode,
        tags: { uniswapStatus: error.status, uniswapErrorCode: error.code },
        extras: {
          userAddress: req.body?.userAddress,
          tokenId: req.body?.tokenId,
          decreasePercentage: req.body?.decreasePercentage,
          uniswapDetails: error.details,
        },
      });
      return res.status(error.status >= 500 ? 502 : 400).json({ message: `Uniswap LP API: ${error.message}` });
    }
    console.error('[API prepare-decrease-tx] Error:', error);
    reportError(error, {
      domain: 'liquidity',
      action: 'decrease',
      component: 'prepare-decrease-tx',
      chainId: req.body?.chainId,
      networkMode,
      extras: { userAddress: req.body?.userAddress, tokenId: req.body?.tokenId },
    });
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    return res.status(500).json({ message: errorMessage, error: process.env.NODE_ENV === 'development' ? error : undefined });
  }
}
