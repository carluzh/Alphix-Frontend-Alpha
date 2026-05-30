/**
 * prepare-tx-shared.ts — boilerplate shared by the non-UY V4 prepare-tx routes
 * (prepare-mint-tx / prepare-increase-tx / prepare-decrease-tx).
 *
 * These routes are thin pass-throughs to Uniswap's LP API. They duplicated the
 * same method guard, IP rate-limit, permit validation, approval-discovery
 * branch, and 3-branch error/observability catch. This module is the single
 * source of truth for those pieces. Per-route logic (tick snapping, input-side
 * selection, decrease percentage, etc.) stays in the routes.
 *
 * prepare-collect-tx is intentionally NOT a consumer: its method guard,
 * response shape, and nested 404 indexing-delay handling are distinct.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getAddress } from 'viem';

import { type NetworkMode } from '@/lib/network-mode';
import { getAllPools } from '@/lib/pools-config';
import { checkTxRateLimit } from '@/lib/tx-validation';
import { getPositionDetails } from '@/lib/liquidity/liquidity-utils';
import { findPoolByPoolKey, isUnifiedYieldPool } from '@/lib/liquidity/utils/pool-type-guards';
import {
  uniswapLPAPI,
  normalizeV4BatchPermit,
  UniswapLPAPIError,
  UniswapLPAPIRateLimitError,
  type V4BatchPermit,
} from '@/lib/liquidity/uniswap-api/client';
import { reportError, addReportBreadcrumb } from '@/lib/observability';

/** Approval transaction forwarded from /lp/check_approval (ERC-20 approve — value always 0). */
export type ApprovalTx = { to: string; from?: string; data: string; chainId: number };

/** Strip `value` from /lp/check_approval ERC-20 approve txs — always 0, FE assumes 0. */
export function toApprovalTx(tx: { to: string; from?: string; data: string; chainId: number }): ApprovalTx {
  return { to: tx.to, from: tx.from, data: tx.data, chainId: tx.chainId };
}

/**
 * POST-guard + per-IP rate-limit shared by mint/increase/decrease.
 * Sends the 405/429 response itself; returns true when it has already responded
 * (the caller should return immediately).
 */
export function enforcePostAndRateLimit(req: NextApiRequest, res: NextApiResponse): boolean {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    return true;
  }

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const rateCheck = checkTxRateLimit(clientIp);
  if (!rateCheck.allowed) {
    res.setHeader('Retry-After', String(rateCheck.retryAfter || 60));
    res.status(429).json({ message: 'Too many requests. Please try again later.' });
    return true;
  }

  return false;
}

/**
 * Permit pairing + signature validation (H2 tightening) shared by mint/increase.
 * Rejects malformed signatures loudly rather than silently coercing empty/short
 * strings downstream (a 64-byte signature is 0x + 130 hex = 132 chars).
 */
export function validatePermitInput(
  permitSignature: string | undefined,
  permitBatchData: V4BatchPermit | undefined,
): { ok: true; hasSignedPermit: boolean } | { ok: false; message: string } {
  if ((permitSignature == null) !== (permitBatchData == null)) {
    return { ok: false, message: 'permitSignature and permitBatchData must be provided together.' };
  }
  if (permitSignature != null) {
    if (typeof permitSignature !== 'string' || permitSignature.length === 0) {
      return { ok: false, message: 'permitSignature must be a non-empty string.' };
    }
    if (permitSignature.length < 132 || !permitSignature.startsWith('0x')) {
      return { ok: false, message: 'permitSignature is malformed (expected 0x-prefixed hex, >= 132 chars).' };
    }
  }
  const hasSignedPermit = !!(permitSignature && permitSignature.length >= 132 && permitBatchData);
  return { ok: true, hasSignedPermit };
}

type ResolvedPositionPool = Awaited<ReturnType<typeof getPositionDetails>>;

/**
 * Resolve + validate the Alphix pool backing an existing position (increase/decrease).
 * Leaves a breadcrumb before the on-chain lookup; lets getPositionDetails throw so the
 * route's catch reports it. Returns a 400-message result for non-Alphix / UY positions.
 */
export async function resolveAlphixPositionPool(opts: {
  tokenId: string;
  chainId: number;
  networkMode: NetworkMode;
  /** UY rejection copy — "separate deposit flow" (increase) vs "separate withdraw flow" (decrease). */
  uyMessage: string;
}): Promise<
  | { ok: true; nftTokenId: bigint; positionDetails: ResolvedPositionPool }
  | { ok: false; message: string }
