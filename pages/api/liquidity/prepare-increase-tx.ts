/**
 * prepare-increase-tx.ts - API route for preparing increase liquidity transactions
 *
 * Following the Uniswap pattern from prepare-mint-tx.ts:
 * 1. Checks ERC20 allowances (returns needsApproval + ERC20_TO_PERMIT2)
 * 2. Checks Permit2 allowances (returns needsApproval + PERMIT2_BATCH_SIGNATURE)
 * 3. Builds transaction calldata using V4PositionManager.addCallParameters
 *
 * @see pages/api/liquidity/prepare-mint-tx.ts
 */

import { CurrencyAmount, Percent, Ether } from '@uniswap/sdk-core';
import { Position as V4Position, V4PositionManager } from "@uniswap/v4-sdk";
import type { AddLiquidityOptions } from "@uniswap/v4-sdk";
import JSBI from 'jsbi';
import type { NextApiRequest, NextApiResponse } from 'next';

import { getPositionManagerAddress } from "@/lib/pools-config";
import { resolveNetworkMode } from "@/lib/network-mode";
import { validateChainId, checkTxRateLimit } from "@/lib/tx-validation";
import { createNetworkClient } from "@/lib/viemClient";
import { buildPoolFromPosition } from "@/lib/liquidity/liquidity-utils";
import { safeParseUnits } from "@/lib/liquidity/utils/parsing/amountParsing";
import {
  checkERC20Allowances,
  buildPermitBatchData,
  buildPermitBatchForSDK,
  type TokenForPermitCheck,
} from "@/lib/liquidity/transaction/permit2-checks";
import {
  isAddress,
  getAddress,
  maxUint256,
  zeroAddress,
  type Hex
} from "viem";

import { PERMIT2_ADDRESS } from '@uniswap/permit2-sdk';

interface PrepareIncreaseTxRequest extends NextApiRequest {
  body: {
    userAddress: string;
    tokenId: string; // NFT token ID (numeric string)
    amount0: string; // Amount of token0 to add
    amount1: string; // Amount of token1 to add
    chainId: number;
    // User settings (optional - defaults provided)
    slippageBps?: number; // Slippage in basis points (e.g., 50 = 0.5%). Default: 50
    deadlineMinutes?: number; // Transaction deadline in minutes. Default: 20
    permitSignature?: string;
    permitBatchData?: {
      domain?: {
        name: string;
        chainId: number;
        verifyingContract: string;
      };
      types?: any;
      values?: {
        details: Array<{
          token: string;
          amount: string;
          expiration: string;
          nonce: string;
        }>;
        spender: string;
        sigDeadline: string;
      };
      details?: Array<{
        token: string;
        amount: string;
        expiration: string;
        nonce: string;
      }>;
      spender?: string;
      sigDeadline?: string;
    };
  };
}

// Approval needed response
interface ApprovalNeededResponse {
  needsApproval: true;
  approvalType: 'ERC20_TO_PERMIT2' | 'PERMIT2_BATCH_SIGNATURE';
  approvalTokenAddress?: string;
  approvalTokenSymbol?: string;
  approveToAddress?: string;
  approvalAmount?: string;
  // Per-token approval flags
  needsToken0Approval?: boolean;
  needsToken1Approval?: boolean;
  // Permit data is included for BOTH types - ERC20_TO_PERMIT2 includes it for after approval
  permitBatchData?: any;
  signatureDetails?: {
    domain: {
      name: string;
      chainId: number;
      verifyingContract: Hex;
      version?: string;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: 'PermitBatch';
  };
}

// Transaction ready response (matches prepare-mint-tx.ts format)
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
  details: {
    token0: { address: string; symbol: string; amount: string };
    token1: { address: string; symbol: string; amount: string };
    liquidity: string;
    tickLower: number;
    tickUpper: number;
  };
}

type PrepareIncreaseTxResponse = ApprovalNeededResponse | TransactionPreparedResponse | { message: string; error?: any };

