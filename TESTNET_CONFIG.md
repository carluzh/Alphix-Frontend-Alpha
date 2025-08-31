# Testnet Configuration for E2E Testing

## Setup Instructions

1. Copy the configuration below to your environment
2. Fill in your actual testnet endpoints and addresses
3. Run tests with `npm run test:e2e:testnet`

## Required Environment Variables

```bash
# Enable testnet mode for E2E tests
E2E_TESTNET_MODE=true

# Testnet RPC endpoint (e.g., Sepolia, Goerli, etc.)
NEXT_PUBLIC_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID

# Testnet subgraph endpoint
SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/your-testnet-subgraph

# Known testnet pool ID for testing
E2E_TEST_POOL_ID=0x1234567890abcdef... # Replace with actual testnet pool address
```

## Optional Configuration

```bash
# Testnet token addresses for swap testing
E2E_TEST_TOKEN_A=0xabcdef1234567890... # e.g., WETH on testnet
E2E_TEST_TOKEN_B=0xfedcba0987654321... # e.g., USDC on testnet

# Logging and monitoring
LOG_LEVEL=info
NEXT_PUBLIC_SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id

# Rate limiting (adjust based on your testnet provider limits)
SUBGRAPH_RATE_LIMIT_CAPACITY=5   # Requests per refill period
SUBGRAPH_RATE_LIMIT_REFILL=1    # Refill rate per second
RPC_RATE_LIMIT_CAPACITY=10
RPC_RATE_LIMIT_REFILL=2

# Enable rate-limited RPC client
USE_RATE_LIMITED_RPC=true
```

## Popular Testnet Endpoints

### Sepolia (Recommended)
```bash
NEXT_PUBLIC_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
# or
NEXT_PUBLIC_RPC_URL=https://rpc.sepolia.org
```

### Goerli (Deprecated but still available)
```bash
NEXT_PUBLIC_RPC_URL=https://goerli.infura.io/v3/YOUR_INFURA_KEY
```

### Polygon Mumbai
```bash
NEXT_PUBLIC_RPC_URL=https://rpc-mumbai.maticvigil.com
```

## Finding Test Pool IDs

1. **Deploy test pools** using your smart contracts on testnet
2. **Use existing pools** if your protocol has testnet deployments
3. **Check subgraph** for existing pool data
4. **Document the pool ID** in your test configuration

## Running Testnet Tests

```bash
# Run all testnet E2E tests
npm run test:e2e:testnet

# Run specific testnet test
npx playwright test tests/e2e/testnet-pool-page.spec.ts

# Debug testnet tests
npm run test:e2e:testnet:debug
```

## Best Practices

1. **Use free tier RPC endpoints** to avoid costs during development
2. **Set conservative rate limits** to avoid hitting provider limits
3. **Test with small amounts** to avoid losing testnet funds
4. **Document your testnet setup** for team members
5. **Keep testnet and mainnet configurations separate**

## Troubleshooting

### Common Issues

1. **RPC Connection Failed**
   - Verify the RPC URL is accessible
   - Check if the testnet is still active
   - Try a different RPC provider

2. **Pool Not Found**
   - Verify the pool ID is correct
   - Check if the pool exists on the testnet
   - Ensure subgraph is indexed for that pool

3. **Rate Limiting**
   - Reduce request frequency in tests
   - Increase rate limit capacity
   - Use multiple RPC providers if available

4. **Token Balance Issues**
   - Get testnet tokens from faucets
   - Use test accounts with sufficient balance
   - Reduce test transaction amounts

## Testnet Faucets

- **Sepolia ETH**: https://sepoliafaucet.com/
- **Goerli ETH**: https://goerlifaucet.com/
- **Mumbai MATIC**: https://faucet.polygon.technology/

## Example Complete Setup

```bash
# .env.testnet
E2E_TESTNET_MODE=true
NEXT_PUBLIC_RPC_URL=https://sepolia.infura.io/v3/1234567890abcdef
SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/my-protocol/sepolia
E2E_TEST_POOL_ID=0xa1b2c3d4e5f678901234567890abcdef12345678
LOG_LEVEL=debug
SUBGRAPH_RATE_LIMIT_CAPACITY=5
SUBGRAPH_RATE_LIMIT_REFILL=1
USE_RATE_LIMITED_RPC=true
```

