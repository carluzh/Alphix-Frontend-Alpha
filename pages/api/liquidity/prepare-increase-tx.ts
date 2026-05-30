/**
 * prepare-increase-tx.ts — thin pass-through to Uniswap's LP API for non-UY V4 increases.
 *
 * No server-side computation. Validates input, forwards to /lp/increase and
 * /lp/check_approval, and returns the response verbatim.
 *
 * Shared boilerplate (rate-limit, position-pool resolution, permit validation,
 * approval discovery, error handling) lives in @/lib/liquidity/api/prepare-tx-shared.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAddress, getAddress } from 'viem';

import { resolveNetworkMode } from '@/lib/network-mode';
import { validateChainId } from '@/lib/tx-validation';
import { safeParseUnits } from '@/lib/liquidity/utils/parsing/amountParsing';
import { getTokenSymbolByAddress, getToken } from '@/lib/pools-config';
import {
  uniswapLPAPI,
  UniswapLPAPIError,
  denormalizeV4BatchPermit,
} from '@/lib/liquidity/uniswap-api/client';
import { addReportBreadcrumb } from '@/lib/observability';
import {
  enforcePostAndRateLimit,
  validatePermitInput,
  resolveAlphixPositionPool,
  resolveApprovalDiscovery,
  handlePrepareTxError,
  type ApprovalTx,
} from '@/lib/liquidity/api/prepare-tx-shared';

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

export default async function handler(
  req: PrepareIncreaseTxRequest,
  res: NextApiResponse<PrepareIncreaseTxResponse>,
) {
  if (enforcePostAndRateLimit(req, res)) return;

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

    const resolved = await resolveAlphixPositionPool({
      tokenId,
      chainId,
      networkMode,
      uyMessage: 'Unified Yield positions use a separate deposit flow.',
    });
    if (!resolved.ok) return res.status(400).json({ message: resolved.message });
    const { nftTokenId, positionDetails } = resolved;

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

    const permitCheck = validatePermitInput(permitSignature, permitBatchData);
    if (!permitCheck.ok) return res.status(400).json({ message: permitCheck.message });
    const hasSignedPermit = permitCheck.hasSignedPermit;

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
        addReportBreadcrumb({
          domain: 'liquidity',
          action: 'create',
          message: 'retry without simulation',
          data: { attempt: 2 },
        });
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
      const { status, body } = await resolveApprovalDiscovery({
        action: 'INCREASE',
        walletAddress: getAddress(userAddress),
        chainId,
        token0Addr: c0,
        token1Addr: c1,
        token0Amount: createResponse.token0.amount,
        token1Amount: createResponse.token1.amount,
        filterZeroAmounts: true,
        passThroughTx: createResponse.increase,
        details,
      });
      return res.status(status).json(body);
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
    handlePrepareTxError(error, req, res, {
      action: 'increase',
      component: 'prepare-increase-tx',
      networkMode,
      chainId: req.body?.chainId,
      extras: { userAddress: req.body?.userAddress, tokenId: req.body?.tokenId },
    });
  }
}
