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

export interface CheckApprovalResponse {
  requestId: string;
  /** Ordered list of ERC-20 approval txs (empty if no approvals needed). */
  transactions: Array<{
    transaction: LPTransactionRequest;
    tokenAddress: string;
  }>;
  permitData?: unknown;
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
  gasFeeEstimates?: unknown;
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
  simulateTransaction?: boolean;
}

export interface IncreasePositionResponse {
  requestId: string;
  token0: LPToken;
  token1: LPToken;
  increase: LPTransactionRequest;
  gasFeeEstimates?: unknown;
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
  simulateTransaction?: boolean;
}

export interface DecreasePositionResponse {
  requestId: string;
  token0: LPToken;
  token1: LPToken;
  decrease: LPTransactionRequest;
  gasFeeEstimates?: unknown;
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
  gasFeeEstimates?: unknown;
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

function getApiKey(): string {
  const key = process.env.UNISWAP_API_KEY;
  if (!key) {
    throw new Error('UNISWAP_API_KEY not configured. Add it to .env.local.');
  }
  return key;
}

async function post<Req, Res>(path: string, body: Req): Promise<Res> {
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

  if (!res.ok) {
    const message = parsed?.message ?? (typeof parsed === 'string' ? parsed : `HTTP ${res.status}`);
    throw new UniswapLPAPIError(res.status, parsed?.code, message, parsed?.details);
  }
  return parsed as Res;
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
