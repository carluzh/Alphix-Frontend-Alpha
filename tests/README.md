# Testing Documentation

## Test Environment Setup

### Mock Mode (Default)
```bash
# Run all tests with MSW mocks
npm run test:e2e
npm run test:run
```

### Testnet Mode (Optional)
```bash
# Enable testnet mode for E2E tests
E2E_TESTNET_MODE=true NEXT_PUBLIC_RPC_URL=https://your-testnet-rpc.com E2E_TEST_POOL_ID=your-test-pool-id npm run test:e2e:testnet
```

## Environment Variables

### Required for Testnet Mode
```bash
E2E_TESTNET_MODE=true          # Enable testnet testing
NEXT_PUBLIC_RPC_URL=...        # Testnet RPC endpoint
E2E_TEST_POOL_ID=...           # Known testnet pool ID for testing
SUBGRAPH_URL=...               # Testnet subgraph endpoint
```

### Optional
```bash
LOG_LEVEL=debug                # Enable detailed logging
NEXT_PUBLIC_SENTRY_DSN=...     # Enable error reporting
```

## Test Categories

### Unit Tests (`tests/hooks/`)
- Hook behavior testing
- Cache invalidation logic
- Component state management
- ✅ Uses MSW for API mocking

### Integration Tests (`tests/integration/`)
- API route testing
- Zod validation
- Error handling
- ✅ Uses MSW for external service mocking

### E2E Tests (`tests/e2e/`)
- **Mock Mode**: Full user flows with MSW
- **Testnet Mode**: Real blockchain integration
- Browser automation with Playwright

## Testnet Testing

### When to Use Testnet Mode
- Integration testing with real smart contracts
- Testing rate limiting with actual RPC calls
- Validating real-time data updates
- End-to-end user flow validation

### Testnet Configuration Example
```bash
# .env.testnet
E2E_TESTNET_MODE=true
NEXT_PUBLIC_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_KEY
SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/your-testnet-subgraph
E2E_TEST_POOL_ID=0x1234567890abcdef... # Testnet pool address
```

### Running Testnet Tests
```bash
# Run only testnet tests
npm run test:e2e:testnet

# Run specific testnet test
npx playwright test tests/e2e/testnet-pool-page.spec.ts --grep "should load pool page"

# Debug testnet tests
npm run test:e2e:testnet:debug
```

## Mock vs Testnet Comparison

| Feature | Mock Mode | Testnet Mode |
|---------|-----------|--------------|
| Speed | ⚡ Fast | 🐌 Slower (network calls) |
| Reliability | ✅ 100% consistent | ⚠️ Depends on network |
| Coverage | 🧪 Unit + integration | 🌐 Full integration |
| Cost | 💰 Free | 💸 Requires testnet funds |
| Setup | 🔧 Simple | ⚙️ Complex configuration |

## Best Practices

### Writing Tests
1. **Use descriptive test names** that explain the behavior
2. **Test error states** as well as success states
3. **Mock external dependencies** in unit tests
4. **Use data-testid attributes** for reliable element selection
5. **Test loading and error states** explicitly

### Testnet Testing
1. **Use testnet tokens** that are easy to acquire
2. **Set up proper cleanup** after tests
3. **Monitor testnet rate limits** and adjust test frequency
4. **Document testnet-specific setup** requirements
5. **Have fallback mock tests** for CI/CD

### CI/CD Integration
```yaml
# .github/workflows/test.yml
- name: Run Mock Tests
  run: npm run test:run

- name: Run E2E Mock Tests
  run: npm run test:e2e

- name: Run Testnet Tests (optional)
  run: npm run test:e2e:testnet
  if: github.event_name == 'schedule' # Only on scheduled runs
```

## Troubleshooting

### Common Issues

1. **MSW handlers not working**
   - Ensure handlers are exported from `tests/mocks/handlers.ts`
   - Check that MSW server is started in test setup

2. **Testnet connection failures**
   - Verify RPC URL is accessible
   - Check rate limits on testnet RPC
   - Ensure testnet has required contracts deployed

3. **Flaky E2E tests**
   - Add proper wait conditions
   - Use `data-testid` for element selection
   - Handle loading states appropriately

4. **Environment variable issues**
   - Use `.env.test` for test-specific variables
   - Ensure variables are prefixed correctly
   - Check that variables are available in test environment

## Test File Structure

```
tests/
├── setup.ts              # Vitest global setup
├── mocks/
│   ├── server.ts         # MSW server setup
│   └── handlers.ts       # API mock handlers
├── hooks/                # Unit tests for hooks
├── integration/          # API integration tests
├── e2e/
│   ├── test-setup.ts     # Playwright + MSW setup
│   ├── smoke.spec.ts     # Basic smoke tests (mock)
│   ├── testnet-*.spec.ts # Testnet integration tests
│   └── ...
└── README.md             # This file
```

## Performance Testing

### Load Testing (Future)
```bash
# Test multiple concurrent users
npx playwright test --workers=4 tests/e2e/smoke.spec.ts

# Test with different network conditions
npx playwright test --headed --slowMo=100 tests/e2e/
```

### Memory Leak Testing (Future)
```typescript
// Add to test setup
test.afterEach(async ({ page }) => {
  const metrics = await page.metrics();
  expect(metrics.JSHeapUsedSize).toBeLessThan(50 * 1024 * 1024); // 50MB
});
```