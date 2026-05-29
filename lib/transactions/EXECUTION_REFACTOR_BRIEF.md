# Transaction Execution Refactor Brief

## Problem

Every transaction flow (swap, add/increase/decrease liquidity, collect fees) used to re-implement the same execution primitives: token approval, Permit2 signing, error handling, Redux tracking, and cache invalidation. This created ~300 lines of duplication per flow and made changes error-prone (e.g., a Kyberswap error handling fix had to be applied in multiple places).

## Target Architecture: 3 Layers

### Layer 1 — Execution Primitives

Pure async helpers. No React state. Take hook references as parameters.

- `lib/swap/swap-execution-common.ts` — shared swap helpers (`buildSwapRequestBody`, `fetchBuildTx`, `sendSwapTransaction`, `buildSwapTransactionInfo`, `invalidateSwapCache`).
- `lib/transactions/flows/executeBatchedIncrease.ts` — pure EIP-5792 batched-increase core.
- Liquidity step handlers live under `lib/liquidity/transaction/executor/handlers/`.

### Layer 2 — Step Orchestrator (`lib/transactions/useStepExecutor.ts`)

Single generic hook that runs any sequence of steps.

```ts
type StepExecutorFn = (step: any, ctx: StepExecutionContext) => Promise<StepResult>

useStepExecutor(config: {
  executors: Record<string, StepExecutorFn>
  onComplete?: (results: Map<number, StepResult>) => void
  onFailure?: (err: Error, idx: number, isRejection: boolean) => void
  onStepComplete?: (idx: number, result: StepResult) => void
})
```

The orchestrator handles:

- Lock-based execution via `executionStore` (Zustand)
- Pre-completed step skipping
- Sequential execution with per-step status tracking
- Cancellation via ref + lock validation
- Centralized error classification (user rejection vs real errors) with Sentry tagging
- Signature/data forwarding between steps via `StepExecutionContext`

### Layer 3 — Flow Definitions (`lib/transactions/flows/`)

Each flow defines WHAT steps to generate and WHAT params to pass.

- `useSwapFlow.ts` — Alphix pool swap + Kyberswap aggregator (approval? → permit? → swap).
- `useDecreaseLiquidityFlow.ts` — single-step decrease/withdraw (V4 + UY).
- `useCollectFeesFlow.ts` — single-step collect.
- `useIncreaseLiquidityFlow.ts` — multi-step increase (approvals → permit → increase). Currently superseded by `useLiquidityExecutors` in production modals; retained as a self-contained alternative.
- `useExecutorBridge.ts` + `useLiquidityExecutors.ts` — bridges the registry-based liquidity step handlers (`lib/liquidity/transaction/executor/handlers/`) into the `StepExecutorFn` interface for all liquidity domain step types.

## Step Types

The single source of truth for transaction step kinds is `lib/transactions/types.ts` (`TransactionStepType`). Liquidity-domain step kinds (e.g. `IncreasePositionTransactionBatchedAsync`, `UnifiedYieldDepositTransaction`) live in `lib/liquidity/types/transaction.ts` and are bridged through `useExecutorBridge`.

## Key Design Decisions

- **Primitives are NOT hooks.** They're plain async functions that receive hook references as params. This makes them testable and reusable outside React.
- **The orchestrator IS a hook** because it manages React state (step statuses, current index). But it's generic — no flow-specific logic.
- **Flow definitions own step generation.** Only the flow knows what steps are needed (does this token need approval? is Permit2 required?).
- **Error handling lives in the orchestrator**, not in each flow. `isUserRejectionError` + Sentry + classifier is identical everywhere — no reason to repeat it.
- **ProgressIndicator integration** comes free from the orchestrator. Every flow gets step-by-step UI progress without extra work.
