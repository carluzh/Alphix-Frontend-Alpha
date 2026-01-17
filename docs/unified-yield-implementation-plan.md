# Unified Yield Integration - Implementation Plan

## Executive Summary

This plan prepares the Alphix Frontend for Unified Yield liquidity provision, a non-Uniswap SDK deposit flow where:
- Users approve a Hook contract (not Permit2)
- Hook receives deposits and mints ERC-4626 shares to users
- Hook deposits underlying tokens into shared vaults across pools
- Vaults earn rehypothecation yield (Aave) + swap fees (JIT liquidity)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER DEPOSIT FLOW                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   User                                                              │
│     │                                                               │
│     ├─1─► ERC20.approve(hookAddress, amount)   [for each token]    │
│     │                                                               │
│     └─2─► Hook.deposit(token0, token1, amount0, amount1, recipient) │
│               │                                                     │
│               ├──► Hook mints shares to user (ERC-4626 compliant)  │
│               │                                                     │
│               └──► Hook deposits into underlying vaults:           │
│                     • ETH Vault (shared: ETH/USDC, ETH/USDT, ...)  │
│                     • USDC Vault (shared: ETH/USDC, USDC/USDT, ...)│
│                     • Vaults earn Aave yield                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Clarifications from User

1. **One Hook per Pool**: Each pool (ETH/USDC, USDC/USDT) has its own Hook
2. **Hook IS ERC-4626**: Users receive Hook shares directly (not separate vault shares)
3. **Shared Underlying Vaults**: Different Hooks deposit into the same token vaults
4. **Vault Addresses Hardcoded**: Will be in pool/token config
5. **Full CRUD Required**: Deposit, Withdraw, and Position Management

## Current Codebase State

### Implementation Status (Updated Iteration 2)

**COMPLETED:**
- `lib/liquidity/unified-yield/abi/unifiedYieldHookABI.ts` - Full Hook ABI ✅ NEW
- `lib/liquidity/unified-yield/types.ts` - Position & TX types + withdraw types ✅ UPDATED
- `lib/liquidity/unified-yield/useUnifiedYieldApprovals.ts` - Approval checking ✅
- `lib/liquidity/unified-yield/buildUnifiedYieldDepositTx.ts` - Deposit TX builder ✅ UPDATED
- `lib/liquidity/unified-yield/buildUnifiedYieldWithdrawTx.ts` - Withdraw TX builder ✅ NEW
- `lib/liquidity/unified-yield/fetchUnifiedYieldPositions.ts` - Position fetch ✅ REWRITTEN
- `lib/liquidity/unified-yield/positionAdapter.ts` - Position adapter (bigint support) ✅ UPDATED
- `lib/liquidity/unified-yield/index.ts` - Module exports ✅ UPDATED
- `lib/liquidity/hooks/approval/useModeAwareApprovals.ts` - Mode dispatcher ✅
- `lib/liquidity/unified-yield/hooks/useUnifiedYieldDeposit.ts` - Deposit execution ✅ NEW (Iteration 3)
- `lib/liquidity/unified-yield/hooks/useUnifiedYieldWithdraw.ts` - Withdraw execution ✅ NEW (Iteration 3)
- `lib/liquidity/unified-yield/hooks/useUnifiedYieldPosition.ts` - Combined position hook ✅ NEW (Iteration 3)
- `lib/liquidity/unified-yield/hooks/index.ts` - Hooks exports ✅ NEW (Iteration 3)

**REMAINING:**
- API integration (get-positions.ts) - merge UY positions with V4
- UI integration points - wire up mode-aware deposit/withdraw flows

### Additional Clarifications (Iteration 2)

6. **No Slippage Protection**: Hook's deposit function has no minSharesOut parameter
7. **Partial Withdrawals**: Supported - users can withdraw any number of shares
8. **Native ETH Handling**: Hook wraps ETH internally - send ETH as msg.value

## Implementation Tasks

