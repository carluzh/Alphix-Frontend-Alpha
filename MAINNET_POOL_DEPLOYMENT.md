# Mainnet Rehypothecated Pools Deployment

## Status: Ready for Deployment Data

### Completed Frontend Changes

1. **Slippage Support** - All unified yield transaction builders now support slippage protection:
   - [x] `unifiedYieldHookABI.ts` - Updated ABI with `expectedSqrtPriceX96` and `maxPriceSlippage` params
   - [x] `types.ts` - Added slippage params to `UnifiedYieldDepositParams` and `UnifiedYieldWithdrawParams`
   - [x] `buildUnifiedYieldDepositTx.ts` - Encodes slippage params (defaults to 0 to skip check)
   - [x] `buildUnifiedYieldWithdrawTx.ts` - Encodes slippage params (defaults to 0 to skip check)
   - [x] `useUnifiedYieldDeposit.ts` - Accepts `sqrtPriceX96` and `maxPriceSlippage` from callers
   - [x] `useUnifiedYieldWithdraw.ts` - Accepts `sqrtPriceX96` and `maxPriceSlippage` from callers

2. **Config Format Consolidated** - `pools.json` now matches testnet format:
   - [x] Added `yieldSources` arrays
   - [x] Changed `rehypoRange` to tick format (integers, not price strings)
   - [x] TODO markers in place for deployment values

3. **Subgraph Unified** - `subgraph-url-helper.ts` updated:
   - [x] Mainnet now uses unified Alphix subgraph (like testnet)
   - [x] `getUniswapV4SubgraphUrl()` returns `SUBGRAPH_URL_MAINNET_ALPHIX` on mainnet
   - [x] All Pool/PoolDayData queries use the same subgraph as Alphix entities

4. **WebSocket Network Filtering** - WebSocket now filters by network:
   - [x] `backend-client.ts` - `getWebSocketUrl()` accepts optional `networkMode` param
   - [x] `WebSocketManager.ts` - Added `networkMode` to constructor, `switchNetwork()` method
   - [x] `getSharedWebSocketManager()` - Accepts `networkMode`, auto-switches if network changes
   - [x] `WebSocketProvider.tsx` - Passes `networkMode` to manager, calls `switchNetwork()` on change
   - [x] URL format: `ws://...?network=base` (mainnet) or `?network=base-sepolia` (testnet)

---

## Values Needed From Deployment

Replace the `TODO_*` placeholders in `config/pools.json`:

### Global Hook
```json
"hooks": {
  "alphixHookId": "TODO_HOOK_ADDRESS_FROM_DEPLOYMENT"  // ← Replace
}
```

### USDC/USDT Pool (Stable)
```json
{
  "subgraphId": "TODO_POOL_ID_FROM_DEPLOYMENT",        // ← Replace with bytes32 poolId
  "hooks": "TODO_HOOK_ADDRESS_FROM_DEPLOYMENT",        // ← Replace with hook address
  "rehypoRange": {
    "min": "TODO_TICK_LOWER",                          // ← Replace with tick (e.g., "-276326")
    "max": "TODO_TICK_UPPER"                           // ← Replace with tick (e.g., "-276324")
  }
}
```

### ETH/USDC Pool (Volatile)
```json
{
  "subgraphId": "TODO_POOL_ID_FROM_DEPLOYMENT",        // ← Replace with bytes32 poolId
  "hooks": "TODO_HOOK_ADDRESS_FROM_DEPLOYMENT"         // ← Replace with hook address
  // rehypoRange already set to full range ticks (-887220 to 887220)
}
```

### Environment Variable
```
SUBGRAPH_URL_MAINNET_ALPHIX=<new_subgraph_url>
```

---

## Contract Function Signatures (for reference)

```solidity
function addReHypothecatedLiquidity(
    uint256 shares,
    uint160 expectedSqrtPriceX96,  // pass 0 to skip slippage check
    uint24 maxPriceSlippage         // 1000000 = 100%, 10000 = 1%
) external payable returns (BalanceDelta delta);

function removeReHypothecatedLiquidity(
    uint256 shares,
    uint160 expectedSqrtPriceX96,  // pass 0 to skip slippage check
    uint24 maxPriceSlippage         // 1000000 = 100%, 10000 = 1%
) external returns (BalanceDelta delta);
```

---

## Files Modified

| File | Change |
|------|--------|
| `config/pools.json` | Added yieldSources, converted rehypoRange to tick format, TODO placeholders |
| `lib/liquidity/unified-yield/abi/unifiedYieldHookABI.ts` | Added slippage params to function signatures |
| `lib/liquidity/unified-yield/types.ts` | Added `expectedSqrtPriceX96` and `maxPriceSlippage` to param interfaces |
| `lib/liquidity/unified-yield/buildUnifiedYieldDepositTx.ts` | Encodes new slippage params |
| `lib/liquidity/unified-yield/buildUnifiedYieldWithdrawTx.ts` | Encodes new slippage params |
| `lib/liquidity/unified-yield/hooks/useUnifiedYieldDeposit.ts` | Accepts slippage config, passes to contract call |
| `lib/liquidity/unified-yield/hooks/useUnifiedYieldWithdraw.ts` | Accepts slippage config, passes to contract call |
| `lib/subgraph-url-helper.ts` | Mainnet now uses unified Alphix subgraph for all queries |
| `lib/backend-client.ts` | `getWebSocketUrl()` now accepts optional `networkMode` for filtering |
| `lib/websocket/WebSocketManager.ts` | Added network mode support, `switchNetwork()` method, auto-reconnect on switch |
| `lib/websocket/WebSocketProvider.tsx` | Passes network mode to manager, calls `switchNetwork()` on network change |
