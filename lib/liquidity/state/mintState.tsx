/**
 * Mint State - Zustand-based state management for position creation
 *
 * Mirrors Uniswap's implementation from:
 * - interface/apps/web/src/state/mint/v3/reducer.ts
 * - interface/apps/web/src/state/mint/v3/actions.ts
 * - interface/apps/web/src/state/mint/v3/hooks.tsx
 *
 * Uses Zustand for simpler, more performant state management.
 * Maintains backwards-compatible API with previous Context+useReducer implementation.
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useCallback, type ReactNode } from 'react';
import { PositionField } from '../types';

// =============================================================================
// STATE TYPES - Matches Uniswap's MintState
// =============================================================================

export interface MintState {
  /** Which field the user is actively editing */
  independentField: PositionField;
  /** The value in the active field */
  typedValue: string;
  /** Start price for new pools (not used in Alphix - pools are pre-deployed) */
  startPriceTypedValue: string;
  /** Left range input (min price or tick) */
  leftRangeTypedValue: string;
  /** Right range input (max price or tick) */
  rightRangeTypedValue: string;
  /** Full precision value for token0 */
  fullPrecisionValue0: string;
  /** Full precision value for token1 */
  fullPrecisionValue1: string;
}

export const initialMintState: MintState = {
  independentField: PositionField.TOKEN0,
  typedValue: '',
  startPriceTypedValue: '',
  leftRangeTypedValue: '',
  rightRangeTypedValue: '',
  fullPrecisionValue0: '',
  fullPrecisionValue1: '',
};

// =============================================================================
// ACTION TYPES - Kept for backwards compatibility
// =============================================================================

export enum MintActionType {
  TYPE_INPUT = 'MINT/TYPE_INPUT',
  TYPE_START_PRICE_INPUT = 'MINT/TYPE_START_PRICE_INPUT',
  TYPE_LEFT_RANGE_INPUT = 'MINT/TYPE_LEFT_RANGE_INPUT',
  TYPE_RIGHT_RANGE_INPUT = 'MINT/TYPE_RIGHT_RANGE_INPUT',
  SET_FULL_RANGE = 'MINT/SET_FULL_RANGE',
  RESET_MINT_STATE = 'MINT/RESET_MINT_STATE',
  SET_FULL_PRECISION = 'MINT/SET_FULL_PRECISION',
}

// Action payloads - kept for backwards compatibility
interface TypeInputPayload {
  field: PositionField;
  typedValue: string;
  noLiquidity?: boolean;
}

interface TypeRangePayload {
  typedValue: string;
}

interface SetFullRangePayload {
  leftRangeTypedValue: string;
  rightRangeTypedValue: string;
}

interface SetFullPrecisionPayload {
  field: PositionField;
  value: string;
}

// Action union type - kept for backwards compatibility
export type MintAction =
  | { type: MintActionType.TYPE_INPUT; payload: TypeInputPayload }
  | { type: MintActionType.TYPE_START_PRICE_INPUT; payload: TypeRangePayload }
  | { type: MintActionType.TYPE_LEFT_RANGE_INPUT; payload: TypeRangePayload }
  | { type: MintActionType.TYPE_RIGHT_RANGE_INPUT; payload: TypeRangePayload }
  | { type: MintActionType.SET_FULL_RANGE; payload: SetFullRangePayload }
  | { type: MintActionType.RESET_MINT_STATE }
  | { type: MintActionType.SET_FULL_PRECISION; payload: SetFullPrecisionPayload };

// =============================================================================
// ACTION CREATORS - Kept for backwards compatibility
// =============================================================================

export const mintActions = {
  typeInput: (payload: TypeInputPayload): MintAction => ({
    type: MintActionType.TYPE_INPUT,
    payload,
  }),

  typeStartPriceInput: (typedValue: string): MintAction => ({
    type: MintActionType.TYPE_START_PRICE_INPUT,
    payload: { typedValue },
  }),

  typeLeftRangeInput: (typedValue: string): MintAction => ({
    type: MintActionType.TYPE_LEFT_RANGE_INPUT,
    payload: { typedValue },
  }),

  typeRightRangeInput: (typedValue: string): MintAction => ({
    type: MintActionType.TYPE_RIGHT_RANGE_INPUT,
    payload: { typedValue },
  }),

  setFullRange: (leftRangeTypedValue: string, rightRangeTypedValue: string): MintAction => ({
    type: MintActionType.SET_FULL_RANGE,
    payload: { leftRangeTypedValue, rightRangeTypedValue },
  }),

  resetMintState: (): MintAction => ({
    type: MintActionType.RESET_MINT_STATE,
  }),

  setFullPrecision: (field: PositionField, value: string): MintAction => ({
    type: MintActionType.SET_FULL_PRECISION,
    payload: { field, value },
  }),
};