> {
  const { tokenId, chainId, networkMode, uyMessage } = opts;
  const nftTokenId = BigInt(tokenId);

  // Breadcrumb before the on-chain position lookup; if it throws it bubbles to the
  // outer catch where reportError captures it.
  addReportBreadcrumb({ domain: 'liquidity', action: 'fetchPositionDetails', data: { tokenId, chainId } });
  const positionDetails = await getPositionDetails(nftTokenId, chainId);
  const poolConfig = findPoolByPoolKey(getAllPools(networkMode), positionDetails.poolKey);
  if (!poolConfig) {
    return { ok: false, message: 'Position is not in an Alphix pool.' };
  }
  if (isUnifiedYieldPool(poolConfig)) {
    return { ok: false, message: uyMessage };
  }
  return { ok: true, nftTokenId, positionDetails };
}

/** Amounts mirrored back from /lp/create or /lp/increase. */
export type ApprovalDiscoveryDetails = { token0: { amount: string }; token1: { amount: string } };

/** Permit-signature-required body (200): user must sign a fresh Permit2 batch permit. */
export type Permit2BatchSignatureBody = {
  needsApproval: true;
  approvalType: 'PERMIT2_BATCH_SIGNATURE';
  permitBatchData: V4BatchPermit;
  signatureDetails: {
    domain: { name: string; chainId: number; verifyingContract: string };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
  };
  approveToken0Tx?: ApprovalTx;
  approveToken1Tx?: ApprovalTx;
  details: ApprovalDiscoveryDetails;
};

/** ERC-20-approval-required body (200): Permit2 state still valid, only ERC-20 approves remain. */
export type Erc20ToPermit2Body = {
  needsApproval: true;
  approvalType: 'ERC20_TO_PERMIT2';
  approveToken0Tx?: ApprovalTx;
  approveToken1Tx?: ApprovalTx;
  create: { to: string; from?: string; data: string; value: string; chainId: number };
  details: ApprovalDiscoveryDetails;
};

/** 502 body: simulation failed but /lp/check_approval reported nothing missing. */
export type ApprovalDiscoveryUpstreamFailureBody = { message: string };

/**
 * Discriminated response from {@link resolveApprovalDiscovery}: callers can `return
 * res.status(status).json(body)` without an `as` cast — the route's response union
 * already accepts both 200 bodies (PERMIT2_BATCH_SIGNATURE / ERC20_TO_PERMIT2) and
 * the 502 error body shape.
 */
export type ApprovalDiscoveryResponse =
  | { status: 200; body: Permit2BatchSignatureBody | Erc20ToPermit2Body }
  | { status: 502; body: ApprovalDiscoveryUpstreamFailureBody };

/**
 * The /lp/check_approval discovery branch shared by mint and increase.
 *
 * Runs only after a simulation revert proved approvals are missing. Calls
 * /lp/check_approval and returns the response the FE expects:
 *  - PERMIT2_BATCH_SIGNATURE when a fresh batch permit must be signed,
 *  - ERC20_TO_PERMIT2 (with the pre-fetched tx) when only ERC-20 approves remain,
 *  - 502 when simulation failed but nothing was reported missing.
 *
 * All calldata is relayed verbatim from uniswapLPAPI — no calldata is synthesized here.
 */
