# Cache System v2

## Overview

A simplified, modular cache system built on React Query with proper configuration and comprehensive testing.

## Quick Start

### 1. Import from the main entry point

```tsx
import {
  usePoolsBatch,
  useUserPositions,
  useAddLiquidityMutation,
  queryKeys,
} from '@/lib/cache'
```

### 2. Use query hooks

```tsx
function LiquidityPage() {
  const { data: pools, isLoading } = usePoolsBatch()
  const { data: positions } = useUserPositions(address)

  if (isLoading) return <Spinner />
  return <PoolsList pools={pools} positions={positions} />
}
```

### 3. Use mutation hooks

```tsx
function AddLiquidityButton() {
  const addLiquidity = useAddLiquidityMutation({
    onSuccess: () => toast.success('Liquidity added!'),
  })

  return (
    <button
      onClick={() =>
        addLiquidity.mutate({
          poolId,
          owner: address,
          amount0: '100',
          amount1: '100',
          tickLower: -1000,
          tickUpper: 1000,
        })
      }
    >
      Add Liquidity
    </button>
  )
}
```

## Architecture

```
lib/cache/
├── index.ts              # Public API (import from here)
├── types.ts              # TypeScript interfaces
│
├── client/               # Client-side caching
│   ├── query-client.ts   # React Query config
│   ├── query-keys.ts     # Centralized query keys
│   ├── persistence.ts    # localStorage helpers
│   ├── mutations.ts      # Transaction mutations
│   └── queries/          # Query hooks
│       ├── pools.ts
│       └── positions.ts
│
├── server/               # Server-side caching
│   └── cache-helpers.ts  # Next.js cache utilities
│
└── coordination/         # Cross-layer coordination
    ├── barriers.ts       # Indexing barriers
    └── invalidation-orchestrator.ts
```

## Features

### ✅ Type-Safe Query Keys

```tsx
// ✅ Type-safe, autocomplete
queryClient.invalidateQueries({ queryKey: queryKeys.user.positions(address) })

// ❌ Error-prone
queryClient.invalidateQueries({ queryKey: ['user', 'positions', address] })
```

### ✅ Automatic Cache Invalidation

```tsx
const addLiquidity = useAddLiquidityMutation()

addLiquidity.mutate(params)
// Automatically invalidates:
// - User positions
// - Pool stats
// - Pool state
// - Server cache
```

### ✅ Indexing Barrier Coordination

```tsx
// Automatically waits for subgraph to index transaction
const mutation = useAddLiquidityMutation()

mutation.mutate(params)
// 1. Executes transaction
// 2. Waits for subgraph to index
// 3. Invalidates caches
// 4. Calls onSuccess
```

### ✅ localStorage Persistence

```tsx
// Position IDs automatically persisted across page reloads
const { data: positionIds } = useUserPositionIds(address)
// Uses localStorage under the hood
```

### ✅ Comprehensive Testing

- Unit tests for all components
- Integration tests for complete flows
- 85%+ code coverage

## Configuration

### Stale Times

```tsx
import { STALE_TIMES } from '@/lib/cache'

STALE_TIMES.REAL_TIME  // 0ms - Always fresh
STALE_TIMES.VOLATILE   // 15s - Fast-changing (fees, prices)
STALE_TIMES.NORMAL     // 30s - Medium-changing (positions, stats)
STALE_TIMES.STABLE     // 5m - Slow-changing (charts)
STALE_TIMES.STATIC     // 1h - Static (token metadata)
```

### GC Times

```tsx
import { GC_TIMES } from '@/lib/cache'

GC_TIMES.SHORT   // 5 minutes
GC_TIMES.MEDIUM  // 30 minutes
GC_TIMES.LONG    // 24 hours
```

## API Reference

### Query Hooks

#### Pools

```tsx
usePoolsBatch()         // All pools with stats
usePoolStats(poolId)    // Individual pool stats
usePoolState(poolId)    // Current pool state (tick, liquidity)
usePoolChart(poolId, 7) // Chart data (7 days)
usePoolFee(poolId)      // Current dynamic fee
```

#### Positions

```tsx
useUserPositionIds(address)              // Position IDs (localStorage)
useUserPositions(address)                // Full position data
useUncollectedFees(positionId)           // Single position fees
useUncollectedFeesBatch(address, ids)    // Batch fees
useUserActivity(address, 50)             // Transaction history
```

### Mutation Hooks

```tsx
useAddLiquidityMutation({ onSuccess, onError })
useRemoveLiquidityMutation({ onSuccess, onError })
useCollectFeesMutation({ onSuccess, onError })
useTransactionMutation(executeFn, { reason, onSuccess, onError })
```

### Utilities

```tsx
// Indexing barriers
setIndexingBarrier(address, blockNumber)
getIndexingBarrier(address)
waitForBarrier(address)

// Invalidation
const orchestrator = useInvalidationOrchestrator()
await orchestrator.invalidateAfterTransaction(context)

// localStorage
getFromLocalStorage(key, ttl)
setToLocalStorage(key, data)
removeFromLocalStorage(key)
```

## Testing

```bash
# Unit tests
npm test tests/cache/

# Integration tests
npm test tests/integration/

# All tests
npm test
```

## Migration

See [CACHE_MIGRATION_GUIDE.md](../../CACHE_MIGRATION_GUIDE.md) for step-by-step instructions.

## Troubleshooting

### Cache not invalidating

1. Check React Query DevTools (bottom-right in dev mode)
2. Look for `[Invalidation]` logs in console
3. Verify query keys match between query and invalidation

### Stale data after transaction

1. Check if barrier timed out (`[Barrier]` logs)
2. Verify subgraph is indexing properly
3. Check server cache revalidation succeeded

### localStorage errors

1. Check browser storage quota
2. Verify SafeStorage is working
3. Clear old versions: `clearStorageVersion('v0')`

## Performance

### Metrics

```tsx
// Check cache hit rates in development
window.__REACT_QUERY_DEVTOOLS__
```

### Optimization Tips

1. Use specific query keys for targeted invalidation
2. Set appropriate stale times for your data
3. Use `enabled` option to prevent unnecessary fetches
4. Batch API calls when possible

## Examples

See:
- [CACHE_MIGRATION_GUIDE.md](../../CACHE_MIGRATION_GUIDE.md) - Migration examples
- [tests/integration/](../../tests/integration/) - Integration test examples
- [app/liquidity/page.tsx](../../app/liquidity/page.tsx) - Real usage (after migration)

## Support

Questions? Check:
1. This README
2. Migration guide
3. Test files for usage examples
4. React Query docs: https://tanstack.com/query/latest
