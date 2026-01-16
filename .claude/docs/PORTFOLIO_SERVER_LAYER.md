# Portfolio Server Layer Architecture

## Overview

This document outlines a server layer to provide portfolio analytics, activity history, and historical data for the Alphix Portfolio page. Since Uniswap's portfolio APIs are internal/private, we need to build our own data layer.

## Data Gaps to Fill

| Feature | Current Status | Priority |
|---------|---------------|----------|
| Activity History | Endpoint incomplete | P0 |
| Portfolio Value Chart | Missing | P1 |
| Position Entry Prices | Missing | P1 |
| PnL Calculations | Missing | P2 |
| Historical Prices | Pool-level only | P2 |
| Fee Earnings History | Missing | P3 |

---

## Architecture Options

### Option A: Subgraph-Only (Recommended for MVP)
- Query Base subgraph directly for on-chain events
- Calculate portfolio metrics client-side
- No additional infrastructure needed
- Limited to 30-day history (subgraph retention)

### Option B: Hybrid with Supabase (Recommended for Full Feature Set)
- Use subgraph for real-time data
- Store historical snapshots in Supabase
- Background jobs to index events and prices
- Full historical data retention

### Option C: Full Indexer
- Custom indexer using Ponder/Subsquid
- Complete control over data model
- Higher complexity and maintenance

---

## Recommended Implementation: Option B (Hybrid)

### Database Schema (Supabase)

```sql
-- Portfolio value snapshots (hourly/daily)
CREATE TABLE portfolio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  total_value_usd NUMERIC(20, 8),
  positions_value_usd NUMERIC(20, 8),
  token_balances JSONB, -- { symbol: amount, usdValue }
  chain_id INTEGER DEFAULT 8453,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wallet_address, timestamp, chain_id)
);

-- Position entry data (when positions are created)
CREATE TABLE position_entries (
  position_id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  entry_timestamp TIMESTAMPTZ NOT NULL,
  entry_price_token0 NUMERIC(30, 18),
  entry_price_token1 NUMERIC(30, 18),
  entry_amount0 NUMERIC(30, 18),
  entry_amount1 NUMERIC(30, 18),
  entry_value_usd NUMERIC(20, 8),
  chain_id INTEGER DEFAULT 8453,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activity events (swaps, mints, burns, collects)
CREATE TABLE activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'swap', 'mint', 'burn', 'collect'
  timestamp TIMESTAMPTZ NOT NULL,
  pool_id TEXT,
  position_id TEXT,
  token0_symbol TEXT,
  token0_amount NUMERIC(30, 18),
  token0_usd_value NUMERIC(20, 8),
  token1_symbol TEXT,
  token1_amount NUMERIC(30, 18),
  token1_usd_value NUMERIC(20, 8),
  total_usd_value NUMERIC(20, 8),
  gas_used NUMERIC(20, 0),
  gas_price NUMERIC(20, 0),
  chain_id INTEGER DEFAULT 8453,
  block_number BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tx_hash, event_type, chain_id)
);

-- Token price history (hourly)
CREATE TABLE token_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_address TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  price_usd NUMERIC(20, 8),
  chain_id INTEGER DEFAULT 8453,
  UNIQUE(token_address, timestamp, chain_id)
);

-- Indexes
CREATE INDEX idx_portfolio_snapshots_wallet ON portfolio_snapshots(wallet_address, timestamp DESC);
CREATE INDEX idx_activity_events_wallet ON activity_events(wallet_address, timestamp DESC);
CREATE INDEX idx_activity_events_type ON activity_events(event_type, timestamp DESC);
CREATE INDEX idx_position_entries_wallet ON position_entries(wallet_address);
CREATE INDEX idx_token_prices_symbol ON token_prices(symbol, timestamp DESC);
```

---

## API Endpoints

### 1. Activity History (P0)

**Endpoint:** `GET /api/portfolio/activity`

```typescript
// app/api/portfolio/activity/route.ts
interface ActivityQuery {
  address: string;
  limit?: number;      // default 50
  offset?: number;     // for pagination
  type?: 'all' | 'swap' | 'mint' | 'burn' | 'collect';
  startTime?: number;  // unix timestamp
  endTime?: number;
  network?: 'mainnet' | 'testnet';
}

interface ActivityResponse {
  items: ActivityItem[];
  total: number;
  hasMore: boolean;
}

interface ActivityItem {
  id: string;
  type: 'swap' | 'mint' | 'burn' | 'collect';
  timestamp: number;
  txHash: string;
  poolId?: string;
  positionId?: string;
  token0: { symbol: string; amount: string; usdValue: number };
  token1: { symbol: string; amount: string; usdValue: number };
  totalUsdValue: number;
  gasUsed?: string;
}
```

**Implementation Strategy:**
1. First, try to fetch from Supabase `activity_events` table
2. If not found or stale, query subgraph directly
3. Cache results in Supabase for future queries