export default async function handler(
  req: PrepareIncreaseTxRequest,
  res: NextApiResponse<PrepareIncreaseTxResponse>
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
      amount0: inputAmount0,
      amount1: inputAmount1,
      chainId,
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
    const {
      details, defC0, defC1, currency0, currency1,
      isNativeC0, isNativeC1, pool, poolState: state,
    } = await buildPoolFromPosition(nftTokenId, chainId, networkMode);

    // Parse amounts (amounts are already in pool key order from UI)
    let amountC0Raw = safeParseUnits(inputAmount0 || "0", defC0.decimals);
    let amountC1Raw = safeParseUnits(inputAmount1 || "0", defC1.decimals);

    // Handle out-of-range positions
    const outOfRangeBelow = state.tick < details.tickLower;
    const outOfRangeAbove = state.tick > details.tickUpper;
    if (outOfRangeBelow) {
      amountC1Raw = 0n;
    } else if (outOfRangeAbove) {
      amountC0Raw = 0n;
    }

    if (amountC0Raw === 0n && amountC1Raw === 0n) {
      return res.status(400).json({ message: 'Please enter a valid amount to add.' });
    }

    // Build position using SDK
    let position: V4Position;
    const userProvidedAmount0 = amountC0Raw > 0n;
    const userProvidedAmount1 = amountC1Raw > 0n;

    if (userProvidedAmount0 && !userProvidedAmount1) {
      const amt0 = CurrencyAmount.fromRawAmount(currency0, amountC0Raw.toString());
      position = V4Position.fromAmount0({
        pool,
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
        amount0: amt0.quotient,
        useFullPrecision: true,
      });
    } else if (userProvidedAmount1 && !userProvidedAmount0) {
      const amt1 = CurrencyAmount.fromRawAmount(currency1, amountC1Raw.toString());
      position = V4Position.fromAmount1({
        pool,
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
        amount1: amt1.quotient,
      });
    } else {
      const amt0 = CurrencyAmount.fromRawAmount(currency0, amountC0Raw.toString());
      const amt1 = CurrencyAmount.fromRawAmount(currency1, amountC1Raw.toString());
      position = V4Position.fromAmounts({
        pool,
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
        amount0: amt0.quotient,
        amount1: amt1.quotient,
        useFullPrecision: true,
      });
    }

    // Check for zero liquidity
    if (JSBI.equal(position.liquidity, JSBI.BigInt(0))) {
      return res.status(400).json({ message: 'Amount too small, please try a larger amount.' });
    }

    // Get actual amounts from position
    const SLIPPAGE_TOLERANCE = new Percent(slippageBps, 10_000);
    const slippageAmounts = position.mintAmountsWithSlippage(SLIPPAGE_TOLERANCE);
    const amount0ForPermit = BigInt(slippageAmounts.amount0.toString());
    const amount1ForPermit = BigInt(slippageAmounts.amount1.toString());

    // Extract permit data
    const { permitSignature: batchPermitSignature, permitBatchData } = req.body;
    const hasBatchPermit = batchPermitSignature && permitBatchData;

    // Build tokens for permit checking
    const token0Address = getAddress(details.poolKey.currency0);
    const tokensForCheck: [TokenForPermitCheck, TokenForPermitCheck] = [
      { address: isNativeC0 ? zeroAddress : getAddress(defC0.address), requiredAmount: amountC0Raw, permitAmount: amount0ForPermit, symbol: defC0.symbol, isNative: isNativeC0 },
      { address: isNativeC1 ? zeroAddress : getAddress(defC1.address), requiredAmount: amountC1Raw, permitAmount: amount1ForPermit, symbol: defC1.symbol, isNative: isNativeC1 },
    ];

    const { erc20ApprovalNeeded, needsToken0Approval, needsToken1Approval } =
      await checkERC20Allowances(publicClient, userAddress, tokensForCheck, token0Address);

    if (!hasBatchPermit) {
      const permitResult = await buildPermitBatchData(
        publicClient, userAddress, tokensForCheck, token0Address,
        POSITION_MANAGER_ADDRESS, chainId, needsToken0Approval, needsToken1Approval,
      );

      if (erc20ApprovalNeeded) {
        return res.status(200).json({
          needsApproval: true,
          approvalType: 'ERC20_TO_PERMIT2' as const,
          approvalTokenAddress: erc20ApprovalNeeded.address,
          approvalTokenSymbol: erc20ApprovalNeeded.symbol,
          approveToAddress: PERMIT2_ADDRESS,
          approvalAmount: maxUint256.toString(),
          needsToken0Approval,
          needsToken1Approval,
          permitBatchData: permitResult?.permitBatchData,
          signatureDetails: permitResult?.signatureDetails,
        });
      }

      if (permitResult) {
        return res.status(200).json({
          needsApproval: true,
          approvalType: 'PERMIT2_BATCH_SIGNATURE' as const,
          permitBatchData: permitResult.permitBatchData,
          signatureDetails: permitResult.signatureDetails,
        });
      }
    }

    // Build transaction
    const latestBlockForTx = await publicClient.getBlock({ blockTag: 'latest' });
    if (!latestBlockForTx) throw new Error("Failed to get latest block for deadline.");
    const deadlineSeconds = BigInt(deadlineMinutes) * 60n;
    const deadlineBigInt = latestBlockForTx.timestamp + deadlineSeconds;

    const permitBatchValues = hasBatchPermit ? (permitBatchData.values || {
      details: permitBatchData.details || [],
      spender: permitBatchData.spender || POSITION_MANAGER_ADDRESS,
      sigDeadline: permitBatchData.sigDeadline || '0'
    }) : null;

    const hasNativeETH = isNativeC0 || isNativeC1;
    let addOptions: AddLiquidityOptions = {
      slippageTolerance: SLIPPAGE_TOLERANCE,
      deadline: deadlineBigInt.toString(),
      tokenId: nftTokenId.toString(),
      hookData: '0x',
      useNative: hasNativeETH ? Ether.onChain(chainId) : undefined,
    };

    if (permitBatchValues) {
      const permitBatchForSDK = buildPermitBatchForSDK(permitBatchValues);

      addOptions = {
        ...addOptions,
        batchPermit: {
          owner: getAddress(userAddress),
          permitBatch: permitBatchForSDK,
          signature: batchPermitSignature as string,
        }
      };
    }

    const methodParameters = V4PositionManager.addCallParameters(position, addOptions);
    const calldata = methodParameters.calldata;
    const value = methodParameters.value ?? "0";

    // Estimate gas
    let gasLimit: string | undefined;
    try {
      const estimatedGas = await publicClient.estimateGas({
        account: getAddress(userAddress),
        to: POSITION_MANAGER_ADDRESS as `0x${string}`,
        data: calldata as `0x${string}`,
        value: value ? BigInt(value) : undefined,
      });
      gasLimit = ((estimatedGas * 120n) / 100n).toString();
    } catch (e) {
      console.warn('[prepare-increase-tx] Gas estimation failed:', e);
    }

    // Final amounts
    let finalAmount0 = BigInt(position.mintAmounts.amount0.toString());
    let finalAmount1 = BigInt(position.mintAmounts.amount1.toString());
    const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    if (finalAmount0 >= MAX_UINT256 / 2n) finalAmount0 = 0n;
    if (finalAmount1 >= MAX_UINT256 / 2n) finalAmount1 = 0n;

    return res.status(200).json({
      needsApproval: false,
      create: {
        to: POSITION_MANAGER_ADDRESS,
        from: getAddress(userAddress),
        data: calldata,
        value,
        chainId,
        gasLimit,
      },
      transaction: {
        to: POSITION_MANAGER_ADDRESS,
        data: calldata,
        value,
        gasLimit,
      },
      sqrtRatioX96: state.sqrtPriceX96.toString(),
      currentTick: state.tick,
      poolLiquidity: state.liquidity.toString(),
      deadline: deadlineBigInt.toString(),
      details: {
        token0: { address: isNativeC0 ? zeroAddress : getAddress(defC0.address), symbol: defC0.symbol, amount: finalAmount0.toString() },
        token1: { address: isNativeC1 ? zeroAddress : getAddress(defC1.address), symbol: defC1.symbol, amount: finalAmount1.toString() },
        liquidity: position.liquidity.toString(),
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
      }
    });

  } catch (error: any) {
    console.error("[API prepare-increase-tx] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
    return res.status(500).json({ message: errorMessage, error: process.env.NODE_ENV === 'development' ? error : undefined });
  }
}
