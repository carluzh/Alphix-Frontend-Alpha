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
  type HandleApprovalStepParams,
  type HandlePermitTransactionParams,
} from './approvalHandler';

// Permit signature handler
export {
  handleSignatureStep,
  type HandleSignatureStepParams,
} from './permitHandler';

// Position transaction handlers
export {
  handlePositionTransactionStep,
  getLiquidityTxRequest,
  type HandlePositionStepParams,
  type PositionStep,
} from './positionHandler';

// Unified Yield transaction handlers
export {
  handleUnifiedYieldApprovalStep,
  handleUnifiedYieldDepositStep,
  handleUnifiedYieldWithdrawStep,
  type HandleUnifiedYieldApprovalParams,
  type HandleUnifiedYieldDepositParams,
  type HandleUnifiedYieldWithdrawParams,
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
