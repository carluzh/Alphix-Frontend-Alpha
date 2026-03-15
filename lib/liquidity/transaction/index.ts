/**
 * Transaction Module
 *
 * Transaction builders and step management for liquidity operations.
 */

// Transaction builders
export {
  buildIncreaseLiquidityTx,
  parseTokenIdFromPosition,
  type IncreasePositionData,
  type BuildIncreaseOptions,
  type BuildIncreaseTxResult,
  type BuildIncreaseTxContext,
  type PrepareIncreasePermitParams,
  buildDecreaseLiquidityTx,
  buildCollectFeesTx,
  type DecreasePositionData,
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

// Permit2 shared utilities
export {
  checkERC20Allowances,
  buildPermitBatchData,
  buildPermitBatchForSDK,
  type TokenForPermitCheck,
  type ERC20ApprovalResult,
  type PermitBatchDataResult,
} from './permit2-checks'

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