### Phase 1: Core Types & ABI Updates

#### 1.1 Update Hook ABI (`lib/liquidity/unified-yield/abi/`)
Create comprehensive Hook ABI with placeholder functions:

```typescript
// lib/liquidity/unified-yield/abi/unifiedYieldHookABI.ts
export const UNIFIED_YIELD_HOOK_ABI = [
  // ═══════════════ ERC-4626 VAULT INTERFACE ═══════════════
  // User receives Hook shares representing their position

  // Deposit both tokens, receive shares
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },

  // Withdraw by burning shares
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },

  // Standard ERC-4626 view functions
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'supply', type: 'uint256' }],
  },

  // Convert shares to underlying token amounts
  {
    name: 'previewRedeem',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },

  // Preview deposit (shares for given amounts)
  {
    name: 'previewDeposit',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },

  // ═══════════════ HOOK-SPECIFIC FUNCTIONS ═══════════════

  // Get underlying vault addresses
  {
    name: 'getVault0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'vault', type: 'address' }],
  },
  {
    name: 'getVault1',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'vault', type: 'address' }],
  },

  // Get pool info
  {
    name: 'poolKey',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  },
] as const;
```

#### 1.2 Update Types (`lib/liquidity/unified-yield/types.ts`)

```typescript
// Add withdrawal params
export interface UnifiedYieldWithdrawParams {
  poolId: string;
  hookAddress: Address;
  shares: bigint;
  userAddress: Address;
  chainId: number;
  slippageBps?: number;
}

export interface UnifiedYieldWithdrawTxResult {
  calldata: `0x${string}`;
  value: bigint;  // Always 0 for withdrawals
  to: Address;
  gasLimit?: bigint;
}

// Update position to reflect Hook-as-vault architecture
export interface UnifiedYieldPosition {
  id: string;
  hookAddress: Address;  // Hook IS the ERC-4626 vault
  shareBalance: bigint;
  shareBalanceFormatted: string;

  // Underlying amounts (from Hook.previewRedeem)
  token0Amount: string;
  token1Amount: string;
  token0AmountRaw: bigint;
  token1AmountRaw: bigint;

  // Pool info
  poolId: string;
  token0Symbol: string;
  token1Symbol: string;
  token0Address: Address;
  token1Address: Address;
  token0Decimals: number;
  token1Decimals: number;

  // Discriminators
  isUnifiedYield: true;
  isFullRange: true;
  status: 'IN_RANGE';

  // Optional metadata
  createdAt?: number;
  valueUSD?: number;
}
```

### Phase 2: Position Fetching Updates

#### 2.1 Rewrite `fetchUnifiedYieldPositions.ts`

The current implementation tries to call `getVault()` on hooks. Update to:

1. Query `Hook.balanceOf(user)` directly (Hook IS the ERC-4626)
2. Call `Hook.previewRedeem(shares)` to get underlying amounts
3. Handle the two-token return from `previewRedeem`

```typescript
// Key changes:
async function fetchPoolUnifiedYieldPosition(
  pool: PoolConfig,
  userAddress: Address,
  client: PublicClient,
  networkMode: NetworkMode
): Promise<UnifiedYieldPosition | null> {
  const hookAddress = pool.hooks as Address;
  if (!hookAddress) return null;

  // Query share balance directly from Hook (Hook IS ERC-4626)
  const shareBalance = await client.readContract({
    address: hookAddress,
    abi: UNIFIED_YIELD_HOOK_ABI,
    functionName: 'balanceOf',
    args: [userAddress],
  });

  if (shareBalance <= 0n) return null;

  // Get underlying amounts from Hook.previewRedeem
  // Returns [amount0, amount1] for two-token positions
  const [token0AmountRaw, token1AmountRaw] = await client.readContract({
    address: hookAddress,
    abi: UNIFIED_YIELD_HOOK_ABI,
    functionName: 'previewRedeem',
    args: [shareBalance],
  });

  return {
    id: `uy-${hookAddress}-${userAddress}`,
    hookAddress,
    shareBalance,
    token0AmountRaw,
    token1AmountRaw,
    // ... rest of fields
  };
}
```

