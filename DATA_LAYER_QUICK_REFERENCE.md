# Data Layer Quick Reference

## Hook Categories & Usage

### 📊 Category 1: Static/Cached Data (Long cache)
```typescript
// Token prices - 5min cache
const { data: prices, isLoading } = useAllPrices();

// Pool stats (TVL, volume) - 10-30min cache
const { data: stats, isLoading } = usePoolStats(poolId);

// Chart data - 30min cache
const { data: chart, isLoading } = usePoolChart(poolId, '1D');
```

### 👤 Category 2: User Data (Manual invalidation)
```typescript
// User positions - invalidate after tx
const { data: positions, isLoading } = useUserPositions(userAddress);

// Uncollected fees - invalidate after collect
const { data: fees, isLoading } = useUncollectedFeesBatch(positionIds);

// Activity history - invalidate after tx
const { data: activity, isLoading } = useActivity(userAddress, limit);
```

### ⚡ Category 3: Real-time Data (Block-driven)
```typescript
// Live pool state - updates on new blocks
const { data: state, isLoading } = usePoolState(poolId);

// Current fee - updates on new blocks
const { data: fee, isLoading } = useDynamicFeeNow(poolId);

// Swap quote - manual trigger
const { data: quote, refetch, isFetching } = useQuote(params, {
  enabled: false // Manual only
});
```

## Common Patterns

### Loading States
```typescript
const { data, isLoading, isError, error } = usePoolState(poolId);

if (isLoading) return <Skeleton />;
if (isError) return <ErrorMessage error={error} />;
return <PoolDisplay data={data} />;
```

### Manual Refetch
```typescript
const { data, refetch, isFetching } = useQuote(params, {
  enabled: false
});

const handleRefresh = () => {
  refetch(); // Manual trigger
};
```

### Transaction Invalidation
```typescript
import { invalidateAfterTx } from '@/lib/invalidation';

await invalidateAfterTx(queryClient, {
  owner: userAddress,
  reason: 'liquidity-added'
});
```

### Block-Driven Updates
```typescript
// Automatic updates on new blocks
useBlockRefetch();
const { data: poolState } = usePoolState(poolId);
```

## Environment Variables

```bash
# Required
SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/your-subgraph
NEXT_PUBLIC_RPC_URL=https://your-rpc-endpoint.com

# Rate Limiting (optional)
SUBGRAPH_RATE_LIMIT_CAPACITY=10
SUBGRAPH_RATE_LIMIT_REFILL=2
USE_RATE_LIMITED_RPC=true

# Logging (optional)
LOG_LEVEL=info
NEXT_PUBLIC_SENTRY_DSN=your-sentry-dsn
```

## Testing Setup

```typescript
// Unit test
import { renderHook, waitFor } from '@testing-library/react';
import { usePoolState } from '@/components/data/hooks';

test('loads pool state', async () => {
  const { result } = renderHook(() => usePoolState('test-pool'));
  await waitFor(() => expect(result.current.data).toBeDefined());
});

// E2E test
import { test, expect } from '@/tests/e2e/test-setup';

test('pool page works', async ({ page }) => {
  await page.goto('/liquidity/test-pool');
  await expect(page.locator('[data-testid="pool-price"]')).toBeVisible();
});
```

## Migration Examples

### Before → After

```typescript
// OLD WAY
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
  fetch('/api/pool-state').then(r => r.json()).then(setData);
}, []);

// NEW WAY
const { data, isLoading } = usePoolState(poolId);
```

## Key Benefits

- ✅ **Automatic caching** - No manual cache management
- ✅ **Type safety** - Full TypeScript support
- ✅ **Error handling** - Centralized error management
- ✅ **Loading states** - Consistent UX patterns
- ✅ **Performance** - Optimized fetching strategies
- ✅ **Testing** - MSW integration for reliable tests
- ✅ **Rate limiting** - Built-in protection against API limits
- ✅ **Observability** - Structured logging and monitoring

## Quick Commands

```bash
# Run tests
npm run test:run

# Run E2E tests
npm run test:e2e

# Check linting
npm run lint

# Development server
npm run dev
```

## Need Help?

1. **Documentation**: `DATA_LAYER_README.md`
2. **Migration Guide**: `DEVELOPER_MIGRATION_GUIDE.md`
3. **Examples**: Check existing migrated components
4. **Tests**: Run test suite to verify patterns