**Subgraph Query:**
```graphql
query GetUserActivity($owner: String!, $first: Int!, $skip: Int!) {
  # Swaps where user is sender
  swaps(
    first: $first
    skip: $skip
    where: { origin: $owner }
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    transaction { id, blockNumber, timestamp, gasUsed, gasPrice }
    pool { id, token0 { symbol, decimals }, token1 { symbol, decimals } }
    sender
    recipient
    amount0
    amount1
    amountUSD
  }

  # Liquidity additions
  mints(
    first: $first
    skip: $skip
    where: { origin: $owner }
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    transaction { id, blockNumber, timestamp }
    pool { id, token0 { symbol, decimals }, token1 { symbol, decimals } }
    owner
    amount0
    amount1
    amountUSD
  }

  # Liquidity removals
  burns(
    first: $first
    skip: $skip
    where: { origin: $owner }
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    transaction { id, blockNumber, timestamp }
    pool { id, token0 { symbol, decimals }, token1 { symbol, decimals } }
    owner
    amount0
    amount1
    amountUSD
  }

  # Fee collections
  collects(
    first: $first
    skip: $skip
    where: { owner: $owner }
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    transaction { id, blockNumber, timestamp }
    pool { id, token0 { symbol, decimals }, token1 { symbol, decimals } }
    owner
    amount0
    amount1
  }
}
```

---

### 2. Portfolio Value Chart (P1)

**Endpoint:** `GET /api/portfolio/chart`

```typescript
interface ChartQuery {
  address: string;
  period: 'day' | 'week' | 'month' | 'year' | 'all';
  network?: 'mainnet' | 'testnet';
}

interface ChartResponse {
  points: ChartPoint[];
  currentValue: number;
  change24h: { absolute: number; percentage: number };
  changeTotal: { absolute: number; percentage: number };
}

interface ChartPoint {
  timestamp: number;
  value: number;
}
```

**Implementation Strategy:**
1. Fetch historical snapshots from `portfolio_snapshots` table
2. If no snapshots exist, calculate current value only
3. Background job creates snapshots hourly

**Background Job (Cron):**
```typescript
// Run every hour via Vercel Cron or similar
async function snapshotPortfolios() {
  // Get all active wallets (wallets with positions)
  const activeWallets = await getActiveWallets();

  for (const wallet of activeWallets) {
    // Get current positions value
    const positions = await fetchUserPositions(wallet);
    const prices = await fetchCurrentPrices();

    const totalValue = calculatePortfolioValue(positions, prices);

    // Insert snapshot
    await supabase.from('portfolio_snapshots').insert({
      wallet_address: wallet,
      timestamp: new Date().toISOString(),
      total_value_usd: totalValue,
      positions_value_usd: totalValue,
      token_balances: positions.tokenBalances,
    });
  }
}
```

---

### 3. Position Entry Prices (P1)

**Endpoint:** `GET /api/portfolio/positions/entries`

```typescript
interface EntriesQuery {
  address: string;
  positionIds?: string[];
}

interface EntriesResponse {
  entries: PositionEntry[];
}

interface PositionEntry {
  positionId: string;
  poolId: string;
  entryTimestamp: number;
  entryPrices: { token0: number; token1: number };
  entryAmounts: { token0: string; token1: string };
  entryValueUsd: number;
  currentValueUsd: number;
  pnlUsd: number;
  pnlPercentage: number;
}
```

**Implementation Strategy:**
1. Listen for `Mint` events on PositionManager contract
2. Record entry prices at time of position creation
3. Calculate PnL by comparing entry vs current value

**Event Listener (Webhook or Polling):**
```typescript
// Listen for position creation events
async function handleMintEvent(event: MintEvent) {
  const { positionId, owner, pool, amount0, amount1, timestamp } = event;

  // Get prices at time of mint
  const prices = await getHistoricalPrices(pool.token0, pool.token1, timestamp);

  // Calculate entry value
  const entryValueUsd =
    parseFloat(amount0) * prices.token0 +
    parseFloat(amount1) * prices.token1;

  await supabase.from('position_entries').insert({
    position_id: positionId,
    wallet_address: owner,
    pool_id: pool.id,
    entry_timestamp: new Date(timestamp * 1000).toISOString(),
    entry_price_token0: prices.token0,
    entry_price_token1: prices.token1,
    entry_amount0: amount0,
    entry_amount1: amount1,
    entry_value_usd: entryValueUsd,
  });
}
```

---

### 4. Token Price History (P2)

**Endpoint:** `GET /api/prices/history`

```typescript
interface PriceHistoryQuery {
  symbols: string[];  // ['ETH', 'USDC']
  period: 'day' | 'week' | 'month' | 'year';
}

interface PriceHistoryResponse {
  prices: Record<string, PricePoint[]>;
}

interface PricePoint {
  timestamp: number;
  price: number;
}
```

**Data Sources:**
1. **CoinGecko API** (free tier: 10-30 calls/min)
2. **DefiLlama API** (free, good for DeFi tokens)
3. **Pool price from subgraph** (for LP tokens)

