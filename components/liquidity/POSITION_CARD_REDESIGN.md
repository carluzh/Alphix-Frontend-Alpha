# Position Card Redesign - Implementation Guide

## Overview

This redesign transforms the position card from a detailed, large card (~320px) to a compact card (~140px) with nested modals for detailed information and actions.

## Architecture

```
PositionCardCompact.tsx        → Compact card (140px height)
    ↓ (click)
PositionDetailsModal.tsx        → Full position details + action buttons
    ↓ (click "Add Liquidity" or "Withdraw")
NestedModalManager.tsx          → Side-by-side modal system
    ↓ (renders)
AddLiquidityForm / WithdrawModal → Your existing modals
```

## New Components

### 1. **PositionCardCompact.tsx**
- **Height**: ~140px (compact design)
- **Top Section**: Token icons, pair name, status badge, total USD value, three-dot menu
- **Footer Section**: APR, Fees (left) | Status indicator (right)
- **Click Behavior**: Opens Position Details Modal
- **Three-Dot Menu**: Only "Pool Info" (other actions moved to modal)

### 2. **PositionDetailsModal.tsx**
- **Trigger**: Clicking anywhere on PositionCardCompact
- **Layout**: Blurred backdrop (like RangeSelectionModalV2)
- **Sections**:
  - Token pair with status
  - Position Overview (total value, token amounts, price range)
  - Fees & Earnings (APR, unclaimed fees, fee breakdown, "Claim Fees" button)
  - Actions ("Add Liquidity" and "Withdraw" buttons)
- **Click Behavior**:
  - "Add Liquidity" → Closes details modal, opens your existing AddLiquidityForm
  - "Withdraw" → Closes details modal, opens your existing WithdrawModal
  - "Claim Fees" → Executes claimFees function

### 3. **NestedModalManager.tsx**
- **Purpose**: Manages side-by-side modal layout
- **Desktop**: Shows primary modal (left) + secondary modal (right) when both are open
- **Mobile**: Stacks modals vertically
- **Dim Effect**: Primary modal dims/blurs slightly when secondary modal opens
- **Closing**: Stepwise (secondary → primary → none)

### 4. **usePositionAPR.ts** (Hook)
- **Purpose**: Calculates position-specific APR
- **Input**: Position details (ticks, tokens, pool state)
- **Output**: APR percentage, loading state, error
- **Calculation**: Uses existing `calculatePositionAPY` from `lib/apy-calculator.ts`

### 5. **PositionCardWithModals.tsx** (Integration Example)
- **Purpose**: Complete integration example
- **Features**: Wires up compact card + details modal + existing modals
- **Usage**: Drop-in replacement for existing PositionCard

## Migration Guide

### Step 1: Update Imports

**Before:**
```tsx
import { PositionCard } from '@/components/liquidity/PositionCard';
```

**After:**
```tsx
import { PositionCardWithModals } from '@/components/liquidity/PositionCardWithModals';
```

### Step 2: Replace Component

**Before:**
```tsx
<PositionCard
  position={position}
  valueUSD={valueUSD}
  // ... all existing props
/>
```

**After:**
```tsx
<PositionCardWithModals
  position={position}
  valueUSD={valueUSD}
  // ... all existing props (same interface)
  chainId={4002} // Add if not already passed
  poolLiquidity={poolLiquidity} // Add if not already passed
  currentPoolSqrtPriceX96={currentPoolSqrtPriceX96} // Add if not already passed
  onPoolInfo={() => {
    // Navigate to pool details page
    // Example: router.push(`/pool/${position.poolId}`)
  }}
/>
```

### Step 3: Add Missing Props (if needed)

The new components require a few additional props for APR calculation:

```tsx
// In your portfolio page / position list component
const [poolState, setPoolState] = useState({
  liquidity: null,
  sqrtPriceX96: null,
  tick: null
});

// Fetch pool state from your RPC or subgraph
useEffect(() => {
  // Fetch pool liquidity, sqrtPriceX96, and tick
  // Example:
  fetchPoolState(position.poolId).then(state => {
    setPoolState(state);
  });
}, [position.poolId]);

// Pass to component
<PositionCardWithModals
  // ... existing props
  poolLiquidity={poolState.liquidity}
  currentPoolSqrtPriceX96={poolState.sqrtPriceX96}
  currentPoolTick={poolState.tick}
/>
```

## Component Breakdown

### PositionCardCompact Layout

```
┌─────────────────────────────────────────────────────┐
│ [Icons] USDC / WETH     ● In Range         $1234.56 │  ~100px
│                                                  [⋮] │
├─────────────────────────────────────────────────────┤
│ APR: 15.2%   Fees: $12.34         ● In Range    │  ~40px
└─────────────────────────────────────────────────────┘
```

### PositionDetailsModal Sections

```
┌────────────────────────────────────────┐
│ POSITION DETAILS                    [×]│
├────────────────────────────────────────┤
│ [Icons] USDC / WETH  ● In Range        │
│                                        │
│ ━━ POSITION OVERVIEW ━━━━━━━━━━━━━━━━ │
│ Total Value: $1,234.56                 │
│                                        │
│ Position Amounts:                      │
│ 500.00 USDC ($500.00)                  │
│ 0.25 WETH ($734.56)                    │
│                                        │
│ Price Range:                           │
│ Min: 1950 USDC / WETH                  │
│ Max: 2050 USDC / WETH                  │
│                                        │
│ ━━ FEES & EARNINGS ━━━━━━━━━━━━━━━━━━ │
│ ┌──────────┐  ┌──────────┐            │
│ │ APR      │  │ Fees     │            │
│ │ 15.2%    │  │ $12.34   │            │
│ └──────────┘  └──────────┘            │
│                                        │
│ Fee Breakdown:                         │
│ 1.50 USDC ($1.50)                      │
│ 0.001 WETH ($10.84)                    │
│                                        │
│ [Claim Fees]                           │
│                                        │
│ ━━ ACTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ [Add Liquidity]    [Withdraw]          │
└────────────────────────────────────────┘
```

