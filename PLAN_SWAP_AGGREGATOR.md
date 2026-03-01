# Swap Aggregator Integration Plan

## Overview

Integrate Kyberswap aggregator to provide best-price routing on Base, while preferring Alphix V4 pools when competitive.

**Flow:**
```
User enters swap
    ↓
Fetch quotes in parallel:
  - Alphix V4 pools (existing logic)
  - Kyberswap aggregator
    ↓
Compare outputs:
  - If Alphix within slippage tolerance of Kyberswap → use Alphix
  - Otherwise → use Kyberswap
    ↓
Execute via appropriate router
```

---

## Phase 1: Kyberswap API Client

### New Files

```
lib/aggregators/
├── types.ts                 # Shared types
├── kyberswap.ts             # Kyberswap API client
└── index.ts                 # Aggregator interface
```

### lib/aggregators/types.ts

```typescript
export type AggregatorSource = 'alphix' | 'kyberswap';

export interface AggregatorQuote {
  source: AggregatorSource;
  outputAmount: string;          // Decimal string
  outputAmountWei: bigint;
  priceImpact: number | null;
  gasEstimate: bigint;
  routerAddress: string;
  // Kyberswap-specific
  routeSummary?: any;            // For POST /route/build
  encodedSwapData?: string;      // Calldata for execution
}

export interface QuoteRequest {
  fromToken: string;             // Address
  toToken: string;               // Address
  amount: string;                // Wei string
  slippageBps: number;
  userAddress?: string;
}

export interface QuoteComparison {
  alphixQuote: AggregatorQuote | null;
  kyberQuote: AggregatorQuote | null;
  selectedQuote: AggregatorQuote;
  alphixPreferred: boolean;      // True if Alphix was chosen
  reason: string;                // "best_price" | "within_tolerance" | "aggregator_unavailable"
}
```

### lib/aggregators/kyberswap.ts

```typescript
const KYBER_BASE_URL = 'https://aggregator-api.kyberswap.com/base/api/v1';
const CLIENT_ID = process.env.KYBERSWAP_CLIENT_ID || 'alphix';

export async function getKyberswapQuote(request: QuoteRequest): Promise<AggregatorQuote | null> {
  // 1. GET /routes - fetch best route
  const routeResponse = await fetch(
    `${KYBER_BASE_URL}/routes?` + new URLSearchParams({
      tokenIn: request.fromToken,
      tokenOut: request.toToken,
      amountIn: request.amount,
      gasInclude: 'true',
    }),
    {
      headers: { 'x-client-id': CLIENT_ID },
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!routeResponse.ok) return null;
  const routeData = await routeResponse.json();
  if (!routeData.data?.routeSummary) return null;

  // 2. POST /route/build - get calldata
  const buildResponse = await fetch(`${KYBER_BASE_URL}/route/build`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': CLIENT_ID,
    },
    body: JSON.stringify({
      routeSummary: routeData.data.routeSummary,
      sender: request.userAddress,
      recipient: request.userAddress,
      slippageTolerance: request.slippageBps,
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!buildResponse.ok) return null;
  const buildData = await buildResponse.json();

  return {
    source: 'kyberswap',
    outputAmount: routeData.data.routeSummary.amountOut,
    outputAmountWei: BigInt(routeData.data.routeSummary.amountOut),
    priceImpact: routeData.data.routeSummary.priceImpact || null,
    gasEstimate: BigInt(routeData.data.routeSummary.gas || 0),
    routerAddress: buildData.data.routerAddress,
    routeSummary: routeData.data.routeSummary,
    encodedSwapData: buildData.data.data,
  };
}
```

---

## Phase 2: Modified Quote Endpoint

### Update: pages/api/swap/get-quote.ts

**Changes:**
1. Import Kyberswap client
2. Fetch both quotes in parallel
3. Compare and select best
4. Return with source indicator

```typescript
// New imports
import { getKyberswapQuote, type AggregatorQuote } from '@/lib/aggregators/kyberswap';

// Inside handler, after existing V4 quote logic:

// Fetch Kyberswap quote in parallel (only if user address provided)
let kyberQuote: AggregatorQuote | null = null;
if (req.body.userAddress && fromToken.address && toToken.address) {
  try {
    kyberQuote = await getKyberswapQuote({
      fromToken: fromToken.address,
      toToken: toToken.address,
      amount: amountInSmallestUnits.toString(),
      slippageBps: req.body.slippageBps || 50,
      userAddress: req.body.userAddress,
    });
  } catch (e) {
    console.warn('[Kyberswap] Quote failed, using Alphix only:', e);
  }
}

// Compare quotes
const alphixOutputWei = amountOut; // from existing V4 quote
const kyberOutputWei = kyberQuote?.outputAmountWei || 0n;

// Determine if Alphix is within tolerance
const slippageTolerance = req.body.slippageBps || 50; // basis points
const toleranceMultiplier = 10000n - BigInt(slippageTolerance);
const alphixWithinTolerance = alphixOutputWei * 10000n >= kyberOutputWei * toleranceMultiplier;

let selectedSource: 'alphix' | 'kyberswap' = 'alphix';
let reason = 'alphix_only';

if (kyberQuote) {
  if (alphixOutputWei >= kyberOutputWei) {
    selectedSource = 'alphix';
    reason = 'best_price';
  } else if (alphixWithinTolerance) {
    selectedSource = 'alphix';
    reason = 'within_tolerance';
  } else {
    selectedSource = 'kyberswap';
    reason = 'aggregator_better';
  }
}

// Return response with source
const responseData = {
  // ... existing fields ...
  source: selectedSource,
  selectionReason: reason,
  kyberswapAvailable: !!kyberQuote,
  // Include Kyberswap data if selected
  ...(selectedSource === 'kyberswap' && kyberQuote && {
    kyberswapData: {
      routerAddress: kyberQuote.routerAddress,
      routeSummary: kyberQuote.routeSummary,
      encodedSwapData: kyberQuote.encodedSwapData,
    }
  }),
};
```

