# Phase 1 Investigation Report: Critical Transaction Stepper Issues

**Date**: January 2026
**Status**: Awaiting User Approval for Phase 2 Implementation

---

## Executive Summary

5 parallel investigations were conducted on the CRITICAL issues in the Alphix Add Liquidity transaction stepper. Each investigation:
1. Located the issue in Alphix code with evidence
2. Analyzed how Uniswap handles the same scenario
3. Validated the fix is needed for Alphix
4. Proposed a specific fix following Uniswap patterns

| Issue | Severity | Uniswap Pattern Found | Fix Complexity |
|-------|----------|----------------------|----------------|
| C1: No Gas Estimation | CRITICAL | `simulateTransaction: true` | Medium |
| C2: Permit Nonce Staleness | CRITICAL | Refresh nonce before signing | Low |
| C3: Permit Burned on API Error | CRITICAL | Permit caching + retry | Medium |
| C4: No Rollback After Partial Success | CRITICAL | Redux + localStorage persistence | Medium |
| C5: Permit Nonce Reuse After Failure | CRITICAL | Auto-detect + refresh permit | Medium |

---

## C1: No Gas Estimation Throughout Flow

### Problem Location

**File**: [ReviewExecuteModal.tsx](components/liquidity/wizard/ReviewExecuteModal.tsx) (lines 317-363)
**File**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts) (lines 923-927)

```typescript
// PROBLEM: No gas estimation before wallet prompt
const hash = await sendTransactionAsync({
  to: txData.to as `0x${string}`,
  data: txData.data as Hex,
  value: txData.value && txData.value !== '0' ? BigInt(txData.value) : undefined,
  // NO gasLimit field - transaction can fail after user confirms
});
```

### Uniswap Reference

**File**: `interface/packages/uniswap/src/features/transactions/swap/steps/swap.ts`

```typescript
// Uniswap requests simulation from API
const { swap } = await TradingApiClient.fetchSwap({
  ...swapRequestArgs,
  signature,
  simulateTransaction: true,  // KEY: Backend simulates and returns gasLimit
})
return validateTransactionRequest(swap)  // Returns tx WITH gasLimit
```

### Proposed Fix

1. **API endpoints accept `simulateTransaction: true`** and return `gasLimit`
2. **Create `useGasValidation()` hook** to check user has sufficient ETH
3. **Validate gas BEFORE any wallet prompt** - show error if insufficient
4. **Include `gasLimit` in all `sendTransactionAsync` calls**

### Files to Modify

| File | Change |
|------|--------|
| `pages/api/liquidity/prepare-mint-tx.ts` | Add simulation, return gasLimit |
| `pages/api/liquidity/prepare-zap-mint-tx.ts` | Add simulation, return gasLimit |
| `lib/hooks/useGasValidation.ts` | **NEW**: Pre-execution gas validation |
| `components/liquidity/wizard/ReviewExecuteModal.tsx` | Call validation before prompts |
| `lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts` | Include gasLimit in tx calls |

---

## C2: Permit Nonce Staleness Risk

### Problem Location

**File**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts) (lines 795-836)
**File**: [prepare-mint-tx.ts](pages/api/liquidity/prepare-mint-tx.ts) (lines 502-530)

```typescript
// PROBLEM: Nonce fetched during API call, never refreshed before signing
const response = await fetch(endpoint, {
  method: 'POST',
  body: JSON.stringify(baseRequestBody),  // Nonce fetched HERE
});
// ... user reviews for 2-3 minutes ...
const signature = await signTypedDataAsync({...});  // Nonce may be STALE
```

### Uniswap Reference

Uniswap fetches nonce **immediately before signing**, not minutes before:

```typescript
// Uniswap pattern: Fresh nonce right before sign
const freshPermitData = await fetchPermitData()  // Gets current nonce
const signature = syncPermitAndSignature(freshPermitData)  // Signs with fresh nonce
```

### Proposed Fix