### Phase 3: Transaction Builders

#### 3.1 Update `buildUnifiedYieldDepositTx.ts`

Current implementation is mostly correct. Updates needed:
- Use the new comprehensive ABI
- Add slippage protection (minShares parameter if Hook supports it)

#### 3.2 Create `buildUnifiedYieldWithdrawTx.ts`

```typescript
// lib/liquidity/unified-yield/buildUnifiedYieldWithdrawTx.ts

export async function buildUnifiedYieldWithdrawTx(
  params: UnifiedYieldWithdrawParams
): Promise<UnifiedYieldWithdrawTxResult> {
  const { hookAddress, shares, userAddress } = params;

  const calldata = encodeFunctionData({
    abi: UNIFIED_YIELD_HOOK_ABI,
    functionName: 'withdraw',
    args: [shares, userAddress],
  });

  return {
    calldata,
    value: 0n,  // No ETH for withdrawals
    to: hookAddress,
    gasLimit: undefined,
  };
}
```

### Phase 4: Execution Hooks

#### 4.1 Create `useUnifiedYieldDeposit.ts`

Transaction execution hook for deposits:

```typescript
// lib/liquidity/unified-yield/hooks/useUnifiedYieldDeposit.ts

export function useUnifiedYieldDeposit() {
  const { address: userAddress } = useAccount();
  const { writeContract, isPending, isSuccess, data: txHash } = useWriteContract();

  const deposit = useCallback(async (params: UnifiedYieldDepositParams) => {
    const txData = await buildUnifiedYieldDepositTx(params);

    return writeContract({
      address: txData.to,
      abi: UNIFIED_YIELD_HOOK_ABI,
      functionName: 'deposit',
      args: [
        params.token0Address,
        params.token1Address,
        params.amount0Wei,
        params.amount1Wei,
        params.userAddress,
      ],
      value: txData.value,
    });
  }, [writeContract]);

  return {
    deposit,
    isPending,
    isSuccess,
    txHash,
  };
}
```

#### 4.2 Create `useUnifiedYieldWithdraw.ts`

```typescript
// lib/liquidity/unified-yield/hooks/useUnifiedYieldWithdraw.ts

export function useUnifiedYieldWithdraw() {
  const { writeContract, isPending, isSuccess, data: txHash } = useWriteContract();

  const withdraw = useCallback(async (params: UnifiedYieldWithdrawParams) => {
    return writeContract({
      address: params.hookAddress,
      abi: UNIFIED_YIELD_HOOK_ABI,
      functionName: 'withdraw',
      args: [params.shares, params.userAddress],
    });
  }, [writeContract]);

  return {
    withdraw,
    isPending,
    isSuccess,
    txHash,
  };
}
```

### Phase 5: Position Management Integration

#### 5.1 Update Position Adapter

The current `positionAdapter.ts` is good but needs updates for:
- Handle bigint `token0AmountRaw`/`token1AmountRaw` (currently expects string)
- Add method to detect partial withdrawal support

#### 5.2 Create `useUnifiedYieldPosition.ts`

Combined hook for position management:

```typescript
// lib/liquidity/unified-yield/hooks/useUnifiedYieldPosition.ts

export function useUnifiedYieldPosition(hookAddress: Address) {
  const { address: userAddress } = useAccount();
  const client = usePublicClient();

  // Fetch position data
  const { data: position, refetch } = useQuery({
    queryKey: ['unified-yield-position', hookAddress, userAddress],
    queryFn: () => fetchSinglePosition(hookAddress, userAddress, client),
    enabled: !!hookAddress && !!userAddress,
  });

  // Deposit mutation
  const depositMutation = useUnifiedYieldDeposit();

  // Withdraw mutation
  const withdrawMutation = useUnifiedYieldWithdraw();

  return {
    position,
    refetch,
    deposit: depositMutation.deposit,
    withdraw: withdrawMutation.withdraw,
    isDepositing: depositMutation.isPending,
    isWithdrawing: withdrawMutation.isPending,
  };
}
```

