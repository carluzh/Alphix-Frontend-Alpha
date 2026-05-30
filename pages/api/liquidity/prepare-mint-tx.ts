/**
 * prepare-mint-tx.ts — thin pass-through to Uniswap's LP API for non-UY V4 mints.
 *
 * No server-side computation. Validates input, snaps ticks to the pool's
 * tickSpacing (required by /lp/create), forwards the request to /lp/create
 * and /lp/check_approval, and returns the response verbatim.
 *
 * Shared boilerplate (rate-limit, permit validation, approval discovery, error
 * handling) lives in @/lib/liquidity/api/prepare-tx-shared.
 */

import { nearestUsableTick, TickMath } from '@uniswap/v3-sdk';
import type { NextApiRequest, NextApiResponse } from 'next';
import { isAddress, getAddress, parseUnits } from 'viem';

import {
  type TokenSymbol,
  getToken,
  getPoolBySlugMultiChain,
  getPoolByTokens,
} from '@/lib/pools-config';
import { validateChainId } from '@/lib/tx-validation';
import { resolveNetworkMode } from '@/lib/network-mode';
import { isUnifiedYieldPool } from '@/lib/liquidity/utils/pool-type-guards';
import {
  uniswapLPAPI,
  UniswapLPAPIError,
  denormalizeV4BatchPermit,
} from '@/lib/liquidity/uniswap-api/client';
import { addReportBreadcrumb } from '@/lib/observability';
import {
  enforcePostAndRateLimit,
  validatePermitInput,
  resolveApprovalDiscovery,
  handlePrepareTxError,
  type ApprovalTx,
} from '@/lib/liquidity/api/prepare-tx-shared';

interface PrepareMintTxRequest extends NextApiRequest {
  body: {
    userAddress: string;
    poolId?: string;
    token0Symbol: TokenSymbol;
    token1Symbol: TokenSymbol;
    inputAmount: string;
    inputTokenSymbol: TokenSymbol;
    userTickLower: number;
    userTickUpper: number;
    chainId: number;
    slippageBps?: number;
    deadlineMinutes?: number;
    /** EIP-712 signature over the v4BatchPermitData typed data. */
    permitSignature?: string;
    /** Normalized batch permit data echoed from this route's first response. */
    permitBatchData?: import('@/lib/liquidity/uniswap-api/client').V4BatchPermit;
  };
}

interface ApprovalNeededResponse {
  needsApproval: true;
  approvalType: 'ERC20_TO_PERMIT2';
  approveToken0Tx?: ApprovalTx;
  approveToken1Tx?: ApprovalTx;
  /** Pre-built create tx so the FE can pair it with the approve(s). */
  create?: { to: string; from?: string; data: string; value: string; chainId: number; gasLimit?: string };
  /** Amounts Uniswap will actually transfer (mirrors /lp/create response). */
  details: { token0: { amount: string }; token1: { amount: string } };
}

interface PermitSignatureNeededResponse {
  needsApproval: true;
  approvalType: 'PERMIT2_BATCH_SIGNATURE';
  permitBatchData: import('@/lib/liquidity/uniswap-api/client').V4BatchPermit;
  signatureDetails: {
    domain: { name: string; chainId: number; verifyingContract: string };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
  };
  approveToken0Tx?: ApprovalTx;
  approveToken1Tx?: ApprovalTx;
  details: { token0: { amount: string }; token1: { amount: string } };
}

interface TransactionPreparedResponse {
  needsApproval: false;
  create: { to: string; from?: string; data: string; value: string; chainId: number; gasLimit?: string };
  /** Estimated gas cost in wei from /lp/create simulation. */
  gasFee?: string;
  details: { token0: { amount: string }; token1: { amount: string } };
}

type PrepareMintTxResponse =
  | ApprovalNeededResponse
  | PermitSignatureNeededResponse
  | TransactionPreparedResponse
  | { message: string; error?: any };

