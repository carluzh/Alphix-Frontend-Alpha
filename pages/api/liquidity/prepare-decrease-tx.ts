/**
 * prepare-decrease-tx.ts — route non-UY V4 decrease liquidity through Uniswap's LP API.
 *
 * Decrease operations don't require approvals (user is withdrawing).
 * UY positions use a separate share-burn flow; this route rejects them.
 */

import JSBI from 'jsbi';
import { Position as V4Position } from '@uniswap/v4-sdk';
import type { NextApiRequest, NextApiResponse } from 'next';

import { getAllPools } from '@/lib/pools-config';
import { resolveNetworkMode } from '@/lib/network-mode';
import { validateChainId, checkTxRateLimit } from '@/lib/tx-validation';
import { createNetworkClient } from '@/lib/viemClient';
import { buildPoolFromPosition } from '@/lib/liquidity/liquidity-utils';
import { safeParseUnits } from '@/lib/liquidity/utils/parsing/amountParsing';
import { findPoolByPoolKey, isUnifiedYieldPool } from '@/lib/liquidity/utils/pool-type-guards';
import { uniswapLPAPI, UniswapLPAPIError } from '@/lib/liquidity/uniswap-api/client';
import { isAddress, getAddress, zeroAddress } from 'viem';

interface PrepareDecreaseTxRequest extends NextApiRequest {
  body: {
    userAddress: string;
    tokenId: string;
    decreaseAmount0: string;
    decreaseAmount1: string;
    chainId: number;
    isFullBurn?: boolean;
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

function computeDecreasePercentage(args: {
  isFullBurn: boolean;
  amountC0Raw: bigint;
  amountC1Raw: bigint;
  maxAmount0: JSBI;
  maxAmount1: JSBI;
}): number {
  if (args.isFullBurn) return 100;
  let percentage = 0;
  if (!JSBI.equal(args.maxAmount0, JSBI.BigInt(0))) {
    percentage = Math.max(percentage, Number(args.amountC0Raw) / Number(args.maxAmount0.toString()) * 100);
  }
  if (!JSBI.equal(args.maxAmount1, JSBI.BigInt(0))) {
    percentage = Math.max(percentage, Number(args.amountC1Raw) / Number(args.maxAmount1.toString()) * 100);
  }
  return Math.max(1, Math.min(100, Math.round(percentage)));
}

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
  const publicClient = createNetworkClient(networkMode);

  try {
    const {
      userAddress,
      tokenId,
      decreaseAmount0: inputAmount0,
      decreaseAmount1: inputAmount1,
      chainId,
      isFullBurn = false,
      slippageBps = 50,
      deadlineMinutes = 30,
    } = req.body;

    const chainIdError = validateChainId(chainId, networkMode);
    if (chainIdError) return res.status(400).json({ message: chainIdError });
    if (!isAddress(userAddress)) return res.status(400).json({ message: 'Invalid userAddress.' });
    if (!tokenId) return res.status(400).json({ message: 'Missing tokenId.' });

    const nftTokenId = BigInt(tokenId);

    const { details, defC0, defC1, isNativeC0, isNativeC1, pool, poolState: state } =
      await buildPoolFromPosition(nftTokenId, chainId, networkMode);

    const poolConfig = findPoolByPoolKey(getAllPools(networkMode), details.poolKey);
    if (!poolConfig) {
      return res.status(400).json({ message: 'Position is not in an Alphix pool.' });
    }
    if (isUnifiedYieldPool(poolConfig)) {
      return res.status(400).json({ message: 'Unified Yield positions use a separate withdraw flow.' });
    }

    const amountC0Raw = safeParseUnits(inputAmount0 || '0', defC0.decimals);
    const amountC1Raw = safeParseUnits(inputAmount1 || '0', defC1.decimals);
    if (amountC0Raw === 0n && amountC1Raw === 0n && !isFullBurn) {
      return res.status(400).json({ message: 'Please enter a valid amount to withdraw.' });
    }

    const currentPosition = new V4Position({
      pool,
      liquidity: JSBI.BigInt(details.liquidity.toString()),
      tickLower: details.tickLower,
      tickUpper: details.tickUpper,
    });

    const decreasePercentage = computeDecreasePercentage({
      isFullBurn,
      amountC0Raw,
      amountC1Raw,
      maxAmount0: currentPosition.amount0.quotient,
      maxAmount1: currentPosition.amount1.quotient,
    });

    try {
      const deadlineSeconds = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;

      const response = await uniswapLPAPI.decrease({
        walletAddress: getAddress(userAddress),
        chainId,
        protocol: 'V4',
        token0Address: details.poolKey.currency0,
        token1Address: details.poolKey.currency1,
        nftTokenId: nftTokenId.toString(),
        liquidityPercentageToDecrease: decreasePercentage,
        slippageTolerance: slippageBps / 100,
        deadline: deadlineSeconds,
        simulateTransaction: true,
      });

      const deadlineBigInt = BigInt(deadlineSeconds);
      const pctFraction = Math.round(decreasePercentage * 100);
      const liquidityToRemove = isFullBurn
        ? currentPosition.liquidity.toString()
        : JSBI.divide(JSBI.multiply(currentPosition.liquidity, JSBI.BigInt(pctFraction)), JSBI.BigInt(10000)).toString();

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
        deadline: deadlineBigInt.toString(),
        isFullBurn: decreasePercentage === 100,
        gasFee: response.gasFee,
        details: {
          token0: { address: isNativeC0 ? zeroAddress : getAddress(defC0.address), symbol: defC0.symbol, amount: response.token0.amount },
          token1: { address: isNativeC1 ? zeroAddress : getAddress(defC1.address), symbol: defC1.symbol, amount: response.token1.amount },
          liquidityToRemove,
          tickLower: details.tickLower,
          tickUpper: details.tickUpper,
        },
      });
    } catch (e) {
      if (e instanceof UniswapLPAPIError) {
        console.error('[prepare-decrease-tx] Uniswap LP API error:', e.status, e.message);
        return res.status(e.status >= 500 ? 502 : 400).json({ message: `Uniswap LP API: ${e.message}` });
      }
      throw e;
    }
  } catch (error: any) {
    console.error('[API prepare-decrease-tx] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    return res.status(500).json({ message: errorMessage, error: process.env.NODE_ENV === 'development' ? error : undefined });
  }
}
