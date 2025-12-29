/**
 * Shared Liquidity Components
 *
 * Reusable components for liquidity operations following Uniswap's architecture pattern.
 * These components are used across Increase, Decrease, and Create flows.
 */

// Input form for deposits
export {
  DepositInputForm,
  type DepositInputFormProps,
  type DepositInfo,
  type PositionField,
} from './DepositInputForm';

// Detail rows for amounts and fees
export {
  LiquidityDetailRows,
  LiquidityDetailRowsCompact,
  type LiquidityDetailRowsProps,
} from './LiquidityDetailRows';

// Position info header display
export {
  LiquidityPositionInfo,
  LiquidityPositionInfoLoader,
  LiquidityPositionInfoExtended,
  type LiquidityPositionInfoProps,
  type PositionInfoData,
} from './LiquidityPositionInfo';

// Transaction progress indicator
export {
  TransactionProgress,
  TransactionProgressBar,
  createIncreaseLiquiditySteps,
  createDecreaseLiquiditySteps,
  type TransactionProgressProps,
  type TransactionStep,
  type TransactionStepStatus,
} from './TransactionProgress';
