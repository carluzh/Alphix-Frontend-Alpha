/**
 * Apollo Queries Index
 *
 * Re-exports all GraphQL query definitions.
 *
 * @see interface/packages/api/src/clients/graphql/web (Uniswap's query files)
 */

// Pool queries
export {
  GET_POOL,
  GET_POOL_STATE,
  GET_POOL_METRICS,
  GET_POOL_PRICE_HISTORY,
  GET_POOL_TICKS,
} from './pools'

// Position queries
export {
  GET_USER_POSITIONS,
  GET_POSITION,
  GET_POSITION_FEES,
} from './positions'

// Re-export fragments for custom queries
export * from './fragments'
