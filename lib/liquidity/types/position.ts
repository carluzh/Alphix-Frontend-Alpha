/**
 * Position State Types - Uniswap-style position creation state management
 *
 * Mirrors Uniswap's implementation from:
 * - interface/apps/web/src/components/Liquidity/Create/types.ts
 * - interface/apps/web/src/components/Liquidity/types.ts
 *
 * Simplified for Alphix (V4 only).
 */

import type { Currency, CurrencyAmount, Price } from '@uniswap/sdk-core';
import type { Pool as V4Pool } from '@uniswap/v4-sdk';
import type { Address } from 'viem';

// =============================================================================
// POSITION FIELD ENUM - Matches Uniswap's types/position.ts
// =============================================================================

/**
 * PositionField enum - identifies which token in a position
 */
export enum PositionField {
  TOKEN0 = 'TOKEN0',
  TOKEN1 = 'TOKEN1',
}

// =============================================================================
// FEE DATA TYPES - Matches Uniswap's FeeData
// =============================================================================

export interface FeeData {
  isDynamic: boolean;
  feeAmount: number;
  tickSpacing: number;
}

/**
 * Default fee configuration (0.3% with 60 tick spacing)
 */
export const DEFAULT_FEE_DATA: FeeData = {
  feeAmount: 3000,
  tickSpacing: 60,
  isDynamic: false,
};

// =============================================================================
// POSITION FLOW STEP - Matches Uniswap's PositionFlowStep
// =============================================================================

export enum PositionFlowStep {
  SELECT_TOKENS_AND_FEE_TIER = 0,
  PRICE_RANGE = 1,
  DEPOSIT = 2,
}

// =============================================================================
// RANGE INPUT MODE - Matches Uniswap's RangeAmountInputPriceMode
// =============================================================================

export enum RangeAmountInputPriceMode {
  PRICE = 'price',
  PERCENTAGE = 'percentage',
}

// =============================================================================
// INITIAL POSITION - For migration/edit purposes
// =============================================================================

export interface InitialPosition {
  tickLower: number;
  tickUpper: number;
  isOutOfRange: boolean;
  fee: FeeData;
}

// =============================================================================
// POSITION STATE - Core state for position creation
// =============================================================================

/**
 * PositionState - User-defined state for a position being created
 *
 * This matches Uniswap's PositionState interface.
 */
export interface PositionState {
  fee?: FeeData;
  hook?: string;
  userApprovedHook?: string;
  initialPosition?: InitialPosition;
}

/**
 * Default position state
 */
export const DEFAULT_POSITION_STATE: PositionState = {
  fee: undefined,
  hook: undefined,
  userApprovedHook: undefined,
};

// =============================================================================
// PRICE RANGE STATE - Matches Uniswap's PriceRangeState
// =============================================================================

/**
 * PriceRangeState - State for price range selection
 */
export interface PriceRangeState {
  priceInverted: boolean;
  fullRange: boolean;
  initialPrice: string;
  isInitialPriceDirty?: boolean;
  minPrice?: string;
  maxPrice?: string;
  inputMode?: RangeAmountInputPriceMode;
}

/**
 * Default price range state
 */
export const DEFAULT_PRICE_RANGE_STATE: PriceRangeState = {
  priceInverted: false,
  fullRange: false,
  initialPrice: '',
  isInitialPriceDirty: false,
};

// =============================================================================
// CREATE POSITION INFO - Derived position information
// =============================================================================

/**
 * CreatePositionInfo - Derived information for V4 position creation
 *
 * Simplified from Uniswap's CreateV4PositionInfo since we only support V4.
 */
export interface CreatePositionInfo {
  currencies: {
    /** Display currencies (sorted) */
    display: { [key in PositionField]: Currency | undefined };
    /** SDK currencies (same as display for V4) */
    sdk: { [key in PositionField]: Currency | undefined };
  };
  /** The V4 pool instance */
  pool?: V4Pool;
  /** Whether we're creating a new pool */
  creatingPoolOrPair?: boolean;
  /** Pool ID if exists */
  poolId?: string;
  /** Loading state */
  poolOrPairLoading?: boolean;
  /** Function to refetch pool data */
  refetchPoolData: () => void;
}

