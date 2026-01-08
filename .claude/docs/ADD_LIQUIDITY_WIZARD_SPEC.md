# Add Liquidity Wizard - Implementation Specification

> **For**: Intern implementation
> **Goal**: Create a Uniswap-style multi-step Add Liquidity flow with Alphix customizations

---

## Overview

Build a wizard-style Add Liquidity flow that can be launched from multiple entry points. The flow should match Uniswap's UX patterns while adding Alphix-specific features (Rehypothecation option vs Concentrated Liquidity).

---

## User Flow

### Entry Points

| Entry Point | Skip Steps | Notes |
|-------------|------------|-------|
| Pool Detail Page (right sidebar) | Token Selection, LP Option | Pool already known |
| Overview Page | None | Full wizard |
| Pools List (future) | None | Full wizard |

### Step Sequence

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: TOKEN SELECTION (skip if from pool page)              │
│  - Select token0 and token1                                    │
│  - Auto-detect available pools for pair                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 2: LP OPTION SELECTION (skip if from pool page)          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  CARD (Recommended): Rehypothecation Mode               │   │
│  │  - Preset range (full range for now)                    │   │
│  │  - Earns from Aave rehypothecation                      │   │
│  │  - Higher yield, simpler UX                             │   │
│  │  - Visually emphasized                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ROW (Advanced): Concentrated Liquidity                  │   │
│  │  - Custom range selection                                │   │
│  │  - Standard CLMM experience                             │   │
│  │  - For experienced LPs                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 3: RANGE SELECTION (Concentrated mode only)              │
│  - Preset buttons (±15%, ±8%, ±3%, Full Range)                 │
│  - OR custom range modal                                        │
│  - Skip entirely for Rehypo mode (use preset range)            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 4: AMOUNT INPUT                                          │
│  - Two token inputs OR single-token zap                        │
│  - Balance display + MAX buttons                               │
│  - Real-time dependent amount calculation                      │
│  - APR estimate display                                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 5: REVIEW & CONFIRM                                      │
│  - Position summary                                            │
│  - Token amounts with USD values                               │
│  - Gas estimate                                                │
│  - APR breakdown (Pool APR + Aave yield if Rehypo)            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  STEP 6: TRANSACTION EXECUTION                                 │
│  - Approval steps (ERC20 → Permit2)                           │
│  - Permit signature                                            │
│  - Transaction execution                                       │
│  - Success/failure feedback                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Files to Study

### Uniswap Reference (interface/)

| File | Purpose |
|------|---------|
| `interface/apps/web/src/pages/CreatePosition/CreatePosition.tsx` | Main page orchestrator |
| `interface/apps/web/src/pages/CreatePosition/CreateLiquidityContextProvider.tsx` | Centralized form state context |
| `interface/apps/web/src/components/Liquidity/Create/SelectTokenStep.tsx` | Token + fee selection step |
| `interface/apps/web/src/components/Liquidity/Create/RangeSelectionStep.tsx` | Range selection UI |
| `interface/apps/web/src/components/Liquidity/Create/FormWrapper.tsx` | Multi-step form + progress indicator |
| `interface/apps/web/src/components/Liquidity/ReviewModal.tsx` | Review/confirm modal |

### Current Alphix Implementation

| File | Purpose |
|------|---------|
| `components/liquidity/AddLiquidityForm.tsx` | Current monolithic form (1,451 lines) - **to be refactored** |
| `lib/liquidity/hooks/transaction/useAddLiquidityTransaction.ts` | Transaction execution - **reuse as-is** |
| `lib/liquidity/hooks/transaction/useAddLiquidityCalculation.ts` | Amount calculation - **reuse as-is** |
| `components/liquidity/TransactionFlowPanel.tsx` | Step-based transaction UI - **reuse as-is** |
| `pages/api/liquidity/prepare-mint-tx.ts` | Backend mint transaction - **no changes needed** |
| `pages/api/liquidity/prepare-zap-mint-tx.ts` | Backend zap transaction - **no changes needed** |

### Configuration

| File | Purpose |
|------|---------|
| `lib/pools-config.ts` | Pool metadata (tokens, fees, tickSpacing) |
| `config/pools.json` | Pool configuration data |

### Yield/APR Patterns (for Rehypo display)

| File | Purpose |
|------|---------|
| `lib/apr.ts` | APR calculations |
| `components/liquidity/PointsCampaign/` | Template for boosted yield display |
| `components/liquidity/FeeStats/LiquidityPositionFeeStats.tsx` | Fee stats pattern |

---

## Architecture

### State Management

Create a centralized context following Uniswap's pattern:

