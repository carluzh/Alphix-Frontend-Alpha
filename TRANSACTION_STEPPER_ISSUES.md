# Transaction Stepper Issues Tracker

This document tracks issues found during the deep investigation of the Add Liquidity transaction stepper flow.

**Investigation Date**: January 2026
**Status**: In Progress

---

## Issue Summary

| Severity | Count | Fixed |
|----------|-------|-------|
| CRITICAL | 5 | 0 |
| HIGH | 8 | 0 |
| MEDIUM | 6 | 0 |
| **Total** | **19** | **0** |

---

## CRITICAL Issues

### C1. No Gas Estimation Throughout Flow
- [ ] **Status**: Open
- **Location**: [ReviewExecuteModal.tsx](components/liquidity/wizard/ReviewExecuteModal.tsx) → `handleConfirm()`
- **Description**: `writeContractAsync` and `sendTransactionAsync` are called without estimating gas first. If user has insufficient gas, transaction fails after wallet prompt with poor UX.
- **Risk**: User wastes time signing transactions that will fail
- **Fix**: Call `estimateGas` before each transaction, show gas cost in UI, block if insufficient

---

### C2. Permit Nonce Staleness Risk
- [ ] **Status**: Open
- **Location**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts) → `prepareAndSignPermit()`
- **Description**: Permit nonce is fetched during API call but may become stale if user has pending transactions or opens multiple tabs.
- **Risk**: Permit signature becomes invalid, transaction reverts on-chain
- **Fix**: Fetch nonce immediately before signing, validate nonce freshness, handle nonce conflicts

---

### C3. Permit Burned on API Error
- [ ] **Status**: Open
- **Location**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts) → `handleDeposit()`
- **Description**: If the API returns an error AFTER the permit is signed, the permit may be consumed server-side but no position is created.
- **Risk**: User's permit is wasted, must re-sign for retry
- **Fix**: Implement permit caching, retry with same signature, clear error handling for API failures

---

### C4. No Rollback After Partial Success
- [ ] **Status**: Open
- **Location**: [ReviewExecuteModal.tsx](components/liquidity/wizard/ReviewExecuteModal.tsx) → `handleConfirm()`
- **Description**: If Token0 approval succeeds but Token1 fails, there's no recovery path. The Token0 approval is "wasted" and user must restart.
- **Risk**: Poor UX, wasted gas on approvals that don't lead to position creation
- **Fix**: Persist approval state, allow resuming from last successful step

---

### C5. Permit Nonce Reuse Impossible After On-Chain Failure
- [ ] **Status**: Open
- **Location**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts) → `handleDeposit()`
- **Description**: If deposit transaction fails AFTER permit is burned on-chain, the same nonce cannot be reused. User must generate new permit.
- **Risk**: Confusing error state, user doesn't understand why retry fails
- **Fix**: Detect on-chain permit consumption, automatically refresh permit on retry

---

## HIGH Issues

### H1. No User Rejection Detection for Approvals
- [ ] **Status**: Open
- **Location**: [ReviewExecuteModal.tsx](components/liquidity/wizard/ReviewExecuteModal.tsx) → `handleConfirm()`
- **Description**: When user rejects in wallet, error is caught generically. No specific handling for `UserRejectedRequestError`.
- **Risk**: Generic error message shown, user doesn't know they can retry
- **Fix**: Catch `UserRejectedRequestError` specifically, show "Transaction rejected" with retry option

---

### H2. No State Persistence Across Page Reloads
- [ ] **Status**: Open
- **Location**: [ReviewExecuteModal.tsx](components/liquidity/wizard/ReviewExecuteModal.tsx)
- **Description**: If page reloads mid-flow, all progress is lost. No localStorage/sessionStorage backup of approval states or pending transactions.
- **Risk**: User loses progress, must restart entire flow, wastes gas on re-approvals
- **Fix**: Persist transaction state in localStorage, restore on mount, show "resume flow" option

---

