import { PositionStatus, ProtocolVersion } from './pool-types'
import { Currency, CurrencyAmount, Price, Token } from '@uniswap/sdk-core'
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk'

/** Fee tier configuration (inlined from deleted Create/types.ts) */
type FeeData = {
  isDynamic: boolean
  feeAmount: number
  tickSpacing: number
}

// Chain ID type (replaces Uniswap's EVMUniverseChainId)
type EVMUniverseChainId = number

export interface PriceOrdering {
  priceLower?: Price<Currency, Currency>
  priceUpper?: Price<Currency, Currency>
  quote?: Currency
  base?: Currency
}

interface BasePositionInfo {
  status: PositionStatus
  version: ProtocolVersion
  currency0Amount: CurrencyAmount<Currency>
  currency1Amount: CurrencyAmount<Currency>
  chainId: EVMUniverseChainId
  poolId: string // Refers to pool contract address for v2 & v3, and poolId for v4
  tokenId?: string
  tickLower?: number
  tickUpper?: number
  tickSpacing?: number
  liquidity?: string
  liquidityToken?: Token
  totalSupply?: CurrencyAmount<Currency>
  liquidityAmount?: CurrencyAmount<Currency>
  token0UncollectedFees?: string
  token1UncollectedFees?: string
  fee0Amount?: CurrencyAmount<Currency>
  fee1Amount?: CurrencyAmount<Currency>
  apr?: number
  isHidden?: boolean
}

type V4PositionInfo = BasePositionInfo & {
  version: ProtocolVersion.V4
  tokenId: string
  poolOrPair?: V4Pool
  position?: V4Position
  feeTier?: FeeData
  v4hook?: string
  owner: string
  totalApr?: number
  unclaimedRewardsAmountUni?: string
  boostedApr?: number
}

// Alphix only mints V4 positions; the V2/V3 union arms were removed as dead scaffolding.
export type PositionInfo = V4PositionInfo
