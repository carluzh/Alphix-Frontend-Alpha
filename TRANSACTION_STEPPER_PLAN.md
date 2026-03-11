# Unified Transaction Stepper — Refactor Plan

## Goal

Every user interaction flows through the same transaction stepper. One executor, one store, one modal shell, one error handling path. Different flows provide different steps and review content — everything else is shared.

## What We Have Today

```
ReviewExecuteModal.tsx  → useLiquidityStepExecutor  → executionStore (Zustand, lock-based)
IncreaseLiquidityReview → useLiquidityStepExecutor  → 5x local useState (no store)
DecreaseLiquidityReview → useLiquidityStepExecutor  → 5x local useState (no store)
CollectFeesModal        → useLiquidityStepExecutor  → 5x local useState (no store)
SwapExecuteModal        → useSwapStepExecutor       → local SwapExecutorState (separate system)
```

**Duplication per flow:** ~200-300 LOC of identical execution state, error handling, and ProgressIndicator rendering logic.

## What We Already Built (Phase 3 wizard refactor)

- `executionStore.ts` — Zustand store, lock-based ownership, authoritative execution truth
- `useReviewModalState.ts` — useReducer for UI-only modal state (view, error, preview)
- `mapExecutorStepsToUI.ts` — pure step mapping function
- `ReviewComponents.tsx` — shared ErrorCallout, TokenInfoRow, DoubleCurrencyLogo
- `ProgressIndicator` — shared step progress UI

These become the foundation for the unified system.

## Target Architecture: 4 Layers

```
┌─────────────────────────────────────────────────────────┐
│  Layer 4: <TransactionModal>                            │
│  Shared shell: Dialog + header + ProgressIndicator +    │
│  ErrorCallout + button. Each flow provides review       │
│  content via render prop.                               │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Flow Definitions (~50-100 LOC each)           │
│  useSwapFlow, useCreatePositionFlow, useIncreaseFlow,   │
│  useDecreaseFlow, useCollectFeesFlow, useZapFlow        │
│  Each defines: generateSteps + executors map + review   │
├─────────────────────────────────────────────────────────┤
│  Layer 2: useStepExecutor (generic orchestrator)        │
│  executionStore (Zustand) + step loop + cancellation +  │
│  error classification + ProgressIndicator integration   │
├─────────────────────────────────────────────────────────┤
│  Layer 1: Execution Primitives                          │
│  executeApproval, executePermitSign, sendTransaction,   │
│  fetchPermitData — pure async, no React state           │
└─────────────────────────────────────────────────────────┘
```

### Layer 1 — Execution Primitives (`lib/transactions/primitives.ts`)

Pure async functions. No React. Take hook references as parameters. Testable.

```ts
executeApproval(params: {
  token: Address;
  spender: Address;          // Permit2, KyberRouter, or Hook address
  amount: bigint;
  sendTx: WriteContractFn;
  publicClient: PublicClient;
  addTransaction: TransactionAdder;
  chainId: number;
}): Promise<Hash>

executePermitSign(params: {
  permitData: { domain, types, message };
  signTypedDataAsync: SignFn;
}): Promise<Hex>

executeTransaction(params: {
  to: Address;
  data: Hex;
  value?: bigint;
  sendTransaction: SendTransactionFn;
  waitForReceipt: WaitFn;
  addTransaction: TransactionAdder;
  chainId: number;
  txInfo: TransactionInfo;
}): Promise<Hash>

fetchPermitData(params: {
  userAddress: string;
  token: Address;
  amount: bigint;
  chainId: number;
  approvalMode: 'exact' | 'infinite';
}): Promise<PreparePermitResponse>
```

**Source:** Extract from `useLiquidityStepExecutor` handlers + `useSwapStepExecutor` callbacks. Already cleanly separated as useCallback functions — just move out and parameterize hook references.

### Layer 2 — Generic Step Orchestrator (`lib/transactions/useStepExecutor.ts`)

Single hook that runs any step sequence. Replaces both `useLiquidityStepExecutor` and `useSwapStepExecutor`.

