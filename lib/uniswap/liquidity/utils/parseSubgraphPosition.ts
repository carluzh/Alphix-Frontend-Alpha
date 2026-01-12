/**
 * parseSubgraphPosition
 *
 * Transforms Alphix subgraph position data into Uniswap's PositionInfo type.
 * Mirrors interface/apps/web/src/components/Liquidity/utils/parseFromRest.ts
 *
 * @see parseRestPosition for the Uniswap REST API equivalent
 */

import { Currency, CurrencyAmount, NativeCurrency, Token } from '@uniswap/sdk-core'
import { PositionStatus, ProtocolVersion } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb'
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk'
import { V3PositionInfo, type PositionInfo } from '../types'
import { DYNAMIC_FEE_DATA, FeeData } from '../Create/types'

// Constants
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Subgraph position token structure
 */
export interface SubgraphPositionToken {
  address: string
  symbol: string
  amount: string
  rawAmount?: string
  decimals?: number
}

/**
 * Subgraph position structure (from useUserPositions)
 */
export interface SubgraphPosition {
  id?: string
  positionId: string
  owner: string
  poolId: string
  token0: SubgraphPositionToken
  token1: SubgraphPositionToken
  tickLower: number
  tickUpper: number
  liquidity: string
  ageSeconds?: number
  blockTimestamp?: number
  lastTimestamp?: number
  isInRange: boolean
  token0UncollectedFees?: string
  token1UncollectedFees?: string
}

/**
 * Pool state needed to create SDK Pool/Position objects
 * Passed separately since our subgraph doesn't include this in position data
 */
export interface PoolState {
  sqrtPriceX96: string
  liquidity: string
  tick: number
  tickSpacing: number
  fee: number
  hooks?: string
}

/**
 * Configuration for parsing
 */
export interface ParseSubgraphPositionConfig {
  chainId: number
  token0Decimals?: number
  token1Decimals?: number
  poolState?: PoolState
  isHidden?: boolean
  apr?: number
}

// Native currency implementation (matches parseFromRest.ts)
class NativeCurrencyImpl extends NativeCurrency {
  private _wrapped: Token | undefined

  constructor(chainId: number) {
    super(chainId, 18, 'ETH', 'Ethereum')
  }

  public get wrapped(): Token {
    if (this._wrapped) return this._wrapped
    const wethAddresses: Record<number, string> = {
      1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // Mainnet
      8453: '0x4200000000000000000000000000000000000006', // Base
      10: '0x4200000000000000000000000000000000000006', // Optimism
      42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // Arbitrum
    }
    const address = wethAddresses[this.chainId] || wethAddresses[1]
    this._wrapped = new Token(this.chainId, address, 18, 'WETH', 'Wrapped Ether')
    return this._wrapped
  }

  public equals(other: Currency): boolean {
    return other.isNative && other.chainId === this.chainId
  }
}

const cachedNativeCurrency: Record<number, NativeCurrencyImpl> = {}

function nativeOnChain(chainId: number): NativeCurrencyImpl {
  if (!cachedNativeCurrency[chainId]) {
    cachedNativeCurrency[chainId] = new NativeCurrencyImpl(chainId)
  }
  return cachedNativeCurrency[chainId]
}

/**
 * Parse token from subgraph format to SDK Currency
 */
function parseSubgraphToken(
  token: SubgraphPositionToken,
  chainId: number,
  defaultDecimals: number = 18
): Currency {
  const decimals = token.decimals ?? defaultDecimals

  if (token.address === ZERO_ADDRESS || token.address.toLowerCase() === ZERO_ADDRESS) {
    return nativeOnChain(chainId)
  }

  return new Token(chainId, token.address, decimals, token.symbol)
}

/**
 * Derive PositionStatus from position state
 * Mirrors Uniswap's status derivation
 */
function derivePositionStatus(
  isInRange: boolean,
  liquidity?: string
): PositionStatus {
  if (!liquidity || liquidity === '0') {
    return PositionStatus.CLOSED
  }
  return isInRange ? PositionStatus.IN_RANGE : PositionStatus.OUT_OF_RANGE
}

/**
 * Parse a subgraph position into Uniswap's PositionInfo type
 *
 * @param position - Subgraph position data
 * @param config - Configuration including chainId and optional pool state
 * @returns PositionInfo compatible with Uniswap components, or undefined if parsing fails
 *
 * @example
 * ```typescript
 * const positionInfo = parseSubgraphPosition(subgraphPosition, {
 *   chainId: 8453,
 *   token0Decimals: 18,
 *   token1Decimals: 6,
 *   poolState: { sqrtPriceX96, liquidity, tick, tickSpacing, fee, hooks }
 * })
 * ```
 */
