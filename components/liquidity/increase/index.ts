/**
 * Increase Liquidity Module
 *
 * Following Uniswap's modular architecture pattern with:
 * - Context for UI state
 * - TxContext for transaction data
 * - Thin modal wrapper
 * - Separate Form and Review components
 */

// Context providers and hooks
export {
  IncreaseLiquidityContextProvider,
  useIncreaseLiquidityContext,
  IncreaseLiquidityStep,
  type IncreaseLiquidityState,
  type IncreaseLiquidityDerivedInfo,
  type IncreaseLiquidityContextProviderProps,
  type PositionField,
} from './IncreaseLiquidityContext';

export {
  IncreaseLiquidityTxContextProvider,
  useIncreaseLiquidityTxContext,
} from './IncreaseLiquidityTxContext';

// Components
export { IncreaseLiquidityForm } from './IncreaseLiquidityForm';
export { IncreaseLiquidityReview } from './IncreaseLiquidityReview';
export { IncreaseLiquidityModal, default } from './IncreaseLiquidityModal';
