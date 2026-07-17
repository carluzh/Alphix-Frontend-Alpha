/**
 * Transaction Module
 *
 * Step management + handlers for liquidity operations. V4 tx-building primitives
 * (mint/increase/decrease/collect + Permit2 logic) have been sunsetted in favor
 * of the Uniswap Liquidity API (see @/lib/liquidity/uniswap-api/client).
 */

// Main step generator - COPIED FROM UNISWAP
export { generateLPTransactionSteps } from './steps'

// Step handlers and execution store
export {
  // Execution store
  useExecutionStore,
  type ExecutionState,
  type ExecutionStore,
} from './executor'

// Context builders
export {
  buildLiquidityTxContext,
  type MintTxApiResponse,
  type TokenConfig,
  type BuildLiquidityContextParams,
} from './context'
