# Backend Changes Required for Arbitrum Support

The frontend is fully wired for Arbitrum (chain ID 42161). The backend needs the following changes.

## Network Routing

All REST endpoints already receive `?network=base|arbitrum|base-sepolia` via `buildBackendUrl()` in `lib/backend-client.ts`.

The backend must:
- Parse the `network` query parameter on every endpoint
- Default to `base` if omitted
- Route data lookups to the correct chain's data source

## REST Endpoints (all need network awareness)

| Endpoint | Notes |
|----------|-------|
| `GET /portfolio/chart` | Filter by network |
| `GET /pools/{poolId}/history` | Pool IDs are chain-specific |
| `GET /pools/{poolId}/current` | Chain-specific pool state |
| `GET /pools/{poolId}/prices` | Chain-specific token prices |
| `GET /pools/{poolId}/prices/history` | Chain-specific price history |
| `GET /position/{positionId}/fees` | Position IDs are chain-specific (66-char hex) |
| `GET /position/{positionId}/apr` | Chain-specific 7d APR |
| `GET /unified-yield/pools` | Return only pools for requested network |
| `GET /unified-yield/pool/{poolId}/apr` | Chain-specific APR |
| `GET /unified-yield/pool/{poolId}/apr/history` | Chain-specific APR history |
| `GET /unified-yield/position/{positionId}/compounded-fees` | Chain-specific (hookAddress-userAddress) |
| `GET /unified-yield/user/{address}/compounded-fees` | Filter by network |
| `GET /pools/metrics` | Return only pools for requested network |
| `GET /spark/rates` | Clarify if Arbitrum has equivalent yield source or mainnet-only |
| `GET /spark/rates/history` | Same as above |

## WebSocket

Connection URL already includes `?network=base|arbitrum` (see `lib/websocket/WebSocketManager.ts`).

The WebSocket server must:
- Parse `?network=` on the upgrade request
- Subscribe channels only to events for the requested network
- Channels: `positions:{address}`, `pools:{poolId}`, `pools:metrics`, `prices:{poolId}`
- Position updates must only include positions for the connected network
- Pool metrics broadcasts must be filtered by network

## Subgraph

- Arbitrum subgraph URL will be set via `SUBGRAPH_URL_ARBITRUM_ALPHIX` env var
- Frontend's GraphQL proxy (`/api/graphql`) already routes to the correct subgraph based on network mode
- The subgraph needs to be deployed to Goldsky indexing the Arbitrum PoolManager at `0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32`

## Arbitrum Contract Addresses

From `config/arbitrum_pools.json`:

```
PoolManager:      0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32
UniversalRouter:  0x A51afAF359d044F8e56fE74B9575f23142cD4B76
Quoter:           0xFd23802b40A51c80CA3e4E1d1536A9E4De8C9fE6
PositionManager:  0xd88F38F930b7952f2DB2432Cb002E7abbF3dD869
StateView:        0x76fd297e2D437cd7f76d50F01AfE6160f86e9990
Alphix Hook:      0x5e645C3D580976Ca9e3fe77525D954E73a0Ce0C0
```

## Arbitrum Pool

USDC/USDT pool:
- Token0: USDC (`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`)
- Token1: USDT (`0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`)
- Fee: 100 (0.01%)
- TickSpacing: 1
- SubgraphId: `0xe2c28a234aadc40f115dcc56b70a759d02a372db90dfeed19048392d942ee286`
- Hook: `0x5e645C3D580976Ca9e3fe77525D954E73a0Ce0C0`

Aave yield sources via ERC4626 wrappers:
- aUSDC wrapper: `0x7CFaDFD5645B50bE87d546f42787461a1e3B3b00`
- aUSDT wrapper: `0x8218dCFF40249A29fE2AC504A1FAe25a3393fCc6`

## Database Schema

All historical data tables need a `network` or `chain_id` column:
- Pool snapshots
- Position fee accruals
- Price history
- APR calculations
- Portfolio snapshots

Indexes should include `(network, ...)` as prefix for all time-series queries.

## Points / Referral

Currently called without `?network=` parameter. Points should be **split per chain**:
- Add `?network=base|arbitrum` parameter to all points endpoints
- Track points accrual separately per chain (different pools, different positions)
- Leaderboard can aggregate across chains or be per-chain (TBD)
- Referral system remains shared across chains

## Testing Checklist

1. `GET /pools/metrics?network=arbitrum` returns Arbitrum pools only
2. `GET /pools/{arbitrumPoolId}/current?network=arbitrum` returns correct state
3. WebSocket with `?network=arbitrum` streams only Arbitrum events
4. `GET /unified-yield/pools?network=arbitrum` returns Arbitrum UY pools
5. Position fee queries work with Arbitrum position IDs
6. Switching networks mid-session (WebSocket reconnect) works correctly
