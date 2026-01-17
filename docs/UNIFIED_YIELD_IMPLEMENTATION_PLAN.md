# Unified Yield Implementation Plan

## Overview

This document outlines the implementation plan for adding Unified Yield support to the Alphix Frontend. Unified Yield is a different liquidity provision mechanism that:

1. **Deposits through a Hook contract** instead of Uniswap V4's PositionManager
2. **Uses ERC-4626 vaults** for position representation instead of ERC721 NFTs
3. **Earns yield from swap fees + Aave lending** through rehypothecation

## Current Architecture

### Add Liquidity Flow (V4 Standard)
```
User Input → ERC20 Approve to Permit2 → Permit2 Signature → V4PositionManager.mint()
```

### Position Representation
- ERC721 NFTs from PositionManager contract
- Subgraph indexes `hookPositions` entities
- Position data: tokenId, tickLower, tickUpper, liquidity

## Target Architecture (Unified Yield)

### Add Liquidity Flow (Unified Yield)
```
User Input → ERC20 Approve to Hook Contract → Hook.deposit()
```

### Position Representation
- ERC-4626 vault shares (fungible tokens)
- User balance represents their position
- No subgraph initially - direct contract calls

---

## Phase 1: Types and Abstractions

### 1.1 Create Unified Yield Types

**New File: `lib/liquidity/unified-yield/types.ts`**

```typescript
import type { Address } from 'viem';

export interface UnifiedYieldPosition {
  // Position identifier (vault address + user address)
  id: string;

  // Vault contract address
  vaultAddress: Address;

  // User's share balance
  shareBalance: bigint;
  shareBalanceFormatted: string;

  // Underlying token amounts (via previewRedeem)
  token0Amount: string;
  token1Amount: string;
  token0AmountRaw: string;
  token1AmountRaw: string;

  // Pool info
  poolId: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Address: Address;
  token1Address: Address;

  // For display compatibility with V4 positions
  isUnifiedYield: true; // Discriminator
  isFullRange: true; // Unified Yield always uses managed range

  // Status (always in-range for Unified Yield)
  status: 'IN_RANGE';
}

export interface UnifiedYieldDepositParams {
  poolId: string;
  amount0: string;
  amount1: string;
  userAddress: Address;
  hookAddress: Address;
}

export interface UnifiedYieldApprovalStatus {
  token0NeedsApproval: boolean;
  token1NeedsApproval: boolean;
  token0Allowance: bigint;
  token1Allowance: bigint;
}
```

### 1.2 Extend LPMode Type

**Modify: `components/liquidity/wizard/types.ts`**

```typescript
// Existing - no change needed
export type LPMode = 'rehypo' | 'concentrated';

// Add helper type for position discrimination
export interface PositionTypeDiscriminator {
  isUnifiedYield: boolean;
}
```

---

## Phase 2: Approval Flow for Unified Yield

### 2.1 Create Unified Yield Approval Hook

**New File: `lib/liquidity/unified-yield/useUnifiedYieldApprovals.ts`**

This hook checks ERC20 allowances to the Hook contract (not Permit2).

```typescript
export interface UseUnifiedYieldApprovalsParams {
  userAddress?: Address;
  token0Address: Address;
  token1Address: Address;
  amount0Wei: bigint;
  amount1Wei: bigint;
  hookAddress: Address;
  chainId?: number;
}

export function useUnifiedYieldApprovals(params: UseUnifiedYieldApprovalsParams) {
  // Check ERC20 allowance to Hook contract for both tokens
  // Return: { needsToken0Approval, needsToken1Approval, isLoading, refetch }
}
```

### 2.2 Create Mode-Aware Approval Hook

**New File: `lib/liquidity/hooks/approval/useModeAwareApprovals.ts`**

```typescript
export function useModeAwareApprovals(params: {
  mode: LPMode;
  // ... other params
}) {
  // If mode === 'rehypo', use useUnifiedYieldApprovals
  // If mode === 'concentrated', use existing useLiquidityApprovals
}
```

### 2.3 Modify CreatePositionTxContext

**Modify: `components/liquidity/wizard/CreatePositionTxContext.tsx`**

- Import mode from AddLiquidityContext
- Use mode-aware approval hook instead of `useCheckMintApprovals`
- Generate different approval steps based on mode

---

## Phase 3: Transaction Building for Unified Yield

### 3.1 Create Unified Yield Deposit Builder

**New File: `lib/liquidity/unified-yield/buildUnifiedYieldDepositTx.ts`**

```typescript
export interface BuildUnifiedYieldDepositParams {
  poolId: string;
  hookAddress: Address;
  token0Address: Address;
  token1Address: Address;
  amount0Wei: bigint;
  amount1Wei: bigint;
  userAddress: Address;
  chainId: number;
}

export async function buildUnifiedYieldDepositTx(params: BuildUnifiedYieldDepositParams) {
  // Build calldata for Hook.deposit() function
  // Return: { calldata, value, to: hookAddress }

  // NOTE: The actual function signature will be provided later
  // For now, create a placeholder structure
}
```

### 3.2 Create Mode-Aware Transaction Steps Generator

**Modify: `lib/liquidity/transaction/steps/generateLPTransactionSteps.ts`**

```typescript
export function generateLPTransactionSteps(params: {
  mode: LPMode;
  // ... existing params
}) {
  if (mode === 'rehypo') {
    return generateUnifiedYieldSteps(params);
  }
  return generateV4Steps(params); // existing logic
}

function generateUnifiedYieldSteps(params) {
  // 1. Token0 approval to Hook (if needed)
  // 2. Token1 approval to Hook (if needed)
  // 3. Hook.deposit() call
  // NO Permit2 signature step
}
```

