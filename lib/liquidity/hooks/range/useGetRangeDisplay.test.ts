/**
 * getRangeDisplay Tests
 *
 * Mirrors Uniswap's test implementation from:
 * interface/apps/web/src/components/Liquidity/hooks/useGetRangeDisplay.test.tsx
 *
 * Tests the price range display formatting for liquidity positions.
 * Uses pure function version (getRangeDisplay) to avoid jsdom dependencies.
 */

import { Currency, Price } from '@uniswap/sdk-core'
import { FeeAmount, nearestUsableTick, TICK_SPACINGS, TickMath } from '@uniswap/v3-sdk'
import { describe, expect, it } from 'vitest'

import {
  Bound,
  formatRangeString,
  getIsTickAtLimit,
  getRangeDisplay,
} from './useGetRangeDisplay'

function createCurrency(symbol: string): Currency {
  return {
    decimals: 18,
    symbol,
    name: symbol,
  } as unknown as Currency
}

function createPrice({
  baseCurrency,
  quoteCurrency,
  value,
}: {
  baseCurrency: Currency
  quoteCurrency: Currency
  value: string
}): Price<Currency, Currency> {
  return new Price(baseCurrency, quoteCurrency, '1', value)
}

describe('getRangeDisplay', () => {
  const base = createCurrency('BASE')
  const quote = createCurrency('QUOTE')
  const priceLower = createPrice({ baseCurrency: base, quoteCurrency: quote, value: '100' })
  const priceUpper = createPrice({ baseCurrency: base, quoteCurrency: quote, value: '200' })

  it('returns formatted prices and symbols for normal range', () => {
    const result = getRangeDisplay({
      priceOrdering: { priceLower, priceUpper, quote, base },
      pricesInverted: false,
      tickSpacing: 60,
      tickLower: -197160,
      tickUpper: -196500,
    })
    expect(result.minPrice).toBe('100')
    expect(result.maxPrice).toBe('200')
    expect(result.tokenASymbol).toBe('QUOTE')
    expect(result.tokenBSymbol).toBe('BASE')
    expect(result.isFullRange).toBe(false)
  })

  it('returns 0 and infinity for full range', () => {
    const tickSpacing = TICK_SPACINGS[FeeAmount.MEDIUM]
    const minTick = nearestUsableTick(TickMath.MIN_TICK, tickSpacing)
    const maxTick = nearestUsableTick(TickMath.MAX_TICK, tickSpacing)

    const result = getRangeDisplay({
      priceOrdering: { priceLower, priceUpper, quote, base },
      pricesInverted: false,
      tickSpacing,
      tickLower: minTick,
      tickUpper: maxTick,
    })
    expect(result.minPrice).toBe('0')
    expect(result.maxPrice).toBe('∞')
    expect(result.tokenASymbol).toBe('QUOTE')
    expect(result.tokenBSymbol).toBe('BASE')
    expect(result.isFullRange).toBe(true)
  })

  it('returns - for missing price', () => {
    const result = getRangeDisplay({
      priceOrdering: { priceLower: undefined, priceUpper, quote, base },
      pricesInverted: false,
      tickSpacing: 60,
      tickLower: -197160,
      tickUpper: -196500,
    })
    expect(result.minPrice).toBe('-')
    expect(result.maxPrice).toBe('200')
    expect(result.tokenASymbol).toBe('QUOTE')
    expect(result.tokenBSymbol).toBe('BASE')
    expect(result.isFullRange).toBe(false)
  })

  it('handles inverted prices for normal range', () => {
    const result = getRangeDisplay({
      priceOrdering: { priceLower, priceUpper, quote, base },
      pricesInverted: true,
      tickSpacing: 60,
      tickLower: -197160,
      tickUpper: -196500,
    })
    // When inverted, prices are 1/value, so 1/200=0.005, 1/100=0.01
    expect(result.minPrice).toBe('0.005')
    expect(result.maxPrice).toBe('0.01')
    expect(result.tokenASymbol).toBe('BASE')
    expect(result.tokenBSymbol).toBe('QUOTE')
    expect(result.isFullRange).toBe(false)
  })

  it('handles inverted prices for full range', () => {
    const tickSpacing = TICK_SPACINGS[FeeAmount.MEDIUM]
    const minTick = nearestUsableTick(TickMath.MIN_TICK, tickSpacing)
    const maxTick = nearestUsableTick(TickMath.MAX_TICK, tickSpacing)

    const result = getRangeDisplay({
      priceOrdering: { priceLower, priceUpper, quote, base },
      pricesInverted: true,
      tickSpacing,
      tickLower: minTick,
      tickUpper: maxTick,
    })
    expect(result.minPrice).toBe('0')
    expect(result.maxPrice).toBe('∞')
    expect(result.tokenASymbol).toBe('BASE')
    expect(result.tokenBSymbol).toBe('QUOTE')
    expect(result.isFullRange).toBe(true)
  })

  it('handles missing tickSpacing, tickLower, tickUpper', () => {
    const result = getRangeDisplay({
      priceOrdering: { priceLower, priceUpper, quote, base },
      pricesInverted: false,
    })
    expect(result.minPrice).toBe('100')
    expect(result.maxPrice).toBe('200')
  })
})

describe('formatRangeString', () => {
  it('formats full range correctly', () => {
    const result = formatRangeString({
      minPrice: '0',
      maxPrice: '∞',
      tokenASymbol: 'USDC',
      tokenBSymbol: 'ETH',
      isFullRange: true,
    })
    expect(result).toBe('Full Range (USDC per ETH)')
  })

  it('formats normal range correctly', () => {
    const result = formatRangeString({
      minPrice: '1,500',
      maxPrice: '2,000',
      tokenASymbol: 'USDC',
      tokenBSymbol: 'ETH',
      isFullRange: false,
    })
    expect(result).toBe('1,500 - 2,000 USDC per ETH')
  })

  it('handles missing token symbols', () => {
    const result = formatRangeString({
      minPrice: '100',
      maxPrice: '200',
      isFullRange: false,
    })
    expect(result).toBe('100 - 200')
  })

  it('handles full range with missing symbols', () => {
    const result = formatRangeString({
      minPrice: '0',
      maxPrice: '∞',
      isFullRange: true,
    })
    expect(result).toBe('Full Range (? per ?)')
  })
})

describe('tick at limit edge cases', () => {
  it('detects partial limit (lower only)', () => {
    const tickSpacing = TICK_SPACINGS[FeeAmount.MEDIUM]
    const minTick = nearestUsableTick(TickMath.MIN_TICK, tickSpacing)

    const result = getIsTickAtLimit(tickSpacing, minTick, -196500)
    expect(result[Bound.LOWER]).toBe(true)
    expect(result[Bound.UPPER]).toBe(false)
  })

  it('detects partial limit (upper only)', () => {
    const tickSpacing = TICK_SPACINGS[FeeAmount.MEDIUM]
    const maxTick = nearestUsableTick(TickMath.MAX_TICK, tickSpacing)

    const result = getIsTickAtLimit(tickSpacing, -197160, maxTick)
    expect(result[Bound.LOWER]).toBe(false)
    expect(result[Bound.UPPER]).toBe(true)
  })
})