```ts
interface UseStepExecutorConfig {
  /** Map of step type → executor function */
  executors: Record<string, (step: TransactionStep) => Promise<StepResult>>;
  /** Called on full completion */
  onComplete?: (lastTxHash?: string) => void;
  /** Called on failure */
  onFailure?: (error: Error) => void;
}

interface StepResult {
  txHash?: string;
  signature?: string;
}

function useStepExecutor(config: UseStepExecutorConfig): {
  execute: (steps: TransactionStep[], preCompleted?: Set<number>) => Promise<void>;
  state: ExecutionState;        // From executionStore
  reset: () => void;
  currentStep: StepState | undefined;
}
```

**Built on:** `executionStore` (already exists). The orchestrator:
- Calls `startExecution()` to acquire lock
- Iterates steps, skips pre-completed ones (swap's optimization, generalized)
- Dispatches to `executors[step.type]` (registry pattern)
- Updates store via `completeStep`/`failStep`
- Classifies errors: `isUserRejectionError` → onFailure with rejection flag
- Handles cancellation via ref + lock validation
- Releases lock on completion/failure/cancel

### Layer 3 — Flow Definitions (~50-100 LOC each)

Each flow only defines WHAT to do, not HOW.

```ts
// Example: useSwapFlow
function useSwapFlow(trade: SwapTrade) {
  const { sendTransaction, ... } = useWagmiHooks();

  const generateSteps = useCallback(async () => {
    if (isETH(trade.inputToken)) return { steps: [swapStep], preCompleted: new Set() };
    const approval = await checkAllowance(...);
    const permit = await fetchPermitData(...);
    return {
      steps: [approvalStep, permitStep, swapStep].filter(Boolean),
      preCompleted: approval.sufficient ? new Set([0]) : new Set(),
    };
  }, [trade]);

  const executors = useMemo(() => ({
    [TransactionStepType.TokenApprovalTransaction]: (step) =>
      executeApproval({ token: step.token, spender: step.spender, sendTx, ... }),
    [TransactionStepType.Permit2Signature]: (step) =>
      executePermitSign({ permitData: step.permitData, signTypedDataAsync }),
    [TransactionStepType.SwapTransaction]: (step) =>
      executeSwapTransaction({ trade, source, ... }),
  }), [sendTx, signTypedDataAsync, trade]);

  return { generateSteps, executors };
}
```

**Flows to create:**
| Flow | File | Steps |
|------|------|-------|
| Swap (Alphix + Kyber) | `useSwapFlow.ts` | approval? → permit? → swap |
| Create Position | `useCreatePositionFlow.ts` | approval(s)? → permit? → mint |
| Increase Liquidity | `useIncreaseFlow.ts` | approval(s)? → permit? → increase |
| Decrease Liquidity | `useDecreaseFlow.ts` | decrease (single step) |
| Collect Fees | `useCollectFeesFlow.ts` | collect (single step) |
| Zap Deposit | `useZapFlow.ts` | approval? → swap → approval? → deposit |
| UY Deposit | `useUYDepositFlow.ts` | approval? → deposit |
| UY Withdraw | `useUYWithdrawFlow.ts` | withdraw (single step) |

### Layer 4 — Shared TransactionModal (`components/transactions/TransactionModal.tsx`)

One modal shell used by ALL flows. Each flow provides:
- **Review content** (render prop) — the token amounts, price display, etc.
- **Flow definition** (from Layer 3) — step generation + executors
- **Config** — title, confirm button text, success behavior

```tsx
interface TransactionModalProps {
  open: boolean;
  onClose: () => void;
  /** Modal title in review state */
  title: string;
  /** Title during execution */
  executingTitle?: string;
  /** Button text */
  confirmText: string;
  /** Whether confirm is disabled (flow-specific validation) */
  confirmDisabled?: boolean;
  /** The review content — unique per flow */
  children: React.ReactNode;
  /** Flow definition: step generation + executors */
  flow: {
    generateSteps: () => Promise<{ steps: TransactionStep[]; preCompleted?: Set<number> }>;
    executors: Record<string, (step: TransactionStep) => Promise<StepResult>>;
  };
  /** Pre-execution hook (chain switching, quote refresh, etc.) */
  onBeforeExecute?: () => Promise<boolean>;
  /** What happens on success */
  onSuccess?: (txHash?: string) => void;
  /** Success behavior: 'close' (default) | 'navigate' | 'show' */
  successBehavior?: 'close' | 'navigate' | 'show';
  /** If successBehavior is 'navigate', where to go */
  successNavigateTo?: string;
  /** If successBehavior is 'show', render success content */
  renderSuccess?: (txHash: string) => React.ReactNode;
  /** Optional back button — presence enables 2-column button layout */
  onBack?: () => void;
  /** Extra content rendered below ProgressIndicator during execution (e.g., zap countdown) */
  renderExecutingExtra?: React.ReactNode;
}
```

**The modal manages:**
- View state machine: review → executing → success (via `useReviewModalState`, generalized)
- ProgressIndicator rendering (when executing + steps available)
- ErrorCallout rendering (on failure, with retry)
- Confirm button with disabled state (isExecuting || view === 'executing' || confirmDisabled)
- Close prevention during execution
- Button layout: single column (default) or 2-column grid (when `onBack` provided)
- Step display metadata read directly from steps (no separate mapper needed)

**Consumer usage:**
```tsx
// SwapExecuteModal becomes ~40 LOC:
function SwapExecuteModal({ trade, open, onClose }) {
  const flow = useSwapFlow(trade);

  return (
    <TransactionModal
      open={open}
      onClose={onClose}
      title="Review Swap"
      executingTitle="Swapping"
      confirmText="Swap"
      flow={flow}
      onBeforeExecute={() => refreshQuote(trade)}
      onSuccess={(hash) => { toast.success('Swap complete'); onClose(); }}
    >
      <SwapReviewContent trade={trade} />
    </TransactionModal>
  );
}

// CollectFeesModal becomes ~30 LOC:
function CollectFeesModal({ position, open, onClose }) {
  const flow = useCollectFeesFlow(position);

  return (
    <TransactionModal
      open={open}
      onClose={onClose}
      title="Collect Fees"
      confirmText="Collect"
      confirmDisabled={!hasFees}
      flow={flow}
      onSuccess={() => { onClose(); }}
    >
      <CollectFeesReviewContent position={position} />
    </TransactionModal>
  );
}
```

## Migration Plan (5 Phases)

### Phase 1: Extract Primitives
**Goal:** Create `lib/transactions/primitives.ts` with shared async functions.
**Work:**
- Extract `executeApproval` from liquidity handlers + swap executor
- Extract `executePermitSign` from both
- Extract `executeTransaction` (generic send + wait + track)
- Keep `fetchPermitData`, `fetchBuildTx` from `swap-execution-common.ts`
- Unit test primitives if feasible

**Files created:** `lib/transactions/primitives.ts`
**Files modified:** None yet (primitives are new, old code untouched)
**Risk:** None — additive only

### Phase 2: Generic Step Orchestrator
**Goal:** Create `lib/transactions/useStepExecutor.ts` that replaces both executors.
**Work:**
- Generalize `executionStore` if needed (should work as-is)
- Build `useStepExecutor` hook with registry-based dispatch
- Add pre-completed step skipping (from swap executor)
- Add unified error classification
- Keep backward-compat: old executors can wrap the new one

**Files created:** `lib/transactions/useStepExecutor.ts`
**Files modified:** `executionStore.ts` (minor, if any)
**Risk:** Low — new hook, old executors still work

### Phase 3: TransactionModal Shell
**Goal:** Create `components/transactions/TransactionModal.tsx`.
**Work:**
- Build the shared modal with render prop pattern
- Integrate `useStepExecutor` + `useReviewModalState` + `ProgressIndicator` + `ErrorCallout`
- Support all success behaviors (close, navigate, show success view)
- Support `onBeforeExecute` for chain switching / quote refresh
- Test with one simple flow first (CollectFees — fewest steps)

**Files created:** `components/transactions/TransactionModal.tsx`
**Risk:** Low — new component, no migration yet

### Phase 4: Migrate Flows (one at a time)
**Goal:** Migrate each existing modal to use TransactionModal + flow definition.
**Order** (simplest → most complex):
1. **CollectFeesModal** — single step, no success view, simplest flow
2. **DecreaseLiquidityReview** — single step, has success view
3. **IncreaseLiquidityReview** — multi-step with permit flow
4. **SwapExecuteModal** — multi-step with quote refresh
5. **ReviewExecuteModal** — most complex (V4 + UY + Zap modes)

**Per migration:**
- Create flow definition hook (`useCollectFeesFlow.ts`, etc.)
- Rewrite modal as thin wrapper around `<TransactionModal>`
- Delete old execution state management from the component
- Verify behavior matches (manual test)

**Files created:** One flow hook per migration
**Files modified:** One modal per migration
**Files deleted:** Eventually `useLiquidityStepExecutor.ts`, `useSwapStepExecutor.ts`, `useSwapExecution.ts`

### Phase 5: Cleanup
**Goal:** Remove all old execution infrastructure.
**Work:**
- Delete `useLiquidityStepExecutor.ts` (replaced by `useStepExecutor`)
- Delete `useSwapStepExecutor.ts` (replaced by `useStepExecutor` + `useSwapFlow`)
- Delete `useSwapExecution.ts` (legacy, already deprecated)
- Delete `useStepBasedLiquidity.ts` (wrapper around old executor)
- Clean up `executor/handlers/` — move reusable parts to primitives, delete rest
- Update barrel exports
- Final LOC count comparison

## Expected Result

| Component | Before (LOC) | After (LOC) |
|-----------|-------------|-------------|
| `lib/transactions/primitives.ts` | — | ~150 (new, shared) |
| `lib/transactions/useStepExecutor.ts` | — | ~150 (new, generic) |
| `components/transactions/TransactionModal.tsx` | — | ~200 (new, shared shell) |
| `useSwapExecution.ts` | 644 | **deleted** |
| `useSwapStepExecutor.ts` | 770 | **deleted** |
| `useLiquidityStepExecutor.ts` | 545 | **deleted** |
| `SwapExecuteModal.tsx` | ~400 | ~60 (thin wrapper) |
| `ReviewExecuteModal.tsx` | ~1200 | ~80 (thin wrapper) |
| `IncreaseLiquidityReview.tsx` | ~450 | ~80 (thin wrapper) |
| `DecreaseLiquidityReview.tsx` | ~400 | ~80 (thin wrapper) |
| `CollectFeesModal.tsx` | ~350 | ~50 (thin wrapper) |
| Flow definitions (8 total) | — | ~600 (new, 75 avg each) |

**Net:** ~4,750 LOC → ~1,450 LOC. Elimination of ~3,300 LOC of duplicated execution logic.

## Key Design Decisions

1. **Primitives are NOT hooks.** Pure async functions with hook refs as params. Testable, reusable.
2. **The orchestrator IS a hook** (manages execution state). But it's generic — zero flow-specific logic.
3. **TransactionModal owns the UI state machine.** Flows never manage view/error/steps directly.
4. **Flow definitions own step generation.** Only the flow knows what steps are needed.
5. **Error handling is centralized** in the orchestrator. `isUserRejectionError` + Sentry + toast — once.
6. **Pre-completed step skipping** is generalized from the swap executor to all flows.
7. **executionStore stays** — it's already the right abstraction (Zustand, lock-based, proven).
8. **`onBeforeExecute`** handles flow-specific pre-work (chain switching, quote refresh, permit fetching).

## Resolved Design Decisions

1. **Success view:** `successBehavior: 'close' | 'navigate' | 'show'` + `renderSuccess` prop. Increase/Decrease use `'show'` with their custom success content. Others use `'close'`.
2. **Executing extras:** `renderExecutingExtra?: ReactNode` slot below ProgressIndicator. Only zap uses it (countdown timer).
3. **Back button:** `onBack?: () => void` prop. Present = 2-column grid (Back + Confirm). Absent = single button.
4. **Step display metadata:** Each `TransactionStep` carries its own `label`, `icon`, `subtitle` for UI rendering. No separate `mapExecutorStepsToUI` needed — ProgressIndicator reads directly from step metadata. This eliminates per-flow mapper functions entirely.

## Intern's Brief Alignment

The intern's `EXECUTION_REFACTOR_BRIEF.md` covers Layers 1-3 accurately. Their "3 layers" map to our Layers 1-3. We add Layer 4 (TransactionModal) for the full Option C experience. Their LOC estimates are conservative — with the shared modal, savings are even larger.

Their migration path (primitives → orchestrator → rewrite swap → migrate liquidity) aligns with our Phase 1-4, but we add Phase 3 (TransactionModal) between orchestrator and migration, and we migrate in complexity order rather than by domain.
