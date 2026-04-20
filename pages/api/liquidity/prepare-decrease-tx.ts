/**
 * prepare-decrease-tx.ts - API route for preparing decrease liquidity transactions
 *
 * Decrease operations don't require approvals or permits (user is withdrawing tokens),
 * so this always returns transaction data directly.
 *
 * @see pages/api/liquidity/prepare-mint-tx.ts
 * @see pages/api/liquidity/prepare-increase-tx.ts
 */

import { Percent } from '@uniswap/sdk-core';
import { Position as V4Position, V4PositionManager, V4PositionPlanner, toHex } from "@uniswap/v4-sdk";
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { getPositionManagerAddress, getAllPools } from "@/lib/pools-config";
import { resolveNetworkMode } from "@/lib/network-mode";
import { validateChainId, checkTxRateLimit } from "@/lib/tx-validation";
import { createNetworkClient } from "@/lib/viemClient";
import { buildPoolFromPosition } from "@/lib/liquidity/liquidity-utils";
import { safeParseUnits } from "@/lib/liquidity/utils/parsing/amountParsing";
import { findPoolByPoolKey, isUnifiedYieldPool } from "@/lib/liquidity/utils/pool-type-guards";
import { uniswapLPAPI, UniswapLPAPIError } from "@/lib/liquidity/uniswap-api/client";
import {
  isAddress,
  getAddress,
  zeroAddress,
  type Hex
} from "viem";

interface PrepareDecreaseTxRequest extends NextApiRequest {
  body: {
    userAddress: string;
    tokenId: string; // NFT token ID (numeric string)
    decreaseAmount0: string; // Amount of token0 to withdraw (display units)
    decreaseAmount1: string; // Amount of token1 to withdraw (display units)
    chainId: number;
    isFullBurn?: boolean; // Whether to fully remove the position
    // User settings (optional - defaults provided)
    slippageBps?: number; // Slippage in basis points (e.g., 50 = 0.5%). Default: 50
    deadlineMinutes?: number; // Transaction deadline in minutes. Default: 20
  };
}

