/**
 * prepare-decrease-tx.ts — thin pass-through to Uniswap's LP API for non-UY V4 decreases.
 *
 * No approvals needed (user is withdrawing). No server-side computation.
 * Validates input, forwards to /lp/decrease, and returns the response verbatim.
 *
 * Shared boilerplate (rate-limit, position-pool resolution, error handling)
 * lives in @/lib/liquidity/api/prepare-tx-shared.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAddress, getAddress } from 'viem';

import { resolveNetworkMode } from '@/lib/network-mode';
import { validateChainId } from '@/lib/tx-validation';
import { uniswapLPAPI } from '@/lib/liquidity/uniswap-api/client';
import {
  enforcePostAndRateLimit,
  resolveAlphixPositionPool,
  handlePrepareTxError,
} from '@/lib/liquidity/api/prepare-tx-shared';

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
  if (enforcePostAndRateLimit(req, res)) return;

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

    const pct = Math.round(decreasePercentage);

    const resolved = await resolveAlphixPositionPool({
      tokenId,
      chainId,
      networkMode,
      uyMessage: 'Unified Yield positions use a separate withdraw flow.',
    });
    if (!resolved.ok) return res.status(400).json({ message: resolved.message });
    const { nftTokenId, positionDetails } = resolved;

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
    handlePrepareTxError(error, req, res, {
      action: 'decrease',
      component: 'prepare-decrease-tx',
      networkMode,
      chainId: req.body?.chainId,
      extras: { userAddress: req.body?.userAddress, tokenId: req.body?.tokenId },
      uniswapExtras: { decreasePercentage: req.body?.decreasePercentage },
    });
  }
}