export async function resolveApprovalDiscovery(opts: {
  action: 'CREATE' | 'INCREASE';
  walletAddress: `0x${string}`;
  chainId: number;
  token0Addr: `0x${string}`;
  token1Addr: `0x${string}`;
  token0Amount: string;
  token1Amount: string;
  /** increase filters out zero-amount sides; mint sends both unconditionally. */
  filterZeroAmounts: boolean;
  /** Pre-fetched create/increase tx, paired with the approve(s) for the FE. */
  passThroughTx: { to: string; from?: string; data: string; value: string };
  details: ApprovalDiscoveryDetails;
}): Promise<ApprovalDiscoveryResponse> {
  const {
    action,
    walletAddress,
    chainId,
    token0Addr,
    token1Addr,
    token0Amount,
    token1Amount,
    filterZeroAmounts,
    passThroughTx,
    details,
  } = opts;

  const lpTokens = [
    { tokenAddress: token0Addr, amount: token0Amount },
    { tokenAddress: token1Addr, amount: token1Amount },
  ];

  const approvalCheck = await uniswapLPAPI.checkApproval({
    walletAddress,
    chainId,
    protocol: 'V4',
    lpTokens: filterZeroAmounts ? lpTokens.filter(t => BigInt(t.amount) > 0n) : lpTokens,
    action,
  });

  const findApprovalFor = (currency: string): ApprovalTx | undefined => {
    const match = approvalCheck.transactions.find(t =>
      getAddress(t.tokenAddress ?? t.transaction.to).toLowerCase() === currency.toLowerCase()
    );
    return match ? toApprovalTx({ ...match.transaction, chainId }) : undefined;
  };
  const approveToken0Tx = findApprovalFor(token0Addr);
  const approveToken1Tx = findApprovalFor(token1Addr);
  const erc20Fields = (approveToken0Tx || approveToken1Tx) ? { approveToken0Tx, approveToken1Tx } : null;

  if (approvalCheck.v4BatchPermitData) {
    const v4 = normalizeV4BatchPermit(approvalCheck.v4BatchPermitData, chainId);
    const primaryType = Object.keys(v4.types).find(k => k !== 'EIP712Domain') ?? 'PermitBatch';
    return {
      status: 200,
      body: {
        needsApproval: true,
        approvalType: 'PERMIT2_BATCH_SIGNATURE',
        permitBatchData: v4,
        signatureDetails: { domain: v4.domain, types: v4.types, primaryType },
        ...(erc20Fields ?? {}),
        details,
      },
    };
  }
  if (erc20Fields) {
    // Existing Permit2 state still valid; pass the pre-fetched tx through so the FE
    // can pair it with the approve(s) (atomic on 5792, sequential otherwise).
    return {
      status: 200,
      body: {
        needsApproval: true,
        approvalType: 'ERC20_TO_PERMIT2',
        create: {
          to: passThroughTx.to,
          from: passThroughTx.from,
          data: passThroughTx.data,
          value: passThroughTx.value,
          chainId,
        },
        ...erc20Fields,
        details,
      },
    };
  }
  // Simulation failed but /lp/check_approval reported nothing missing — don't hand
  // the FE an unsimulated tx silently. Surface the upstream failure.
  return {
    status: 502,
    body: { message: 'Uniswap LP API: simulation failed but no approvals or permit were required.' },
  };
}

/**
 * The 3-branch error/observability catch shared by mint/increase/decrease.
 *  - UniswapLPAPIRateLimitError → 429, breadcrumb only (expected, not captured)
 *  - UniswapLPAPIError → 502/400, reportError with Uniswap tags
 *  - anything else → 500, reportError
 *
 * `extras` are the base report extras (used by both the Uniswap and generic
 * branches); `uniswapExtras` are the extra fields the Uniswap-error branch adds
 * on top (e.g. tick bounds for mint, decreasePercentage for decrease).
 */
export function handlePrepareTxError(
  error: unknown,
  req: NextApiRequest,
  res: NextApiResponse,
  ctx: {
    action: 'mint' | 'increase' | 'decrease';
    component: string;
    networkMode: NetworkMode;
    chainId: number | undefined;
    extras: Record<string, unknown>;
    uniswapExtras?: Record<string, unknown>;
  },
): void {
  const { action, component, networkMode, chainId, extras, uniswapExtras } = ctx;

  if (error instanceof UniswapLPAPIRateLimitError) {
    console.warn(`[${component}] Rate limit exhausted after retries`);
    // Rate limits are expected — do NOT capture; leave a breadcrumb trail only.
    addReportBreadcrumb({ domain: 'liquidity', action, level: 'warning', message: 'rate limited' });
    res.setHeader('Retry-After', '2');
    res.status(429).json({ message: 'Busy — please retry in a moment.' });
    return;
  }
  if (error instanceof UniswapLPAPIError) {
    console.error(`[${component}] Uniswap LP API error:`, error.status, error.message);
    reportError(error, {
      domain: 'liquidity',
      action,
      component,
      chainId,
      networkMode,
      tags: { uniswapStatus: error.status, uniswapErrorCode: error.code },
      extras: { ...extras, ...(uniswapExtras ?? {}), uniswapDetails: error.details },
    });
    res.status(error.status >= 500 ? 502 : 400).json({ message: `Uniswap LP API: ${error.message}` });
    return;
  }
  console.error(`[API ${component}] Error:`, error);
  reportError(error, {
    domain: 'liquidity',
    action,
    component,
    chainId,
    networkMode,
    extras,
  });
  const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
  res.status(500).json({ message: errorMessage, error: process.env.NODE_ENV === 'development' ? error : undefined });
}
