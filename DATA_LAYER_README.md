# Data Layer Architecture & Usage Guide

## Overview

This project implements a comprehensive, centralized data fetching and caching system built on React Query v5. The architecture categorizes data streams into three distinct categories based on refresh frequency and usage patterns.

## Data Categories

### Category 1: Infrequent Data (Cache-First)
Data that changes infrequently and can be cached aggressively.

**Characteristics:**
- Stale time: 5-30 minutes
- Refetch on window focus: disabled
- GC time: 30-60 minutes
- Perfect for: prices, pool stats, historical data

**Examples:**
```typescript
// Token prices (5min stale)
const { data: prices } = useAllPrices();

// Pool statistics (10-30min stale)
const { data: poolStats } = usePoolStats(poolId);

// Chart data (30min stale)
const { data: chartData } = usePoolChart(poolId, timeframe);
```

### Category 2: User-Action Driven Data (Stale-Infinity)
Data that should only refetch when the user performs specific actions.

**Characteristics:**
- Stale time: Infinity (never refetch automatically)
- Manual invalidation via user actions
- Perfect for: user positions, uncollected fees, portfolio data

**Examples:**
```typescript
// User positions (manual invalidation)
const { data: positions } = useUserPositions(userAddress);

// Uncollected fees (manual invalidation)
const { data: fees } = useUncollectedFeesBatch(positionIds);

// Transaction history (manual invalidation)
const { data: activity } = useActivity(userAddress, limit);
```

### Category 3: Continuous Data (Block-Driven)
Data that requires near-real-time updates based on blockchain state.

**Characteristics:**
- Stale time: 0 (always fresh)
- Block-driven invalidation
- Perfect for: pool state, current prices, quotes

**Examples:**
```typescript
// Live pool state (block-driven)
const { data: poolState } = usePoolState(poolId);

// Dynamic fee (block-driven)
const { data: fee } = useDynamicFeeNow(poolId);

// Swap quotes (on-demand with abort)
const { data: quote, refetch } = useQuote(params, {
  enabled: false, // Manual trigger
  refetchInterval: false
});
```

## Core Components

### Query Keys (`lib/queryKeys.ts`)
Centralized query key definitions with category-specific defaults:

```typescript
import { qk, QUERY_CATEGORY } from '@/lib/queryKeys';

// Usage
queryClient.invalidateQueries({ queryKey: qk.userPositions(userAddress) });
queryClient.invalidateQueries({ queryKey: qk.poolState(poolId) });
```

### React Query Hooks (`components/data/hooks.ts`)
All data fetching logic is centralized in typed hooks:

```typescript
// Category 1
export function useAllPrices() { /* ... */ }
export function usePoolStats(poolId: string) { /* ... */ }

// Category 2
export function useUserPositions(owner: string) { /* ... */ }
export function useUncollectedFees(positionId: string) { /* ... */ }

// Category 3
export function usePoolState(poolId: string) { /* ... */ }
export function useDynamicFeeNow(poolId: string) { /* ... */ }
```

### Server-Side API Routes
All external data fetching is server-side for security and caching:

```typescript
// pages/api/liquidity/get-pool-state.ts
export default async function handler(req, res) {
  const { poolId } = req.query;
  // Fetch from subgraph/RPC with rate limiting
  // Return validated data
}
```

### Rate Limiting (`lib/rateLimiter.ts`)
Comprehensive rate limiting with token bucket algorithm:

```typescript
// Environment variables
SUBGRAPH_RATE_LIMIT_CAPACITY=10    # Max requests
SUBGRAPH_RATE_LIMIT_REFILL=2       # Per second
RPC_RATE_LIMIT_CAPACITY=20
RPC_RATE_LIMIT_REFILL=5
USE_RATE_LIMITED_RPC=true          # Enable for viem client
```

### Validation (`lib/validation.ts`)
Zod-based runtime validation for all API responses:

```typescript
import { validateApiResponse, PoolStateSchema } from '@/lib/validation';

const validatedData = validateApiResponse(PoolStateSchema, apiResponse, 'pool-state');
```

### Logging (`lib/logger.ts`)
Structured logging with optional Sentry integration:

```typescript
import { logger } from '@/lib/logger';

logger.info('Operation completed', { duration: 100, userId });
logger.error('API call failed', error, { endpoint: '/api/prices' });
```

## Usage Patterns

### Basic Hook Usage
```typescript
function MyComponent() {
  const { data, isLoading, error } = usePoolState(poolId);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;

  return <PoolDisplay data={data} />;
}
```

### Manual Refetch (Category 3)
```typescript
function SwapInterface() {
  const { data: quote, refetch } = useQuote(params, {
    enabled: false, // Don't fetch automatically
  });

  const handleAmountChange = async (amount: string) => {
    await refetch(); // Manual refetch on user input
  };

  return <SwapForm onAmountChange={handleAmountChange} quote={quote} />;
}
```

### Transaction Invalidation (Category 2)
```typescript
import { invalidateAfterTx } from '@/lib/invalidation';

async function handleTransaction() {
  try {
    const tx = await walletClient.sendTransaction(txData);
    await tx.wait();

    // Invalidate all related queries
    await invalidateAfterTx(queryClient, {
      owner: userAddress,
      reason: 'liquidity-added'
    });
  } catch (error) {
    console.error('Transaction failed:', error);
  }
}
```

