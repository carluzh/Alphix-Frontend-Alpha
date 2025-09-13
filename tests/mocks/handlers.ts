import { http, HttpResponse } from 'msw';

// Mock data for consistent testing
const mockPoolState = {
  poolId: '0x123...',
  sqrtPriceX96: '123456789012345678901234567890',
  tick: 12345,
  liquidity: '1000000000000000000',
  protocolFee: 0,
  lpFee: 3000,
  currentPrice: '1.23',
  currentPoolTick: 12345,
};

const mockLiquidityDepth = {
  success: true,
  data: {
    hookPositions: [
      {
        id: '1',
        tickLower: 12000,
        tickUpper: 13000,
        liquidity: '500000000000000000',
      },
      {
        id: '2',
        tickLower: 12500,
        tickUpper: 13500,
        liquidity: '300000000000000000',
      },
    ],
  },
};

const mockPoolStats = {
  success: true,
  pools: [
    {
      poolId: '0x123...',
      tvlUSD: 1000000,
      volume24hUSD: 50000,
      tvlYesterdayUSD: 950000,
      volumePrev24hUSD: 45000,
    },
  ],
};

const mockPrices = {
  'aETH': 3500,
  'aBTC': 65000,
  'aUSDC': 1,
  'aUSDT': 1,
  'ETH': 3500,
  'BTC': 65000,
};

const mockActivity = {
  success: true,
  data: {
    transactions: [
      {
        id: '1',
        type: 'SWAP',
        amount0: '1000000000000000000',
        amount1: '3500000000',
        timestamp: Math.floor(Date.now() / 1000),
      },
    ],
  },
};

const mockDynamicFee = {
  dynamicFee: '3000',
  dynamicFeeBps: 3000,
  poolId: '0x123...',
  poolName: 'ETH/USDC',
  isEstimate: false,
  note: 'Mock dynamic fee for testing',
};

export const handlers = [
  // Liquidity API routes
  http.get('/api/liquidity/get-pool-state', () => {
    return HttpResponse.json(mockPoolState);
  }),

  http.post('/api/liquidity/get-pool-state', () => {
    return HttpResponse.json(mockPoolState);
  }),

  http.get('/api/liquidity/liquidity-depth', () => {
    return HttpResponse.json(mockLiquidityDepth);
  }),

  http.get('/api/liquidity/get-pools-batch', () => {
    return HttpResponse.json(mockPoolStats);
  }),

  // Prices API route
  http.get('/api/prices/get-token-prices', () => {
    return HttpResponse.json(mockPrices);
  }),

  // Portfolio API route
  http.get('/api/portfolio/get-activity', () => {
    return HttpResponse.json(mockActivity);
  }),

  // Swap API routes
  http.get('/api/swap/get-dynamic-fee', () => {
    return HttpResponse.json(mockDynamicFee);
  }),

  http.get('/api/swap/get-quote', () => {
    return HttpResponse.json({
      quote: {
        amountIn: '1000000000000000000',
        amountOut: '3450000000',
        path: ['0x123...', '0x456...'],
        fees: [3000],
      },
    });
  }),

  // Maintenance status
  http.get('/api/maintenance-status', () => {
    return HttpResponse.json({ maintenance: false });
  }),

  // Login/logout routes
  http.post('/api/login', () => {
    return HttpResponse.json({ success: true, token: 'mock-token' });
  }),

  http.post('/api/logout', () => {
    return HttpResponse.json({ success: true });
  }),

  // External API mocks (CoinGecko)
  http.get('https://api.coingecko.com/api/v3/simple/price*', () => {
    return HttpResponse.json({
      bitcoin: { usd: 65000 },
      ethereum: { usd: 3500 },
      'usd-coin': { usd: 1 },
      tether: { usd: 1 },
    });
  }),

  // Additional API routes for testing
  http.get('/api/liquidity/get-positions*', () => {
    return HttpResponse.json([
      {
        id: 'position-1',
        poolId: '0x123...',
        token0: { symbol: 'aUSDC', amount: '1000000000' },
        token1: { symbol: 'aUSDT', amount: '1000000000' },
        tickLower: 12000,
        tickUpper: 13000,
        liquidity: '1000000000000000000',
      },
    ]);
  }),
];
