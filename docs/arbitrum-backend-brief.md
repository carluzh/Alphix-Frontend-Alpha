# Alphix Backend API — Arbitrum One Support Brief

> **Goal**: Enable `api.alphix.fi` to serve Arbitrum One data. The frontend is already multi-chain — all API calls pass `?network=arbitrum`. The backend just needs to index Arbitrum and respond to those requests.

---

## 1. Network Parameter Convention

The frontend sends a `network` query param on every request. Mapping:

| Frontend NetworkMode | `?network=` value | Chain ID |
|---|---|---|
| `mainnet` | `base` | 8453 |
| `arbitrum` | `arbitrum` | 42161 |
| `testnet` | `base-sepolia` | 84532 |

**The frontend already sends `?network=arbitrum` for all endpoints.** The backend needs to route these to Arbitrum data sources.

---

## 2. Arbitrum Chain Configuration

### Subgraph (Goldsky)
```
https://api.goldsky.com/api/public/project_cmktm2w8l5s0k01u9fz2yetrw/subgraphs/alphix-arbitrum/v0.0.4/gn
```

### Goldsky Webhook Detection
For the webhook network detection logic, the Arbitrum data source name contains `"arbitrum"` (e.g., `alphix-arbitrum/v0.0.4`). Use this to route incoming webhook data to the Arbitrum dataset.

### Uniswap V4 Contracts on Arbitrum
```
PoolManager:      0x360e68faccca8ca495c1b759fd9eee466db9fb32
PositionManager:  0xd88f38f930b7952f2db2432cb002e7abbf3dd869
StateView:        0x76fd297e2d437cd7f76d50f01afe6160f86e9990
UniversalRouter:  0xa51afafe0263b40edaef0df8781ea9aa03e381a3
Quoter:           0x3972c00f7ed4885e145823eb7c655375d275a1c5
```

### Alphix Hook & Yield Contracts on Arbitrum
```
AlphixHook:       0x5e645C3D580976Ca9e3fe77525D954E73a0Ce0C0
AccessManager:    0x56Ec52a214de51ad7DbbEb990a88b9625257Ed9D
HookOwner:        0xe231a6e1E18aC6A123cd0EaEA8C4Ca07E50E8800
YieldManager:     0x1F3f02cE8Cd8D97F1caB75429eaDCb1571bdAe35
YieldTreasury:    0x240B7e8FcfdB38C94c0b8733A4A50F28A4C99fa8

# Aave Wrappers (rehypothecation)
WrapperUSDC:      0x968eD10776AC144308ae4160E2F5017A6999126C  (aToken: 0x724dc807b04555b71ed48a6896b6F41593b8C637, symbol: awaUSDC)
WrapperUSDT:      0x7d1613B33e0d0E5c0707287b148CAdb3590e702a  (aToken: 0x6ab707Aca953eDAeFBc4fD23bA73294241490620, symbol: awaUSDT)
```

### Pool: USDC/USDT (Stable, Aave rehypo)
```
Subgraph ID:  0xe2c28a234aadc40f115dcc56b70a759d02a372db90dfeed19048392d942ee286
Currency0:    USDC  0xaf88d065e77c8cC2239327C5EDb3A432268e5831 (6 decimals)
Currency1:    USDT  0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 (6 decimals)
Fee:          8388608 (dynamic)
TickSpacing:  1
Hooks:        0x5e645C3D580976Ca9e3fe77525D954E73a0Ce0C0
Type:         Stable
YieldSources: [aave]
RehypoRange:  min=-8, max=8
```

### RPC
> **TODO**: Carl to provide Arbitrum RPC URL (env var `ARBITRUM_RPC_URL` or hardcode a public one like `https://arb1.arbitrum.io/rpc`)

---

## 3. REST Endpoints — Full Inventory

Every endpoint below already works for `?network=base`. Each needs to also handle `?network=arbitrum`.

### 3.1 Pool Metrics (Liquidity Page — main table stats)
```
GET /pools/metrics?network=arbitrum
```
**Returns**: Array of pool metrics (TVL, volume 24h, fees 24h, APR, lending yield, token prices) for ALL Arbitrum pools.
**Response shape**:
```json
{
  "success": true,
  "network": "arbitrum",
  "pools": [{
    "poolId": "0xe2c28a...",
    "name": "USDC/USDT",
    "network": "arbitrum",
    "tvlUsd": 123456.78,
    "volume24hUsd": 45678.90,
    "fees24hUsd": 12.34,
    "lendingYield24hUsd": 5.67,
    "totalFees24hUsd": 18.01,
    "lpFee": 0.0001,
    "token0Price": 1.0,
    "token1Price": 1.0,
    "timestamp": 1709900000
  }],
  "timestamp": 1709900000
}
```
**Used by**: Liquidity listing page — the TVL, Volume, Fees, APR columns.

