/**
 * Test Constants for Alphix
 *
 * Based on Uniswap's test-utils/constants.ts pattern.
 * Contains pre-built tokens, amounts, and prices for Base chain (chainId 8453).
 */
import { CurrencyAmount, Percent, Price, Token } from '@uniswap/sdk-core'
import JSBI from 'jsbi'

// =============================================================================
// CHAIN CONSTANTS
// =============================================================================

/** Base chain ID */
export const BASE_CHAIN_ID = 8453

/** Ethereum mainnet chain ID (for reference tests) */
export const MAINNET_CHAIN_ID = 1

// =============================================================================
// BASE CHAIN TOKENS
// =============================================================================

/**
 * USDC on Base - Native Circle USDC
 * Address: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
 */
export const USDC_BASE = new Token(
  BASE_CHAIN_ID,
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  6,
  'USDC',
  'USD Coin'
)

/**
 * aUSDT on Base - Alphix USDT
 * Address: 0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2
 */
export const AUSDT_BASE = new Token(
  BASE_CHAIN_ID,
  '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  6,
  'aUSDT',
  'Alphix USDT'
)

/**
 * WETH on Base
 * Address: 0x4200000000000000000000000000000000000006
 */
export const WETH_BASE = new Token(
  BASE_CHAIN_ID,
  '0x4200000000000000000000000000000000000006',
  18,
  'WETH',
  'Wrapped Ether'
)

/**
 * Generic test tokens with simple addresses for unit tests
 */
export const TEST_TOKEN_A = new Token(
  BASE_CHAIN_ID,
  '0x0000000000000000000000000000000000000001',
  18,
  'TSTA',
  'Test Token A'
)

export const TEST_TOKEN_B = new Token(
  BASE_CHAIN_ID,
  '0x0000000000000000000000000000000000000002',
  18,
  'TSTB',
  'Test Token B'
)

export const TEST_TOKEN_C = new Token(
  BASE_CHAIN_ID,
  '0x0000000000000000000000000000000000000003',
  6,
  'TSTC',
  'Test Token C'
)

// =============================================================================
// MAINNET TOKENS (for reference price tests)
// =============================================================================

/**
 * USDT on Mainnet (for getPriceDifference tests that use USDT)
 */
export const USDT_MAINNET = new Token(
  MAINNET_CHAIN_ID,
  '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  6,
  'USDT',
  'Tether USD'
)

/**
 * ETH placeholder for mainnet tests
 */
export const ETH_MAINNET_PLACEHOLDER = new Token(
  MAINNET_CHAIN_ID,
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  18,
  'WETH',
  'Wrapped Ether'
)

// =============================================================================
// CURRENCY AMOUNT HELPERS
// =============================================================================

/**
 * Create a CurrencyAmount from a token and raw amount string.
 * Uses JSBI for compatibility with SDK.
 */
export function createAmount<T extends Token>(token: T, rawAmount: string): CurrencyAmount<T> {
  return CurrencyAmount.fromRawAmount(token, JSBI.BigInt(rawAmount))
}

/**
 * Pre-built common amounts for testing
 */
export const AMOUNTS = {
  // USDC amounts (6 decimals)
  USDC_1: createAmount(USDC_BASE, '1000000'),        // 1 USDC
  USDC_100: createAmount(USDC_BASE, '100000000'),    // 100 USDC
  USDC_1000: createAmount(USDC_BASE, '1000000000'),  // 1000 USDC

  // aUSDT amounts (6 decimals)
  AUSDT_1: createAmount(AUSDT_BASE, '1000000'),       // 1 aUSDT
  AUSDT_100: createAmount(AUSDT_BASE, '100000000'),   // 100 aUSDT
  AUSDT_1000: createAmount(AUSDT_BASE, '1000000000'), // 1000 aUSDT

  // WETH amounts (18 decimals)
  WETH_1: createAmount(WETH_BASE, '1000000000000000000'),    // 1 WETH
  WETH_01: createAmount(WETH_BASE, '100000000000000000'),    // 0.1 WETH
  WETH_001: createAmount(WETH_BASE, '1000000000000000'),     // 0.001 WETH
}

// =============================================================================
// PERCENT HELPERS
// =============================================================================

/**
 * Create a Percent from a percentage value.
 * @param value - Percentage as a number (e.g., 5 for 5%)
 * @param precision - Decimal precision (default 100 for whole percentages)
 */
export function createPercent(numerator: number, denominator: number = 100): Percent {
  return new Percent(numerator, denominator)
}

/**
 * Pre-built common percentages for testing
 */
export const PERCENTS = {
  // Standard slippage values
  SLIPPAGE_05: createPercent(5, 1000),   // 0.5%
  SLIPPAGE_1: createPercent(1, 100),     // 1%
  SLIPPAGE_2: createPercent(2, 100),     // 2%
  SLIPPAGE_5: createPercent(5, 100),     // 5%

  // Price impact values
  IMPACT_POSITIVE_5: createPercent(5, 100),     // +5% (negative for user)
  IMPACT_POSITIVE_10: createPercent(10, 100),   // +10% (negative for user)
  IMPACT_NEGATIVE_25: createPercent(-25, 1000), // -2.5% (positive for user)
  IMPACT_ZERO: createPercent(0, 100),           // 0%
  IMPACT_SMALL: createPercent(123, 100000),     // 0.123%
  IMPACT_LARGE_NEGATIVE: createPercent(-1, 1),  // -100%
}

// =============================================================================
// PRICE HELPERS
// =============================================================================

/**
 * Create a Price from two currency amounts.
 */
export function createPrice<TBase extends Token, TQuote extends Token>(
  baseAmount: CurrencyAmount<TBase>,
  quoteAmount: CurrencyAmount<TQuote>
): Price<TBase, TQuote> {
  return new Price(
    baseAmount.currency,
    quoteAmount.currency,
    baseAmount.quotient,
    quoteAmount.quotient
  )
}

// =============================================================================
// TRANSACTION REQUEST MOCKS
// =============================================================================

/**
 * Base mock transaction request for testing
 */
export const MOCK_TX_REQUEST = {
  chainId: BASE_CHAIN_ID,
  data: '0x000' as `0x${string}`,
  to: '0x456' as `0x${string}`,
  value: 0n,
}

/**
 * Mock approval transaction request (approve to Permit2)
 * Decodes to: approve(0x000000000022d473030f116ddee9f6b43ac78ba3, maxUint256)
 */
export const MOCK_APPROVE_REQUEST = {
  ...MOCK_TX_REQUEST,
  data: '0x095ea7b3000000000000000000000000000000000022d473030f116ddee9f6b43ac78ba3ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as `0x${string}`,
}

/**
 * Mock revoke transaction request (approve to 0)
 * Decodes to: approve(0x000000000022d473030f116ddee9f6b43ac78ba3, 0)
 */
export const MOCK_REVOKE_REQUEST = {
  ...MOCK_TX_REQUEST,
  data: '0x095ea7b3000000000000000000000000000000000022d473030f116ddee9f6b43ac78ba30000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
}

/**
 * Permit2 contract address (extracted from mock data)
 */
export const PERMIT2_ADDRESS = '0x000000000022d473030f116ddee9f6b43ac78ba3'

// =============================================================================
// TEST ADDRESSES
// =============================================================================

export const TEST_ADDRESSES = {
  USER: '0x18d058a7E0486E632f7DfC473BC76D72CD201cAd' as `0x${string}`,
  SPENDER: '0x000000000022d473030f116ddee9f6b43ac78ba3' as `0x${string}`,
  POOL: '0x1234567890123456789012345678901234567890' as `0x${string}`,
}