---

## Phase 3: Transaction Builder Updates

### Update: pages/api/swap/build-tx.ts

**Add source parameter handling:**

```typescript
interface BuildSwapTxRequest extends NextApiRequest {
  body: {
    // ... existing fields ...
    source: 'alphix' | 'kyberswap';
    // Kyberswap-specific (when source === 'kyberswap')
    kyberswapData?: {
      routerAddress: string;
      encodedSwapData: string;
    };
  };
}

// Inside handler:
if (req.body.source === 'kyberswap') {
  const { routerAddress, encodedSwapData } = req.body.kyberswapData!;

  // For Kyberswap, we return the pre-built calldata
  // No simulation needed - Kyberswap already validated the route
  return res.status(200).json({
    ok: true,
    source: 'kyberswap',
    to: routerAddress,
    data: encodedSwapData,
    value: isNativeInput ? actualSwapAmount.toString() : '0',
  });
}

// Existing Alphix logic continues for source === 'alphix'
```

---

## Phase 4: Approval Flow

### New File: lib/aggregators/approval.ts

```typescript
import { KYBER_ROUTER_BASE } from './constants';

// Kyberswap Meta Aggregation Router V2 on Base
export const KYBERSWAP_ROUTER_ADDRESS = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';

export interface ApprovalCheck {
  needsApproval: boolean;
  spender: string;
  token: string;
  currentAllowance: bigint;
  requiredAmount: bigint;
}

export async function checkKyberswapApproval(
  tokenAddress: string,
  userAddress: string,
  amount: bigint,
  publicClient: any
): Promise<ApprovalCheck> {
  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [userAddress, KYBERSWAP_ROUTER_ADDRESS],
  });

  return {
    needsApproval: allowance < amount,
    spender: KYBERSWAP_ROUTER_ADDRESS,
    token: tokenAddress,
    currentAllowance: allowance,
    requiredAmount: amount,
  };
}
```

### Update: components/swap/useSwapExecution.ts

Add branch for Kyberswap execution:

```typescript
// When source === 'kyberswap':
// 1. Check if approval needed for Kyberswap router
// 2. If needed, prompt standard ERC20 approve (not Permit2)
// 3. Execute swap with Kyberswap calldata

// State machine additions:
// - checking_kyber_allowance
// - needs_kyber_approval
// - approving_kyber
// - executing_kyber_swap
```

---

## Phase 5: UI Updates

### Update: components/swap/SwapInputView.tsx

**Minimal changes - just show source badge:**

```tsx
// In route info section, add source indicator:
{trade.source === 'alphix' && (
  <span className="text-xs text-muted-foreground ml-2">
    via Alphix Pool
  </span>
)}

{trade.source === 'kyberswap' && (
  <span className="text-xs text-muted-foreground ml-2">
    via Kyberswap
  </span>
)}
```

### Update: components/swap/useSwapTrade.ts

Pass source through to UI:

```typescript
// Add to trade model:
source: quoteData?.source || 'alphix',
kyberswapAvailable: quoteData?.kyberswapAvailable || false,
```

---

## File Changes Summary

| File | Type | Description |
|------|------|-------------|
| `lib/aggregators/types.ts` | New | Shared types |
| `lib/aggregators/kyberswap.ts` | New | Kyberswap API client |
| `lib/aggregators/approval.ts` | New | Approval checking |
| `lib/aggregators/index.ts` | New | Exports |
| `pages/api/swap/get-quote.ts` | Modify | Add parallel Kyberswap fetch, comparison logic |
| `pages/api/swap/build-tx.ts` | Modify | Handle Kyberswap source |
| `components/swap/useSwapQuote.ts` | Modify | Pass userAddress, slippage to API |
| `components/swap/useSwapExecution.ts` | Modify | Add Kyberswap approval + execution flow |
| `components/swap/useSwapTrade.ts` | Modify | Expose source to UI |
| `components/swap/SwapInputView.tsx` | Modify | Show source badge |

---

## Environment Variables

```env
KYBERSWAP_CLIENT_ID=alphix    # Or register with Kyberswap BD
```

---

## Error Handling

1. **Kyberswap timeout (5s)**: Fall back to Alphix-only quote
2. **Kyberswap returns no route**: Fall back to Alphix-only
3. **Kyberswap rate limited**: Fall back to Alphix-only
4. **Both fail**: Show error to user

All fallbacks are silent - user just sees Alphix quote without knowing aggregator was attempted.

---

## Testing Plan

1. **Unit tests**: Kyberswap client with mocked responses
2. **Integration tests**:
   - ETH → USDC via Alphix (should prefer Alphix)
   - ETH → USDC via Kyberswap (force by returning worse Alphix quote)
   - Approval flow for Kyberswap router
3. **Manual testing**:
   - Various token pairs
   - Large amounts (check if Kyberswap wins)
   - Network errors (verify fallback)

---

## Open Questions

1. **Slippage source**: Currently using user's slippage setting for comparison tolerance. Is this correct, or should we have a separate "prefer Alphix within X%" setting?

2. **Quote caching**: Should Kyberswap quotes share the same 15s cache, or separate?

3. **Analytics**: Track which source is used for swaps? (for understanding when Alphix wins vs loses)