1. **Create `getNonceForToken()` helper** to fetch current nonce from Permit2
2. **Refresh nonce immediately before signing** in `prepareAndSignPermit()`
3. **Update permitBatchData with fresh nonces** before `signTypedDataAsync`

### Files to Modify

| File | Change |
|------|--------|
| `lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts` | Add `getNonceForToken()`, refresh in `prepareAndSignPermit()` |
| `pages/api/liquidity/prepare-mint-tx.ts` | Accept refreshed nonces from frontend |
| `pages/api/liquidity/prepare-zap-mint-tx.ts` | Same refresh logic |

### Implementation Code

```typescript
// Add to useAddLiquidityTransaction.ts
const getNonceForToken = useCallback(
  async (tokenAddress: string): Promise<number> => {
    const [, , nonce] = await publicClient.readContract({
      address: PERMIT2_ADDRESS,
      abi: iallowance_transfer_abi,
      functionName: 'allowance',
      args: [accountAddress, tokenAddress, POSITION_MANAGER_ADDRESS]
    });
    return nonce;
  },
  [publicClient, accountAddress]
);

// In prepareAndSignPermit(), before signing:
const freshNonces = await Promise.all(
  permitBatchData.values.details.map(d => getNonceForToken(d.token))
);
// Update details with fresh nonces before signing
```

---

## C3: Permit Burned on API Error

### Problem Location

**File**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts) (lines 854-862)

```typescript
// PROBLEM: Permit sent to API, but if API fails, permit may be burned
const requestBody = permitData
  ? { ...baseRequestBody, permitSignature: permitData.signature, permitBatchData: permitData.permitBatchData }
  : baseRequestBody;

let response = await fetch(endpoint, {
  body: JSON.stringify(requestBody),  // PERMIT SENT HERE
});

if (!response.ok) {
  throw new Error(errorData.message);  // Permit potentially burned, no recovery
}
```

### Uniswap Reference

Uniswap uses **step-based architecture** where permit signing is separate from execution:

```typescript
// Uniswap: Permit step is cached, can be reused on retry
const steps = [
  permit,                    // Sign once
  increasePosition           // Can retry without re-signing
]
```

### Proposed Fix

1. **Create `lib/permit-cache.ts`** for client-side permit caching
2. **Cache permit after successful signing** with 2-hour TTL
3. **On API error, offer retry with cached permit**
4. **Clear cache only on successful position creation**
5. **API: Don't include permit in calldata until validation passes**

### Files to Modify

| File | Change |
|------|--------|
| `lib/permit-cache.ts` | **NEW**: Permit caching utilities |
| `lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts` | Integrate cache, retry logic |
| `pages/api/liquidity/prepare-mint-tx.ts` | Separate validation from permit inclusion |
| `pages/api/liquidity/prepare-zap-mint-tx.ts` | Same architecture change |

### Implementation Code

```typescript
// lib/permit-cache.ts
interface CachedPermit {
  signature: string;
  permitBatchData: any;
  signedAt: number;
  expiresAt: number;
}

export function cachePermit(userAddress, token0, token1, tickLower, tickUpper, signature, permitBatchData) {
  const key = `permit:${userAddress}:${token0}:${token1}:${tickLower}:${tickUpper}`;
  localStorage.setItem(key, JSON.stringify({
    signature, permitBatchData,
    signedAt: Date.now(),
    expiresAt: Date.now() + 2 * 60 * 60 * 1000  // 2 hour TTL
  }));
}

export function getCachedPermit(userAddress, token0, token1, tickLower, tickUpper) {
  // ... retrieve and validate expiry
}
```

---

## C4: No Rollback After Partial Success

### Problem Location

**File**: [ReviewExecuteModal.tsx](components/liquidity/wizard/ReviewExecuteModal.tsx) (lines 317-386)