### H3. No Retry Mechanism After Signature Rejection
- [ ] **Status**: Open
- **Location**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts) → `prepareAndSignPermit()`
- **Description**: User rejection during permit signing has no retry mechanism. Must close modal and restart.
- **Risk**: Poor UX for accidental rejections
- **Fix**: Keep modal open on rejection, show "Try Again" button, preserve input state

---

### H4. No Signature Deadline Validation
- [ ] **Status**: Open
- **Location**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts) → `prepareAndSignPermit()`
- **Description**: EIP-712 deadline from API is not validated client-side before signing. Could be expired or too short.
- **Risk**: User signs expired permit, transaction fails
- **Fix**: Validate deadline > now + buffer, warn if deadline is too short

---

### H5. Position ID Extraction Has No Fallback
- [ ] **Status**: Open
- **Location**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts) → `handleDeposit()`
- **Description**: Position ID extraction relies on parsing Transfer event logs. No fallback if logs are malformed or missing.
- **Risk**: Position created but ID not captured, user can't navigate to position
- **Fix**: Add fallback query to subgraph, show "Position created, loading details..." state

---

### H6. No Confirmation Progress Callback
- [ ] **Status**: Open
- **Location**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts) → `handleDeposit()`
- **Description**: `waitForTransactionReceipt` doesn't notify UI of confirmation progress (1/12 confirmations, etc.).
- **Risk**: User sees "pending" with no progress indication, may think it's stuck
- **Fix**: Use `onReplaced` callback, show confirmation count, add "View on Explorer" link

---

### H7. Silent Token1 Skip in Zap Mode
- [ ] **Status**: Open
- **Location**: [ReviewExecuteModal.tsx](components/liquidity/wizard/ReviewExecuteModal.tsx) → `handleConfirm()`
- **Description**: Token1 approval is silently skipped when `isZapMode=true`. No UI indication of why.
- **Risk**: User confusion about why Token1 approval didn't happen
- **Fix**: Show explanatory text in zap mode, or show Token1 step as "auto-handled"

---

### H8. Zap Output Token Approval Threshold May Be Insufficient
- [ ] **Status**: Open
- **Location**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts)
- **Description**: Uses `APPROVAL_AMOUNT_THRESHOLD` (10x input) for output token approval. May be insufficient for volatile pairs with high slippage.
- **Risk**: Approval insufficient, zap transaction fails
- **Fix**: Calculate based on actual quote + max slippage, or use MaxUint256

---

## MEDIUM Issues

### M1. No Timeout on waitForTransactionReceipt
- [ ] **Status**: Open
- **Location**: [ReviewExecuteModal.tsx](components/liquidity/wizard/ReviewExecuteModal.tsx), [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts)
- **Description**: `waitForTransactionReceipt` has no timeout. Could hang indefinitely on slow networks or stuck transactions.
- **Risk**: UI hangs forever, user must force-close
- **Fix**: Add timeout (e.g., 5 minutes), show "Taking longer than expected" with options

---

### M2. Hardcoded MaxUint256 Approval Amounts
- [ ] **Status**: Open
- **Location**: [ReviewExecuteModal.tsx](components/liquidity/wizard/ReviewExecuteModal.tsx) → approval logic
- **Description**: Uses `MaxUint256` for all approvals. No option for exact amount approvals.
- **Risk**: Security concern for users who prefer minimal approvals
- **Fix**: Add setting for "Exact amount" vs "Unlimited" approvals

---

### M3. No Partial Success Recovery UI
- [ ] **Status**: Open
- **Location**: [ReviewExecuteModal.tsx](components/liquidity/wizard/ReviewExecuteModal.tsx)
- **Description**: No mechanism to resume from "Token0 approved, Token1 pending" state after failure.
- **Risk**: User must restart, wasting previous approvals
- **Fix**: Show "Resume from step X" option when partial state detected

---

