/**
 * Tick Limit Detection Tests
 *
 * Extracted from Uniswap's priceRangeInfo.test.ts
 * interface/apps/web/src/components/Liquidity/utils/priceRangeInfo.test.ts
 *
 * Tests the pure functions for detecting full-range positions.
 */

import { FeeAmount, nearestUsableTick, TICK_SPACINGS, TickMath } from '@uniswap/v3-sdk'
import { describe, expect, it } from 'vitest'

import {
  Bound,
  getIsTickAtLimit,
  isFullRangePosition,
} from './useGetRangeDisplay'

// Pre-calculate tick limits for common fee tiers (mirrors Uniswap's approach)
const TICK_SPACE_LIMITS = {
  [FeeAmount.LOW]: [
    nearestUsableTick(TickMath.MIN_TICK, TICK_SPACINGS[FeeAmount.LOW]),
    nearestUsableTick(TickMath.MAX_TICK, TICK_SPACINGS[FeeAmount.LOW]),
  ],
  [FeeAmount.MEDIUM]: [
    nearestUsableTick(TickMath.MIN_TICK, TICK_SPACINGS[FeeAmount.MEDIUM]),
    nearestUsableTick(TickMath.MAX_TICK, TICK_SPACINGS[FeeAmount.MEDIUM]),
  ],
  [FeeAmount.HIGH]: [
    nearestUsableTick(TickMath.MIN_TICK, TICK_SPACINGS[FeeAmount.HIGH]),
    nearestUsableTick(TickMath.MAX_TICK, TICK_SPACINGS[FeeAmount.HIGH]),
  ],
}

describe('getIsTickAtLimit', () => {
  describe('FeeAmount.MEDIUM (tickSpacing: 60)', () => {
    const tickSpacing = TICK_SPACINGS[FeeAmount.MEDIUM]
    const [minTick, maxTick] = TICK_SPACE_LIMITS[FeeAmount.MEDIUM]

    it('returns true for both bounds when at exact limits', () => {
      const result = getIsTickAtLimit(tickSpacing, minTick, maxTick)
      expect(result[Bound.LOWER]).toBe(true)
      expect(result[Bound.UPPER]).toBe(true)
    })

    it('returns false for both bounds when not at limits', () => {
      const result = getIsTickAtLimit(tickSpacing, -197160, -196500)
      expect(result[Bound.LOWER]).toBe(false)
      expect(result[Bound.UPPER]).toBe(false)
    })

    it('returns true for lower, false for upper when only lower at limit', () => {
      const result = getIsTickAtLimit(tickSpacing, minTick, -196500)
      expect(result[Bound.LOWER]).toBe(true)
      expect(result[Bound.UPPER]).toBe(false)
    })

    it('returns false for lower, true for upper when only upper at limit', () => {
      const result = getIsTickAtLimit(tickSpacing, -197160, maxTick)
      expect(result[Bound.LOWER]).toBe(false)
      expect(result[Bound.UPPER]).toBe(true)
    })

    it('returns undefined when tickSpacing is undefined', () => {
      const result = getIsTickAtLimit(undefined, minTick, maxTick)
      expect(result[Bound.LOWER]).toBe(undefined)
      expect(result[Bound.UPPER]).toBe(undefined)
    })

    it('returns undefined when ticks are undefined', () => {
      const result = getIsTickAtLimit(tickSpacing, undefined, undefined)
      expect(result[Bound.LOWER]).toBe(undefined)
      expect(result[Bound.UPPER]).toBe(undefined)
    })
  })

  describe('FeeAmount.LOW (tickSpacing: 10)', () => {
    const tickSpacing = TICK_SPACINGS[FeeAmount.LOW]
    const [minTick, maxTick] = TICK_SPACE_LIMITS[FeeAmount.LOW]

    it('returns true for both bounds when at exact limits', () => {
      const result = getIsTickAtLimit(tickSpacing, minTick, maxTick)
      expect(result[Bound.LOWER]).toBe(true)
      expect(result[Bound.UPPER]).toBe(true)
    })

    it('correctly identifies tick spacing difference from MEDIUM', () => {
      // MIN_TICK for LOW (-887270) is different from MEDIUM (-887220)
      expect(minTick).not.toBe(TICK_SPACE_LIMITS[FeeAmount.MEDIUM][0])
    })
  })

  describe('FeeAmount.HIGH (tickSpacing: 200)', () => {
    const tickSpacing = TICK_SPACINGS[FeeAmount.HIGH]
    const [minTick, maxTick] = TICK_SPACE_LIMITS[FeeAmount.HIGH]

    it('returns true for both bounds when at exact limits', () => {
      const result = getIsTickAtLimit(tickSpacing, minTick, maxTick)
      expect(result[Bound.LOWER]).toBe(true)
      expect(result[Bound.UPPER]).toBe(true)
    })
  })
})

describe('isFullRangePosition', () => {
  describe('FeeAmount.MEDIUM', () => {
    const tickSpacing = TICK_SPACINGS[FeeAmount.MEDIUM]
    const [minTick, maxTick] = TICK_SPACE_LIMITS[FeeAmount.MEDIUM]

    it('returns true when both ticks are at limits', () => {
      expect(isFullRangePosition(tickSpacing, minTick, maxTick)).toBe(true)
    })

    it('returns false when only lower tick is at limit', () => {
      expect(isFullRangePosition(tickSpacing, minTick, -196500)).toBe(false)
    })

    it('returns false when only upper tick is at limit', () => {
      expect(isFullRangePosition(tickSpacing, -197160, maxTick)).toBe(false)
    })

    it('returns false when neither tick is at limit', () => {
      expect(isFullRangePosition(tickSpacing, -197160, -196500)).toBe(false)
    })

    it('returns false when tickSpacing is undefined', () => {
      expect(isFullRangePosition(undefined, minTick, maxTick)).toBe(false)
    })

    it('returns false when ticks are undefined', () => {
      expect(isFullRangePosition(tickSpacing, undefined, undefined)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('handles tick 0 correctly (not a limit)', () => {
      const tickSpacing = TICK_SPACINGS[FeeAmount.MEDIUM]
      expect(isFullRangePosition(tickSpacing, 0, 0)).toBe(false)
    })

    it('works with all common fee tiers', () => {
      for (const feeAmount of [FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH]) {
        const tickSpacing = TICK_SPACINGS[feeAmount]
        const [minTick, maxTick] = [
          nearestUsableTick(TickMath.MIN_TICK, tickSpacing),
          nearestUsableTick(TickMath.MAX_TICK, tickSpacing),
        ]
        expect(isFullRangePosition(tickSpacing, minTick, maxTick)).toBe(true)
      }
    })
  })
})

describe('TickMath constants', () => {
  it('MIN_TICK and MAX_TICK are correct SDK values', () => {
    // These are the raw SDK values before nearest usable tick adjustment
    expect(TickMath.MIN_TICK).toBe(-887272)
    expect(TickMath.MAX_TICK).toBe(887272)
  })

  it('nearestUsableTick respects tick spacing', () => {
    // For tickSpacing 60 (MEDIUM), MIN_TICK rounds to -887220
    expect(nearestUsableTick(TickMath.MIN_TICK, 60)).toBe(-887220)
    expect(nearestUsableTick(TickMath.MAX_TICK, 60)).toBe(887220)

    // For tickSpacing 10 (LOW), MIN_TICK rounds to -887270
    expect(nearestUsableTick(TickMath.MIN_TICK, 10)).toBe(-887270)
    expect(nearestUsableTick(TickMath.MAX_TICK, 10)).toBe(887270)
  })
})