```typescript
// PROBLEM: Sequential execution, no checkpoints
try {
  // Token0 approval - SUCCESS, gas spent
  if (txInfo?.needsToken0Approval) {
    await handleApprove(pool.currency0.symbol, state.amount0);
    stepIdx++;
  }

  // Token1 approval - FAILS HERE
  if (txInfo?.needsToken1Approval) {
    await handleApprove(pool.currency1.symbol, state.amount1);  // ERROR THROWN
    stepIdx++;
  }
  // ... never reached
} catch (err) {
  setView('review');           // Goes back to review
  setCurrentStep(undefined);   // Clears all progress
  // Token0 approval is WASTED - must redo everything
}
```

### Uniswap Reference

**File**: `interface/packages/uniswap/src/features/transactions/slice.ts`

```typescript
// Uniswap: Redux + localStorage persistence
const slice = createSlice({
  name: 'transactions',
  reducers: {
    addTransaction: (state, { payload }) => {
      state[from][chainId][id] = transaction;  // PERSISTED
    },
    updateTransaction: (state, { payload }) => {
      state[from][chainId][id] = transaction;  // UPDATED
    },
  },
});

// On retry: Check if approval already confirmed
const alreadyCompleted = checkReduxForCompletedTransaction(step.type, step.token);
if (alreadyCompleted) continue;  // SKIP completed steps
```

### Proposed Fix

1. **Create `StepCompletionCache` interface** with localStorage persistence
2. **Save approval tx hashes after each success**
3. **On retry, verify approvals on-chain** before re-executing
4. **Skip completed steps** and resume from failure point
5. **Show "Resume" UI** if previous attempt exists

### Files to Modify

| File | Change |
|------|--------|
| `components/liquidity/wizard/CreatePositionTxContext.tsx` | Add step tracking state |
| `components/liquidity/wizard/ReviewExecuteModal.tsx` | Cache steps, skip completed, resume UI |
| `lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts` | Return tx hashes from approvals |
| `lib/transactions/step-cache.ts` | **NEW**: Step completion cache helpers |

### Implementation Code

```typescript
// Step completion cache structure
interface StepCompletionCache {
  token0ApprovalHash?: string;
  token1ApprovalHash?: string;
  permitSignature?: string;
  permitBatchData?: any;
  failedStep?: string;
  failureReason?: string;
  timestamp: number;
}

// In handleConfirm():
const cacheKey = `lp_step_cache_${accountAddress}_${poolId}`;

// After Token0 approval succeeds:
const cache = { token0ApprovalHash: hash, timestamp: Date.now() };
localStorage.setItem(cacheKey, JSON.stringify(cache));

// On retry, check cache:
const cached = JSON.parse(localStorage.getItem(cacheKey));
if (cached?.token0ApprovalHash) {
  const receipt = await publicClient.getTransactionReceipt({ hash: cached.token0ApprovalHash });
  if (receipt?.status === 'success') {
    startStepIdx = 1;  // Skip Token0, start from Token1
  }
}
```

---

## C5: Permit Nonce Reuse Impossible After On-Chain Failure

### Problem Location

**File**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts) (lines 839-981)

```typescript
// PROBLEM: If tx fails AFTER permit consumed on-chain, retry uses same stale nonce
const handleDeposit = useCallback(async (permitData) => {
  try {
    const hash = await sendTransactionAsync({...});
    // Transaction submitted with permit nonce N
    // If TX reverts AFTER Permit2 consumed the nonce, nonce N is burned
  } catch (error) {
    // User clicks retry
    // Same permitData (with nonce N) is reused
    // On-chain: Nonce is now N+1
    // Result: InvalidNonce error
  }
});
```

### Uniswap Reference

**File**: `interface/packages/uniswap/src/features/transactions/liquidity/steps/increasePosition.ts`

```typescript
// Uniswap's async pattern: getTxRequest called on EACH attempt
export function createIncreasePositionAsyncStep(args) {
  return {
    type: TransactionStepType.IncreasePositionTransactionAsync,
    getTxRequest: async (signature) => {
      // Called on EACH retry - backend gets fresh nonce
      const { increase } = await TradingApiClient.increaseLpPosition({
        ...args,
        signature,
        simulateTransaction: true,
      });
      return validateTransactionRequest(increase);
    },
  }
}
```

