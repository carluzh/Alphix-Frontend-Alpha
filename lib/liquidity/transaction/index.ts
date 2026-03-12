/**
 * Transaction Module
 *
 * Transaction builders and step management for liquidity operations.
 */

// Transaction builders
export {
  buildIncreaseLiquidityTx,
  prepareIncreasePermit,
  parseTokenIdFromPosition,
  type IncreasePositionData,
  type IncreasePositionParams,
  type BuildIncreaseOptions,
  type BuildIncreaseTxResult,
  type BuildIncreaseTxContext,
  type PrepareIncreasePermitParams,
  buildDecreaseLiquidityTx,
  buildCollectFeesTx,
  type DecreasePositionData,
  type DecreasePositionParams,
  type BuildDecreaseOptions,
  type BuildDecreaseTxResult,
  type BuildDecreaseTxContext,
} from './builders'

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
  getLiquidityTransactionInfo,
  getLiquidityTxRequest,
  getApprovalTransactionInfo,
  getPermitTransactionInfo,
  checkApprovalAmount,
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
  validateLiquidityContext,
  type MintTxApiResponse,
  type TokenConfig,
  type BuildLiquidityContextParams,
} from './context'