export function parseSubgraphPosition(
  position: SubgraphPosition | undefined,
  config: ParseSubgraphPositionConfig
): PositionInfo | undefined {
  if (!position) {
    return undefined
  }

  try {
    const { chainId, token0Decimals = 18, token1Decimals = 18, poolState, isHidden, apr } = config

    // Parse tokens to SDK Currency objects
    const token0 = parseSubgraphToken(position.token0, chainId, token0Decimals)
    const token1 = parseSubgraphToken(position.token1, chainId, token1Decimals)

    // Parse amounts - use rawAmount if available, otherwise parse amount string
    const amount0Raw = position.token0.rawAmount || parseAmountToRaw(position.token0.amount, token0Decimals)
    const amount1Raw = position.token1.rawAmount || parseAmountToRaw(position.token1.amount, token1Decimals)

    // Create CurrencyAmount objects
    const currency0Amount = CurrencyAmount.fromRawAmount(token0, amount0Raw)
    const currency1Amount = CurrencyAmount.fromRawAmount(token1, amount1Raw)

    // Parse uncollected fees
    const fee0Raw = position.token0UncollectedFees || '0'
    const fee1Raw = position.token1UncollectedFees || '0'
    const fee0Amount = CurrencyAmount.fromRawAmount(token0, fee0Raw)
    const fee1Amount = CurrencyAmount.fromRawAmount(token1, fee1Raw)

    // Derive status
    const status = derivePositionStatus(position.isInRange, position.liquidity)

    // Build V4 pool and position if pool state is provided
    let pool: V4Pool | undefined
    let sdkPosition: V4Position | undefined
    let feeTier: FeeData | undefined

    if (poolState) {
      const hooks = poolState.hooks || ZERO_ADDRESS
      feeTier = {
        feeAmount: poolState.fee,
        tickSpacing: poolState.tickSpacing,
        isDynamic: false, // Can be detected from fee value if needed
      }

      try {
        pool = new V4Pool(
          token0,
          token1,
          poolState.fee,
          poolState.tickSpacing,
          hooks,
          poolState.sqrtPriceX96,
          poolState.liquidity,
          poolState.tick
        )

        sdkPosition = new V4Position({
          pool,
          liquidity: position.liquidity,
          tickLower: position.tickLower,
          tickUpper: position.tickUpper,
        })
      } catch (e) {
        console.warn('[parseSubgraphPosition] Failed to create SDK pool/position:', e)
      }
    }

    // Return V4 PositionInfo
    // Note: We return as PositionInfo but it's effectively V4PositionInfo
    // Convert hex positionId to decimal for cleaner URLs (0x000d0e35 → 854581)
    const tokenId = position.positionId.startsWith('0x')
      ? BigInt(position.positionId).toString()
      : position.positionId

    return {
      status,
      version: ProtocolVersion.V4,
      chainId,
      poolId: position.poolId,
      tokenId,
      currency0Amount,
      currency1Amount,
      fee0Amount,
      fee1Amount,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      tickSpacing: poolState?.tickSpacing,
      liquidity: position.liquidity,
      token0UncollectedFees: fee0Raw,
      token1UncollectedFees: fee1Raw,
      poolOrPair: pool,
      position: sdkPosition,
      feeTier,
      v4hook: poolState?.hooks,
      owner: position.owner,
      apr,
      isHidden,
    } as PositionInfo
  } catch (e) {
    console.error('[parseSubgraphPosition] Error parsing position:', e, position)
    return undefined
  }
}

/**
 * Parse a formatted amount string to raw BigInt string
 * E.g., "1.5" with 18 decimals → "1500000000000000000"
 */
function parseAmountToRaw(amount: string, decimals: number): string {
  try {
    const parsed = parseFloat(amount)
    if (!Number.isFinite(parsed)) return '0'
    const multiplier = BigInt(10 ** decimals)
    // Use string manipulation to avoid floating point precision issues
    const [whole, frac = ''] = amount.split('.')
    const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals)
    const raw = BigInt(whole + fracPadded)
    return raw.toString()
  } catch {
    return '0'
  }
}

/**
 * Batch parse multiple positions
 */
export function parseSubgraphPositions(
  positions: SubgraphPosition[],
  config: Omit<ParseSubgraphPositionConfig, 'poolState'>,
  poolStates?: Record<string, PoolState>
): PositionInfo[] {
  return positions
    .map((pos) =>
      parseSubgraphPosition(pos, {
        ...config,
        poolState: poolStates?.[pos.poolId],
      })
    )
    .filter((p): p is PositionInfo => p !== undefined)
}
