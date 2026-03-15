/**
 * Uniswap Gateway API configuration
 *
 * Shared constants for fetching data from Uniswap's interface.gateway.uniswap.org.
 * Centralised here to avoid duplication across API routes.
 */

// GraphQL Gateway (v1) — tick data, price history
export const UNISWAP_GRAPHQL_GATEWAY = 'https://interface.gateway.uniswap.org/v1/graphql'

export const UNISWAP_GRAPHQL_HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://app.uniswap.org',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
} as const

// Data API (v2, gRPC-Connect) — portfolio balances
export const UNISWAP_DATA_API_PORTFOLIO = 'https://interface.gateway.uniswap.org/v2/data.v1.DataApiService/GetPortfolio'

export const UNISWAP_DATA_API_HEADERS = {
  'Content-Type': 'application/json',
  'Origin': 'https://app.uniswap.org',
  'Referer': 'https://app.uniswap.org/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Connect-Protocol-Version': '1',
} as const

// Data API (v2) — portfolio chart
export const UNISWAP_DATA_API_PORTFOLIO_CHART = 'https://interface.gateway.uniswap.org/v2/data.v1.DataApiService/GetPortfolioChart'