// =============================================================================
// REDUCER - Kept for backwards compatibility (used internally by dispatch)
// =============================================================================

export function mintReducer(state: MintState, action: MintAction): MintState {
  switch (action.type) {
    case MintActionType.TYPE_INPUT: {
      const { field, typedValue, noLiquidity } = action.payload;

      if (noLiquidity) {
        // If no liquidity, set independent amounts independently
        if (field === PositionField.TOKEN0) {
          return {
            ...state,
            independentField: field,
            typedValue,
            fullPrecisionValue0: typedValue,
          };
        } else {
          return {
            ...state,
            independentField: field,
            typedValue,
            fullPrecisionValue1: typedValue,
          };
        }
      }

      return {
        ...state,
        independentField: field,
        typedValue,
      };
    }

    case MintActionType.TYPE_START_PRICE_INPUT:
      return {
        ...state,
        startPriceTypedValue: action.payload.typedValue,
      };

    case MintActionType.TYPE_LEFT_RANGE_INPUT:
      return {
        ...state,
        leftRangeTypedValue: action.payload.typedValue,
      };

    case MintActionType.TYPE_RIGHT_RANGE_INPUT:
      return {
        ...state,
        rightRangeTypedValue: action.payload.typedValue,
      };

    case MintActionType.SET_FULL_RANGE:
      return {
        ...state,
        leftRangeTypedValue: action.payload.leftRangeTypedValue,
        rightRangeTypedValue: action.payload.rightRangeTypedValue,
      };

    case MintActionType.RESET_MINT_STATE:
      return initialMintState;

    case MintActionType.SET_FULL_PRECISION: {
      const { field, value } = action.payload;
      if (field === PositionField.TOKEN0) {
        return { ...state, fullPrecisionValue0: value };
      }
      return { ...state, fullPrecisionValue1: value };
    }

    default:
      return state;
  }
}

// =============================================================================
// ZUSTAND STORE - Primary state management
// =============================================================================

interface MintStoreState extends MintState {
  // Actions
  typeInput: (payload: TypeInputPayload) => void;
  typeStartPriceInput: (typedValue: string) => void;
  typeLeftRangeInput: (typedValue: string) => void;
  typeRightRangeInput: (typedValue: string) => void;
  setFullRange: (leftValue: string, rightValue: string) => void;
  resetMintState: () => void;
  setFullPrecision: (field: PositionField, value: string) => void;
  /** Dispatch for backwards compatibility */
  dispatch: (action: MintAction) => void;
}

export const useMintStore = create<MintStoreState>((set, get) => ({
  // Initial state
  ...initialMintState,

  // Actions
  typeInput: (payload: TypeInputPayload) => {
    const { field, typedValue, noLiquidity } = payload;

    if (noLiquidity) {
      if (field === PositionField.TOKEN0) {
        set({
          independentField: field,
          typedValue,
          fullPrecisionValue0: typedValue,
        });
      } else {
        set({
          independentField: field,
          typedValue,
          fullPrecisionValue1: typedValue,
        });
      }
      return;
    }

    set({
      independentField: field,
      typedValue,
    });
  },

  typeStartPriceInput: (typedValue: string) => {
    set({ startPriceTypedValue: typedValue });
  },

  typeLeftRangeInput: (typedValue: string) => {
    set({ leftRangeTypedValue: typedValue });
  },

  typeRightRangeInput: (typedValue: string) => {
    set({ rightRangeTypedValue: typedValue });
  },

  setFullRange: (leftValue: string, rightValue: string) => {
    set({
      leftRangeTypedValue: leftValue,
      rightRangeTypedValue: rightValue,
    });
  },

  resetMintState: () => {
    set(initialMintState);
  },

  setFullPrecision: (field: PositionField, value: string) => {
    if (field === PositionField.TOKEN0) {
      set({ fullPrecisionValue0: value });
    } else {
      set({ fullPrecisionValue1: value });
    }
  },

  // Dispatch for backwards compatibility with action-based patterns
  dispatch: (action: MintAction) => {
    const state = get();
    const newState = mintReducer(state, action);
    set(newState);
  },
}));

