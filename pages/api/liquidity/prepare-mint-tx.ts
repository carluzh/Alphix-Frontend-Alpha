/**
 * prepare-mint-tx.ts — thin pass-through to Uniswap's LP API for non-UY V4 mints.
 *
 * No server-side computation. Validates input, snaps ticks to the pool's
 * tickSpacing (required by /lp/create), forwards the request to /lp/create
 * and /lp/check_approval, and returns the response verbatim.
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
import { validateChainId, checkTxRateLimit } from '@/lib/tx-validation';
import { resolveNetworkMode } from '@/lib/network-mode';
import { isUnifiedYieldPool } from '@/lib/liquidity/utils/pool-type-guards';
import {
  uniswapLPAPI,
  UniswapLPAPIError,
  UniswapLPAPIRateLimitError,
  normalizeV4BatchPermit,
  denormalizeV4BatchPermit,
} from '@/lib/liquidity/uniswap-api/client';
import { reportError, addReportBreadcrumb } from '@/lib/observability';

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

/** Approval transaction forwarded from /lp/check_approval (ERC-20 approve — value always 0). */
type ApprovalTx = { to: string; from?: string; data: string; chainId: number };

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

/** Strip `value` from /lp/check_approval ERC-20 approve txs — always 0, FE assumes 0. */
function toApprovalTx(tx: { to: string; from?: string; data: string; chainId: number }): ApprovalTx {
  return { to: tx.to, from: tx.from, data: tx.data, chainId: tx.chainId };
}

export default async function handler(
  req: PrepareMintTxRequest,
  res: NextApiResponse<PrepareMintTxResponse>,
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

    if ((permitSignature == null) !== (permitBatchData == null)) {
      return res.status(400).json({ message: 'permitSignature and permitBatchData must be provided together.' });
    }
    // H2 tightening: reject malformed signatures loudly rather than silently coercing
    // empty/short strings downstream (a 64-byte signature is 0x + 130 hex = 132 chars).
    if (permitSignature != null) {
      if (typeof permitSignature !== 'string' || permitSignature.length === 0) {
        return res.status(400).json({ message: 'permitSignature must be a non-empty string.' });
      }
      if (permitSignature.length < 132 || !permitSignature.startsWith('0x')) {
        return res.status(400).json({ message: 'permitSignature is malformed (expected 0x-prefixed hex, >= 132 chars).' });
      }
    }
    const hasSignedPermit = !!(permitSignature && permitSignature.length >= 132 && permitBatchData);

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
      const t0Addr = getAddress(token0Config.address);
      const t1Addr = getAddress(token1Config.address);
      const approvalCheck = await uniswapLPAPI.checkApproval({
        walletAddress: getAddress(userAddress),
        chainId,
        protocol: 'V4',
        lpTokens: [
          { tokenAddress: t0Addr, amount: createResponse.token0.amount },
          { tokenAddress: t1Addr, amount: createResponse.token1.amount },
        ],
        action: 'CREATE',
      });

      const findApprovalFor = (currency: string): ApprovalTx | undefined => {
        const match = approvalCheck.transactions.find(t =>
          getAddress(t.tokenAddress ?? t.transaction.to).toLowerCase() === currency.toLowerCase()
        );
        return match ? toApprovalTx({ ...match.transaction, chainId }) : undefined;
      };
      const approveToken0Tx = findApprovalFor(t0Addr);
      const approveToken1Tx = findApprovalFor(t1Addr);
      const erc20Fields = (approveToken0Tx || approveToken1Tx) ? { approveToken0Tx, approveToken1Tx } : null;

      if (approvalCheck.v4BatchPermitData) {
        const v4 = normalizeV4BatchPermit(approvalCheck.v4BatchPermitData, chainId);
        const primaryType = Object.keys(v4.types).find(k => k !== 'EIP712Domain') ?? 'PermitBatch';
        return res.status(200).json({
          needsApproval: true,
          approvalType: 'PERMIT2_BATCH_SIGNATURE',
          permitBatchData: v4,
          signatureDetails: { domain: v4.domain, types: v4.types, primaryType },
          ...(erc20Fields ?? {}),
          details,
        });
      }
      if (erc20Fields) {
        // Existing Permit2 state still valid; pass the pre-fetched create tx through
        // so the FE can pair it with the approve(s) (atomic on 5792, sequential otherwise).
        return res.status(200).json({
          needsApproval: true,
          approvalType: 'ERC20_TO_PERMIT2',
          create: {
            to: createResponse.create.to,
            from: createResponse.create.from,
            data: createResponse.create.data,
            value: createResponse.create.value,
            chainId,
          },
          ...erc20Fields,
          details,
        });
      }
      // Simulation failed but /lp/check_approval reported nothing missing — don't hand
      // the FE an unsimulated tx silently. Surface the upstream failure.
      return res.status(502).json({
        message: 'Uniswap LP API: simulation failed but no approvals or permit were required.',
      });
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
    if (error instanceof UniswapLPAPIRateLimitError) {
      console.warn('[prepare-mint-tx] Rate limit exhausted after retries');
      // Rate limits are expected — do NOT capture; leave a breadcrumb trail only.
      addReportBreadcrumb({ domain: 'liquidity', action: 'mint', level: 'warning', message: 'rate limited' });
      res.setHeader('Retry-After', '2');
      return res.status(429).json({ message: 'Busy — please retry in a moment.' });
    }
    if (error instanceof UniswapLPAPIError) {
      console.error('[prepare-mint-tx] Uniswap LP API error:', error.status, error.message);
      reportError(error, {
        domain: 'liquidity',
        action: 'mint',
        component: 'prepare-mint-tx',
        chainId: req.body?.chainId,
        networkMode,
        tags: { uniswapStatus: error.status, uniswapErrorCode: error.code },
        extras: {
          userAddress: req.body?.userAddress,
          poolId: req.body?.poolId,
          tickLower: req.body?.userTickLower,
          tickUpper: req.body?.userTickUpper,
          uniswapDetails: error.details,
        },
      });
      return res.status(error.status >= 500 ? 502 : 400).json({ message: `Uniswap LP API: ${error.message}` });
    }
    console.error('[API prepare-mint-tx] Error:', error);
    reportError(error, {
      domain: 'liquidity',
      action: 'mint',
      component: 'prepare-mint-tx',
      chainId: req.body?.chainId,
      networkMode,
      extras: { userAddress: req.body?.userAddress, poolId: req.body?.poolId },
    });
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    return res.status(500).json({ message: errorMessage, error: process.env.NODE_ENV === 'development' ? error : undefined });
  }
}
