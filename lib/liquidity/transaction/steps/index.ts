/**
 * Transaction Steps
 *
 * Step factory functions for liquidity flows.
 * COPIED FROM UNISWAP - DO NOT MODIFY WITHOUT UPDATING FROM SOURCE
 */

// Main step generator - COPIED FROM UNISWAP
export { generateLPTransactionSteps } from './generateLPTransactionSteps';

export {
  // Approval utilities
  parseERC20ApproveCalldata,
  // Step creation functions - COPIED FROM UNISWAP
  createApprovalTransactionStep,
  createRevocationTransactionStep,
  createPermit2SignatureStep,
  createPermit2TransactionStep,
  createIncreasePositionStep,
  createIncreasePositionAsyncStep,
  createCreatePositionAsyncStep,
  createIncreasePositionStepBatched,
  createDecreasePositionStep,
  createCollectFeesStep,
  // Unified Yield step creation functions
  createUnifiedYieldApprovalStep,
  createUnifiedYieldDepositStep,
  createUnifiedYieldWithdrawStep,
  // Flow ordering functions - COPIED FROM UNISWAP
  orderIncreaseLiquiditySteps,
  orderDecreaseLiquiditySteps,
  orderCollectFeesSteps,
  // UI helpers
  generateStepperSteps,
  createInitialFlowState,
  getNextStep,
  isFlowComplete,
  hasFlowError,
  // Flow types
  type IncreaseLiquidityFlow,
  type DecreaseLiquidityFlow,
  type CollectFeesFlow,
  type ValidatedPermit,
} from './steps';
