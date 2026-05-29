/**
 * Uniswap Liquidity API client.
 *
 * Sunsets our custom V4 transaction builders for non-UY pools. We send
 * position parameters to `https://liquidity.api.uniswap.org/lp/*` and get
 * back ready-to-sign TransactionRequest objects.
 *
 * UY pools (rehypothecation, custom ERC-4626 Hook) stay on the legacy path.
 *
 * Endpoints discovered (all POST):
 *   /lp/check_approval  — check/build ERC-20 + Permit2 approval txs
 *   /lp/create          — build V4 mint position tx (requires tickBounds|priceBounds)
 *   /lp/increase        — build V4 increase liquidity tx (requires existing nftTokenId)
 *   /lp/decrease        — build V4 decrease liquidity tx (by percentage)
 *   /lp/claim_fees      — build V4 collect fees tx
 */

import { addReportBreadcrumb } from '@/lib/observability';

const BASE_URL = 'https://liquidity.api.uniswap.org';

export type LPProtocol = 'V2' | 'V3' | 'V4';

/** Shape the LP API returns for a single ethers/viem-compatible transaction request. */
export interface LPTransactionRequest {
  to: string;
  from: string;
  data: string;
  value: string;
  chainId: number;
}

/** Minimal token descriptor used across requests and responses. */
export interface LPToken {
  tokenAddress: string;
  amount: string;
}

// ---------------------------------------------------------------------------
// check_approval
// ---------------------------------------------------------------------------

export type LPApprovalAction = 'CREATE' | 'INCREASE' | 'DECREASE' | 'MIGRATE';

export interface CheckApprovalRequest {
  walletAddress: string;
  protocol: LPProtocol;
  chainId: number;
  lpTokens: LPToken[];
  action: LPApprovalAction;
  simulateTransaction?: boolean;
}

/**
 * Raw v4BatchPermitData as returned by Uniswap's /lp/check_approval.
 * Note quirks vs. standard EIP-712: each type wraps its array in `{ fields: [...] }`,
 * and `domain.chainId` is a chain-name string ("BASE", "ARBITRUM") not a number.
 * Use {@link normalizeV4BatchPermit} to convert before signing or surfacing to wagmi.
 */
export interface V4BatchPermitRaw {
  domain: {
    name: string;
    chainId: string | number;
    verifyingContract: string;
  };
  types: Record<string, { fields: Array<{ name: string; type: string }> }>;
  values: {
    details: Array<{
      token: string;
      amount: string;
      expiration: string;
      nonce: string;
    }>;
    spender: string;
    sigDeadline: string;
  };
}

/**
 * Standard EIP-712 typed-data shape consumed by viem/wagmi `signTypedData`.
 */