// =============================================================================
// PROVIDER - For backwards compatibility (no-op wrapper)
// =============================================================================

interface MintStateProviderProps {
  children: ReactNode;
  /** Optional initial state override */
  initialState?: Partial<MintState>;
}

/**
 * MintStateProvider - Backwards compatibility wrapper
 *
 * With Zustand, we don't need a Provider. This component exists for
 * backwards compatibility and to support initial state overrides.
 */
export function MintStateProvider({ children, initialState }: MintStateProviderProps) {
  // Apply initial state on mount if provided
  if (initialState) {
    // Only set non-default values
    const store = useMintStore.getState();
    const hasChanges = Object.keys(initialState).some(
      (key) => initialState[key as keyof MintState] !== store[key as keyof MintState]
    );

    if (hasChanges) {
      useMintStore.setState({ ...initialMintState, ...initialState });
    }
  }

  return <>{children}</>;
}

// =============================================================================
// HOOKS - Uniswap-style hooks for consuming state
// =============================================================================

/**
 * useMintState - Get current mint state
 * Matches Uniswap's useV3MintState
 * Uses useShallow to prevent infinite loops from object recreation (matches Uniswap pattern)
 */
export function useMintState(): MintState {
  return useMintStore(
    useShallow((state) => ({
      independentField: state.independentField,
      typedValue: state.typedValue,
      startPriceTypedValue: state.startPriceTypedValue,
      leftRangeTypedValue: state.leftRangeTypedValue,
      rightRangeTypedValue: state.rightRangeTypedValue,
      fullPrecisionValue0: state.fullPrecisionValue0,
      fullPrecisionValue1: state.fullPrecisionValue1,
    }))
  );
}

/**
 * useMintActionHandlers - Get action handler functions
 * Matches Uniswap's useV3MintActionHandlers
 */
export function useMintActionHandlers(): {
  onFieldAInput: (typedValue: string) => void;
  onFieldBInput: (typedValue: string) => void;
  onLeftRangeInput: (typedValue: string) => void;
  onRightRangeInput: (typedValue: string) => void;
  onStartPriceInput: (typedValue: string) => void;
  onSetFullRange: (leftValue: string, rightValue: string) => void;
  onResetMintState: () => void;
  onSetFullPrecision: (field: PositionField, value: string) => void;
} {
  const {
    typeInput,
    typeStartPriceInput,
    typeLeftRangeInput,
    typeRightRangeInput,
    setFullRange,
    resetMintState,
    setFullPrecision,
  } = useMintStore();

  const onFieldAInput = useCallback(
    (typedValue: string) => {
      typeInput({ field: PositionField.TOKEN0, typedValue });
    },
    [typeInput]
  );

  const onFieldBInput = useCallback(
    (typedValue: string) => {
      typeInput({ field: PositionField.TOKEN1, typedValue });
    },
    [typeInput]
  );

  const onLeftRangeInput = useCallback(
    (typedValue: string) => {
      typeLeftRangeInput(typedValue);
    },
    [typeLeftRangeInput]
  );

  const onRightRangeInput = useCallback(
    (typedValue: string) => {
      typeRightRangeInput(typedValue);
    },
    [typeRightRangeInput]
  );

  const onStartPriceInput = useCallback(
    (typedValue: string) => {
      typeStartPriceInput(typedValue);
    },
    [typeStartPriceInput]
  );

  const onSetFullRange = useCallback(
    (leftValue: string, rightValue: string) => {
      setFullRange(leftValue, rightValue);
    },
    [setFullRange]
  );

  const onResetMintState = useCallback(() => {
    resetMintState();
  }, [resetMintState]);

  const onSetFullPrecision = useCallback(
    (field: PositionField, value: string) => {
      setFullPrecision(field, value);
    },
    [setFullPrecision]
  );

  return {
    onFieldAInput,
    onFieldBInput,
    onLeftRangeInput,
    onRightRangeInput,
    onStartPriceInput,
    onSetFullRange,
    onResetMintState,
    onSetFullPrecision,
  };
}

/**
 * useMintDispatch - Get dispatch function for backwards compatibility
 *
 * @deprecated Prefer using useMintActionHandlers() or direct store actions via useMintStore()
 */
export function useMintDispatch(): (action: MintAction) => void {
  return useMintStore((state) => state.dispatch);
}