---

### 3.2 Pool History (Pool Detail Page — TVL & Volume Charts)
```
GET /pools/{poolId}/history?network=arbitrum&period=DAY|WEEK|MONTH
```
**Returns**: Time-series of pool snapshots.
**Response shape**:
```json
{
  "success": true,
  "poolId": "0xe2c28a...",
  "period": "WEEK",
  "fromTimestamp": 1709000000,
  "toTimestamp": 1709900000,
  "snapshotCount": 168,
  "snapshots": [{
    "timestamp": 1709000000,
    "tick": 0,
    "sqrtPriceX96": "79228162514264337593543950336",
    "liquidity": "1234567890",
    "tvlToken0": 50000,
    "tvlToken1": 50000,
    "tvlUSD": 100000,
    "volumeUSD": 5000,
    "feesUSD": 1.5
  }]
}
```
**Used by**: Pool detail page TVL chart, Volume chart.

---

### 3.3 Pool Current State (Pool Detail Page — Header Stats)
```
GET /pools/{poolId}/current?network=arbitrum
```
**Returns**: Latest snapshot for a single pool.
**Response shape**:
```json
{
  "success": true,
  "snapshot": { /* same shape as PoolSnapshot above */ }
}
```
**Used by**: Pool detail page header (current TVL, volume, fees, tick, price).

---

### 3.4 Pool Prices (Token Prices)
```
GET /pools/{poolId}/prices?network=arbitrum
```
**Returns**: Current USD prices of both tokens in the pool.
**Response shape**:
```json
{
  "success": true,
  "poolId": "0xe2c28a...",
  "token0Price": 1.0001,
  "token1Price": 0.9999
}
```
**Used by**: Pool detail page, position value calculations.

---

### 3.5 Pool Price History (Pool Detail Page — Price Chart)
```
GET /pools/{poolId}/prices/history?network=arbitrum&period=DAY|WEEK|MONTH
```
**Returns**: Historical USD prices for both tokens.
**Response shape**:
```json
{
  "success": true,
  "poolId": "0xe2c28a...",
  "period": "WEEK",
  "points": [{
    "timestamp": 1709000000,
    "token0PriceUsd": 1.0001,
    "token1PriceUsd": 0.9999,
    "tick": 0
  }]
}
```
**Used by**: Pool detail page price chart.

---

### 3.6 Position Fees (Position Detail — Fee History)
```
GET /position/{positionId}/fees?network=arbitrum&period=DAY|WEEK|MONTH
```
**Note**: `positionId` is a 66-char hex string (e.g., `0x00000000...000e054b`).
**Returns**: Fee snapshots over time.
**Response shape**:
```json
{
  "success": true,
  "positionId": "0x000...054b",
  "period": "WEEK",
  "fromTimestamp": 1709000000,
  "toTimestamp": 1709900000,
  "points": [{
    "timestamp": 1709000000,
    "feesUsd": 0.05,
    "accumulatedFeesUsd": 1.23,
    "apr": 5.67
  }]
}
```
**Used by**: Position detail page fee chart.

---

### 3.7 Position APR (Position Detail — Yield Display)
```
GET /position/{positionId}/apr?network=arbitrum
```
**Returns**: 7-day average APR for a specific LP position.
**Response shape**:
```json
{
  "success": true,
  "positionId": "0x000...054b",
  "apr7d": 1.826,
  "apr7dPercent": "1.83%",
  "dataPoints": 168,
  "inRangeDataPoints": 160,
  "daysCovered": 7,
  "latestValueUsd": 1000.50
}
```
**Used by**: Position detail page yield display.

---

### 3.8 Portfolio Chart (Overview Page — Portfolio Value Chart)
```
GET /portfolio/chart?network=arbitrum&address={wallet}&period=DAY|WEEK|MONTH
```
**Returns**: Historical portfolio value (sum of all position values) for a user on Arbitrum.
**Response shape**:
```json
{
  "success": true,
  "address": "0x...",
  "period": "WEEK",
  "fromTimestamp": 1709000000,
  "toTimestamp": 1709900000,
  "positionCount": 2,
  "points": [{
    "timestamp": 1709000000,
    "positionsValue": 5000.50
  }]
}
```
**Used by**: Overview page portfolio chart.

---