export interface V4BatchPermit {
  domain: {
    name: string;
    chainId: number;
    verifyingContract: string;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  values: V4BatchPermitRaw['values'];
}

/**
 * Normalize Uniswap's response shape into standard EIP-712 typed data.
 * Pass `chainId` to override the string-typed `domain.chainId`.
 */
export function normalizeV4BatchPermit(raw: V4BatchPermitRaw, chainId: number): V4BatchPermit {
  const types: Record<string, Array<{ name: string; type: string }>> = {};
  for (const [typeName, def] of Object.entries(raw.types)) {
    types[typeName] = def.fields;
  }
  return {
    domain: { ...raw.domain, chainId },
    types,
    values: raw.values,
  };
}

/**
 * Inverse of {@link normalizeV4BatchPermit}. /lp/create and /lp/increase require
 * the `{fields: [...]}` wrapper on each type entry; sending a flat array errors with
 * "cannot decode message uniswap.liquidity.v1.TypeFieldArray from JSON: array".
 */
export function denormalizeV4BatchPermit(normalized: V4BatchPermit): V4BatchPermitRaw {
  const types: Record<string, { fields: Array<{ name: string; type: string }> }> = {};
  for (const [typeName, fields] of Object.entries(normalized.types)) {
    types[typeName] = { fields };
  }
  return {
    domain: normalized.domain,
    types,
    values: normalized.values,
  };
}

export interface CheckApprovalResponse {
  requestId: string;
  /** Ordered list of ERC-20 approval txs (empty if no approvals needed). */
  transactions: Array<{
    transaction: LPTransactionRequest;
    tokenAddress: string;
  }>;
  /** Raw v4 batch permit envelope; pass through {@link normalizeV4BatchPermit} before use. */
  v4BatchPermitData?: V4BatchPermitRaw | null;
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

export interface ExistingPoolRef {
  token0Address: string;
  token1Address: string;
  /** V4: pool id (32-byte keccak). V3: pool contract address. */
  poolReference: string;
}

export interface NewPoolRef {
  token0Address: string;
  token1Address: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  /** For V4 initialization; human-readable price (token1 per token0 in decimals). */
  initialPrice: string;
}

export type TickBounds = { tickLower: number; tickUpper: number };

export interface CreatePositionRequest {
  walletAddress: string;
  chainId: number;
  protocol: LPProtocol;
  /** Exactly one of existingPool or newPool. */
  existingPool?: ExistingPoolRef;
  newPool?: NewPoolRef;
  independentToken: LPToken;
  /** Ticks must be pre-snapped to the pool's tickSpacing — API rejects
   *  `priceBounds`/`tickPrice` with a 400 regardless of shape (verified
   *  empirically against /lp/create). */
  tickBounds: TickBounds;
  /** Decimal percent (0.5 = 0.5%). Optional — if omitted, Uniswap applies its own server-side slippage (value server-controlled/undocumented). */
  slippageTolerance?: number;
  /** Unix timestamp in seconds. API default is +20min if omitted. */
  deadline?: number;
  /**
   * Off-chain Permit2 batch typed-data echoed from /lp/check_approval.
   * Note: /lp/create names this `batchPermitData` (not `v4BatchPermitData` like /lp/increase).
   * Send the raw shape returned by /lp/check_approval, NOT the normalized form.
   */
  batchPermitData?: V4BatchPermitRaw;
  /** EIP-712 signature over the (normalized) batchPermitData typed data. */
  signature?: string;
  simulateTransaction?: boolean;
}

export interface CreatePositionResponse {
  requestId: string;
  token0: LPToken;
  token1: LPToken;
  tickLower: number;
  tickUpper: number;
  /** Optional — /lp/create omits these in practice (verified empirically). */
  minPrice?: string;
  maxPrice?: string;
  /** Price representation of the requested tick range — NOT slippage-adjusted on /lp/create. */
  adjustedMinPrice?: string;
  adjustedMaxPrice?: string;
  create: LPTransactionRequest;
  /** Total estimated gas cost (gasLimit * maxFeePerGas) in wei. Present when simulateTransaction=true. */
  gasFee?: string;
}

// ---------------------------------------------------------------------------
// increase
// ---------------------------------------------------------------------------

export interface IncreasePositionRequest {
  walletAddress: string;
  chainId: number;
  protocol: LPProtocol;
  token0Address: string;
  token1Address: string;
  nftTokenId: string;
  independentToken: LPToken;
  /** Decimal percent (0.5 = 0.5%). Optional — if omitted, Uniswap applies its own server-side slippage (value server-controlled/undocumented). */
  slippageTolerance?: number;
  /** Unix timestamp in seconds. API default is +20min if omitted. */
  deadline?: number;
  /** Off-chain Permit2 batch typed-data (echoed from /lp/check_approval). Raw shape. */
  v4BatchPermitData?: V4BatchPermitRaw;
  /** EIP-712 signature over the (normalized) v4BatchPermitData typed data. */
  signature?: string;
  simulateTransaction?: boolean;
}

export interface IncreasePositionResponse {
  requestId: string;
  token0: LPToken;
  token1: LPToken;
  increase: LPTransactionRequest;
  /** Total estimated gas cost (gasLimit * maxFeePerGas) in wei. Present when simulateTransaction=true. */
  gasFee?: string;
}

// ---------------------------------------------------------------------------
// decrease
// ---------------------------------------------------------------------------

export interface DecreasePositionRequest {
  walletAddress: string;
  chainId: number;
  protocol: LPProtocol;
  token0Address: string;
  token1Address: string;
  nftTokenId: string;
  /** 1-100. */
  liquidityPercentageToDecrease: number;
  /** Decimal percent (0.5 = 0.5%). Optional — if omitted, Uniswap applies its own server-side slippage (value server-controlled/undocumented). */
  slippageTolerance?: number;
  /** Unix timestamp in seconds. API default is +20min if omitted. */
  deadline?: number;
  simulateTransaction?: boolean;
}

export interface DecreasePositionResponse {
  requestId: string;
  token0: LPToken;
  token1: LPToken;
  decrease: LPTransactionRequest;
  /** Total estimated gas cost (gasLimit * maxFeePerGas) in wei. Present when simulateTransaction=true. */
  gasFee?: string;
}

// ---------------------------------------------------------------------------
// claim_fees
// ---------------------------------------------------------------------------

export interface ClaimFeesRequest {
  walletAddress: string;
  chainId: number;
  protocol: LPProtocol;
  tokenId: string;
  simulateTransaction?: boolean;
}

export interface ClaimFeesResponse {
  requestId: string;
  token0: LPToken;
  token1: LPToken;
  claim: LPTransactionRequest;
  /** Total estimated gas cost (gasLimit * maxFeePerGas) in wei. Present when simulateTransaction=true. */
  gasFee?: string;
}

// ---------------------------------------------------------------------------
// Core POST helper
// ---------------------------------------------------------------------------

export class UniswapLPAPIError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'UniswapLPAPIError';
  }
}

