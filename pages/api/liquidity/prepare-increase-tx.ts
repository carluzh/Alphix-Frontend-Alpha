/**
 * prepare-increase-tx.ts — thin pass-through to Uniswap's LP API for non-UY V4 increases.
 *
 * No server-side computation. Validates input, forwards to /lp/increase and
 * /lp/check_approval, and returns the response verbatim.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { isAddress, getAddress } from 'viem';

import { getAllPools } from '@/lib/pools-config';
import { resolveNetworkMode } from '@/lib/network-mode';
import { validateChainId, checkTxRateLimit } from '@/lib/tx-validation';
import { getPositionDetails } from '@/lib/liquidity/liquidity-utils';
import { safeParseUnits } from '@/lib/liquidity/utils/parsing/amountParsing';
import { findPoolByPoolKey, isUnifiedYieldPool } from '@/lib/liquidity/utils/pool-type-guards';
import { getTokenSymbolByAddress, getToken } from '@/lib/pools-config';
import {
  uniswapLPAPI,
  UniswapLPAPIError,
  UniswapLPAPIRateLimitError,
  normalizeV4BatchPermit,
  denormalizeV4BatchPermit,
} from '@/lib/liquidity/uniswap-api/client';

interface PrepareIncreaseTxRequest extends NextApiRequest {
  body: {
    userAddress: string;
    tokenId: string;
    amount0: string;
    amount1: string;
    chainId: number;
    /**
     * Which side the user is entering — the OTHER side is recomputed by Uniswap.
     * Required: a missing value caused MAX deposits to fail simulation with
     * TRANSFER_FROM_FAILED on the legacy "independent = token0 when amount0 > 0" heuristic.
     */
    inputSide?: 'token0' | 'token1';
    slippageBps?: number;
    deadlineMinutes?: number;
    permitSignature?: string;
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
  /** Pre-built increase tx so the FE can pair it with the approve(s). */
  create?: { to: string; from?: string; data: string; value: string; chainId: number; gasLimit?: string };
  /** Amounts Uniswap will actually transfer (mirrors /lp/increase response). */
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
  gasFee?: string;
  details: { token0: { amount: string }; token1: { amount: string } };
}

type PrepareIncreaseTxResponse =
  | ApprovalNeededResponse
  | PermitSignatureNeededResponse
  | TransactionPreparedResponse
  | { message: string; error?: any };

function toApprovalTx(tx: { to: string; from?: string; data: string; chainId: number }): ApprovalTx {
  return { to: tx.to, from: tx.from, data: tx.data, chainId: tx.chainId };
}