### M4. Inconsistent Error Handling (throw vs return null)
- [ ] **Status**: Open
- **Location**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts) → `prepareAndSignPermit()`
- **Description**: Some errors are thrown, others return null. Calling code must handle both patterns.
- **Risk**: Unhandled errors, inconsistent behavior
- **Fix**: Standardize on throwing errors, use proper error types

---

### M5. Generic Error Messages for All Failure Types
- [ ] **Status**: Open
- **Location**: [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts)
- **Description**: All failures show same generic error toast. No differentiation between gas issues, reverts, timeouts, network errors.
- **Risk**: User can't understand what went wrong or how to fix it
- **Fix**: Parse error types, show specific messages with actionable guidance

---

### M6. Race Conditions with Double-Click and Step State
- [ ] **Status**: Open
- **Location**: [ReviewExecuteModal.tsx](components/liquidity/wizard/ReviewExecuteModal.tsx) → `handleConfirm()`
- **Description**: No debouncing on confirm button. `setCurrentStep` is async but treated as sync. Could cause duplicate submissions.
- **Risk**: Double approval transactions, wasted gas, confusing UI state
- **Fix**: Add `isSubmitting` guard, disable button during execution, debounce clicks

---

## Edge Case Scenarios

### Page Reload Behavior

| State When Reload | Current Behavior | Desired Behavior |
|-------------------|------------------|------------------|
| Mid-approval | All progress lost | Persist approved tokens in localStorage |
| After Token0, before Token1 | Token0 approval wasted | Resume from Token1 step |
| After permit signed | Permit burned, no position | Attempt recovery with same signature |
| After tx submitted | No tracking | Store txHash, show pending state on reload |

### Internet Outage Behavior

| Scenario | Current Behavior | Desired Behavior |
|----------|------------------|------------------|
| During approval tx | `waitForTransactionReceipt` hangs | Timeout with retry option |
| During permit sign | Signature completes (local) | Cache permit for later use |
| During deposit API call | Request times out | Retry with exponential backoff |
| During deposit tx | Receipt polling hangs | Show "checking status" with explorer link |

### Wallet Disconnect Behavior

| Timing | Current Behavior | Desired Behavior |
|--------|------------------|------------------|
| Before any step | `handleConfirm` throws early | Show "Connect wallet" prompt |
| Mid-approval | Transaction fails | Clean up UI state, show reconnect option |
| After permit, before deposit | Permit signed but unusable | Cache permit, prompt reconnect |

---

## Files Involved

| File | Role |
|------|------|
| [ReviewExecuteModal.tsx](components/liquidity/wizard/ReviewExecuteModal.tsx) | Main orchestration, step tracking, approval execution |
| [useAddLiquidityTransaction.ts](lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts) | Permit signing, deposit execution, position ID extraction |
| [types.ts](lib/transactions/types.ts) | Step builders, step type definitions |
| [prepare-mint-tx.ts](pages/api/liquidity/prepare-mint-tx.ts) | API endpoint for transaction building |
| [prepare-zap-mint-tx.ts](pages/api/liquidity/prepare-zap-mint-tx.ts) | API endpoint for zap transaction building |

---

## Fix Priority Order

1. **C1** - Gas estimation (prevents most wasted transactions)
2. **M6** - Race conditions (prevents duplicate submissions)
3. **H1** - User rejection detection (quick win, better UX)
4. **H2** - State persistence (prevents lost progress)
5. **C4** - Rollback mechanism (builds on H2)
6. **C2/C3/C5** - Permit handling (complex, interdependent)
7. **Remaining HIGH issues**
8. **Remaining MEDIUM issues**

---

## Notes

- Uniswap reference implementations are in `interface/packages/uniswap/src/features/transactions/`
- Key patterns to study:
  - Gas estimation: `useTransactionRequestInfo.ts`
  - State persistence: `TransactionFlowProvider.tsx`
  - Permit recovery: `steps/increasePosition.ts`
  - Error handling: `transactionSagaHelpers.ts`

---

*Last Updated: January 2026*