/**
 * Thrown after the retry budget is exhausted on a rate-limit response (HTTP 403
 * with body `{"message":"Forbidden"}`). Routes translate this to a 429 to the
 * frontend so the UI can show a "slow down" toast instead of a generic error.
 */
export class UniswapLPAPIRateLimitError extends UniswapLPAPIError {
  constructor() {
    super(403, 'rate_limited', 'Uniswap LP API rate limit exceeded. Please retry in a moment.');
    this.name = 'UniswapLPAPIRateLimitError';
  }
}

function getApiKey(): string {
  const key = process.env.UNISWAP_API_KEY;
  if (!key) {
    throw new Error('UNISWAP_API_KEY not configured. Add it to .env.local.');
  }
  return key;
}

/** Base retry delays (ms) for rate-limit (HTTP 403) responses. The API enforces
 *  ~6 req/sec with no Retry-After header. Three attempts ride out typical
 *  multi-user bursts. ±50% jitter smooths the thundering-herd when many
 *  clients collide at the same wall-clock instant. */
const RATE_LIMIT_RETRY_BASE_MS = [200, 500, 1100];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Returns base delay ±50% for jitter. */
function jitter(baseMs: number): number {
  const spread = baseMs * 0.5;
  return Math.max(50, Math.round(baseMs + (Math.random() * 2 - 1) * spread));
}

async function post<Req, Res>(path: string, body: Req): Promise<Res> {
  // N+1 iterations: N retry-sleeps + 1 final attempt without sleep.
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_BASE_MS.length; attempt++) {
    // Pre-fetch lifecycle breadcrumb so a subsequent failure correlates to the
    // exact endpoint + retry attempt that triggered it.
    addReportBreadcrumb({
      domain: 'liquidity',
      action: 'uniswapLPApi',
      message: path,
      data: { attempt, path },
    });

    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getApiKey(),
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = text; }

    // Treat any 403 or 429 as rate-limit and retry with backoff.
    // Empirically Uniswap returns 403+`{"message":"Forbidden"}` (no Retry-After header), but
    // coupling to the body string is fragile — accept either status code so we survive
    // a future migration to spec-compliant 429s or any body-shape change.
    const isRateLimit = res.status === 403 || res.status === 429;
    if (isRateLimit && attempt < RATE_LIMIT_RETRY_BASE_MS.length) {
      await sleep(jitter(RATE_LIMIT_RETRY_BASE_MS[attempt]));
      continue;
    }
    if (isRateLimit) {
      // Rate-limits are expected; routes decide whether to surface them. We do NOT
      // capture here — only leave a breadcrumb trail.
      throw new UniswapLPAPIRateLimitError();
    }

    if (!res.ok) {
      const message = parsed?.message ?? (typeof parsed === 'string' ? parsed : `HTTP ${res.status}`);
      // Error-path breadcrumb (before throwing) so the failure correlates to the
      // upstream requestId even when the body carried no successful payload.
      addReportBreadcrumb({
        domain: 'liquidity',
        action: 'uniswapLPApi',
        level: 'error',
        message: `${path} failed`,
        data: { path, status: res.status, code: parsed?.code, requestId: parsed?.requestId },
      });
      throw new UniswapLPAPIError(res.status, parsed?.code, message, parsed?.details);
    }
    // Tag every successful Uniswap LP API response with its `requestId` so support
    // can correlate user complaints back to a specific upstream call.
    if (parsed?.requestId) {
      addReportBreadcrumb({
        domain: 'liquidity',
        action: 'uniswapLPApi',
        message: path,
        data: { requestId: parsed.requestId },
      });
    }
    return parsed as Res;
  }
  // Unreachable; the loop either returns a success or throws.
  throw new UniswapLPAPIRateLimitError();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const uniswapLPAPI = {
  checkApproval: (req: CheckApprovalRequest) =>
    post<CheckApprovalRequest, CheckApprovalResponse>('/lp/check_approval', req),

  create: (req: CreatePositionRequest) =>
    post<CreatePositionRequest, CreatePositionResponse>('/lp/create', req),

  increase: (req: IncreasePositionRequest) =>
    post<IncreasePositionRequest, IncreasePositionResponse>('/lp/increase', req),

  decrease: (req: DecreasePositionRequest) =>
    post<DecreasePositionRequest, DecreasePositionResponse>('/lp/decrease', req),

  claimFees: (req: ClaimFeesRequest) =>
    post<ClaimFeesRequest, ClaimFeesResponse>('/lp/claim_fees', req),
};
