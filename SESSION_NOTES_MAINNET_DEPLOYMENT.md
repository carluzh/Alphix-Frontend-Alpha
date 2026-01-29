# Session Notes: Mainnet Rehypothecated Pools Deployment

## Date: 2026-01-29
## Branch: `temp-v1.6`

---

## Context / Goal

Deploy new mainnet pools with **rehypothecated liquidity** support, matching what already works on testnet. The contract engineer deployed updated contracts with new slippage parameters, the subgraph engineer is deploying a unified subgraph, and the backend engineer added WebSocket network filtering.

---

## What Was Done (All Completed)

### 1. Slippage Protection for Unified Yield Deposit/Withdraw

**Why:** The new contract signatures added two params for slippage protection:
```solidity
addReHypothecatedLiquidity(uint256 shares, uint160 expectedSqrtPriceX96, uint24 maxPriceSlippage)
removeReHypothecatedLiquidity(uint256 shares, uint160 expectedSqrtPriceX96, uint24 maxPriceSlippage)
```

**Key decisions:**
- `expectedSqrtPriceX96` = 0 means "skip slippage check" (backwards compatible)
- `maxPriceSlippage` uses same scale as LP fee: `1000000 = 100%`, `10000 = 1%`
- Defaults to 0 (skip check) when callers don't provide values

**Files changed:**
- `lib/liquidity/unified-yield/abi/unifiedYieldHookABI.ts` — ABI updated with new params
- `lib/liquidity/unified-yield/types.ts` — Added `expectedSqrtPriceX96?: bigint` and `maxPriceSlippage?: number` to both `UnifiedYieldDepositParams` and `UnifiedYieldWithdrawParams`
- `lib/liquidity/unified-yield/buildUnifiedYieldDepositTx.ts` — Encodes slippage params
- `lib/liquidity/unified-yield/buildUnifiedYieldWithdrawTx.ts` — Encodes slippage params
- `lib/liquidity/unified-yield/hooks/useUnifiedYieldDeposit.ts` — Hook accepts `sqrtPriceX96?: string` and `maxPriceSlippage?: number`, passes to contract call
- `lib/liquidity/unified-yield/hooks/useUnifiedYieldWithdraw.ts` — Same as deposit

**How callers use it:**
```tsx
const { deposit } = useUnifiedYieldDeposit({
  hookAddress: '0x...',
  sqrtPriceX96: poolState.sqrtPriceX96,  // from pool state query
  maxPriceSlippage: 10000,                // 1%
  // ... other params
});
```

---

### 2. Pool Config Updated with Deployment Data (`pools.json`)

**Major change:** The mainnet stable pool is **USDS/USDC** (not USDC/USDT as originally configured). This was determined by the deployment team's contract deployment.

**Changes to `config/pools.json`:**
- **Replaced** `usdc-usdt` pool → `usds-usdc` pool
- Added `USDS` token definition (address: `0x820C137fa70C8691f0e44Dc420a5e53c168921Dc`, 18 decimals)
- Kept `USDT` token definition (still referenced elsewhere in codebase)
- Added `yieldSources`: `["spark", "aave"]` for USDS/USDC, `["aave"]` for ETH/USDC
- All deployment addresses filled in (pool IDs, hook addresses, tick ranges)

**Pool 1: USDS/USDC (Stable)**
| Field | Value |
|-------|-------|
| Pool ID | `usds-usdc` |
| subgraphId | `0xb90ac48b0f87826ce215f42b734a154d3a958cfc281151a30520083ea7b063ba` |
| Hook | `0xe562971e8f8753120029Ed9D5cA31c569f7020c0` |
| currency0 | USDS (`0x820C137fa70C8691f0e44Dc420a5e53c168921Dc`) |
| currency1 | USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) |
| tickSpacing | 1 |
| rehypoRange | `-276326` to `-276324` (narrow, not full range) |
| yieldSources | spark (sUSDS: `0xc7b9A2146E9c7F081C84D20626641fc59F3d4cab`), aave (aBasUSDC: `0xf62bca61Fe33f166791c3c6989b0929CCaaDA5B2`) |

