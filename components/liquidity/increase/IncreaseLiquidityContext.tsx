"use client";

/**
 * IncreaseLiquidityContext - UI state management for increase liquidity flow
 *
 * Following Uniswap's two-context pattern:
 * - This context handles UI state (step, amounts, field selection)
 * - Separate TxContext handles transaction data (approvals, gas)
 *
 * @see interface/apps/web/src/pages/IncreaseLiquidity/IncreaseLiquidityContext.tsx
 */

import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  type Dispatch,
  type SetStateAction,
  type PropsWithChildren,
} from "react";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";

/**
 * Step enum for type-safe navigation
 */
export enum IncreaseLiquidityStep {
  Input = 0,
  Review = 1,
}

/**
 * Position field enum matching Uniswap's pattern
 */
export type PositionField = "TOKEN0" | "TOKEN1";

/**
 * Core state for increase liquidity operation
 */
export interface IncreaseLiquidityState {
  position: ProcessedPosition;
  exactField: PositionField;
  exactAmount: string;
}

/**
 * Derived info calculated from state
 */
export interface IncreaseLiquidityDerivedInfo {
  formattedAmounts?: { TOKEN0?: string; TOKEN1?: string };
  currencyAmounts?: { TOKEN0?: string; TOKEN1?: string };
  currencyAmountsUSDValue?: { TOKEN0?: number; TOKEN1?: number };
  currencyBalances?: { TOKEN0?: string; TOKEN1?: string };
  error?: string;
}

/**
 * Context type definition
 */
interface IncreaseLiquidityContextType {
  step: IncreaseLiquidityStep;
  setStep: Dispatch<SetStateAction<IncreaseLiquidityStep>>;
  increaseLiquidityState: IncreaseLiquidityState;
  setIncreaseLiquidityState: Dispatch<SetStateAction<IncreaseLiquidityState>>;
  derivedIncreaseLiquidityInfo: IncreaseLiquidityDerivedInfo;
  setDerivedInfo: Dispatch<SetStateAction<IncreaseLiquidityDerivedInfo>>;
  // Convenience setters
  setAmount0: (value: string) => void;
  setAmount1: (value: string) => void;
  setExactField: (field: PositionField) => void;
  // Validation helpers
  hasValidAmounts: boolean;
  isOverBalance0: boolean;
  isOverBalance1: boolean;
}

const IncreaseLiquidityContext = createContext<IncreaseLiquidityContextType | null>(null);

export interface IncreaseLiquidityContextProviderProps extends PropsWithChildren {
  position: ProcessedPosition;
  initialAmount0?: string;
  initialAmount1?: string;
}

/**
 * Provider for increase liquidity UI state
 */
export function IncreaseLiquidityContextProvider({
  children,
  position,
  initialAmount0 = "",
  initialAmount1 = "",
}: IncreaseLiquidityContextProviderProps) {
  const [step, setStep] = useState(IncreaseLiquidityStep.Input);

  const [increaseLiquidityState, setIncreaseLiquidityState] = useState<IncreaseLiquidityState>({
    position,
    exactField: "TOKEN0",
    exactAmount: initialAmount0,
  });

  const [derivedInfo, setDerivedInfo] = useState<IncreaseLiquidityDerivedInfo>({
    formattedAmounts: {
      TOKEN0: initialAmount0,
      TOKEN1: initialAmount1,
    },
    currencyAmounts: {},
    currencyAmountsUSDValue: {},
    currencyBalances: {},
  });

  // Convenience setters
  const setAmount0 = (value: string) => {
    setIncreaseLiquidityState((prev) => ({
      ...prev,
      exactField: "TOKEN0",
      exactAmount: value,
    }));
    setDerivedInfo((prev) => ({
      ...prev,
      formattedAmounts: {
        ...prev.formattedAmounts,
        TOKEN0: value,
      },
    }));
  };

  const setAmount1 = (value: string) => {
    setIncreaseLiquidityState((prev) => ({
      ...prev,
      exactField: "TOKEN1",
      exactAmount: value,
    }));
    setDerivedInfo((prev) => ({
      ...prev,
      formattedAmounts: {
        ...prev.formattedAmounts,
        TOKEN1: value,
      },
    }));
  };

  const setExactField = (field: PositionField) => {
    setIncreaseLiquidityState((prev) => ({
      ...prev,
      exactField: field,
    }));
  };

  // Validation
  const hasValidAmounts = useMemo(() => {
    const amt0 = parseFloat(derivedInfo.formattedAmounts?.TOKEN0 || "0");
    const amt1 = parseFloat(derivedInfo.formattedAmounts?.TOKEN1 || "0");
    return amt0 > 0 || amt1 > 0;
  }, [derivedInfo.formattedAmounts]);

  const isOverBalance0 = useMemo(() => {
    const amt = parseFloat(derivedInfo.formattedAmounts?.TOKEN0 || "0");
    const bal = parseFloat(derivedInfo.currencyBalances?.TOKEN0 || "0");
    return amt > bal && amt > 0;
  }, [derivedInfo.formattedAmounts?.TOKEN0, derivedInfo.currencyBalances?.TOKEN0]);

  const isOverBalance1 = useMemo(() => {
    const amt = parseFloat(derivedInfo.formattedAmounts?.TOKEN1 || "0");
    const bal = parseFloat(derivedInfo.currencyBalances?.TOKEN1 || "0");
    return amt > bal && amt > 0;
  }, [derivedInfo.formattedAmounts?.TOKEN1, derivedInfo.currencyBalances?.TOKEN1]);

  const value = useMemo(
    () => ({
      step,
      setStep,
      increaseLiquidityState,
      setIncreaseLiquidityState,
      derivedIncreaseLiquidityInfo: derivedInfo,
      setDerivedInfo,
      setAmount0,
      setAmount1,
      setExactField,
      hasValidAmounts,
      isOverBalance0,
      isOverBalance1,
    }),
    [step, increaseLiquidityState, derivedInfo, hasValidAmounts, isOverBalance0, isOverBalance1]
  );

  return (
    <IncreaseLiquidityContext.Provider value={value}>
      {children}
    </IncreaseLiquidityContext.Provider>
  );
}

/**
 * Hook to access increase liquidity context
 */
export function useIncreaseLiquidityContext(): IncreaseLiquidityContextType {
  const context = useContext(IncreaseLiquidityContext);
  if (!context) {
    throw new Error(
      "useIncreaseLiquidityContext must be used within IncreaseLiquidityContextProvider"
    );
  }
  return context;
}
