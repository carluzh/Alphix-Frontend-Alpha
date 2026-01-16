# API Routes Structure

This project uses **two API patterns** due to historical development:

## App Router APIs (`app/api/`)
GraphQL and batch read endpoints using Next.js App Router format.

| Route | Purpose |
|-------|---------|
| `/api/graphql` | Apollo GraphQL endpoint (pools, positions, prices) |
| `/api/liquidity/get-pools-batch` | Batch pool data with TVL/volume |
| `/api/liquidity/pool-chart-data` | Pool chart historical data |
| `/api/maintenance-status` | Maintenance mode check |

## Pages Router APIs (`pages/api/`)
Transaction preparation and individual data endpoints using Next.js Pages Router format.

| Route | Purpose |
|-------|---------|
| `/api/liquidity/get-pool-state` | Single pool state (tick, price, liquidity) |
| `/api/liquidity/get-position` | Single position data |
| `/api/liquidity/get-positions` | User positions list |
| `/api/liquidity/get-ticks` | Pool tick data for charts |
| `/api/liquidity/get-historical-dynamic-fees` | Fee history |
| `/api/liquidity/pool-metrics` | Pool APR/yield metrics |
| `/api/liquidity/pool-price-history` | Price history (GraphQL internal) |
| `/api/liquidity/prepare-*-tx` | Transaction builders (mint, increase, decrease, collect, zap) |
| `/api/swap/get-quote` | Swap quote with routing |
| `/api/swap/build-tx` | Build swap transaction |
| `/api/swap/prepare-permit` | Permit2 signature preparation |
| `/api/misc/faucet` | Testnet faucet |
| `/api/portfolio/chart` | Portfolio value history |

## Why Two Patterns?
- **App Router** (`app/api/`): Newer endpoints, GraphQL integration
- **Pages Router** (`pages/api/`): Existing transaction logic, Uniswap SDK integration

Both patterns work simultaneously in Next.js 15. The split is intentional - consolidation would require significant refactoring of transaction builders.
