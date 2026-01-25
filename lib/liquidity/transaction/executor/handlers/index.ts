/**
 * Step Handlers - Barrel Export
 *
 * COPIED FROM UNISWAP - DO NOT MODIFY WITHOUT UPDATING FROM SOURCE
 * Source: interface/apps/web/src/state/sagas/transactions/utils.ts
 * Source: interface/apps/web/src/state/sagas/liquidity/liquiditySaga.ts
 *
 * These handlers execute individual transaction steps in liquidity flows.
 */

// Approval handlers
export {
  handleApprovalTransactionStep,
  handlePermitTransactionStep,
  getApprovalTransactionInfo,
  getPermitTransactionInfo,
  checkApprovalAmount,
  type HandleApprovalStepParams,
  type HandlePermitTransactionParams,
  type ApproveTransactionInfo,
  type Permit2ApproveTransactionInfo,
} from './approvalHandler';

// Permit signature handler
export {
  handleSignatureStep,
  type HandleSignatureStepParams,
} from './permitHandler';

// Position transaction handlers
export {
  handlePositionTransactionStep,
  handlePositionTransactionBatchedStep,
  getLiquidityTransactionInfo,
  getLiquidityTxRequest,
  type HandlePositionStepParams,
  type HandleBatchedPositionStepParams,
  type PositionStep,
  type BatchedPositionStep,
  type LiquidityTransactionInfo,
  type LiquidityIncreaseTransactionInfo,
  type LiquidityDecreaseTransactionInfo,
  type CollectFeesTransactionInfo,
} from './positionHandler';

// Unified Yield transaction handlers
export {
  handleUnifiedYieldApprovalStep,
  handleUnifiedYieldDepositStep,
  handleUnifiedYieldWithdrawStep,
  getUnifiedYieldApprovalInfo,
  getUnifiedYieldDepositInfo,
  getUnifiedYieldWithdrawInfo,
  type HandleUnifiedYieldApprovalParams,
  type HandleUnifiedYieldDepositParams,
  type HandleUnifiedYieldWithdrawParams,
  type UnifiedYieldStep,
  type UnifiedYieldApprovalInfo,
  type UnifiedYieldDepositInfo,
  type UnifiedYieldWithdrawInfo,
  type UnifiedYieldTransactionInfo,
} from './unifiedYieldHandler';

// Step handler registry for extensible step execution
export {
  STEP_HANDLER_REGISTRY,
  isRegisteredStepType,
  getStepHandler,
  executeRegisteredStep,
  type TransactionFunctions,
  type StepExecutionContext,
  type TransactionStepHandler,
  type StepHandlerEntry,
} from './registry';