### Block-Driven Refetch (Category 3)
```typescript
function PoolDashboard() {
  // This hook automatically invalidates when new blocks arrive
  useBlockRefetch({
    onBlock: (blockNumber) => {
      console.log('New block:', blockNumber);
    }
  });

  const { data: poolState } = usePoolState(poolId);
  // Data automatically updates on new blocks
}
```

## Migration Guide

### From Manual Fetching
```typescript
// OLD: Manual fetch in component
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
  fetch('/api/pool-state')
    .then(res => res.json())
    .then(setData)
    .finally(() => setLoading(false));
}, []);

// NEW: Use centralized hook
const { data, isLoading } = usePoolState(poolId);
```

### From Direct Subgraph Calls
```typescript
// OLD: Direct client-side subgraph
const { loading, data } = useQuery(POOL_QUERY, { variables });

// NEW: Server-side via hook
const { data, isLoading } = usePoolState(poolId);
```

### From Custom Cache
```typescript
// OLD: Custom cache management
const cache = new Map();
function getCachedData(key) { /* ... */ }

// NEW: React Query handles everything
const { data } = usePoolStats(poolId); // Automatic caching
```

## Environment Configuration

```bash
# Required
SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/your-subgraph
NEXT_PUBLIC_RPC_URL=https://your-rpc-endpoint.com

# Optional (with defaults)
SUBGRAPH_MAX_CONCURRENCY=4
SUBGRAPH_RATE_LIMIT_CAPACITY=10
SUBGRAPH_RATE_LIMIT_REFILL=2
RPC_RATE_LIMIT_CAPACITY=20
RPC_RATE_LIMIT_REFILL=5
USE_RATE_LIMITED_RPC=true

# Logging
LOG_LEVEL=info
NEXT_PUBLIC_SENTRY_DSN=your-sentry-dsn
```

## Testing

### Unit Tests
```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { usePoolState } from '@/components/data/hooks';

test('usePoolState returns pool data', async () => {
  const { result } = renderHook(() => usePoolState('pool-123'));

  await waitFor(() => {
    expect(result.current.data).toBeDefined();
  });
});
```

### Integration Tests
```typescript
import { server } from '@/tests/mocks/server';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('API routes work with MSW', async () => {
  const response = await fetch('/api/liquidity/get-pool-state?poolId=test');
  expect(response.ok).toBe(true);
});
```

### E2E Tests
```typescript
import { test, expect } from '@/tests/e2e/test-setup';

test('pool page loads correctly', async ({ page }) => {
  await page.goto('/liquidity/test-pool');
  await expect(page.locator('[data-testid="pool-price"]')).toBeVisible();
});
```

## Best Practices

### 1. Always Use Hooks
- Never call `queryClient` directly in components
- Use provided hooks for all data fetching
- Let React Query handle caching automatically

### 2. Proper Error Handling
```typescript
const { data, error, isError } = usePoolState(poolId);

if (isError) {
  logger.error('Failed to load pool state', error);
  return <ErrorFallback />;
}
```

### 3. Loading States
```typescript
const { data, isLoading, isFetching } = usePoolState(poolId);

// Use isLoading for initial load, isFetching for refetch
if (isLoading) return <Skeleton />;
if (data) return <PoolData data={data} />;
```

### 4. Optimistic Updates
```typescript
const queryClient = useQueryClient();

const handleTransaction = async () => {
  // Optimistic update
  queryClient.setQueryData(qk.poolState(poolId), newState);

  try {
    await executeTransaction();
  } catch (error) {
    // Revert on failure
    queryClient.invalidateQueries({ queryKey: qk.poolState(poolId) });
  }
};
```

### 5. Debouncing
```typescript
const { data: quote } = useQuote(params, {
  enabled: params.amount > 0,
  refetchInterval: false, // No auto-refetch
});

// Debounce in component
const debouncedRefetch = useDebounce(refetch, 300);
```

## Performance Considerations

### Query Key Structure
- Use stable, serializable keys
- Include all variables that affect the result
- Follow the established patterns in `lib/queryKeys.ts`

### Cache Management
- Category 1: Long stale times, aggressive caching
- Category 2: Manual invalidation, infinite stale time
- Category 3: Block-driven, minimal caching

### Bundle Size
- Only import hooks you need
- Server-side validation reduces client bundle
- Tree-shaking friendly structure

## Troubleshooting

### Common Issues

1. **Data not updating**: Check if you're using the right category
2. **Rate limits**: Verify environment variables are set
3. **Validation errors**: Check API response format matches Zod schema
4. **Infinite loading**: Ensure MSW handlers are set up in tests

### Debug Logging
```typescript
// Enable debug logging
process.env.LOG_LEVEL = 'debug';

// Check rate limiter status
import { getRateLimitStatus } from '@/lib/rateLimiter';
console.log(getRateLimitStatus());
```

## Contributing

### Adding New Hooks
1. Add to `components/data/hooks.ts`
2. Follow category conventions
3. Include proper error handling
4. Add TypeScript types
5. Write unit tests

### Adding New API Routes
1. Create in `pages/api/`
2. Use rate limiting middleware
3. Add Zod validation
4. Include proper error handling
5. Add MSW handlers for testing

### Environment Variables
- Document new env vars in this guide
- Provide sensible defaults
- Update Docker/config examples

---

This data layer provides a robust, scalable foundation for all data operations in the application. The three-category system ensures optimal performance while maintaining data freshness where needed.


