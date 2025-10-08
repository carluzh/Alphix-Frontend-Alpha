# Refactor Notes

## Type System Consolidation

### Current State
Types are scattered across `/lib`, `/app`, and `/components` directories, leading to:
- **Duplicated type definitions** (same interface in multiple files)
- **Inconsistent naming** (e.g., `Token` vs `TokenSelectorToken`)
- **Poor discoverability** (hard to find shared types)

### Duplicates Found

#### 🔴 HIGH PRIORITY - Exact Duplicates

1. **`FeeHistoryPoint`** - DUPLICATED 3x
   - `components/dynamic-fee-chart.tsx:7`
   - `components/dynamic-fee-chart-preview.tsx:11`
   - `components/swap/swap-interface.tsx:80`
   - **Action**: Move to `/types/fee.ts`

2. **`PoolState`** - DUPLICATED 2x
   - `lib/liquidity-utils.ts:237` (full interface)
   - `lib/validation.ts:15` (zod schema export)
   - **Action**: Move to `/types/pool.ts`, keep zod schema in validation

3. **`TokenBalance`** / **`TokenBalanceData`** - Different names, similar structure
   - `app/portfolio/page.tsx:288` (as `TokenBalance`)
   - `components/swap/TokenSelector.tsx:103` (as `TokenBalanceData`)
   - **Action**: Unify as `TokenBalance` in `/types/token.ts`

4. **`Token`** / **`TokenSelectorToken`** - Similar types
   - `components/swap/swap-interface.tsx:143` (as `Token`)
   - `components/swap/TokenSelector.tsx:18` (as `TokenSelectorToken`)
   - **Action**: Unify as `Token` in `/types/token.ts`

#### 🟡 MEDIUM PRIORITY - Should Be Centralized

**Pool Types** (currently in `/lib/pools-config.ts`, `/lib/liquidity-utils.ts`, `/lib/apy-calculator.ts`):
- `Pool` ✅ (already in `/types/index.ts`)
- `PoolConfig` (lib/pools-config.ts:20)
- `PoolState` (lib/liquidity-utils.ts:237)
- `PoolMetrics` (lib/apy-calculator.ts:9)
- `PoolDetailData` (app/liquidity/[poolId]/page.tsx:173 - extends Pool)
- `TokenConfig` (lib/pools-config.ts:6)
- `PoolCurrency` (lib/pools-config.ts:15)
- **Action**: Create `/types/pool.ts`

**Token Types** (currently in `/lib/swap-constants.ts`, `/components`):
- `TokenDefinition` (lib/swap-constants.ts:53)
- `TokenSymbol` (lib/swap-constants.ts:50 and lib/pools-config.ts:223 - DUPLICATE!)
- `Token` (components/swap/swap-interface.tsx:143)
- `TokenSelectorToken` (components/swap/TokenSelector.tsx:18)
- `TokenBalance` (app/portfolio/page.tsx:288)
- `TokenBalanceData` (components/swap/TokenSelector.tsx:103)
- **Action**: Create `/types/token.ts`

**Liquidity/Position Types** (currently in `/lib/liquidity-utils.ts`):
- `AddLiquidityParams` (lib/liquidity-utils.ts:124)
- `RemoveLiquidityParams` (lib/liquidity-utils.ts:142)
- `CollectLiquidityParams` (lib/liquidity-utils.ts:153)
- `DecodedPositionInfo` (lib/liquidity-utils.ts:166)
- `PositionDetails` (lib/liquidity-utils.ts:185)
- `BuildCollectFeesCallParams` (lib/liquidity-utils.ts:272)
- **Action**: Create `/types/liquidity.ts`

**Swap Types** (currently in `/components/swap/swap-interface.tsx`):
- `SwapState` (line 165)
- `SwapProgressState` (line 168)
- `SwapTxInfo` (line 171)
- `FeeDetail` (line 184)
- `SwapRoute` (lib/routing-engine.ts:3)
- `RouteResult` (lib/routing-engine.ts:21)
- **Action**: Create `/types/swap.ts`

**Permit2 Types** (currently in `/lib/permit-utils.ts`, `/lib/liquidity-utils.ts`):
- `PermitDetails` (lib/permit-utils.ts:15)
- `PermitBatch` (lib/permit-utils.ts:22)
- `PermitSingle` (lib/permit-utils.ts:28)
- `SignedPermit` (lib/permit-utils.ts:34)
- `PermitBatchTypedData` (lib/permit-utils.ts:40)
- `PermitSingleTypedData` (lib/permit-utils.ts:53)
- `LiquidityPermitConfig` (lib/permit-utils.ts:266)
- `Permit2Details` (lib/liquidity-utils.ts:370)
- `PreparedPermit2Batch` (lib/liquidity-utils.ts:377)
- **Action**: Create `/types/permit.ts`