### 3.9 Unified Yield — Pool Listing
```
GET /unified-yield/pools?network=arbitrum
```
**Returns**: All Unified Yield pools on Arbitrum.
**Response shape**:
```json
{
  "success": true,
  "pools": [{
    "poolId": "0xe2c28a...",
    "name": "USDC/USDT",
    "token0": { "address": "0xaf88d...", "symbol": "USDC", "decimals": 6 },
    "token1": { "address": "0xFd086...", "symbol": "USDT", "decimals": 6 },
    "hookAddress": "0x5e645C3D...",
    "tvlUsd": 100000
  }]
}
```

---

### 3.10 Unified Yield — Pool APR
```
GET /unified-yield/pool/{poolId}/apr?network=arbitrum
```
**Returns**: Swap APR (7d and 24h) for a UY pool.
**Response shape**:
```json
{
  "success": true,
  "network": "arbitrum",
  "poolName": "USDC/USDT",
  "poolId": "0xe2c28a...",
  "swapApr7d": 3.45,
  "swapApr24h": 4.12,
  "volume24hUsd": 45678,
  "tvlUsd": 100000,
  "calculatedAt": 1709900000
}
```

---

### 3.11 Unified Yield — APR History
```
GET /unified-yield/pool/{poolId}/apr/history?network=arbitrum&period=DAY|WEEK|MONTH
```
**Returns**: Historical APR data points.
**Response shape**:
```json
{
  "success": true,
  "poolId": "0xe2c28a...",
  "period": "WEEK",
  "points": [{
    "timestamp": 1709000000,
    "swapApr": 3.45,
    "tvlUsd": 100000
  }]
}
```

---

### 3.12 Unified Yield — Position Compounded Fees
```
GET /unified-yield/position/{hookAddress}-{userAddress}/compounded-fees?network=arbitrum
```
**Returns**: Estimated lifetime yield (swap fees + lending) for a specific UY position.
**Response shape**:
```json
{
  "success": true,
  "network": "arbitrum",
  "positionId": "0x5e645c...-0xuser...",
  "hookAddress": "0x5e645c...",
  "poolId": "0xe2c28a...",
  "poolName": "USDC/USDT",
  "compoundedFeesUSD": 123.45,
  "netDepositUSD": 10000,
  "currentValueUSD": 10123.45,
  "createdAtTimestamp": 1709000000,
  "calculationMethod": "snapshot_delta"
}
```

---

### 3.13 Unified Yield — User All Positions Compounded Fees
```
GET /unified-yield/user/{address}/compounded-fees?network=arbitrum
```
**Returns**: All UY positions for a user with compounded fees, plus totals.
**Response shape**:
```json
{
  "success": true,
  "network": "arbitrum",
  "address": "0xuser...",
  "positions": [{
    "positionId": "0x5e645c...-0xuser...",
    "hookAddress": "0x5e645c...",
    "poolId": "0xe2c28a...",
    "poolName": "USDC/USDT",
    "compoundedFeesUSD": 123.45,
    "netDepositUSD": 10000,
    "currentValueUSD": 10123.45,
    "createdAtTimestamp": 1709000000
  }],
  "totals": {
    "compoundedFeesUSD": 123.45,
    "netDepositUSD": 10000,
    "currentValueUSD": 10123.45
  }
}
```

---

### 3.14 Aave Rates (Network-aware for Arbitrum Aave)
```
GET /aave/rates?network=arbitrum
```
**Returns**: Aave lending rates for USDC/USDT on Arbitrum (used for UY yield calculation).
**Note**: The Arbitrum pool uses Aave yield sources (`yieldSources: ["aave"]`), so this endpoint needs Arbitrum Aave rate data.

---

### 3.15 Spark Rates (Base Mainnet Only — NOT needed for Arbitrum)
```
GET /spark/rates
```
No network param. This is Ethereum/Base mainnet only (sUSDS yield). **No changes needed for Arbitrum.**

---

## 4. WebSocket Support

### Connection
```
wss://api.alphix.fi/ws?network=arbitrum
```

The frontend already passes `?network=arbitrum` when connecting. The backend needs to serve Arbitrum data on these channels:

### Channels

| Channel | Data | Update Frequency |
|---|---|---|
| `pools:metrics` | All Arbitrum pool metrics (same shape as REST `/pools/metrics` response `pools` array) | Every snapshot interval |
| `pools:{poolId}` | Single pool update (TVL, volume, price, tick) | On each new snapshot |
| `positions:{walletAddress}` | Position updates for a user on Arbitrum | On position value change |
| `prices:{symbol}` | Token price updates (ETH, USDC, USDT) | On price change |

### Message Format (unchanged)
```json
// Server → Client (data message)
{
  "type": "data",
  "channel": "pools:metrics",
  "data": { /* pool metrics array */ }
}

// Client → Server (subscribe)
{ "type": "subscribe", "channel": "pools:metrics" }

// Client → Server (unsubscribe)
{ "type": "unsubscribe", "channel": "pools:metrics" }

// Server → Client (subscribe acknowledgment)
{ "type": "subscribed", "channel": "pools:metrics" }
```