### Proposed Fix

1. **Create `lib/liquidity/utils/permit-recovery.ts`** with detection utilities
2. **Detect `InvalidNonce` errors** in error handler
3. **Check on-chain if nonce was consumed** (current nonce > permit nonce)
4. **Auto-refresh permit** with new nonce on detection
5. **Retry automatically** with fresh permit
6. **API: Validate nonce even when permit provided**

### Files to Modify

| File | Change |
|------|--------|
| `lib/liquidity/utils/permit-recovery.ts` | **NEW**: Nonce detection, refresh utilities |
| `lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts` | Add permit refresh in error handler |
| `pages/api/liquidity/prepare-mint-tx.ts` | Validate nonce even with permit |
| `pages/api/liquidity/prepare-zap-mint-tx.ts` | Same validation |
| `components/liquidity/wizard/ReviewExecuteModal.tsx` | Show refresh UI on error |

### Implementation Code

```typescript
// lib/liquidity/utils/permit-recovery.ts
export function detectPermitConsumptionError(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  return lower.includes('invalidnonce') || lower.includes('nonce expired');
}

export async function isPermitNonceConsumed(
  publicClient, userAddress, tokenAddress, spenderAddress, permitNonce
): Promise<boolean> {
  const [, , currentNonce] = await publicClient.readContract({
    address: PERMIT2_ADDRESS,
    abi: iallowance_transfer_abi,
    functionName: 'allowance',
    args: [userAddress, tokenAddress, spenderAddress]
  });
  return currentNonce > permitNonce;
}

// In handleDeposit error handler:
if (detectPermitConsumptionError(error.message) && permitData) {
  toast.error('Permit expired, refreshing...');
  const newPermit = await prepareAndSignPermit();  // Gets fresh nonce
  await handleDeposit(newPermit);  // Retry with fresh permit
  return;
}
```

---

## Summary: Proposed File Changes

### New Files to Create

| File | Purpose |
|------|---------|
| `lib/hooks/useGasValidation.ts` | Pre-execution gas validation hook |
| `lib/permit-cache.ts` | Client-side permit signature caching |
| `lib/transactions/step-cache.ts` | Step completion persistence |
| `lib/liquidity/utils/permit-recovery.ts` | Permit nonce detection & refresh |

### Existing Files to Modify

| File | Issues Addressed |
|------|------------------|
| `components/liquidity/wizard/ReviewExecuteModal.tsx` | C1, C4 |
| `lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts` | C1, C2, C3, C5 |
| `pages/api/liquidity/prepare-mint-tx.ts` | C1, C2, C3, C5 |
| `pages/api/liquidity/prepare-zap-mint-tx.ts` | C1, C2, C3, C5 |
| `components/liquidity/wizard/CreatePositionTxContext.tsx` | C4 |

---

## Interdependencies

Some fixes share infrastructure:

```
C2 (Nonce Staleness) ──┐
                       ├──► Permit nonce utilities (shared)
C5 (Nonce Reuse)  ─────┘

C3 (Permit Burned) ────┐
                       ├──► Permit caching (shared)
C4 (No Rollback)  ─────┘

C1 (Gas Estimation) ───► Standalone (API + validation hook)
```

**Recommended Implementation Order**:
1. **C1** - Gas estimation (standalone, high impact)
2. **C2 + C5** - Nonce handling (shared utilities)
3. **C3 + C4** - State persistence (shared caching)

---

## Approval Request

Please review each proposed fix and indicate:
- [ ] **C1**: Approve gas estimation implementation
- [ ] **C2**: Approve nonce refresh implementation
- [ ] **C3**: Approve permit caching implementation
- [ ] **C4**: Approve step persistence implementation
- [ ] **C5**: Approve permit recovery implementation

Once approved, Phase 2 subagents will be tasked with implementing each fix following the Uniswap patterns 1:1.

---

*Generated by Phase 1 Investigation - January 2026*