**Pool 2: ETH/USDC (Volatile)**
| Field | Value |
|-------|-------|
| Pool ID | `eth-usdc` |
| subgraphId | `0x6c4166b0023482b3c174fc08cb5edc1addb28d7252c0374d1507c1a78593998a` |
| Hook | `0xF31de090d650919B1Fd9deBfCb20701d5D5460c0` |
| currency0 | ETH (`0x0000000000000000000000000000000000000000`) |
| currency1 | USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) |
| tickSpacing | 10 |
| rehypoRange | `-887220` to `887220` (full range) |
| yieldSources | aave (aWETH: `0x59f5245129faBEde6FC4243518B74b1DF78A2D9E`, aBasUSDC: `0xf62bca61Fe33f166791c3c6989b0929CCaaDA5B2`) |

**Global hooks.alphixHookId:** Set to ETH/USDC hook (`0xF31de090d650919B1Fd9deBfCb20701d5D5460c0`) for legacy compatibility with `V4_POOL_HOOKS` constant. Each pool also has its own `hooks` field.

**Also updated:** `lib/pools-config.ts` — Added `USDS` with priority `95` to token sorting.

---

### 3. Subgraph Unified for Mainnet

**Why:** Mainnet previously used separate subgraphs for different queries. The subgraph engineer confirmed mainnet will use a single unified subgraph (like testnet).

**Changes to `lib/subgraph-url-helper.ts`:**
- `getUniswapV4SubgraphUrl()` now returns `SUBGRAPH_URL_MAINNET_ALPHIX` on mainnet (previously returned the Uniswap public subgraph)
- Both `getAlphixSubgraphUrl()` and `getUniswapV4SubgraphUrl()` now point to the same unified subgraph on mainnet
- Added Goldsky fallback URL for mainnet via `getSubgraphUrlsWithFallback()`

**Environment variable needed:**
```
SUBGRAPH_URL_MAINNET_ALPHIX=<url from subgraph engineer>
```

**Key learning:** The subgraph schema is identical between mainnet and testnet — same entities (Pool, PoolDayData, HookPosition, UnifiedYieldPosition, AlphixHook, AlphixHookTVL). No frontend query changes needed.

---

### 4. WebSocket Network Filtering

**Why:** Backend engineer added `?network=base|base-sepolia` query param support to the WebSocket server so it only sends events for the requested network.

**Changes:**
1. `lib/backend-client.ts` — `getWebSocketUrl(networkMode?)` appends `?network=base` or `?network=base-sepolia`
2. `lib/websocket/WebSocketManager.ts`:
   - Constructor accepts `networkMode` as third param
   - Added `switchNetwork(networkMode)` method: updates URL, closes old connection, reconnects (preserves channel subscriptions)
   - Added `getNetworkMode()` getter
   - `getSharedWebSocketManager(networkMode?)` auto-switches network on existing instance
3. `lib/websocket/WebSocketProvider.tsx`:
   - Passes `networkMode` from `useNetwork()` to WebSocketManager constructor
   - `useEffect` on `networkMode` change: clears pool data, calls `switchNetwork()`

**Flow on network switch:**
1. User toggles network in UI
2. `networkMode` changes in NetworkContext
3. WebSocketProvider's `useEffect` fires
4. Clears pool data map (stale data from old network)
5. Calls `wsManager.switchNetwork(newMode)` which:
   - Updates internal URL to include new `?network=` param
   - Closes existing WebSocket connection
   - Reconnects with new URL
   - `onopen` handler re-subscribes to all channels (e.g., `pools:metrics`)
6. Backend sends fresh data for the new network

**Backend engineer approved this approach.**

---

## Deployment Addresses Reference

