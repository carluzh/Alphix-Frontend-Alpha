# Developer Migration Guide: From Ad-hoc to Centralized Data Fetching

## Quick Start

If you're new to the codebase or need to quickly understand the new data layer:

1. **Read the main documentation**: `DATA_LAYER_README.md`
2. **Use the hooks**: Replace manual fetches with provided hooks
3. **Follow the patterns**: Use the three-category system
4. **Test thoroughly**: All changes include comprehensive test coverage

## Migration Checklist

### ✅ Phase 1: Assessment (5-10 minutes)
- [ ] Identify all `fetch()` calls in your components
- [ ] Find `useEffect` hooks managing data state
- [ ] Locate direct subgraph queries
- [ ] Check for custom caching logic

### ✅ Phase 2: Hook Replacement (15-30 minutes per component)
- [ ] Replace `fetch()` calls with appropriate hooks
- [ ] Remove manual `useState` for data management
- [ ] Update loading/error states to use hook values
- [ ] Remove manual `useEffect` dependencies

### ✅ Phase 3: Testing & Validation (10-15 minutes)
- [ ] Run existing tests to ensure no regressions
- [ ] Test user interactions that trigger data updates
- [ ] Verify loading states work correctly
- [ ] Check error handling scenarios

## Common Migration Patterns

### Pattern 1: Simple Data Fetch
```typescript
// BEFORE
function PoolInfo({ poolId }) {
  const [poolData, setPoolData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/pool/${poolId}`)
      .then(res => res.json())
      .then(setPoolData)
      .finally(() => setLoading(false));
  }, [poolId]);

  if (loading) return <div>Loading...</div>;
  return <div>TVL: {poolData?.tvl}</div>;
}

// AFTER
function PoolInfo({ poolId }) {
  const { data: poolData, isLoading } = usePoolStats(poolId);

  if (isLoading) return <div>Loading...</div>;
  return <div>TVL: {poolData?.tvl}</div>;
}
```

### Pattern 2: Manual Refetch on Action
```typescript
// BEFORE
function RefreshableData({ poolId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/pool/${poolId}`);
      const newData = await response.json();
      setData(newData);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [poolId]);

  return (
    <div>
      <button onClick={refresh} disabled={loading}>
        {loading ? 'Refreshing...' : 'Refresh'}
      </button>
      <PoolDisplay data={data} />
    </div>
  );
}

// AFTER
function RefreshableData({ poolId }) {
  const { data, isFetching, refetch } = usePoolStats(poolId);

  return (
    <div>
      <button onClick={() => refetch()} disabled={isFetching}>
        {isFetching ? 'Refreshing...' : 'Refresh'}
      </button>
      <PoolDisplay data={data} />
    </div>
  );
}
```

### Pattern 3: Form-Driven Data Fetching
```typescript
// BEFORE
function SearchComponent() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const search = async (searchQuery) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/search?q=${searchQuery}`);
      const data = await response.json();
      setResults(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (query.length > 2) {
      const timeoutId = setTimeout(() => search(query), 300);
      return () => clearTimeout(timeoutId);
    }
  }, [query]);

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search..."
      />
      {loading && <div>Searching...</div>}
      <ResultsList results={results} />
    </div>
  );
}

// AFTER
function SearchComponent() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  const { data: results, isLoading } = useSearchResults(debouncedQuery, {
    enabled: debouncedQuery.length > 2,
  });

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search..."
      />
      {isLoading && <div>Searching...</div>}
      <ResultsList results={results || []} />
    </div>
  );
}
```

### Pattern 4: Transaction-Based Invalidation
```typescript
// BEFORE
function AddLiquidityForm({ poolId, onSuccess }) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (formData) => {
    setIsSubmitting(true);
    try {
      const tx = await addLiquidity(formData);
      await tx.wait();

      // Manual cache invalidation
      queryClient.invalidateQueries(['pool', poolId]);
      queryClient.invalidateQueries(['user-positions']);
      queryClient.invalidateQueries(['uncollected-fees']);

      onSuccess();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* form fields */}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Adding Liquidity...' : 'Add Liquidity'}
      </button>
    </form>
  );
}