```typescript
// New file: lib/liquidity/context/AddLiquidityContext.tsx

interface AddLiquidityState {
  // Step tracking
  currentStep: WizardStep;

  // Token selection
  token0: Token | null;
  token1: Token | null;
  poolId: string | null;

  // LP mode
  mode: 'rehypo' | 'concentrated';

  // Range (concentrated mode only)
  tickLower: number | null;
  tickUpper: number | null;
  isFullRange: boolean;

  // Amounts
  amount0: string;
  amount1: string;
  inputSide: 'token0' | 'token1';
  isZapMode: boolean;

  // Derived data (from hooks)
  dependentAmount: string;
  estimatedApr: number | null;
}

enum WizardStep {
  TOKEN_SELECTION = 0,
  LP_OPTION = 1,
  RANGE_SELECTION = 2,
  AMOUNT_INPUT = 3,
  REVIEW = 4,
  EXECUTING = 5,
}
```

### Component Structure

```
components/liquidity/wizard/
├── AddLiquidityWizard.tsx          # Main orchestrator
├── AddLiquidityContext.tsx         # State context
├── steps/
│   ├── TokenSelectionStep.tsx      # Step 1
│   ├── LPOptionStep.tsx            # Step 2 (Card + Row)
│   ├── RangeSelectionStep.tsx      # Step 3 (reuse existing modal)
│   ├── AmountInputStep.tsx         # Step 4
│   ├── ReviewStep.tsx              # Step 5
│   └── ExecutingStep.tsx           # Step 6 (wraps TransactionFlowPanel)
├── shared/
│   ├── WizardProgress.tsx          # Step indicator
│   ├── WizardNavigation.tsx        # Next/Back buttons
│   └── SelectedTokensChip.tsx      # Shows selected pair (like Uniswap EditStep)
└── hooks/
    └── useWizardNavigation.ts      # Step navigation logic
```

---

## Implementation Notes

### What to Reuse (Don't Rewrite)

1. **All transaction hooks** - `useAddLiquidityTransaction`, `useAddLiquidityCalculation`
2. **All approval hooks** - `useCheckMintApprovals`, `useCheckZapApprovals`
3. **TransactionFlowPanel** - Already handles multi-step transaction display
4. **API endpoints** - No backend changes needed
5. **Range calculation utilities** - `calculateTicksFromPercentage`

### What to Extract from AddLiquidityForm.tsx

The current form has good logic mixed with presentation. Extract:

1. **Range preset logic** (lines 98-105) → Move to context
2. **Amount calculation integration** → Keep hook usage, move to step component
3. **OOR detection** → Move to shared utility
4. **Zap mode logic** → Move to context

### Rehypothecation Mode Specifics

Since Aave hook is in development:

1. **For now**: Treat as full-range position
2. **UI**: Show "Earns from Aave" badge with coming soon indicator
3. **Future**: `pools-config.ts` will have preset range per pool
4. **APR display**: Prepare for dual APR (Pool + Aave) using PointsCampaign pattern

### Deposit Options

Both modes support:
- **Balanced deposit**: User provides both tokens
- **Zap (single-sided)**: User provides one token, system swaps to balance

---

## Visual Guidelines

### LP Option Selection (Step 2)

```
┌────────────────────────────────────────────────────────┐
│  ⭐ RECOMMENDED                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  🔄 Rehypothecation Mode                         │ │
│  │                                                   │ │
│  │  Earn enhanced yield through Aave integration    │ │
│  │  • Preset optimal range                          │ │
│  │  • Higher APY potential                          │ │
│  │  • Set and forget                                │ │
│  │                                                   │ │
│  │  Estimated APY: 12.5% ────────────────────────── │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │  📊 Concentrated Liquidity                       │ │
│  │  Custom range for experienced LPs                │ │
│  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

- **Top card**: Gradient border animation (like APR card in pool detail)
- **Bottom row**: Subtle, muted styling
- **Clear yield advantage** displayed on top card

---

## Testing Checklist

- [ ] Can launch from Pool Detail page (skips steps 1-2)
- [ ] Can launch from Overview page (full flow)
- [ ] Token selection works with search
- [ ] LP option selection persists across navigation
- [ ] Range selection works (concentrated mode)
- [ ] Amount inputs calculate dependent amounts correctly
- [ ] Zap mode works (single-token deposit)
- [ ] Review shows all position details
- [ ] Transaction flow handles approvals correctly
- [ ] Success callback triggers position refresh
- [ ] Error handling at each step

---

## Questions for Clarification

Before starting, confirm with the team:

1. Should the wizard be a modal or a full page?
2. URL state syncing (like Uniswap) or local state only?
3. Animation preferences for step transitions?
4. Mobile layout for wizard steps?
