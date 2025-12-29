/**
 * CreateLiquidityContext - Re-export of AddLiquidityContext with Uniswap-aligned naming
 *
 * This follows Uniswap's pattern where CreatePosition has a combined context
 * managing three state slices: PositionState, PriceRangeState, DepositState
 *
 * @see interface/apps/web/src/pages/CreatePosition/CreateLiquidityContextProvider.tsx
 */

// Re-export the existing AddLiquidityContext with Uniswap-aligned naming
export {
  AddLiquidityProvider as CreateLiquidityContextProvider,
  useAddLiquidityContext as useCreateLiquidityContext,
  DEFAULT_RANGE_STATE,
  DEFAULT_DEPOSIT_STATE,
  DEFAULT_ZAP_STATE,
  type AddLiquidityContextType as CreateLiquidityContextType,
  type AddLiquidityProviderProps as CreateLiquidityContextProviderProps,
} from '../context/AddLiquidityContext';

// Re-export step enum for consistency
export enum CreateLiquidityStep {
  SelectRange = 0,
  Deposit = 1,
  Review = 2,
}
