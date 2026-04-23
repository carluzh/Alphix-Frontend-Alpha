/**
 * Transaction Module
 *
 * Step management + handlers for liquidity operations. V4 tx-building primitives
 * (mint/increase/decrease/collect + Permit2 logic) have been sunsetted in favor
 * of the Uniswap Liquidity API (see @/lib/liquidity/uniswap-api/client).
 */

// Step factory functions - COPIED FROM UNISWAP
export {
  parseERC20ApproveCalldata,
  createApprovalTransactionStep,
  createRevocationTransactionStep,
  createPermit2SignatureStep,
  createPermit2TransactionStep,
  createIncreasePositionStep,
  createIncreasePositionAsyncStep,
  createIncreasePositionStepBatched,
  createDecreasePositionStep,
  createCollectFeesStep,
  orderIncreaseLiquiditySteps,
  orderDecreaseLiquiditySteps,
  orderCollectFeesSteps,
  generateStepperSteps,
  createInitialFlowState,
  getNextStep,
  isFlowComplete,
  hasFlowError,
  type IncreaseLiquidityFlow,
  type DecreaseLiquidityFlow,
  type CollectFeesFlow,
  type ValidatedPermit,
} from './steps'

// Main step generator - COPIED FROM UNISWAP
export { generateLPTransactionSteps } from './steps'

// Step handlers and execution store
export {
  handleApprovalTransactionStep,
  handlePermitTransactionStep,
  handleSignatureStep,
  handlePositionTransactionStep,
  handlePositionTransactionBatchedStep,
  getLiquidityTxRequest,
  // Execution store
  useExecutionStore,
  selectIsLocked,
  selectCurrentStepState,
  selectSteps,
  selectExecutionStatus,
  type ExecutionState,
  type ExecutionStore,
} from './executor'

// Context builders
export {
  buildLiquidityTxContext,
  buildCreatePositionContext,
  buildIncreasePositionContext,
  buildDecreasePositionContext,
  buildCollectFeesContext,
  type MintTxApiResponse,
  type TokenConfig,
  type BuildLiquidityContextParams,
} from './context'