// =============================================================================
// PRICE RANGE INFO - Derived price range information
// =============================================================================

/**
 * PriceRangeInfo - Derived information about the selected price range
 */
export interface PriceRangeInfo {
  /** Current pool price */
  price?: Price<Currency, Currency>;
  /** Tick values [lower, upper] */
  ticks: [number | undefined, number | undefined];
  /** Prices at tick boundaries */
  pricesAtTicks: [Price<Currency, Currency> | undefined, Price<Currency, Currency> | undefined];
  /** Whether ticks are at the limit */
  ticksAtLimit: [boolean, boolean];
  /** Mock pool for calculations when creating new pool */
  mockPool?: V4Pool;
}

// =============================================================================
// DEPOSIT STATE - For amount inputs
// =============================================================================

/**
 * DepositState - State for deposit amount inputs
 */
export interface DepositState {
  exactField: PositionField;
  exactAmounts: {
    [PositionField.TOKEN0]?: string;
    [PositionField.TOKEN1]?: string;
  };
}

/**
 * Default deposit state
 */
export const DEFAULT_DEPOSIT_STATE: DepositState = {
  exactField: PositionField.TOKEN0,
  exactAmounts: {
    [PositionField.TOKEN0]: undefined,
    [PositionField.TOKEN1]: undefined,
  },
};

// =============================================================================
// DEPOSIT INFO - Derived deposit information
// =============================================================================

/**
 * DepositInfo - Derived information about deposits
 *
 * Matches Uniswap's DepositInfo from components/Liquidity/types.ts
 */
export interface DepositInfo {
  /** User's token balances */
  currencyBalances: {
    [PositionField.TOKEN0]?: CurrencyAmount<Currency>;
    [PositionField.TOKEN1]?: CurrencyAmount<Currency>;
  };
  /** Formatted amounts for display */
  formattedAmounts: {
    [PositionField.TOKEN0]?: string;
    [PositionField.TOKEN1]?: string;
  };
  /** Parsed currency amounts */
  currencyAmounts: {
    [PositionField.TOKEN0]?: CurrencyAmount<Currency> | null;
    [PositionField.TOKEN1]?: CurrencyAmount<Currency> | null;
  };
  /** USD values of amounts */
  currencyAmountsUSDValue: {
    [PositionField.TOKEN0]?: CurrencyAmount<Currency>;
    [PositionField.TOKEN1]?: CurrencyAmount<Currency>;
  };
  /** Error message if any */
  error?: string | React.ReactNode;
}

// =============================================================================
// POSITION INFO (for existing positions) - Matches Uniswap's PositionInfo
// =============================================================================

/**
 * V4PositionInfo - Information about an existing V4 position
 */
export interface V4PositionInfo {
  /** Position token ID */
  tokenId: bigint;
  /** Pool key components */
  poolId: string;
  currency0: Currency;
  currency1: Currency;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  /** Position range */
  tickLower: number;
  tickUpper: number;
  /** Current liquidity */
  liquidity: bigint;
  /** Fee growth tracking */
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  /** Owed tokens */
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

// =============================================================================
// PRICE DIFFERENCE - For price impact warnings
// =============================================================================

export type WarningSeverity = 'low' | 'medium' | 'high';

export interface PriceDifference {
  value: number;
  absoluteValue: number;
  warning?: WarningSeverity;
}

// =============================================================================
// DYNAMIC FEE TIER SPEEDBUMP - Matches Uniswap's DynamicFeeTierSpeedbumpData
// =============================================================================

export interface DynamicFeeTierSpeedbumpData {
  open: boolean;
  wishFeeData?: FeeData;
}
