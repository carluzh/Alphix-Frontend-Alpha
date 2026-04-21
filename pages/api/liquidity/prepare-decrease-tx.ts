/**
 * prepare-decrease-tx.ts — route non-UY V4 decrease liquidity through Uniswap's LP API.
 *
 * Decrease operations don't require approvals (user is withdrawing).
 * UY positions use a separate share-burn flow; this route rejects them.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { getAllPools, getToken, getTokenSymbolByAddress } from '@/lib/pools-config';
import { resolveNetworkMode } from '@/lib/network-mode';
import { validateChainId, checkTxRateLimit } from '@/lib/tx-validation';
import { getPositionDetails, getPoolState } from '@/lib/liquidity/liquidity-utils';
import { findPoolByPoolKey, isUnifiedYieldPool } from '@/lib/liquidity/utils/pool-type-guards';
import { uniswapLPAPI, UniswapLPAPIError } from '@/lib/liquidity/uniswap-api/client';
import { isAddress, getAddress, zeroAddress, type Hex } from 'viem';

interface PrepareDecreaseTxRequest extends NextApiRequest {
  body: {
    userAddress: string;
    tokenId: string;
    /** 1-100. Sole supported input from frontend. */
    decreasePercentage: number;
    chainId: number;
    slippageBps?: number;
    deadlineMinutes?: number;
  };
}

interface TransactionPreparedResponse {
  needsApproval: false;
  create: { to: string; from?: string; data: string; value: string; chainId: number; gasLimit?: string };
  transaction: { to: string; data: string; value: string; gasLimit?: string };
  sqrtRatioX96: string;
  currentTick: number;
  poolLiquidity: string;
  deadline: string;
  isFullBurn: boolean;
  /** Estimated gas cost in wei from API simulation. */
  gasFee?: string;
  details: {
    token0: { address: string; symbol: string; amount: string };
    token1: { address: string; symbol: string; amount: string };
    liquidityToRemove: string;
    tickLower: number;
    tickUpper: number;
  };
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
      slippageBps = 50,
      deadlineMinutes = 30,
    } = req.body;

    const chainIdError = validateChainId(chainId, networkMode);
    if (chainIdError) return res.status(400).json({ message: chainIdError });
    if (!isAddress(userAddress)) return res.status(400).json({ message: 'Invalid userAddress.' });
    if (!tokenId) return res.status(400).json({ message: 'Missing tokenId.' });
    if (typeof decreasePercentage !== 'number' || decreasePercentage < 1 || decreasePercentage > 100) {
      return res.status(400).json({ message: 'decreasePercentage must be between 1 and 100.' });
    }

    const nftTokenId = BigInt(tokenId);
    const pct = Math.round(decreasePercentage);

    const details = await getPositionDetails(nftTokenId, chainId);
    const poolConfig = findPoolByPoolKey(getAllPools(networkMode), details.poolKey);
    if (!poolConfig) {
      return res.status(400).json({ message: 'Position is not in an Alphix pool.' });
    }
    if (isUnifiedYieldPool(poolConfig)) {
      return res.status(400).json({ message: 'Unified Yield positions use a separate withdraw flow.' });
    }

    const sym0 = getTokenSymbolByAddress(details.poolKey.currency0, networkMode);
    const sym1 = getTokenSymbolByAddress(details.poolKey.currency1, networkMode);
    const defC0 = sym0 ? getToken(sym0, networkMode) : null;
    const defC1 = sym1 ? getToken(sym1, networkMode) : null;
    if (!defC0 || !defC1) {
      return res.status(400).json({ message: 'Token metadata missing for this position.' });
    }
    const isNativeC0 = getAddress(details.poolKey.currency0) === zeroAddress;
    const isNativeC1 = getAddress(details.poolKey.currency1) === zeroAddress;

    const deadlineSeconds = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;

    const [response, state] = await Promise.all([
      uniswapLPAPI.decrease({
        walletAddress: getAddress(userAddress),
        chainId,
        protocol: 'V4',
        token0Address: details.poolKey.currency0,
        token1Address: details.poolKey.currency1,
        nftTokenId: nftTokenId.toString(),
        liquidityPercentageToDecrease: pct,
        slippageTolerance: slippageBps / 100,
        deadline: deadlineSeconds,
        simulateTransaction: true,
      }),
      getPoolState(poolConfig.poolId as Hex, chainId),
    ]);

    const liquidityToRemove = pct === 100
      ? details.liquidity.toString()
      : ((details.liquidity * BigInt(pct)) / 100n).toString();

    return res.status(200).json({
      needsApproval: false,
      create: {
        to: response.decrease.to,
        from: response.decrease.from,
        data: response.decrease.data,
        value: response.decrease.value,
        chainId,
      },
      transaction: {
        to: response.decrease.to,
        data: response.decrease.data,
        value: response.decrease.value,
      },
      sqrtRatioX96: state.sqrtPriceX96.toString(),
      currentTick: state.tick,
      poolLiquidity: state.liquidity.toString(),
      deadline: deadlineSeconds.toString(),
      isFullBurn: pct === 100,
      gasFee: response.gasFee,
      details: {
        token0: { address: isNativeC0 ? zeroAddress : getAddress(defC0.address), symbol: defC0.symbol, amount: response.token0.amount },
        token1: { address: isNativeC1 ? zeroAddress : getAddress(defC1.address), symbol: defC1.symbol, amount: response.token1.amount },
        liquidityToRemove,
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
      },
    });
  } catch (error: any) {
    if (error instanceof UniswapLPAPIError) {
      console.error('[prepare-decrease-tx] Uniswap LP API error:', error.status, error.message);
      return res.status(error.status >= 500 ? 502 : 400).json({ message: `Uniswap LP API: ${error.message}` });
    }
    console.error('[API prepare-decrease-tx] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    return res.status(500).json({ message: errorMessage, error: process.env.NODE_ENV === 'development' ? error : undefined });
  }
}
