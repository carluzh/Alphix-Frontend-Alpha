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
  UnifiedYieldVaultInfo,
  // Withdraw types
  UnifiedYieldWithdrawParams,
  UnifiedYieldWithdrawTxResult,
  UnifiedYieldWithdrawPreview,
  WithdrawPercentage,
} from './types';

export {
  isUnifiedYieldPosition,
  calculateWithdrawShares,
} from './types';

// Approval hooks
export {
  useUnifiedYieldApprovals,
  useCheckUnifiedYieldApprovals,
  type UseUnifiedYieldApprovalsParams,
  type UseUnifiedYieldApprovalsOptions,
  type UseUnifiedYieldApprovalsResult,
} from './useUnifiedYieldApprovals';

// Transaction building
export {
  buildUnifiedYieldDepositTx,
  estimateUnifiedYieldDepositGas,
  validateUnifiedYieldDepositParams,
} from './buildUnifiedYieldDepositTx';

// Position fetching
export {
  fetchUnifiedYieldPositions,
  fetchSingleUnifiedYieldPosition,
  hasUnifiedYieldPositions,
  previewWithdraw,
  previewDeposit,
  type FetchUnifiedYieldPositionsConfig,
} from './fetchUnifiedYieldPositions';

// Withdraw transaction building
export {
  buildUnifiedYieldWithdrawTx,
  estimateUnifiedYieldWithdrawGas,
  validateUnifiedYieldWithdrawParams,
  buildPercentageWithdrawTx,
} from './buildUnifiedYieldWithdrawTx';

// Position adapter
export {
  adaptUnifiedYieldToProcessedPosition,
  adaptAllUnifiedYieldPositions,
  isAdaptedUnifiedYieldPosition,
  mergePositions,
  markAsUnifiedYield,
} from './positionAdapter';

// Execution hooks
export {
  useUnifiedYieldDeposit,
  useUnifiedYieldWithdraw,
  useUnifiedYieldPosition,
  isNativeToken,
  type UseUnifiedYieldDepositParams,
  type UseUnifiedYieldDepositResult,
  type UseUnifiedYieldWithdrawParams,
  type UseUnifiedYieldWithdrawResult,
  type UseUnifiedYieldPositionParams,
  type UseUnifiedYieldPositionResult,
} from './hooks';