## Feature Comparison

| Feature | Old Card | New Compact Card | Details Modal |
|---------|----------|------------------|---------------|
| Height | ~320px | ~140px | Full modal |
| Token Icons | ✓ | ✓ | ✓ |
| Token Pair | ✓ | ✓ | ✓ |
| Status Badge | ✓ | ✓ | ✓ |
| Total USD Value | ✓ | ✓ | ✓ |
| APR | ✗ | ✓ | ✓ |
| Fees (USD) | ✓ | ✓ | ✓ |
| Fee Breakdown | Hover | ✗ | ✓ |
| Token Amounts | Hover | ✗ | ✓ |
| Price Range | ✓ | ✗ | ✓ |
| Age | ✓ | ✗ | ✗ |
| Withdraw Button | ✓ | ✗ | ✓ |
| Add Liquidity | Menu | ✗ | ✓ |
| Claim Fees | Menu | ✗ | ✓ |
| Pool Info | ✗ | Menu | ✗ |

## APR Calculation

The new design includes **position-specific APR** calculation:

### How it Works

1. **Fetch Pool Metrics** (7-day average)
   - Total fees earned (token0)
   - Average TVL (token0)
   - Number of days

2. **Calculate User's Liquidity**
   - Uses Uniswap V4 SDK to calculate liquidity for $100 investment in the position's range
   - Narrower ranges = higher liquidity = higher fee share = higher APR

3. **Calculate Fee Share**
   - User's liquidity / (Pool liquidity + User's liquidity)

4. **Annualize and Convert to APR**
   - Annual fees = (Total fees / days) × 365
   - User's annual fees = Annual fees × fee share
   - APR = (User's annual fees / $100 investment) × 100

### Implementation

The `usePositionAPR` hook handles this automatically:

```tsx
const { apr, isLoading, error } = usePositionAPR({
  poolId: position.poolId,
  chainId: 4002,
  tickLower: position.tickLower,
  tickUpper: position.tickUpper,
  token0Symbol: position.token0.symbol,
  token1Symbol: position.token1.symbol,
  currentPoolTick,
  currentPoolSqrtPriceX96,
  poolLiquidity,
  enabled: true
});
```

## Styling

All components use your existing design system:

- **Colors**: CSS variables from `globals.css` (bg-modal, border-sidebar-border, etc.)
- **Components**: shadcn/ui (Card, Button, etc.)
- **Icons**: Lucide React
- **Animations**: Framer Motion (for menu)
- **Utilities**: Tailwind CSS

## Responsive Behavior

### Desktop (≥1024px)
- Compact card: Full horizontal layout
- Details modal: Centered, max-width 28rem
- Nested modals: Side-by-side (primary left, secondary right)

### Mobile (<1024px)
- Compact card: Same layout (no changes)
- Details modal: Full-width with padding
- Nested modals: Stacked vertically (only one visible at a time)

## Testing Checklist

- [ ] Compact card renders with correct height (~140px)
- [ ] APR calculates and displays correctly
- [ ] Fees display correctly
- [ ] Status indicator shows correct color and text
- [ ] Clicking card opens Position Details Modal
- [ ] Position Details Modal shows all information
- [ ] "Claim Fees" button works
- [ ] "Add Liquidity" button opens existing modal
- [ ] "Withdraw" button opens existing modal
- [ ] Three-dot menu shows "Pool Info" only
- [ ] Pool Info navigates correctly
- [ ] Mobile layout stacks modals
- [ ] Desktop layout shows side-by-side modals
- [ ] Closing secondary modal returns to primary
- [ ] Closing primary modal closes all
- [ ] Loading states work correctly
- [ ] Error states handled gracefully

## Troubleshooting

### APR not calculating

**Check:**
1. Pool metrics API is returning data (`/api/liquidity/pool-metrics`)
2. `currentPoolTick`, `currentPoolSqrtPriceX96`, and `poolLiquidity` are not null
3. Token prices are available from price service

### Modal not opening

**Check:**
1. Component is client-side (`"use client"` directive)
2. `createPortal` is rendering to `document.body`
3. No z-index conflicts

### Nested modals not appearing side-by-side

**Check:**
1. Screen width is ≥1024px (desktop breakpoint)
2. `NestedModalManager` is receiving both `primaryModal` and `secondaryModal` props
3. `secondaryModalOpen` is true

## Future Enhancements

- [ ] Add price range chart to Details Modal (like Uniswap)
- [ ] Add "Compare APR" feature to compare ranges
- [ ] Add animation when transitioning from card to modal
- [ ] Add keyboard shortcuts (ESC to close, etc.)
- [ ] Add position analytics (historical performance, etc.)
- [ ] Add "Share Position" feature
- [ ] Add export to CSV for position history

## Questions?

If you encounter any issues or have questions:

1. Check the integration example in `PositionCardWithModals.tsx`
2. Review the props interfaces for each component
3. Check console for error messages
4. Verify all required props are passed correctly

---

**Last Updated**: 2025-01-20
**Version**: 1.0.0
**Author**: Claude Code
