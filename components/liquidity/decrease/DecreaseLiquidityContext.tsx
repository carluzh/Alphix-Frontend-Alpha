"use client";

import React, { createContext, useContext, useState, useMemo, useCallback, type PropsWithChildren } from "react";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";

interface DecreaseLiquidityContextType {
  position: ProcessedPosition;
  withdrawAmount0: string;
  withdrawAmount1: string;
  setWithdrawAmount0: (value: string) => void;
  setWithdrawAmount1: (value: string) => void;
  hasValidAmounts: boolean;
  isUnifiedYield: boolean;
}

const DecreaseLiquidityContext = createContext<DecreaseLiquidityContextType | null>(null);

export interface DecreaseLiquidityContextProviderProps extends PropsWithChildren {
  position: ProcessedPosition;
}

export function DecreaseLiquidityContextProvider({ children, position }: DecreaseLiquidityContextProviderProps) {
  const isUnifiedYield = position.isUnifiedYield ?? false;

  const [withdrawAmount0, setWithdrawAmount0State] = useState("");
  const [withdrawAmount1, setWithdrawAmount1State] = useState("");

  const setWithdrawAmount0 = useCallback((value: string) => setWithdrawAmount0State(value), []);
  const setWithdrawAmount1 = useCallback((value: string) => setWithdrawAmount1State(value), []);

  const hasValidAmounts = useMemo(() => {
    return parseFloat(withdrawAmount0 || "0") > 0 || parseFloat(withdrawAmount1 || "0") > 0;
  }, [withdrawAmount0, withdrawAmount1]);

  const value = useMemo(() => ({
    position,
    withdrawAmount0,
    withdrawAmount1,
    setWithdrawAmount0,
    setWithdrawAmount1,
    hasValidAmounts,
    isUnifiedYield,
  }), [position, withdrawAmount0, withdrawAmount1, setWithdrawAmount0, setWithdrawAmount1, hasValidAmounts, isUnifiedYield]);

  return <DecreaseLiquidityContext.Provider value={value}>{children}</DecreaseLiquidityContext.Provider>;
}

export function useDecreaseLiquidityContext(): DecreaseLiquidityContextType {
  const context = useContext(DecreaseLiquidityContext);
  if (!context) throw new Error("useDecreaseLiquidityContext must be used within DecreaseLiquidityContextProvider");
  return context;
}
