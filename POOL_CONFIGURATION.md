# Pool Configuration System

This guide explains how to use the centralized pool configuration system and how to easily add new pools to the application.

## Overview

The app now uses a centralized configuration system located in `lib/pools-config.ts` that contains:

- **Network Configuration**: Chain ID, name, native currency details
- **Contract Addresses**: All deployed contract addresses (State View, Position Manager, etc.)
- **Token Definitions**: Token metadata including addresses, decimals, icons, prices
- **Pool Definitions**: Pool configurations with token pairs, fees, tick spacing, etc.
- **Helper Functions**: Utilities to access and manipulate pool data

## Key Benefits

1. **Single Source of Truth**: All pool-related constants are in one file
2. **Easy Pool Addition**: Add new pools by simply adding entries to the configuration
3. **Type Safety**: Full TypeScript support with auto-completion
4. **Backwards Compatibility**: Existing code continues to work without changes
5. **Dynamic Updates**: Enable/disable pools without code changes

## Adding New Pools

### Step 1: Add Token Definitions (if needed)

If your pool uses new tokens, add them to the `TOKENS` object in `lib/pools-config.ts`:

```typescript
export const TOKENS: Record<string, TokenDefinition> = {
  // Existing tokens...
  
  WETH: {
    symbol: 'WETH',
    name: 'Wrapped Ethereum',
    address: getAddress('0x4200000000000000000000000000000000000006'),
    decimals: 18,
    displayDecimals: 4,
    icon: '/weth.png',
    defaultUsdPrice: 2500,
    coingeckoId: 'ethereum',
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    address: getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
    decimals: 6,
    displayDecimals: 2,
    icon: '/usdc.png',
    defaultUsdPrice: 1,
    coingeckoId: 'usd-coin',
  },
}
```

#### Token Definition Fields:
- `symbol`: Token symbol (e.g., 'WETH')
- `name`: Full token name
- `address`: Token contract address (checksummed)
- `decimals`: Token decimals (for calculations)
- `displayDecimals`: Decimals to show in UI
- `icon`: Path to token icon (place in `/public/`)
- `defaultUsdPrice`: Fallback USD price
- `coingeckoId`: (Optional) CoinGecko ID for price fetching

### Step 2: Add Pool Configuration

Add your pool to the `POOLS` object:

```typescript
export const POOLS: Record<string, PoolConfig> = {
  // Existing pools...
  
  'weth-usdc': {
    id: 'weth-usdc',                    // URL-friendly ID
    name: 'WETH / USDC',                // Display name
    description: 'Wrapped Ethereum paired with USD Coin',
    apiId: '0x1234...5678',             // On-chain pool ID (64 chars)
    token0Symbol: 'WETH',               // Must exist in TOKENS
    token1Symbol: 'USDC',               // Must exist in TOKENS
    fee: 3000,                          // Pool fee (3000 = 0.3%)
    tickSpacing: 60,                    // Tick spacing
    hooks: CONTRACT_ADDRESSES.DEFAULT_HOOKS,
    highlighted: false,                 // Show as featured
    enabled: true,                      // Pool is active
    tags: ['volatile', 'eth'],          // Categorization
    launchDate: '2024-02-01',          // ISO date string
  },
}
```

#### Pool Configuration Fields:
- `id`: URL-friendly identifier (used in routes like `/liquidity/weth-usdc`)
- `name`: Display name shown in UI
- `description`: Optional description
- `apiId`: The actual on-chain pool ID (hex string, 64 characters)
- `token0Symbol`/`token1Symbol`: Must match keys in `TOKENS`
- `fee`: Pool fee in basis points (3000 = 0.3%, 10000 = 1%)
- `tickSpacing`: Uniswap V4 tick spacing
- `hooks`: Hook contract address (usually `CONTRACT_ADDRESSES.DEFAULT_HOOKS`)
- `highlighted`: Whether to feature this pool prominently
- `enabled`: Whether the pool is active (set to `false` to disable)
- `tags`: Array of strings for categorization/filtering
- `launchDate`: When the pool was launched (ISO date format)

### Step 3: Add Token Icons

Place token icon files in the `/public/` directory:
- Use PNG format
- Recommended size: 32x32px or 64x64px
- Name them clearly (e.g., `/weth.png`, `/usdc.png`)

