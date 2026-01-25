/**
 * Unified Yield Module
 *
 * Exports for Unified Yield liquidity provision functionality.
 * Unified Yield is an alternative to standard V4 liquidity that:
 * - Deposits through Hook contracts (not PositionManager)
 * - Hook IS the ERC-4626 vault - users receive Hook shares directly
 * - Earns yield from swap fees + Aave lending (rehypothecation)
 *
 * Architecture:
 * - One Hook per pool
 * - Hook mints shares to users (ERC-4626 compliant)
 * - Hook internally deposits into shared underlying vaults per token
 * - Native ETH is wrapped by Hook internally
 */

// ABI
export { UNIFIED_YIELD_HOOK_ABI } from './abi/unifiedYieldHookABI';
export type { UnifiedYieldHookABI } from './abi/unifiedYieldHookABI';

// Types
export type {
  UnifiedYieldPosition,
  UnifiedYieldDepositParams,
  UnifiedYieldDepositTxResult,
  UnifiedYieldApprovalStatus,
  UnifiedYieldApprovalParams,
  // Withdraw types
  UnifiedYieldWithdrawParams,
  UnifiedYieldWithdrawTxResult,
  UnifiedYieldWithdrawPreview,
  WithdrawPercentage,
} from './types';

export {
  isUnifiedYieldPosition,
  calculateWithdrawShares,
  parseUnifiedYieldPositionId,
  isUnifiedYieldPositionId,
  createUnifiedYieldPositionId,
  type ParsedUnifiedYieldPositionId,
} from './types';

// Approval hooks
export {
  useUnifiedYieldApprovals,
  type UseUnifiedYieldApprovalsParams,
  type UseUnifiedYieldApprovalsOptions,
  type UseUnifiedYieldApprovalsResult,
} from './useUnifiedYieldApprovals';

// Transaction building
export {
  buildUnifiedYieldDepositTx,
  validateUnifiedYieldDepositParams,
  previewDeposit,
} from './buildUnifiedYieldDepositTx';

// Position fetching
export {
  fetchUnifiedYieldPositions,
  fetchSingleUnifiedYieldPosition,
  type FetchUnifiedYieldPositionsConfig,
} from './fetchUnifiedYieldPositions';

// Withdraw transaction building
export {
  buildUnifiedYieldWithdrawTx,
  validateUnifiedYieldWithdrawParams,
  previewWithdraw,
  calculateSharesFromPercentage,
} from './buildUnifiedYieldWithdrawTx';

// Position adapter
export {
  adaptUnifiedYieldToProcessedPosition,
  type UnifiedYieldProcessedPosition,
} from './positionAdapter';

// Execution hooks
export {
  useUnifiedYieldDeposit,
  useUnifiedYieldWithdraw,
  type UseUnifiedYieldDepositParams,
  type UseUnifiedYieldDepositResult,
  type UseUnifiedYieldWithdrawParams,
  type UseUnifiedYieldWithdrawResult,
} from './hooks';
