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

import { getPositionManagerAddress } from "@/lib/pools-config";
import { resolveNetworkMode } from "@/lib/network-mode";
import { validateChainId, checkTxRateLimit } from "@/lib/tx-validation";
import { createNetworkClient } from "@/lib/viemClient";
import { buildPoolFromPosition } from "@/lib/liquidity/liquidity-utils";
import { safeParseUnits } from "@/lib/liquidity/utils/parsing/amountParsing";
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

    // Calculate liquidity to remove based on amounts
    let liquidityToRemove: JSBI;

    if (isFullBurn) {
      liquidityToRemove = currentPosition.liquidity;
    } else {
      // Calculate liquidity percentage from amounts
      const maxAmount0 = currentPosition.amount0;
      const maxAmount1 = currentPosition.amount1;

      let percentage = 0;
      if (!JSBI.equal(maxAmount0.quotient, JSBI.BigInt(0))) {
        const pct0 = Number(amountC0Raw) / Number(maxAmount0.quotient.toString()) * 100;
        percentage = Math.max(percentage, pct0);
      }
      if (!JSBI.equal(maxAmount1.quotient, JSBI.BigInt(0))) {
        const pct1 = Number(amountC1Raw) / Number(maxAmount1.quotient.toString()) * 100;
        percentage = Math.max(percentage, pct1);
      }

      // Cap at 100%
      percentage = Math.min(percentage, 100);

      // Calculate liquidity to remove
      const pctFraction = Math.round(percentage * 100); // basis points
      liquidityToRemove = JSBI.divide(
        JSBI.multiply(currentPosition.liquidity, JSBI.BigInt(pctFraction)),
        JSBI.BigInt(10000)
      );
    }

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