### Step 4: That's It!

Your new pool will automatically appear in:
- The liquidity pools list
- Pool detail pages (accessible via `/liquidity/your-pool-id`)
- All API endpoints
- Token swapping interface (if applicable)

## Configuration Helper Functions

The configuration provides several helper functions:

```typescript
// Get pool configuration
const pool = getPoolConfig('weth-usdc');

// Get all enabled pools
const pools = getEnabledPools();

// Get featured pools only
const featured = getFeaturedPools();

// Get pool tokens
const tokens = getPoolTokens('weth-usdc');
// Returns: { token0: TokenDefinition, token1: TokenDefinition }

// Find pool by token symbols
const pool = getPoolByTokens('WETH', 'USDC');

// Check if pool is enabled
const isEnabled = isPoolEnabled('weth-usdc');

// Get pools by tag
const volatilePools = getPoolsByTag('volatile');
```

## Managing Pool States

### Temporarily Disable a Pool
Set `enabled: false` in the pool configuration:

```typescript
'weth-usdc': {
  // ... other config
  enabled: false, // Pool won't appear in lists
}
```

### Feature a Pool
Set `highlighted: true`:

```typescript
'weth-usdc': {
  // ... other config
  highlighted: true, // Will appear in featured sections
}
```

### Categorize Pools
Use tags for organization:

```typescript
'weth-usdc': {
  // ... other config
  tags: ['volatile', 'eth', 'stable'], // Multiple tags supported
}
```

## Best Practices

1. **Use Descriptive IDs**: Pool IDs should be clear and URL-friendly (e.g., 'weth-usdc', not 'pool1')

2. **Consistent Naming**: Use the format 'TOKEN0 / TOKEN1' for pool names

3. **Proper Decimals**: Set `displayDecimals` appropriately for each token:
   - Stablecoins: 2 decimals
   - Volatile tokens: 4-6 decimals
   - Bitcoin-like: 6-8 decimals

4. **Accurate Fees**: Use the correct fee tier:
   - 500 (0.05%): Stable pairs
   - 3000 (0.3%): Standard pairs
   - 10000 (1%): Exotic/volatile pairs

5. **Test Thoroughly**: Always test new pools on testnet first

6. **Icon Quality**: Use high-quality, consistent token icons

7. **Gradual Rollout**: Start with `enabled: false`, then enable after testing

## Migration Notes

The refactor maintains backwards compatibility:
- All existing imports continue to work
- Legacy constants are re-exported from the new configuration
- No breaking changes to existing components

## Troubleshooting

### Pool Not Appearing
1. Check that `enabled: true`
2. Verify token symbols exist in `TOKENS`
3. Ensure icon files exist in `/public/`

### API Errors
1. Verify `apiId` is correct (64-character hex string)
2. Check that contract addresses are valid
3. Ensure token addresses are checksummed

### Type Errors
1. Make sure token symbols match exactly (case-sensitive)
2. Verify all required fields are provided
3. Check that `getAddress()` is used for addresses

## Example: Complete New Pool Addition

Here's a complete example of adding a new WETH/USDC pool:

```typescript
// 1. Add tokens (if not already present)
WETH: {
  symbol: 'WETH',
  name: 'Wrapped Ethereum',
  address: getAddress('0x4200000000000000000000000000000000000006'),
  decimals: 18,
  displayDecimals: 4,
  icon: '/weth.png',
  defaultUsdPrice: 2500,
  coingeckoId: 'ethereum',
},

// 2. Add pool configuration
'weth-usdc': {
  id: 'weth-usdc',
  name: 'WETH / USDC',
  description: 'Wrapped Ethereum paired with USD Coin',
  apiId: '0xabcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234',
  token0Symbol: 'WETH',
  token1Symbol: 'USDC',
  fee: 3000,
  tickSpacing: 60,
  hooks: CONTRACT_ADDRESSES.DEFAULT_HOOKS,
  highlighted: true,
  enabled: true,
  tags: ['volatile', 'eth'],
  launchDate: '2024-02-01',
},
```

After adding this configuration:
- Place `/weth.png` and `/usdc.png` in the `/public/` directory
- The pool will be accessible at `/liquidity/weth-usdc`
- It will appear in the pools list as a featured pool
- All API endpoints will work automatically

That's it! Your new pool is ready to use.