---

## 5. Frontend Proxy Routes (FYI — No Backend Changes Needed)

These Next.js API routes in the frontend proxy to `api.alphix.fi`. They already forward the `network` param. Listed for reference only:

| Frontend Route | Proxies To |
|---|---|
| `POST /api/liquidity/pool-metrics` | `GET /pools/metrics` |
| `POST /api/liquidity/pool-price-history` | `GET /pools/{poolId}/prices/history` |
| `POST /api/liquidity/get-historical-dynamic-fees` | `GET /pools/{poolId}/dynamic-fees` (if exists) |
| `POST /api/liquidity/get-ticks` | `GET /pools/{poolId}/ticks` (if exists) |
| `GET /api/portfolio/chart` | `GET /portfolio/chart` |
| `POST /api/swap/get-quote` | KyberSwap (not backend) |
| `POST /api/swap/build-tx` | KyberSwap (not backend) |
| `GET /api/tokens/balances` | Alchemy API (not backend) |

---

## 6. What Already Works Without Backend (Subgraph-Only)

These features query the subgraph directly from the frontend and already work on Arbitrum:

- Pool listing (token pairs, fee tiers, pool addresses)
- User position enumeration (LP positions from subgraph)
- Position token amounts & price ranges
- Add/Remove/Increase/Decrease liquidity (on-chain tx)
- Swaps (via KyberSwap aggregator, on-chain)

---

## 7. Priority Order

### P0 — Minimum for Arbitrum launch
1. **`GET /pools/metrics?network=arbitrum`** — Without this, liquidity page shows no TVL/Volume/Fees/APR
2. **`GET /pools/{poolId}/history?network=arbitrum`** — Pool detail page charts
3. **`GET /pools/{poolId}/current?network=arbitrum`** — Pool detail page header stats
4. **`GET /pools/{poolId}/prices?network=arbitrum`** — Token prices for value calculations
5. **`GET /pools/{poolId}/prices/history?network=arbitrum`** — Price charts
6. **`wss://api.alphix.fi/ws?network=arbitrum`** (`pools:metrics` channel) — Real-time updates

### P1 — Full position management
7. **`GET /position/{id}/fees?network=arbitrum`** — Position fee history
8. **`GET /position/{id}/apr?network=arbitrum`** — Position APR
9. **`GET /portfolio/chart?network=arbitrum`** — Overview portfolio chart
10. **WebSocket**: `positions:{address}`, `pools:{poolId}` channels

### P2 — Unified Yield features
11. `GET /unified-yield/pools?network=arbitrum`
12. `GET /unified-yield/pool/{id}/apr?network=arbitrum`
13. `GET /unified-yield/pool/{id}/apr/history?network=arbitrum`
14. `GET /unified-yield/position/{id}/compounded-fees?network=arbitrum`
15. `GET /unified-yield/user/{addr}/compounded-fees?network=arbitrum`
16. `GET /aave/rates?network=arbitrum` (Arbitrum Aave rates for UY yield calc)

### P3 — Nice to have
17. `prices:{symbol}` WebSocket channel

---

## 8. Implementation Checklist

- [ ] Add Arbitrum subgraph URL to backend config
- [ ] Add Goldsky webhook handler for `arbitrum` data source detection
- [ ] Configure Arbitrum RPC endpoint for on-chain reads
- [ ] Register Arbitrum pool(s) in backend database (USDC/USDT pool ID above)
- [ ] Register Arbitrum contract addresses (PoolManager, StateView, PositionManager, Hook)
- [ ] Register Arbitrum Aave wrapper addresses for UY yield tracking
- [ ] Start indexing Arbitrum pool snapshots (TVL, volume, fees, prices)
- [ ] Start indexing Arbitrum position snapshots (for APR/fee calculations)
- [ ] Enable `?network=arbitrum` routing on all REST endpoints
- [ ] Enable `?network=arbitrum` on WebSocket connection
- [ ] Test all P0 endpoints with Arbitrum pool ID
- [ ] Test WebSocket `pools:metrics` channel with Arbitrum data

---

## 9. Notes

- The Arbitrum subgraph schema is **identical** to Base — same entity types, same field names.
- Error handling: If the backend returns errors for `?network=arbitrum`, the frontend shows "Failed to load" states gracefully. No crashes.
- The Arbitrum USDC/USDT pool uses **Aave rehypothecation** (same as Base USDC/USDT), so lending yield tracking is needed.
- Position IDs are 66-char hex strings (`0x` + 64 hex chars, zero-padded). The frontend normalizes these before sending.
