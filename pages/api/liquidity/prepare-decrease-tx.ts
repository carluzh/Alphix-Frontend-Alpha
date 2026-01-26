/**
 * prepare-decrease-tx.ts - API route for preparing decrease liquidity transactions
 *
 * Decrease operations don't require approvals or permits (user is withdrawing tokens),
 * so this always returns transaction data directly.
 *
 * @see pages/api/liquidity/prepare-mint-tx.ts
 * @see pages/api/liquidity/prepare-increase-tx.ts
 */

import { Token, Percent, Ether, CurrencyAmount } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position, V4PositionManager, V4PositionPlanner, toHex } from "@uniswap/v4-sdk";
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { V4_POSITION_MANAGER_ABI } from "@/lib/swap/swap-constants";
import { TokenSymbol, getToken, getPositionManagerAddress, getStateViewAddress, getNetworkModeFromRequest, getTokenSymbolByAddress } from "@/lib/pools-config";
import { validateChainId, checkTxRateLimit } from "@/lib/tx-validation";
import { createNetworkClient } from "@/lib/viemClient";
import { getPositionDetails, getPoolState } from "@/lib/liquidity/liquidity-utils";
import { safeParseUnits } from "@/lib/liquidity/utils/parsing/amountParsing";
import {
  isAddress,
  getAddress,
  parseAbi,
  encodeAbiParameters,
  keccak256,
  formatUnits,
  type Hex
} from "viem";

const ETHERS_ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";
const EMPTY_BYTES = "0x" as const;

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

  // Get network mode from cookies
  const networkMode = getNetworkModeFromRequest(req.headers.cookie);
  const publicClient = createNetworkClient(networkMode);
  const POSITION_MANAGER_ADDRESS = getPositionManagerAddress(networkMode);
  const STATE_VIEW_ADDRESS = getStateViewAddress(networkMode);
  const stateViewAbiViem = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);

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

    // Fetch on-chain position details
    const details = await getPositionDetails(nftTokenId, chainId);

    // Get token symbols from pool key addresses
    const symC0 = getTokenSymbolByAddress(getAddress(details.poolKey.currency0), networkMode);
    const symC1 = getTokenSymbolByAddress(getAddress(details.poolKey.currency1), networkMode);
    if (!symC0 || !symC1) {
      return res.status(400).json({ message: 'Token symbols not found for pool currencies' });
    }

    const defC0 = getToken(symC0, networkMode);
    const defC1 = getToken(symC1, networkMode);
    if (!defC0 || !defC1) {
      return res.status(400).json({ message: 'Token definitions not found' });
    }

    const isNativeC0 = getAddress(details.poolKey.currency0) === ETHERS_ADDRESS_ZERO;
    const isNativeC1 = getAddress(details.poolKey.currency1) === ETHERS_ADDRESS_ZERO;
    const currency0 = isNativeC0 ? Ether.onChain(chainId) : new Token(chainId, getAddress(defC0.address), defC0.decimals, defC0.symbol);
    const currency1 = isNativeC1 ? Ether.onChain(chainId) : new Token(chainId, getAddress(defC1.address), defC1.decimals, defC1.symbol);

    // Get pool state
    const keyTuple = [{
      currency0: getAddress(details.poolKey.currency0),
      currency1: getAddress(details.poolKey.currency1),
      fee: Number(details.poolKey.fee),
      tickSpacing: Number(details.poolKey.tickSpacing),
      hooks: getAddress(details.poolKey.hooks),
    }];
    const encoded = encodeAbiParameters([
      { type: 'tuple', components: [
        { name: 'currency0', type: 'address' },
        { name: 'currency1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickSpacing', type: 'int24' },
        { name: 'hooks', type: 'address' },
      ]}
    ], keyTuple as any);
    const poolId = keccak256(encoded) as Hex;
    const state = await getPoolState(poolId, chainId);

    // Build pool
    const pool = new V4Pool(
      currency0 as any,
      currency1,
      details.poolKey.fee,
      details.poolKey.tickSpacing,
      details.poolKey.hooks,
      JSBI.BigInt(state.sqrtPriceX96.toString()),
      JSBI.BigInt(state.liquidity.toString()),
      state.tick,
    );

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
      EMPTY_BYTES, // hookData
    );

    // Add take actions for each currency (using Currency objects, not addresses)
    // For decrease: we take tokens from the pool
    planner.addTakePair(
      currency0,
      currency1,
      getAddress(userAddress),
    );

    // If burning, add burn action
    if (shouldBurnNFT) {
      planner.addBurn(
        tokenIdHex,
        JSBI.BigInt(slippageAmounts.amount0.toString()),
        JSBI.BigInt(slippageAmounts.amount1.toString()),
        EMPTY_BYTES, // hookData
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
        token0: { address: isNativeC0 ? ETHERS_ADDRESS_ZERO : getAddress(defC0.address), symbol: defC0.symbol, amount: finalAmount0.toString() },
        token1: { address: isNativeC1 ? ETHERS_ADDRESS_ZERO : getAddress(defC1.address), symbol: defC1.symbol, amount: finalAmount1.toString() },
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