### 3.3 Add Unified Yield Handler

**New File: `lib/liquidity/transaction/executor/handlers/unifiedYieldHandler.ts`**

```typescript
export async function handleUnifiedYieldDeposit(
  step: TransactionStep,
  params: ExecutorParams
) {
  // Execute the Hook.deposit() transaction
  // Handle success/failure
}
```

---

## Phase 4: Position Fetching for Unified Yield

### 4.1 Create Unified Yield Position Fetcher

**New File: `lib/liquidity/unified-yield/fetchUnifiedYieldPositions.ts`**

```typescript
export async function fetchUnifiedYieldPositions(
  userAddress: Address,
  chainId: number,
  networkMode: NetworkMode
): Promise<UnifiedYieldPosition[]> {
  // For each pool with Unified Yield:
  // 1. Get vault address from pool config (or Hook)
  // 2. Call vault.balanceOf(userAddress) to get share balance
  // 3. Call vault.previewRedeem(shareBalance) to get underlying amounts
  // 4. Convert to UnifiedYieldPosition format
}
```

### 4.2 Create Position Adapter

**New File: `lib/liquidity/unified-yield/positionAdapter.ts`**

```typescript
export function adaptUnifiedYieldToProcessedPosition(
  uyPosition: UnifiedYieldPosition,
  poolConfig: PoolConfig
): ProcessedPosition {
  // Convert UnifiedYieldPosition to ProcessedPosition format
  // This allows reuse of existing position display components
}
```

### 4.3 Modify Get-Positions API

**Modify: `pages/api/liquidity/get-positions.ts`**

```typescript
export default async function handler(req, res) {
  // Existing V4 position fetching
  const v4Positions = await fetchAndProcessUserPositionsForApi(...);

  // NEW: Fetch Unified Yield positions
  const uyPositions = await fetchUnifiedYieldPositionsForApi(...);

  // Merge and return
  const allPositions = [...v4Positions, ...uyPositions];
  return res.status(200).json(allPositions);
}
```

---

## Phase 5: UI Integration Points

### 5.1 Files Requiring Mode Checks

| File | Change Required |
|------|-----------------|
| `CreatePositionTxContext.tsx` | Use mode-aware approvals |
| `ReviewExecuteModal.tsx` | Generate mode-aware steps |
| `RangeAndAmountsStep.tsx` | Hide range selection for rehypo |
| `PositionCardCompact.tsx` | Handle Unified Yield display |
| `get-positions.ts` | Merge V4 + Unified Yield positions |

### 5.2 Position Display Compatibility

Unified Yield positions should look **identical** to V4 positions:
- Same card layout (PositionCardCompact)
- Show as "Full Range" or "Managed Range"
- Display underlying token amounts (not shares)
- Show APR (swap fees + Aave lending yield)
- Status always "In Range"

---

## File Structure Summary

### New Files to Create

```
lib/liquidity/unified-yield/
├── types.ts                    # Unified Yield types
├── useUnifiedYieldApprovals.ts # Approval checking hook
├── buildUnifiedYieldDepositTx.ts # Transaction builder (placeholder)
├── fetchUnifiedYieldPositions.ts # Position fetching
├── positionAdapter.ts          # Convert UY → ProcessedPosition
└── index.ts                    # Exports

lib/liquidity/hooks/approval/
└── useModeAwareApprovals.ts    # Mode-aware approval hook

lib/liquidity/transaction/executor/handlers/
└── unifiedYieldHandler.ts      # Deposit execution handler
```

### Files to Modify

```
components/liquidity/wizard/
├── CreatePositionTxContext.tsx # Mode-aware approvals
├── ReviewExecuteModal.tsx      # Mode-aware step generation

lib/liquidity/transaction/steps/
└── generateLPTransactionSteps.ts # Mode branching

pages/api/liquidity/
└── get-positions.ts            # Merge position sources
```

---

## Implementation Order

1. **Phase 1**: Create types (can be done immediately)
2. **Phase 2**: Create approval hooks (requires Hook contract address pattern)
3. **Phase 3**: Create transaction builders (requires Hook ABI - placeholder for now)
4. **Phase 4**: Create position fetching (requires vault addresses)
5. **Phase 5**: UI integration (after above phases)

---

## Open Questions for Contract Team

1. **Hook Deposit Function**: What is the exact function signature?
   - Example: `deposit(address token0, address token1, uint256 amount0, uint256 amount1, address recipient)`

2. **Vault Address Discovery**: How do we get the ERC-4626 vault address?
   - Is it stored in the Hook contract?
   - Is there a separate mapping?
   - One vault per pool or shared vault?

3. **Share to Underlying Conversion**: Does the vault implement standard ERC-4626?
   - `previewRedeem(uint256 shares)` → returns underlying amount
   - For two-token positions, how are amounts split?

4. **Events for Indexing**: What events does the Hook emit?
   - For future subgraph development

---

## Current Pool Configuration

Each pool already has a `hooks` address in the config:

```json
{
  "id": "usdc-usdt",
  "hooks": "0xc025186214711638070aF4e27B57B3D4B10B7Fff",
  "rehypoRange": {
    "min": "1.001",
    "max": "1.001601",
    "isFullRange": false
  }
}
```

This Hook address will be used as the approval target for Unified Yield deposits.
