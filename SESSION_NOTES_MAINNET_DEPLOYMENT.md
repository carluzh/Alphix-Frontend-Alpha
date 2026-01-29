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

### 2. Config Format Consolidated (`pools.json`)

**Why:** Mainnet `pools.json` was missing fields that testnet had, and used price strings instead of tick integers for `rehypoRange`.

**Changes to `config/pools.json`:**
- Added `yieldSources` arrays: `["aave", "spark"]` for USDC/USDT, `["aave"]` for ETH/USDC
- Changed `rehypoRange` from price strings to tick integers
- ETH/USDC is full range: `min: "-887220"`, `max: "887220"`, `isFullRange: true`
- USDC/USDT has `TODO_TICK_LOWER` / `TODO_TICK_UPPER` placeholders (needs deployment data)
- Pool IDs and hook addresses are `TODO_*` placeholders

**Still needs (from deployment team):**
- `alphixHookId` (global hook address)
- Per-pool `subgraphId` (bytes32 on-chain poolId — DO NOT recalculate, use the actual deployed value)
- Per-pool `hooks` address
- USDC/USDT tick range (`min`, `max`)

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

## What Still Needs To Be Done

### From Deployment Team (Blockers)
- [ ] Hook contract address → replace all `TODO_HOOK_ADDRESS_FROM_DEPLOYMENT` in `config/pools.json`
- [ ] USDC/USDT pool ID (bytes32) → replace `TODO_POOL_ID_FROM_DEPLOYMENT`
- [ ] ETH/USDC pool ID (bytes32) → replace `TODO_POOL_ID_FROM_DEPLOYMENT`
- [ ] USDC/USDT tick range → replace `TODO_TICK_LOWER` and `TODO_TICK_UPPER`
- [ ] Subgraph URL → set `SUBGRAPH_URL_MAINNET_ALPHIX` in `.env.local`

### Frontend Work (After Getting Deployment Data)
- [ ] Fill in all `TODO_*` values in `config/pools.json`
- [ ] Add `SUBGRAPH_URL_MAINNET_ALPHIX` to `.env.local` and production env
- [ ] Test mainnet pool pages load correctly
- [ ] Test unified yield deposit/withdraw on mainnet
- [ ] Test WebSocket receives mainnet-filtered data
- [ ] Test network switching (mainnet ↔ testnet) clears and reloads data
- [ ] Verify slippage protection works (pass actual sqrtPriceX96 from pool state)

### Nice-to-Have / Future
- [ ] Wire up actual slippage values in the UI components that call `useUnifiedYieldDeposit` / `useUnifiedYieldWithdraw` (currently they can pass 0 to skip, but eventually should use real pool prices)

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

## Important Gotchas

1. **`subgraphId` in pools.json is the ACTUAL on-chain poolId (bytes32).** Do NOT recalculate it using keccak256 or any other method. Use the exact value from the deployment.

2. **Slippage defaults to 0 (skip check).** If callers don't pass `sqrtPriceX96` or `maxPriceSlippage`, the contract-level slippage check is skipped. This is intentional for backwards compatibility.

3. **WebSocket `switchNetwork()` preserves subscriptions.** When reconnecting after a network switch, the `onopen` handler loops through `subscribedChannels` and re-subscribes to all of them. No manual re-subscription needed.

4. **Fee value `8388608` is the dynamic fee flag (`0x800000`).** It does NOT represent an actual fee percentage — it tells the pool manager that fees are controlled by the hook contract.

5. **The `eslint-disable-next-line` in WebSocketProvider** is intentional. The init `useEffect` excludes `networkMode` from deps because network changes are handled by a separate `useEffect` that calls `switchNetwork()`. Including `networkMode` in the init effect would destroy and recreate the manager on every network switch.
