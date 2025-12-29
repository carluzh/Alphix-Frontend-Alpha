/**
 * Liquidity Modals - Barrel Export
 *
 * Exports the modular liquidity management systems following Uniswap's architecture:
 * - Create: New position creation (three-state pattern)
 * - Increase: Add liquidity to existing positions
 * - Decrease: Remove liquidity from existing positions
 *
 * These replace the old monolithic AddLiquidityModal.tsx and WithdrawLiquidityModal.tsx.
 */

// Create Liquidity (New Positions)
export {
  CreateLiquidityContextProvider,
  useCreateLiquidityContext,
  CreateLiquidityTxContextProvider,
  useCreateLiquidityTxContext,
  CreateLiquidityStep,
  CreateLiquidityForm,
  DEFAULT_RANGE_STATE,
  DEFAULT_DEPOSIT_STATE,
  DEFAULT_ZAP_STATE,
  type CreateTxStep,
  type CreateLiquidityContextType,
  type CreateLiquidityContextProviderProps,
  type CreateLiquidityTxContextProviderProps,
} from './create';

// Increase Liquidity (Add)
export {
  IncreaseLiquidityModal,
  IncreaseLiquidityForm,
  IncreaseLiquidityReview,
  IncreaseLiquidityContextProvider,
  useIncreaseLiquidityContext,
  IncreaseLiquidityTxContextProvider,
  useIncreaseLiquidityTxContext,
  IncreaseLiquidityStep,
  type IncreaseTxStep,
  type IncreaseLiquidityState,
  type IncreaseLiquidityDerivedInfo,
} from './increase';

// Decrease Liquidity (Withdraw)
export {
  DecreaseLiquidityModal,
  DecreaseLiquidityForm,
  DecreaseLiquidityReview,
  DecreaseLiquidityContextProvider,
  useDecreaseLiquidityContext,
  DecreaseLiquidityTxContextProvider,
  useDecreaseLiquidityTxContext,
  DecreaseLiquidityStep,
  type DecreaseTxStep,
  type DecreaseLiquidityState,
  type DecreaseLiquidityDerivedInfo,
  type WithdrawField,
} from './decrease';

// Re-export shared components
export * from './shared';
