/**
 * Decrease Liquidity Module
 *
 * Following Uniswap's modular architecture pattern with:
 * - Context for UI state
 * - TxContext for transaction data
 * - Thin modal wrapper
 * - Separate Form and Review components
 */

export {
  DecreaseLiquidityContextProvider,
  useDecreaseLiquidityContext,
  DecreaseLiquidityStep,
  type DecreaseLiquidityState,
  type DecreaseLiquidityDerivedInfo,
  type DecreaseLiquidityContextProviderProps,
  type WithdrawField,
} from './DecreaseLiquidityContext';

export {
  DecreaseLiquidityTxContextProvider,
  useDecreaseLiquidityTxContext,
  type DecreaseTxStep,
} from './DecreaseLiquidityTxContext';

export { DecreaseLiquidityForm } from './DecreaseLiquidityForm';
export { DecreaseLiquidityReview } from './DecreaseLiquidityReview';
export { DecreaseLiquidityModal, default } from './DecreaseLiquidityModal';
