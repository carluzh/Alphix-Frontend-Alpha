/**
 * Chart types - Matching Uniswap's implementation 1:1
 * @see interface/apps/web/src/components/Charts/utils.tsx
 * @see interface/apps/web/src/components/Charts/PriceChart/index.tsx
 * @see interface/apps/web/src/components/Tokens/TokenDetails/ChartSection/util.ts
 */

import type { AreaData, CandlestickData, UTCTimestamp } from 'lightweight-charts'

// Re-export UTCTimestamp for convenience
export type { UTCTimestamp } from 'lightweight-charts'

/**
 * Price chart data type - combines candlestick and area data
 * @see interface/apps/web/src/components/Charts/PriceChart/index.tsx:32
 */
export type PriceChartData = CandlestickData<UTCTimestamp> & AreaData<UTCTimestamp>

/**
 * Chart type enum
 * @see interface/apps/web/src/components/Charts/utils.tsx:9-14
 */
export enum ChartType {
  PRICE = 'Price',
  VOLUME = 'Volume',
  TVL = 'TVL',
  LIQUIDITY = 'Liquidity',
}

/**
 * Price chart display type
 * @see interface/apps/web/src/components/Charts/utils.tsx:4-7
 */
export enum PriceChartType {
  LINE = 'Line chart',
  CANDLESTICK = 'Candlestick',
}

/**
 * Data quality enum for chart data validation
 * @see interface/apps/web/src/components/Tokens/TokenDetails/ChartSection/util.ts:14-18
 */
export enum DataQuality {
  VALID = 0,
  INVALID = 1,
  STALE = 2,
}

/**
 * History duration options for price queries
 * Matches Uniswap's GraphQL HistoryDuration enum
 */
export enum HistoryDuration {
  HOUR = 'HOUR',
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
  YEAR = 'YEAR',
}

/**
 * Result type for chart data queries
 * @see interface/apps/web/src/components/Tokens/TokenDetails/ChartSection/util.ts:6-12
 */
export type ChartQueryResult<TDataType, TChartType extends ChartType> = {
  chartType: TChartType
  entries: TDataType[]
  loading: boolean
  dataQuality: DataQuality
  dataHash?: string
}

/**
 * Timestamped pool price from Uniswap API
 * Matches the GraphQL TimestampedPoolPrice type
 */
export interface TimestampedPoolPrice {
  timestamp: number
  token0Price: number
  token1Price: number
}

/**
 * Variables for pool price chart queries
 */
export interface PoolPriceChartVars {
  poolId: string
  duration: HistoryDuration
  chain?: string
}
