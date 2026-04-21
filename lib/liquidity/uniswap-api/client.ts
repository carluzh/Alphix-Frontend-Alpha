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
export type PriceBounds = { minPrice: string; maxPrice: string };

export interface CreatePositionRequest {
  walletAddress: string;
  chainId: number;
  protocol: LPProtocol;
  /** Exactly one of existingPool or newPool. */
  existingPool?: ExistingPoolRef;
  newPool?: NewPoolRef;
  independentToken: LPToken;
  /** Exactly one of tickBounds or priceBounds. */
  tickBounds?: TickBounds;
  priceBounds?: PriceBounds;
  /** Decimal percent (0.5 = 0.5%). API default is 0.5 if omitted. */
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
  minPrice: string;
  maxPrice: string;
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
  /** Decimal percent (0.5 = 0.5%). API default is 0.5 if omitted. */
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
  /** Decimal percent (0.5 = 0.5%). API default is 0.5 if omitted. */
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

/** Retry budget for rate-limit (HTTP 403) responses. The API enforces 6 req/sec with
 *  no Retry-After header, so we back off with exponential delays. Three attempts lets
 *  us ride out typical multi-user burst spikes while staying responsive. */
const RATE_LIMIT_RETRY_DELAYS_MS = [200, 500, 1100];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function post<Req, Res>(path: string, body: Req): Promise<Res> {
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_DELAYS_MS.length; attempt++) {
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

    // Rate-limited: back off and retry until budget is exhausted.
    const isRateLimit = res.status === 403 && parsed?.message === 'Forbidden';
    if (isRateLimit && attempt < RATE_LIMIT_RETRY_DELAYS_MS.length) {
      await sleep(RATE_LIMIT_RETRY_DELAYS_MS[attempt]);
      continue;
    }
    if (isRateLimit) {
      throw new UniswapLPAPIRateLimitError();
    }

    if (!res.ok) {
      const message = parsed?.message ?? (typeof parsed === 'string' ? parsed : `HTTP ${res.status}`);
      throw new UniswapLPAPIError(res.status, parsed?.code, message, parsed?.details);
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