// Transaction response (no approvals needed for decrease)
interface TransactionPreparedResponse {
  needsApproval: false;
  create: {
    to: string;
    from?: string;
    data: string;
    value: string;
    chainId: number;
    gasLimit?: string;
  };
  transaction: {
    to: string;
    data: string;
    value: string;
    gasLimit?: string;
  };
  sqrtRatioX96: string;
  currentTick: number;
  poolLiquidity: string;
  deadline: string;
  isFullBurn: boolean;
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
  res: NextApiResponse<PrepareDecreaseTxResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  }

  // Rate limiting
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const rateCheck = checkTxRateLimit(clientIp);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', String(rateCheck.retryAfter || 60));
    return res.status(429).json({ message: 'Too many requests. Please try again later.' });
  }

  const networkMode = resolveNetworkMode(req);
  const publicClient = createNetworkClient(networkMode);
  const POSITION_MANAGER_ADDRESS = getPositionManagerAddress(networkMode);

  try {
    const {
      userAddress,
      tokenId,
      decreaseAmount0: inputAmount0,
      decreaseAmount1: inputAmount1,
      chainId,
      isFullBurn = false,
      slippageBps = 50,
      deadlineMinutes = 20,
    } = req.body;

    // Validate inputs
    const chainIdError = validateChainId(chainId, networkMode);
    if (chainIdError) {
      return res.status(400).json({ message: chainIdError });
    }

    if (!isAddress(userAddress)) {
      return res.status(400).json({ message: "Invalid userAddress." });
    }

    if (!tokenId) {
      return res.status(400).json({ message: "Missing tokenId." });
    }

    const nftTokenId = BigInt(tokenId);

    // Build pool + token context from on-chain position
    const { details, defC0, defC1, currency0, currency1, isNativeC0, isNativeC1, pool, poolState: state } = await buildPoolFromPosition(nftTokenId, chainId, networkMode);

    // Parse amounts
    const amountC0Raw = safeParseUnits(inputAmount0 || "0", defC0.decimals);
    const amountC1Raw = safeParseUnits(inputAmount1 || "0", defC1.decimals);

    if (amountC0Raw === 0n && amountC1Raw === 0n && !isFullBurn) {
      return res.status(400).json({ message: 'Please enter a valid amount to withdraw.' });
    }

    // Build position using current liquidity
    const currentPosition = new V4Position({
      pool,
      liquidity: JSBI.BigInt(details.liquidity.toString()),
      tickLower: details.tickLower,
      tickUpper: details.tickUpper,
    });

    // Compute decrease percentage (1-100, int). Used by both legacy + Uniswap API paths.
    const decreasePercentage = computeDecreasePercentage({
      isFullBurn,
      amountC0Raw, amountC1Raw,
      maxAmount0: currentPosition.amount0.quotient,
      maxAmount1: currentPosition.amount1.quotient,
    });

    // Route non-UY pools through Uniswap Liquidity API.
    const poolConfig = findPoolByPoolKey(getAllPools(networkMode), details.poolKey);
    const useUniswapAPI = poolConfig != null && !isUnifiedYieldPool(poolConfig);

    if (useUniswapAPI) {
      try {
        const response = await uniswapLPAPI.decrease({
          walletAddress: getAddress(userAddress),
          chainId,
          protocol: 'V4',
          token0Address: details.poolKey.currency0,
          token1Address: details.poolKey.currency1,
          nftTokenId: nftTokenId.toString(),
          liquidityPercentageToDecrease: decreasePercentage,
          simulateTransaction: false,
        });

        const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
        const deadlineBigInt = latestBlock.timestamp + BigInt(deadlineMinutes) * 60n;
        const liquidityToRemove = (currentPosition.liquidity as any).toString
          ? JSBI.divide(JSBI.multiply(currentPosition.liquidity, JSBI.BigInt(decreasePercentage)), JSBI.BigInt(100)).toString()
          : '0';

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
    }

    // Calculate liquidity to remove from the percentage we already computed.
    const pctFraction = Math.round(decreasePercentage * 100); // basis points
    const liquidityToRemove: JSBI = isFullBurn
      ? currentPosition.liquidity
      : JSBI.divide(JSBI.multiply(currentPosition.liquidity, JSBI.BigInt(pctFraction)), JSBI.BigInt(10000));

    // Create position for removal
    const positionToRemove = new V4Position({
      pool,
      liquidity: liquidityToRemove,
      tickLower: details.tickLower,
      tickUpper: details.tickUpper,
    });

    // Build deadline
    const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
    if (!latestBlock) throw new Error("Failed to get latest block for deadline.");
    const deadlineSeconds = BigInt(deadlineMinutes) * 60n;
    const deadlineBigInt = latestBlock.timestamp + deadlineSeconds;

    // Build remove liquidity calldata using V4PositionPlanner
    const SLIPPAGE_TOLERANCE = new Percent(slippageBps, 10_000);
    const slippageAmounts = positionToRemove.burnAmountsWithSlippage(SLIPPAGE_TOLERANCE);

    // Use V4PositionPlanner for decrease
    const planner = new V4PositionPlanner();

    // Determine if this should burn the position NFT
    const shouldBurnNFT = isFullBurn || JSBI.equal(liquidityToRemove, currentPosition.liquidity);

    // Use toHex for tokenId per SDK pattern (ref: PositionManager.ts:342)
    const tokenIdHex = toHex(nftTokenId.toString());

    // Add decrease liquidity action using JSBI for SDK compatibility
    planner.addDecrease(
      tokenIdHex,
      liquidityToRemove,
      JSBI.BigInt(slippageAmounts.amount0.toString()),
      JSBI.BigInt(slippageAmounts.amount1.toString()),
      "0x", // hookData
    );

    // Add take actions for each currency (using Currency objects, not addresses)
    // For decrease: we take tokens from the pool
    planner.addTakePair(
      currency0,
      currency1,
      getAddress(userAddress),
    );

    // Sweep native ETH back to user (required for native currency positions)
    if (isNativeC0) {
      planner.addSweep(currency0, getAddress(userAddress));
    } else if (isNativeC1) {
      planner.addSweep(currency1, getAddress(userAddress));
    }

    // If burning, add burn action
    if (shouldBurnNFT) {
      planner.addBurn(
        tokenIdHex,
        JSBI.BigInt(slippageAmounts.amount0.toString()),
        JSBI.BigInt(slippageAmounts.amount1.toString()),
        "0x", // hookData
      );
    }

    // Encode the planner actions (pass two arguments, not object)
    const calldata = V4PositionManager.encodeModifyLiquidities(
      planner.finalize() as Hex,
      deadlineBigInt.toString(),
    );

    // Estimate gas
    let gasLimit: string | undefined;
    try {
      const estimatedGas = await publicClient.estimateGas({
        account: getAddress(userAddress),
        to: POSITION_MANAGER_ADDRESS as `0x${string}`,
        data: calldata as `0x${string}`,
        value: 0n,
      });
      gasLimit = ((estimatedGas * 130n) / 100n).toString(); // 30% buffer for decrease
    } catch (e) {
      console.warn('[prepare-decrease-tx] Gas estimation failed:', e);
    }

    // Final amounts
    const finalAmount0 = BigInt(positionToRemove.amount0.quotient.toString());
    const finalAmount1 = BigInt(positionToRemove.amount1.quotient.toString());

    return res.status(200).json({
      needsApproval: false,
      create: {
        to: POSITION_MANAGER_ADDRESS,
        from: getAddress(userAddress),
        data: calldata,
        value: "0",
        chainId,
        gasLimit,
      },
      transaction: {
        to: POSITION_MANAGER_ADDRESS,
        data: calldata,
        value: "0",
        gasLimit,
      },
      sqrtRatioX96: state.sqrtPriceX96.toString(),
      currentTick: state.tick,
      poolLiquidity: state.liquidity.toString(),
      deadline: deadlineBigInt.toString(),
      isFullBurn: shouldBurnNFT,
      details: {
        token0: { address: isNativeC0 ? zeroAddress : getAddress(defC0.address), symbol: defC0.symbol, amount: finalAmount0.toString() },
        token1: { address: isNativeC1 ? zeroAddress : getAddress(defC1.address), symbol: defC1.symbol, amount: finalAmount1.toString() },
        liquidityToRemove: liquidityToRemove.toString(),
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
      }
    });

  } catch (error: any) {
    console.error("[API prepare-decrease-tx] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
    return res.status(500).json({ message: errorMessage, error: process.env.NODE_ENV === 'development' ? error : undefined });
  }
}