export default async function handler(
  req: PrepareMintTxRequest,
  res: NextApiResponse<PrepareMintTxResponse>,
) {
  if (enforcePostAndRateLimit(req, res)) return;

  const networkMode = resolveNetworkMode(req);

  try {
    const {
      userAddress,
      token0Symbol,
      token1Symbol,
      inputAmount,
      inputTokenSymbol,
      userTickLower,
      userTickUpper,
      chainId,
      slippageBps,
      deadlineMinutes = 30,
      permitSignature,
      permitBatchData,
    } = req.body;

    // --- 1. Validate request -------------------------------------------------
    const chainIdError = validateChainId(chainId, networkMode);
    if (chainIdError) return res.status(400).json({ message: chainIdError });
    if (!isAddress(userAddress)) return res.status(400).json({ message: 'Invalid userAddress.' });

    const token0Config = getToken(token0Symbol, networkMode);
    const token1Config = getToken(token1Symbol, networkMode);
    const inputTokenConfig = getToken(inputTokenSymbol, networkMode);
    if (!token0Config || !token1Config || !inputTokenConfig) {
      return res.status(400).json({ message: 'Invalid token symbol(s) provided.' });
    }
    if (isNaN(parseFloat(inputAmount)) || parseFloat(inputAmount) <= 0) {
      return res.status(400).json({ message: 'Invalid inputAmount.' });
    }
    if (typeof userTickLower !== 'number' || typeof userTickUpper !== 'number') {
      return res.status(400).json({ message: 'userTickLower and userTickUpper must be numbers.' });
    }
    if (inputTokenSymbol !== token0Symbol && inputTokenSymbol !== token1Symbol) {
      return res.status(400).json({ message: 'inputTokenSymbol must match token0Symbol or token1Symbol.' });
    }

    const requestPoolId = req.body.poolId;
    const poolConfig = requestPoolId
      ? getPoolBySlugMultiChain(requestPoolId)
      : getPoolByTokens(token0Symbol, token1Symbol, networkMode);
    if (!poolConfig) {
      return res.status(400).json({ message: `No pool configuration found for ${requestPoolId || `${token0Symbol}/${token1Symbol}`}` });
    }
    if (isUnifiedYieldPool(poolConfig)) {
      return res.status(400).json({ message: 'Unified Yield positions use a separate deposit flow.' });
    }

    // /lp/create rejects ticks not aligned to tickSpacing with a 500. Snap before sending.
    const clampedLower = Math.max(userTickLower, TickMath.MIN_TICK);
    const clampedUpper = Math.min(userTickUpper, TickMath.MAX_TICK);
    const tickLower = nearestUsableTick(clampedLower, poolConfig.tickSpacing);
    const tickUpper = nearestUsableTick(clampedUpper, poolConfig.tickSpacing);
    if (tickLower >= tickUpper) {
      return res.status(400).json({ message: 'tickLower must be less than tickUpper.' });
    }

    const permitCheck = validatePermitInput(permitSignature, permitBatchData);
    if (!permitCheck.ok) return res.status(400).json({ message: permitCheck.message });
    const hasSignedPermit = permitCheck.hasSignedPermit;

    const inputTokenAddress = inputTokenSymbol === token0Symbol
      ? getAddress(token0Config.address)
      : getAddress(token1Config.address);
    const deadlineSeconds = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;
    const parsedInputAmount = parseUnits(inputAmount, inputTokenConfig.decimals);

    // --- 2. Call /lp/create --------------------------------------------------
    // Without a signed permit we simulate (success proves both ERC-20 allowances AND
    // the Permit2 batch permit are in place — lets us skip /lp/check_approval).
    // With a permit we skip simulation (Uniswap's simulator 502s on hooked pools with
    // real permits) and trust the wallet for gas estimation.
    // On simulation revert (FAILED_TO_ESTIMATE_GAS / TRANSFER_FROM_FAILED) we retry
    // without simulation so we still have a tx shape to hand off to /lp/check_approval.
    const baseReq = {
      walletAddress: getAddress(userAddress),
      chainId,
      protocol: 'V4' as const,
      existingPool: {
        token0Address: getAddress(token0Config.address),
        token1Address: getAddress(token1Config.address),
        poolReference: poolConfig.poolId,
      },
      independentToken: { tokenAddress: inputTokenAddress, amount: parsedInputAmount.toString() },
      tickBounds: { tickLower, tickUpper },
      // Omit slippageTolerance unless the caller pins one — Uniswap then applies its own.
      ...(typeof slippageBps === 'number' ? { slippageTolerance: slippageBps / 100 } : {}),
      deadline: deadlineSeconds,
      ...(hasSignedPermit ? { batchPermitData: denormalizeV4BatchPermit(permitBatchData!), signature: permitSignature } : {}),
    };

    let createResponse;
    let needsApprovalDiscovery = false;
    try {
      createResponse = await uniswapLPAPI.create({ ...baseReq, simulateTransaction: !hasSignedPermit });
    } catch (e) {
      if (e instanceof UniswapLPAPIError && e.status === 404 && /FAILED_TO_ESTIMATE_GAS|TRANSFER_FROM_FAILED/i.test(e.message)) {
        addReportBreadcrumb({
          domain: 'liquidity',
          action: 'create',
          message: 'retry without simulation',
          data: { attempt: 2 },
        });
        createResponse = await uniswapLPAPI.create({ ...baseReq, simulateTransaction: false });
        needsApprovalDiscovery = true;
      } else {
        throw e;
      }
    }

    const details = {
      token0: { amount: createResponse.token0.amount },
      token1: { amount: createResponse.token1.amount },
    };

    // --- 3. Branch on approval state ----------------------------------------
    if (!hasSignedPermit && needsApprovalDiscovery) {
      const { status, body } = await resolveApprovalDiscovery({
        action: 'CREATE',
        walletAddress: getAddress(userAddress),
        chainId,
        token0Addr: getAddress(token0Config.address),
        token1Addr: getAddress(token1Config.address),
        token0Amount: createResponse.token0.amount,
        token1Amount: createResponse.token1.amount,
        filterZeroAmounts: false,
        passThroughTx: createResponse.create,
        details,
      });
      return res.status(status).json(body);
    }

    // --- 4. No approvals needed: return the tx ------------------------------
    return res.status(200).json({
      needsApproval: false,
      create: {
        to: createResponse.create.to,
        from: createResponse.create.from,
        data: createResponse.create.data,
        value: createResponse.create.value,
        chainId,
      },
      gasFee: createResponse.gasFee,
      details,
    });
  } catch (error: any) {
    handlePrepareTxError(error, req, res, {
      action: 'mint',
      component: 'prepare-mint-tx',
      networkMode,
      chainId: req.body?.chainId,
      extras: { userAddress: req.body?.userAddress, poolId: req.body?.poolId },
      uniswapExtras: { tickLower: req.body?.userTickLower, tickUpper: req.body?.userTickUpper },
    });
  }
}