export default async function handler(
  req: PrepareIncreaseTxRequest,
  res: NextApiResponse<PrepareIncreaseTxResponse>,
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
      amount0: inputAmount0,
      amount1: inputAmount1,
      chainId,
      inputSide,
      slippageBps,
      deadlineMinutes = 30,
      permitSignature,
      permitBatchData,
    } = req.body;

    // --- 1. Validate request -------------------------------------------------
    const chainIdError = validateChainId(chainId, networkMode);
    if (chainIdError) return res.status(400).json({ message: chainIdError });
    if (!isAddress(userAddress)) return res.status(400).json({ message: 'Invalid userAddress.' });
    if (!tokenId) return res.status(400).json({ message: 'Missing tokenId.' });
    if (inputSide !== 'token0' && inputSide !== 'token1') {
      return res.status(400).json({ message: 'inputSide must be "token0" or "token1".' });
    }

    const nftTokenId = BigInt(tokenId);
    const positionDetails = await getPositionDetails(nftTokenId, chainId);
    const poolConfig = findPoolByPoolKey(getAllPools(networkMode), positionDetails.poolKey);
    if (!poolConfig) {
      return res.status(400).json({ message: 'Position is not in an Alphix pool.' });
    }
    if (isUnifiedYieldPool(poolConfig)) {
      return res.status(400).json({ message: 'Unified Yield positions use a separate deposit flow.' });
    }

    const sym0 = getTokenSymbolByAddress(positionDetails.poolKey.currency0, networkMode);
    const sym1 = getTokenSymbolByAddress(positionDetails.poolKey.currency1, networkMode);
    const defC0 = sym0 ? getToken(sym0, networkMode) : null;
    const defC1 = sym1 ? getToken(sym1, networkMode) : null;
    if (!defC0 || !defC1) {
      return res.status(400).json({ message: 'Token metadata missing for this position.' });
    }

    const amountC0Raw = safeParseUnits(inputAmount0 || '0', defC0.decimals);
    const amountC1Raw = safeParseUnits(inputAmount1 || '0', defC1.decimals);
    if (amountC0Raw === 0n && amountC1Raw === 0n) {
      return res.status(400).json({ message: 'Please enter a valid amount to add.' });
    }

    const independentIsToken0 = inputSide === 'token0';
    const independentAmount = independentIsToken0 ? amountC0Raw : amountC1Raw;
    if (independentAmount === 0n) {
      return res.status(400).json({ message: 'Please enter a valid amount to add.' });
    }

    if ((permitSignature == null) !== (permitBatchData == null)) {
      return res.status(400).json({ message: 'permitSignature and permitBatchData must be provided together.' });
    }
    const hasSignedPermit = !!(permitSignature && permitBatchData);

    const deadlineSeconds = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;
    const c0 = getAddress(positionDetails.poolKey.currency0);
    const c1 = getAddress(positionDetails.poolKey.currency1);

    // --- 2. Call /lp/increase -----------------------------------------------
    // Simulation acts as an approval probe: success proves both ERC-20 allowances
    // and the Permit2 batch permit cover the required amounts. On revert we retry
    // without simulation so we still have a tx shape for /lp/check_approval.
    const baseReq = {
      walletAddress: getAddress(userAddress),
      chainId,
      protocol: 'V4' as const,
      token0Address: positionDetails.poolKey.currency0,
      token1Address: positionDetails.poolKey.currency1,
      nftTokenId: nftTokenId.toString(),
      independentToken: {
        tokenAddress: independentIsToken0 ? positionDetails.poolKey.currency0 : positionDetails.poolKey.currency1,
        amount: independentAmount.toString(),
      },
      // Omit slippageTolerance unless the caller pins one — Uniswap then applies its own.
      ...(typeof slippageBps === 'number' ? { slippageTolerance: slippageBps / 100 } : {}),
      deadline: deadlineSeconds,
      ...(hasSignedPermit ? { v4BatchPermitData: denormalizeV4BatchPermit(permitBatchData!), signature: permitSignature } : {}),
    };

    let createResponse;
    let needsApprovalDiscovery = false;
    try {
      createResponse = await uniswapLPAPI.increase({ ...baseReq, simulateTransaction: !hasSignedPermit });
    } catch (e) {
      if (e instanceof UniswapLPAPIError && e.status === 404 && /FAILED_TO_ESTIMATE_GAS|TRANSFER_FROM_FAILED/i.test(e.message)) {
        createResponse = await uniswapLPAPI.increase({ ...baseReq, simulateTransaction: false });
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
      const approvalCheck = await uniswapLPAPI.checkApproval({
        walletAddress: getAddress(userAddress),
        chainId,
        protocol: 'V4',
        lpTokens: [
          { tokenAddress: c0, amount: createResponse.token0.amount },
          { tokenAddress: c1, amount: createResponse.token1.amount },
        ].filter(t => BigInt(t.amount) > 0n),
        action: 'INCREASE',
      });

      const findApprovalFor = (currency: string): ApprovalTx | undefined => {
        const match = approvalCheck.transactions.find(t =>
          getAddress(t.tokenAddress ?? t.transaction.to).toLowerCase() === currency.toLowerCase()
        );
        return match ? toApprovalTx({ ...match.transaction, chainId }) : undefined;
      };
      const approveToken0Tx = findApprovalFor(c0);
      const approveToken1Tx = findApprovalFor(c1);
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
        // No fresh batch permit needed (existing Permit2 state still valid);
        // pass the pre-fetched increase tx through so the FE can pair it with
        // the approve(s) (atomic on 5792, sequential otherwise).
        return res.status(200).json({
          needsApproval: true,
          approvalType: 'ERC20_TO_PERMIT2',
          create: {
            to: createResponse.increase.to,
            from: createResponse.increase.from,
            data: createResponse.increase.data,
            value: createResponse.increase.value,
            chainId,
          },
          ...erc20Fields,
          details,
        });
      }
      // Simulation failed but check_approval reported nothing missing — surface upstream failure.
      return res.status(502).json({
        message: 'Uniswap LP API: simulation failed but no approvals or permit were required.',
      });
    }

    // --- 4. No approvals needed: return the tx ------------------------------
    return res.status(200).json({
      needsApproval: false,
      create: {
        to: createResponse.increase.to,
        from: createResponse.increase.from,
        data: createResponse.increase.data,
        value: createResponse.increase.value,
        chainId,
      },
      gasFee: createResponse.gasFee,
      details,
    });
  } catch (error: any) {
    if (error instanceof UniswapLPAPIRateLimitError) {
      console.warn('[prepare-increase-tx] Rate limit exhausted after retries');
      res.setHeader('Retry-After', '2');
      return res.status(429).json({ message: 'Busy — please retry in a moment.' });
    }
    if (error instanceof UniswapLPAPIError) {
      console.error('[prepare-increase-tx] Uniswap LP API error:', error.status, error.message);
      Sentry.captureException(error, {
        tags: { route: 'prepare-increase-tx', source: 'uniswap_lp_api', uniswap_status: String(error.status) },
        extra: { userAddress: req.body?.userAddress, tokenId: req.body?.tokenId, chainId: req.body?.chainId },
      });
      return res.status(error.status >= 500 ? 502 : 400).json({ message: `Uniswap LP API: ${error.message}` });
    }
    console.error('[API prepare-increase-tx] Error:', error);
    Sentry.captureException(error, {
      tags: { route: 'prepare-increase-tx', source: 'internal' },
      extra: { userAddress: req.body?.userAddress, tokenId: req.body?.tokenId, chainId: req.body?.chainId },
    });
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    return res.status(500).json({ message: errorMessage, error: process.env.NODE_ENV === 'development' ? error : undefined });
  }
}