**Background Job:**
```typescript
// Run every hour
async function indexTokenPrices() {
  const tokens = await getTrackedTokens();

  for (const token of tokens) {
    const price = await fetchPrice(token.address);

    await supabase.from('token_prices').insert({
      token_address: token.address,
      symbol: token.symbol,
      timestamp: new Date().toISOString(),
      price_usd: price,
    });
  }
}
```

---

## Frontend Integration

### New Hooks

```typescript
// hooks/usePortfolioChart.ts
export function usePortfolioChart(address: string, period: ChartPeriod) {
  return useQuery({
    queryKey: ['portfolio-chart', address, period],
    queryFn: () => fetch(`/api/portfolio/chart?address=${address}&period=${period}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// hooks/useActivityHistory.ts
export function useActivityHistory(address: string, options?: ActivityOptions) {
  return useInfiniteQuery({
    queryKey: ['activity', address, options],
    queryFn: ({ pageParam = 0 }) =>
      fetch(`/api/portfolio/activity?address=${address}&offset=${pageParam}&limit=20`).then(r => r.json()),
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore ? pages.length * 20 : undefined,
  });
}

// hooks/usePositionPnL.ts
export function usePositionPnL(address: string) {
  return useQuery({
    queryKey: ['position-entries', address],
    queryFn: () => fetch(`/api/portfolio/positions/entries?address=${address}`).then(r => r.json()),
  });
}
```

---

## Implementation Phases

### Phase 1: Activity History (1-2 days)
1. Fix `/api/portfolio/activity` endpoint
2. Query subgraph for swaps, mints, burns, collects
3. Merge and sort by timestamp
4. Add pagination support
5. Update `useRecentActivity` hook

### Phase 2: Portfolio Snapshots (2-3 days)
1. Create Supabase tables
2. Implement snapshot background job
3. Create `/api/portfolio/chart` endpoint
4. Build chart component with period selector

### Phase 3: Position Entry Tracking (1-2 days)
1. Listen for Mint events
2. Record entry prices in database
3. Calculate PnL on position cards
4. Add PnL column to positions table

### Phase 4: Price History (1 day)
1. Set up CoinGecko/DefiLlama integration
2. Create hourly price indexing job
3. Expose `/api/prices/history` endpoint

---

## Alternative: Quick Win with Subgraph Only

If you want a faster solution without Supabase, you can implement Activity History using just the subgraph:

```typescript
// app/api/portfolio/activity/route.ts
import { request, gql } from 'graphql-request';

const SUBGRAPH_URL = process.env.SUBGRAPH_URL;

const ACTIVITY_QUERY = gql`
  query GetActivity($owner: String!, $first: Int!) {
    swaps(first: $first, where: { origin: $owner }, orderBy: timestamp, orderDirection: desc) {
      id
      timestamp
      transaction { id }
      pool { id, token0 { symbol }, token1 { symbol } }
      amount0
      amount1
      amountUSD
    }
    mints(first: $first, where: { origin: $owner }, orderBy: timestamp, orderDirection: desc) {
      id
      timestamp
      transaction { id }
      pool { id, token0 { symbol }, token1 { symbol } }
      amount0
      amount1
      amountUSD
    }
    burns(first: $first, where: { origin: $owner }, orderBy: timestamp, orderDirection: desc) {
      id
      timestamp
      transaction { id }
      pool { id, token0 { symbol }, token1 { symbol } }
      amount0
      amount1
      amountUSD
    }
  }
`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');
  const limit = parseInt(searchParams.get('limit') || '50');

  if (!address) {
    return Response.json({ error: 'Address required' }, { status: 400 });
  }

  try {
    const data = await request(SUBGRAPH_URL, ACTIVITY_QUERY, {
      owner: address.toLowerCase(),
      first: limit,
    });

    // Merge and sort all activities
    const activities = [
      ...data.swaps.map(s => ({ ...s, type: 'swap' })),
      ...data.mints.map(m => ({ ...m, type: 'mint' })),
      ...data.burns.map(b => ({ ...b, type: 'burn' })),
    ].sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

    return Response.json({
      items: activities.map(a => ({
        id: a.id,
        type: a.type,
        timestamp: Number(a.timestamp),
        txHash: a.transaction.id,
        poolId: a.pool.id,
        token0: { symbol: a.pool.token0.symbol, amount: a.amount0 },
        token1: { symbol: a.pool.token1.symbol, amount: a.amount1 },
        totalUsdValue: parseFloat(a.amountUSD || '0'),
      })),
      total: activities.length,
      hasMore: activities.length === limit,
    });
  } catch (error) {
    console.error('Activity fetch error:', error);
    return Response.json({ items: [], total: 0, hasMore: false });
  }
}
```

---

## Resources

- [Uniswap V3 Subgraph](https://thegraph.com/hosted-service/subgraph/uniswap/uniswap-v3)
- [Base Subgraph](https://api.studio.thegraph.com/query/48211/uniswap-v3-base/version/latest)
- [CoinGecko API](https://www.coingecko.com/en/api/documentation)
- [DefiLlama API](https://defillama.com/docs/api)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
