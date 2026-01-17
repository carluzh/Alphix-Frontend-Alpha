/**
 * Unified Yield Hooks
 *
 * React hooks for managing Unified Yield positions:
 * - useUnifiedYieldDeposit: Execute deposits
 * - useUnifiedYieldWithdraw: Execute withdrawals
 * - useUnifiedYieldPosition: Combined position management
 */

export {
  useUnifiedYieldDeposit,
  isNativeToken,
  type UseUnifiedYieldDepositParams,
  type UseUnifiedYieldDepositResult,
} from './useUnifiedYieldDeposit';

export {
  useUnifiedYieldWithdraw,
  type UseUnifiedYieldWithdrawParams,
  type UseUnifiedYieldWithdrawResult,
} from './useUnifiedYieldWithdraw';

export {
  useUnifiedYieldPosition,
  type UseUnifiedYieldPositionParams,
  type UseUnifiedYieldPositionResult,
} from './useUnifiedYieldPosition';