**Validation/API Types** (currently in `/lib/validation.ts` - zod schemas):
- `PoolStats` (line 41)
- `DynamicFee` (line 54)
- `SwapQuote` (line 66)
- `PortfolioActivity` (line 82)
- `TokenPrices` (line 87)
- `MaintenanceStatus` (line 94)
- `LoginResponse` (line 102)
- `LogoutResponse` (line 109)
- **Action**: Keep zod schemas in validation.ts, but export pure types to `/types/api.ts`

**Wallet Types** (currently in `/lib/wallet-capabilities.ts`):
- `WalletCapabilities` (line 6)
- `CallsStatus` (line 22)
- `SendCallsParams` (line 38)
- `SendCallsResult` (line 58)
- `TransactionExecutionStrategy` (line 307)
- **Action**: Create `/types/wallet.ts`

### Proposed Structure

```
/types/
  index.ts          # Re-export all types for convenience
  pool.ts           # Pool, PoolConfig, PoolState, PoolMetrics, PoolDetailData
  token.ts          # Token, TokenBalance, TokenDefinition, TokenSymbol
  liquidity.ts      # Position, AddLiquidity, RemoveLiquidity, CollectLiquidity params
  swap.ts           # SwapState, SwapProgressState, SwapTx, FeeDetail, SwapRoute
  permit.ts         # All Permit2 related types
  fee.ts            # FeeHistoryPoint, DynamicFee, FeeDetail
  api.ts            # API response types (from validation schemas)
  wallet.ts         # Wallet capabilities and transaction types
```

### Migration Strategy

1. **Phase 1**: Create new type files with consolidated types
2. **Phase 2**: Update imports across codebase (use search/replace)
3. **Phase 3**: Remove old type definitions from original locations
4. **Phase 4**: Add JSDoc comments to all exported types

### Benefits

- ✅ Single source of truth for types
- ✅ Better IDE autocomplete/discovery
- ✅ Easier to maintain consistency
- ✅ Prevents future duplicates
- ✅ Clearer separation between types and implementation

---

## Other Refactoring Notes

### Query Key System Consolidation

**Current State**: Three separate query key systems exist:
1. **`lib/cache-keys.ts`** (4.9K) - `CacheKeyFactory` class with string-based keys
   - Used in: `app/liquidity/[poolId]/page.tsx` (imported for side effects only - sets global window.CacheKeys)
   - Format: `"domain:resource:identifier:params"` (colon-separated strings)

2. **`lib/queryKeys.ts`** (2.5K) - `qk` object with query categories
   - Used in: `components/data/hooks.ts`, `lib/invalidation.ts`
   - Format: `['pools', 'stats', poolId]` (array-based)
   - Includes category definitions (CATEGORY_1, CATEGORY_2, CATEGORY_3) with stale times

3. **`lib/cache/client/query-keys.ts`** (3.7K) - `queryKeys` object (newer React Query system)
   - Used in: `lib/cache/client/queries/*.ts`, `lib/cache/coordination/invalidation-orchestrator.ts`
   - Format: `['pools', 'stats', poolId]` (array-based, hierarchical)
   - Part of the newer cache v2 system

**Problem**: Fragmented key management leading to:
- Inconsistent key formats (string vs array)
- Duplicate key definitions for same resources
- Hard to know which system to use for new features
- Maintenance burden across 3 files

**Recommendation**:
1. **Keep**: `lib/cache/client/query-keys.ts` (newest, best structure, hierarchical)
2. **Migrate away from**: `lib/queryKeys.ts` (2 files use it - `components/data/hooks.ts`, `lib/invalidation.ts`)
3. **Delete**: `lib/cache-keys.ts` (only imported for side effects - not actually used for queries)

**Migration Steps**:
1. Update `components/data/hooks.ts` to use `queryKeys` from cache system
2. Update `lib/invalidation.ts` to use `queryKeys` from cache system
3. Remove `lib/queryKeys.ts`
4. Remove `lib/cache-keys.ts` and the side-effect import from `app/liquidity/[poolId]/page.tsx`
