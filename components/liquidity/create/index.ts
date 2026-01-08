/**
 * Create Liquidity Module
 *
 * Following Uniswap's modular architecture pattern with:
 * - Context for UI state (three-state pattern: Position, Range, Deposit)
 * - TxContext for transaction handling
 *
 * This module handles creating NEW positions. For increasing existing
 * positions, use the ../increase module.
 *
 * @see interface/apps/web/src/pages/CreatePosition/
 */

// Context providers and hooks
export {
  CreateLiquidityContextProvider,
  useCreateLiquidityContext,
  CreateLiquidityStep,
  DEFAULT_RANGE_STATE,
  DEFAULT_DEPOSIT_STATE,
  DEFAULT_ZAP_STATE,
  type CreateLiquidityContextType,
  type CreateLiquidityContextProviderProps,
} from './CreateLiquidityContext';

export {
  CreateLiquidityTxContextProvider,
  useCreateLiquidityTxContext,
  type CreateTxStep,
  type CreateLiquidityTxContextProviderProps,
} from './CreateLiquidityTxContext';

// The UI for creating positions is now handled by the wizard:
// import { AddLiquidityWizard } from '@/components/liquidity/wizard';