### Phase 6: API Integration

#### 6.1 Update `/api/liquidity/get-positions.ts`

Modify to include Unified Yield positions alongside V4 positions:

```typescript
// In the handler:
const [v4Positions, uyPositions] = await Promise.all([
  fetchV4Positions(userAddress, networkMode),
  fetchUnifiedYieldPositions({ userAddress, networkMode, client, chainId }),
]);

// Merge using adapter
const allPositions = mergePositions(v4Positions, uyPositions, networkMode);

return res.json({ positions: allPositions });
```

### Phase 7: UI Integration Points

#### 7.1 Add Liquidity Flow
- UI already has mode selector (concentrated vs rehypo)
- `useModeAwareApprovals` already dispatches to correct approval logic
- Need to wire up deposit execution based on mode

#### 7.2 Position Display
- `PositionCardCompact` works via adapter pattern
- May need "Unified Yield" badge/indicator
- Full range indicator (no price range UI needed)

#### 7.3 Decrease/Withdraw Flow
- Create withdraw modal/page for Unified Yield positions
- Show share balance and underlying token amounts
- Allow partial or full withdrawal

## File Changes Summary

### New Files
```
lib/liquidity/unified-yield/
├── abi/
│   └── unifiedYieldHookABI.ts          # Comprehensive Hook ABI
├── hooks/
│   ├── useUnifiedYieldDeposit.ts       # Deposit execution
│   ├── useUnifiedYieldWithdraw.ts      # Withdraw execution
│   └── useUnifiedYieldPosition.ts      # Combined position hook
└── buildUnifiedYieldWithdrawTx.ts      # Withdraw TX builder
```

### Modified Files
```
lib/liquidity/unified-yield/
├── types.ts                            # Add withdraw types, update position type
├── fetchUnifiedYieldPositions.ts       # Query Hook directly, handle 2-token returns
├── positionAdapter.ts                  # Handle bigint amounts
└── index.ts                            # Export new modules

lib/liquidity/hooks/approval/
└── index.ts                            # Export updates

pages/api/liquidity/
└── get-positions.ts                    # Include Unified Yield positions
```

## Testing Checklist

### Unit Tests
- [ ] Hook ABI encoding/decoding
- [ ] Position fetching from Hook contract
- [ ] Approval checking for ERC20 → Hook
- [ ] Deposit TX building
- [ ] Withdraw TX building
- [ ] Position adapter conversion

### Integration Tests
- [ ] Full deposit flow (approve → deposit)
- [ ] Full withdraw flow
- [ ] Position display in UI
- [ ] Mode switching (concentrated ↔ rehypo)

### E2E Tests (when contracts available)
- [ ] Deposit with actual Hook contract
- [ ] Verify share balance after deposit
- [ ] Withdraw and verify token returns
- [ ] Verify underlying vault deposits

## Dependencies & Assumptions

1. **Hook Contract Not Live**: Implementation uses placeholder ABI
2. **Vault Addresses**: Will be hardcoded in config when available
3. **Two-Token previewRedeem**: Assumes Hook returns `(amount0, amount1)`
4. **Share Decimals**: Assumes 18 decimals for Hook shares

## Migration Notes

When Hook contracts become available:
1. Update `UNIFIED_YIELD_HOOK_ABI` with actual ABI
2. Add vault addresses to pool config
3. Verify function signatures match implementation
4. Test against testnet contracts first

## Questions for Follow-up

1. Does the Hook support slippage protection (minShares/minAmounts)?
2. Is there a separate claim function for fees, or are they auto-compounded?
3. Should we support partial withdrawals (withdraw X% of shares)?
4. Will there be events to track for transaction confirmation?