### Alphix System (Base Mainnet)
| Contract | Address |
|----------|---------|
| Access Manager | `0x56Ec52a214de51ad7DbbEb990a88b9625257Ed9D` |
| Access Manager Admin | `0x350763075330498279F9Fee03Bb4bAEacbd39b04` |
| Pool Manager (Uniswap V4) | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| ETH/USDC Hook | `0xF31de090d650919B1Fd9deBfCb20701d5D5460c0` |
| USDS/USDC Hook | `0xe562971e8f8753120029Ed9D5cA31c569f7020c0` |
| Hook Owner | `0xe231a6e1E18aC6A123cd0EaEA8C4Ca07E50E8800` |
| Yield Manager | `0x1F3f02cE8Cd8D97F1caB75429eaDCb1571bdAe35` |
| Fee Poker | `0x1F3f02cE8Cd8D97F1caB75429eaDCb1571bdAe35` |

### 4626 Wrappers (Yield Sources)
| Wrapper | Address | Asset | Type |
|---------|---------|-------|------|
| awaUSDC (Aave aBasUSDC) | `0xf62bca61Fe33f166791c3c6989b0929CCaaDA5B2` | USDC | Aave |
| awaWETH (Aave aBasWETH) | `0x59f5245129faBEde6FC4243518B74b1DF78A2D9E` | WETH | Aave |
| alpsUSDS (Sky sUSDS) | `0xc7b9A2146E9c7F081C84D20626641fc59F3d4cab` | USDS | Sky/Spark |

### Token Addresses (Base Mainnet)
| Token | Address | Decimals |
|-------|---------|----------|
| ETH | `0x0000000000000000000000000000000000000000` | 18 |
| WETH | `0x4200000000000000000000000000000000000006` | 18 |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |
| USDS | `0x820C137fa70C8691f0e44Dc420a5e53c168921Dc` | 18 |
| USDT | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` | 6 |

---

## What Still Needs To Be Done

### Blockers
- [ ] Set `SUBGRAPH_URL_MAINNET_ALPHIX` in `.env.local` and production env (waiting on subgraph engineer)
- [ ] Add USDS icon to `public/tokens/USDS.png`

### Frontend Testing
- [ ] Test mainnet pool pages load correctly with new pool IDs
- [ ] Test USDS/USDC pool renders (new token, new pool ID)
- [ ] Test unified yield deposit/withdraw on mainnet (both pools)
- [ ] Test WebSocket receives mainnet-filtered data
- [ ] Test network switching (mainnet ↔ testnet) clears and reloads data
- [ ] Verify slippage protection works (pass actual sqrtPriceX96 from pool state)
- [ ] Check all references to old `usdc-usdt` pool ID are handled (routing, deep links, etc.)

### Nice-to-Have / Future
- [ ] Wire up actual slippage values in the UI components that call `useUnifiedYieldDeposit` / `useUnifiedYieldWithdraw` (currently they can pass 0 to skip, but eventually should use real pool prices)
- [ ] Refactor `getHooksAddress()` / `V4_POOL_HOOKS` to be per-pool instead of global (currently uses ETH/USDC hook as default)

---

## Architecture Notes

### Network Mode Flow
```
User toggles network → NetworkContext updates → cookie + localStorage set
    ↓
Components re-render with new networkMode
    ↓
Subgraph queries: getAlphixSubgraphUrl(networkMode) → different URL
REST API calls: buildBackendUrl(path, networkMode) → ?network=base|base-sepolia
WebSocket: switchNetwork(networkMode) → reconnect with ?network= param
Wagmi/wallet: chainId switches (8453 mainnet, 84532 testnet)
```

### Unified Yield Transaction Flow
```
User enters amount → previewDeposit() → shows required amounts + shares
    ↓
User confirms → useUnifiedYieldDeposit.deposit(amount, inputSide, decimals)
    ↓
Internally: previewDeposit → depositWithPreview(preview)
    ↓
