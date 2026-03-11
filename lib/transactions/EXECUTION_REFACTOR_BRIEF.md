# Transaction Execution Refactor Brief

## Problem

Every transaction flow (swap, zap, add/remove/increase liquidity, collect fees) re-implements the same execution primitives: token approval, Permit2 signing, error handling, Redux tracking, and cache invalidation. This creates ~300 lines of duplication per flow and makes changes error-prone (e.g., a Kyberswap error handling fix must be applied in multiple places).

## Current State

```
swap-interface.tsx        → useSwapExecution.ts        (644 LOC, state machine)
SwapExecuteModal.tsx      → useSwapStepExecutor.ts     (770 LOC, step loop)
IncreaseLiquidityReview   → inline execution           (approval + tx)
DecreaseLiquidityReview   → inline execution           (approval + tx)
CollectFeesModal          → inline execution            (approval + tx)
Liquidity wizard          → useLiquidityStepExecutor   (step loop)
```

Partial extraction done: `lib/swap/swap-execution-common.ts` (300 LOC) now holds shared types, body builder, build-tx fetch, transaction sending, and Redux tracking info. Both swap executors import from it.

Still duplicated across flows:
- Token approval (send tx → wait receipt → toast → track in Redux): ~45 lines each
- Permit2 signature (build message → sign → validate → toast): ~40 lines each
- fetchPermitData (POST to /api/swap/prepare-permit): ~30 lines each
- Error classification + Sentry + toast: ~30 lines each

## Target Architecture: 3 Layers

### Layer 1 — Execution Primitives (`lib/transactions/primitives.ts`)

Pure async functions. No React state. Take hook references as parameters.

```ts
// Token approval (ERC20 → spender)
executeApproval(params: {
  token: Address
  spender: Address        // Permit2 for Alphix, KyberRouter for Kyberswap
  amount: bigint
  sendTx: WriteContractFn
  publicClient: PublicClient
  addTransaction: TransactionAdder
  chainId: number
}): Promise<Hash>

// Permit2 signature
executePermitSign(params: {
  permitData: PermitData
  signTypedDataAsync: SignFn
}): Promise<Hex>

// Fetch permit data from server
fetchPermitData(params: {
  userAddress: string
  token: Address
  tokenSymbol: string
  toTokenSymbol: string
  amount: bigint
  chainId: number
  approvalMode: "exact" | "infinite"
}): Promise<PreparePermitResponse>

// Already extracted in swap-execution-common.ts:
fetchBuildTx(body): Promise<BuildTxResult>
sendSwapTransaction(params): Promise<Hash>
buildSwapTransactionInfo(params): TransactionInfo
invalidateSwapCache(params): Promise<void>
```

### Layer 2 — Step Orchestrator (`lib/transactions/useStepExecutor.ts`)

Single generic hook that runs any sequence of steps.

```ts
type StepExecutor = (step: TransactionStep) => Promise<void>

useStepExecutor(config: {
  generateSteps: () => Promise<{ steps: TransactionStep[], preCompleted: Set<number> }>
  executors: Record<TransactionStepType, StepExecutor>
  onComplete?: () => void
}): {
  execute: () => Promise<void>
  state: ExecutorState       // steps[], currentStepIndex, status, error
  reset: () => void
  currentStep: CurrentStepState | undefined  // for ProgressIndicator
}
```

The orchestrator handles:
- Step generation with pre-completion detection
- Sequential execution with per-step status tracking
- Cancellation via ref
- Error classification (user rejection vs other) with Sentry + toast
- ProgressIndicator integration

### Layer 3 — Flow Definitions (~50-100 LOC each)

Each flow only defines WHAT steps to generate and WHAT params to pass.

```ts
// Swap flow
useSwapExecutor(args) {
  const generateSteps = () => {
    if (isETH) return [swapStep]
    if (isKyberswap) return [approvalStep?, swapStep]
    return [approvalStep?, permitStep?, swapStep]
  }

  const executors = {
    [TokenApproval]: () => executeApproval({ spender, token, ... }),
    [Permit2Signature]: () => executePermitSign({ permitData, ... }),
    [SwapTransaction]: () => executeSwapTransaction({ source, trade, ... }),
  }

  return useStepExecutor({ generateSteps, executors })
}

// Add liquidity flow — same pattern
useAddLiquidityExecutor(args) {
  const generateSteps = () => [approveToken0?, approveToken1?, permitStep?, addStep]
  const executors = { ... }
  return useStepExecutor({ generateSteps, executors })
}

// Zap flow — same pattern
useZapExecutor(args) {
  const generateSteps = () => [approveStep?, swapStep, addStep]
  const executors = { ... }
  return useStepExecutor({ generateSteps, executors })
}
```

## Migration Path

1. **Extract remaining primitives** from `useSwapStepExecutor.ts` into `lib/transactions/primitives.ts`: `executeApproval`, `executePermitSign`, `fetchPermitData`. These are already cleanly separated as `useCallback` functions — just move them out and parameterize the hook references.

2. **Generalize the step orchestrator.** The `execute()` loop in `useSwapStepExecutor.ts` (lines 754-930) is already flow-agnostic. Extract it into `useStepExecutor` by replacing the hardcoded `if (step.type === ...)` dispatch with an `executors` map lookup.

3. **Rewrite `useSwapStepExecutor`** as a thin wrapper: step generation + `fetchFreshAlphixQuote` + `useStepExecutor`. Target: ~100 LOC.

4. **Migrate `swap-interface.tsx`** from `useSwapExecution` to the step executor. The state machine in `useSwapExecution` (handleSwap checks readiness, then handleConfirmSwap executes each phase) maps directly to the step pattern. Once migrated, delete `useSwapExecution.ts` entirely (saves 644 LOC).

5. **Migrate liquidity flows** one at a time. Each inline execution (IncreaseLiquidityReview, DecreaseLiquidityReview, CollectFeesModal) becomes a flow definition using the same orchestrator.

## Expected Result

| Component | Before | After |
|-----------|--------|-------|
| `lib/transactions/primitives.ts` | — | ~150 LOC (new, shared) |
| `lib/transactions/useStepExecutor.ts` | — | ~120 LOC (new, generic) |
| `swap-execution-common.ts` | 300 LOC | stays (body builder + types) |
| `useSwapExecution.ts` | 644 LOC | **deleted** |
| `useSwapStepExecutor.ts` | 770 LOC | ~100 LOC |
| Each liquidity flow | ~200-300 LOC inline | ~80 LOC flow definition |

Net elimination: ~1000+ LOC of duplicated execution logic across all flows, replaced by ~270 LOC of shared infrastructure.

## Key Design Decisions

- **Primitives are NOT hooks.** They're plain async functions that receive hook references as params. This makes them testable and reusable outside React.
- **The orchestrator IS a hook** because it manages React state (step statuses, current index). But it's generic — no flow-specific logic.
- **Flow definitions own step generation.** Only the flow knows what steps are needed (does this token need approval? is Permit2 required? is this a zap?).
- **Error handling lives in the orchestrator**, not in each flow. `classifySwapError` + Sentry + toast is identical everywhere — no reason to repeat it.
- **ProgressIndicator integration** comes free from the orchestrator. Every flow gets step-by-step UI progress without extra work.