// AFTER
function AddLiquidityForm({ poolId, onSuccess }) {
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (formData) => {
    setIsSubmitting(true);
    try {
      const tx = await addLiquidity(formData);
      await tx.wait();

      // Centralized invalidation
      await invalidateAfterTx(queryClient, {
        owner: userAddress,
        reason: 'liquidity-added',
        poolIds: [poolId]
      });

      onSuccess();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* form fields */}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Adding Liquidity...' : 'Add Liquidity'}
      </button>
    </form>
  );
}
```

## Category-Specific Migrations

### Category 1: Static/Reference Data
**When to use**: Prices, pool lists, historical data
**Migration**: Replace with `useAllPrices()`, `usePoolStats()`, etc.
**Cache strategy**: Long stale times, aggressive caching

### Category 2: User-Specific Data
**When to use**: Positions, balances, transaction history
**Migration**: Replace with `useUserPositions()`, `useUncollectedFees()`, etc.
**Cache strategy**: Manual invalidation after user actions

### Category 3: Real-time Data
**When to use**: Current prices, pool state, quotes
**Migration**: Replace with `usePoolState()`, `useDynamicFeeNow()`, etc.
**Cache strategy**: Block-driven invalidation

## Error Handling Migration

### Before: Manual Error Handling
```typescript
const [error, setError] = useState(null);

try {
  const data = await fetch('/api/data');
  // handle data
} catch (err) {
  setError(err);
}

if (error) {
  return <ErrorMessage error={error} />;
}
```

### After: React Query Error Handling
```typescript
const { data, error, isError } = useDataHook();

if (isError) {
  logger.error('Data fetch failed', error);
  return <ErrorMessage error={error} />;
}
```

## Testing Migration

### Unit Tests
```typescript
// BEFORE
test('fetches data correctly', async () => {
  const mockData = { /* ... */ };
  global.fetch = jest.fn(() => Promise.resolve({
    json: () => Promise.resolve(mockData)
  }));

  const { result } = renderHook(() => useCustomHook());
  await waitFor(() => expect(result.current.data).toEqual(mockData));
});

// AFTER
test('fetches data correctly', async () => {
  const { result } = renderHook(() => usePoolState('test-pool'));
  await waitFor(() => expect(result.current.data).toBeDefined());
});
// MSW handles mocking automatically
```

### Integration Tests
```typescript
// BEFORE
test('API integration', async () => {
  const response = await request(app)
    .get('/api/test')
    .expect(200);

  expect(response.body).toHaveProperty('data');
});

// AFTER
test('API integration', async () => {
  const response = await fetch('/api/test');
  expect(response.ok).toBe(true);

  const data = await response.json();
  expect(data).toHaveProperty('data');
});
// MSW provides consistent mocking
```

## Common Pitfalls & Solutions

### 1. Forgetting to Handle Loading States
```typescript
// ❌ Wrong
const { data } = usePoolState(poolId);
return <div>Price: {data.price}</div>;

// ✅ Correct
const { data, isLoading } = usePoolState(poolId);
if (isLoading) return <Skeleton />;
return <div>Price: {data?.price}</div>;
```

### 2. Over-fetching Data
```typescript
// ❌ Wrong - fetches on every render
const { data } = usePoolState(poolId);

// ✅ Correct - only fetch when needed
const { data } = usePoolState(poolId, {
  enabled: !!poolId && isVisible
});
```

### 3. Not Using Proper Query Keys
```typescript
// ❌ Wrong - generic key
queryClient.invalidateQueries(['pool-data']);

// ✅ Correct - specific key
queryClient.invalidateQueries({ queryKey: qk.poolState(poolId) });
```

### 4. Race Conditions in Forms
```typescript
// ❌ Wrong - multiple simultaneous requests
const handleAmountChange = (amount) => {
  refetch(); // Called on every keystroke
};

// ✅ Correct - debounced
const debouncedRefetch = useDebounce(refetch, 300);
const handleAmountChange = (amount) => {
  debouncedRefetch();
};
```

## Performance Tips

1. **Use the right category**: Don't use Category 3 for static data
2. **Enable/disable queries**: Use `enabled` option to prevent unnecessary fetches
3. **Debounce user input**: Always debounce form inputs before triggering fetches
4. **Optimistic updates**: Update UI immediately, revert on failure
5. **Background refetch**: Let React Query handle background updates

## Rollback Plan

If you need to rollback a migration:

1. **Keep the old code**: Comment out rather than delete
2. **Gradual migration**: Migrate one component at a time
3. **Feature flags**: Use environment variables to switch implementations
4. **Test coverage**: Ensure tests cover both old and new implementations

## Need Help?

1. **Check the examples**: Look at already migrated components
2. **Read the docs**: `DATA_LAYER_README.md` has detailed usage examples
3. **Run tests**: Use the test suite to verify your migrations
4. **Ask questions**: The patterns are well-established and documented

## Success Metrics

After migration, you should see:
- ✅ Fewer manual state management
- ✅ Consistent loading/error states
- ✅ Automatic caching and invalidation
- ✅ Better TypeScript support
- ✅ Improved test coverage
- ✅ Reduced bundle size (server-side fetching)
- ✅ Better error handling and logging

Remember: The goal is cleaner, more maintainable code with better user experience through optimized data fetching and caching.