writeContractAsync({
  functionName: 'addReHypothecatedLiquidity',
  args: [shares, expectedSqrtPriceX96, maxPriceSlippage]
})
```

### Key File Locations
- Pool config: `config/pools.json`
- Pool config types/helpers: `lib/pools-config.ts`
- Unified yield hooks: `lib/liquidity/unified-yield/hooks/`
- Unified yield ABI: `lib/liquidity/unified-yield/abi/unifiedYieldHookABI.ts`
- Unified yield types: `lib/liquidity/unified-yield/types.ts`
- Subgraph URL routing: `lib/subgraph-url-helper.ts`
- Backend API client: `lib/backend-client.ts`
- WebSocket manager: `lib/websocket/WebSocketManager.ts`
- WebSocket React provider: `lib/websocket/WebSocketProvider.tsx`
- Network context: `lib/network-context.tsx`
- Network mode utils: `lib/network-mode.ts`

---

## All Files Modified This Session

| File | Change |
|------|--------|
| `config/pools.json` | Replaced USDC/USDT→USDS/USDC, added USDS token, filled all deployment addresses |
| `lib/pools-config.ts` | Added USDS to token priority ranking |
| `lib/liquidity/unified-yield/abi/unifiedYieldHookABI.ts` | Added slippage params to function signatures |
| `lib/liquidity/unified-yield/types.ts` | Added `expectedSqrtPriceX96` and `maxPriceSlippage` to param interfaces |
| `lib/liquidity/unified-yield/buildUnifiedYieldDepositTx.ts` | Encodes new slippage params |
| `lib/liquidity/unified-yield/buildUnifiedYieldWithdrawTx.ts` | Encodes new slippage params |
| `lib/liquidity/unified-yield/hooks/useUnifiedYieldDeposit.ts` | Accepts slippage config, passes to contract call |
| `lib/liquidity/unified-yield/hooks/useUnifiedYieldWithdraw.ts` | Accepts slippage config, passes to contract call |
| `lib/subgraph-url-helper.ts` | Mainnet now uses unified Alphix subgraph for all queries |
| `lib/backend-client.ts` | `getWebSocketUrl()` now accepts optional `networkMode` for filtering |
| `lib/websocket/WebSocketManager.ts` | Added network mode support, `switchNetwork()` method |
| `lib/websocket/WebSocketProvider.tsx` | Passes network mode to manager, calls `switchNetwork()` on change |
| `MAINNET_POOL_DEPLOYMENT.md` | Deployment checklist (can be deleted after launch) |
| `SESSION_NOTES_MAINNET_DEPLOYMENT.md` | This file — session handoff notes |

---

## Important Gotchas

1. **Stable pool changed from USDC/USDT to USDS/USDC.** Any hardcoded references to `usdc-usdt` pool ID need to be updated. Check routes, deep links, and any URL-based pool lookups.

2. **Each pool has its own hook address.** ETH/USDC: `0xF31de090d650919B1Fd9deBfCb20701d5D5460c0`, USDS/USDC: `0xe562971e8f8753120029Ed9D5cA31c569f7020c0`. The global `alphixHookId` is set to ETH/USDC for the legacy `V4_POOL_HOOKS` constant used in `usePositionAPR.ts`.

3. **USDS is 18 decimals, USDC is 6.** This matters for amount formatting, sqrtPriceX96 calculations, and token ordering (lower address = currency0).

4. **`subgraphId` in pools.json is the ACTUAL on-chain poolId (bytes32).** Do NOT recalculate it using keccak256 or any other method. Use the exact value from the deployment.

5. **Slippage defaults to 0 (skip check).** If callers don't pass `sqrtPriceX96` or `maxPriceSlippage`, the contract-level slippage check is skipped. This is intentional for backwards compatibility.

6. **WebSocket `switchNetwork()` preserves subscriptions.** When reconnecting after a network switch, the `onopen` handler loops through `subscribedChannels` and re-subscribes to all of them. No manual re-subscription needed.

7. **Fee value `8388608` is the dynamic fee flag (`0x800000`).** It does NOT represent an actual fee percentage — it tells the pool manager that fees are controlled by the hook contract.

8. **The `eslint-disable-next-line` in WebSocketProvider** is intentional. The init `useEffect` excludes `networkMode` from deps because network changes are handled by a separate `useEffect` that calls `switchNetwork()`. Including `networkMode` in the init effect would destroy and recreate the manager on every network switch.

9. **USDS icon missing.** Need to add `/tokens/USDS.png` to `public/tokens/`. Without it, the token icon will show a broken image.
