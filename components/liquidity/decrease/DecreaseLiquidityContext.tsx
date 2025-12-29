"use client";

import React, { createContext, useContext, useState, useMemo, useCallback, type Dispatch, type SetStateAction, type PropsWithChildren } from "react";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";

export enum DecreaseLiquidityStep { Input = 0, Review = 1 }
export type WithdrawField = "amount0" | "amount1";

export interface DecreaseLiquidityState {
  position: ProcessedPosition;
  activeInputSide: WithdrawField | null;
  isFullWithdraw: boolean;
}

export interface DecreaseLiquidityDerivedInfo {
  withdrawAmount0: string;
  withdrawAmount1: string;
  isCalculating: boolean;
}

interface DecreaseLiquidityContextType {
  step: DecreaseLiquidityStep;
  setStep: Dispatch<SetStateAction<DecreaseLiquidityStep>>;
  decreaseLiquidityState: DecreaseLiquidityState;
  setDecreaseLiquidityState: Dispatch<SetStateAction<DecreaseLiquidityState>>;
  derivedDecreaseInfo: DecreaseLiquidityDerivedInfo;
  setDerivedInfo: Dispatch<SetStateAction<DecreaseLiquidityDerivedInfo>>;
  setWithdrawAmount0: (value: string) => void;
  setWithdrawAmount1: (value: string) => void;
  setActiveInputSide: (side: WithdrawField | null) => void;
  setIsFullWithdraw: (value: boolean) => void;
  hasValidAmounts: boolean;
  isAmount0OverBalance: boolean;
  isAmount1OverBalance: boolean;
}

const DecreaseLiquidityContext = createContext<DecreaseLiquidityContextType | null>(null);

export interface DecreaseLiquidityContextProviderProps extends PropsWithChildren {
  position: ProcessedPosition;
}

export function DecreaseLiquidityContextProvider({ children, position }: DecreaseLiquidityContextProviderProps) {
  const [step, setStep] = useState(DecreaseLiquidityStep.Input);
  const [decreaseLiquidityState, setDecreaseLiquidityState] = useState<DecreaseLiquidityState>({
    position,
    activeInputSide: null,
    isFullWithdraw: false,
  });
  const [derivedInfo, setDerivedInfo] = useState<DecreaseLiquidityDerivedInfo>({
    withdrawAmount0: "",
    withdrawAmount1: "",
    isCalculating: false,
  });

  const setWithdrawAmount0 = useCallback((value: string) => {
    setDerivedInfo((prev) => ({ ...prev, withdrawAmount0: value }));
  }, []);

  const setWithdrawAmount1 = useCallback((value: string) => {
    setDerivedInfo((prev) => ({ ...prev, withdrawAmount1: value }));
  }, []);

  const setActiveInputSide = useCallback((side: WithdrawField | null) => {
    setDecreaseLiquidityState((prev) => ({ ...prev, activeInputSide: side }));
  }, []);

  const setIsFullWithdraw = useCallback((value: boolean) => {
    setDecreaseLiquidityState((prev) => ({ ...prev, isFullWithdraw: value }));
  }, []);

  const hasValidAmounts = useMemo(() => {
    const amt0 = parseFloat(derivedInfo.withdrawAmount0 || "0");
    const amt1 = parseFloat(derivedInfo.withdrawAmount1 || "0");
    return amt0 > 0 || amt1 > 0;
  }, [derivedInfo.withdrawAmount0, derivedInfo.withdrawAmount1]);

  const isAmount0OverBalance = useMemo(() => {
    const amt = parseFloat(derivedInfo.withdrawAmount0 || "0");
    const max = parseFloat(position.token0.amount || "0");
    return amt > max && amt > 0;
  }, [derivedInfo.withdrawAmount0, position.token0.amount]);

  const isAmount1OverBalance = useMemo(() => {
    const amt = parseFloat(derivedInfo.withdrawAmount1 || "0");
    const max = parseFloat(position.token1.amount || "0");
    return amt > max && amt > 0;
  }, [derivedInfo.withdrawAmount1, position.token1.amount]);

  const value = useMemo(() => ({
    step,
    setStep,
    decreaseLiquidityState,
    setDecreaseLiquidityState,
    derivedDecreaseInfo: derivedInfo,
    setDerivedInfo,
    setWithdrawAmount0,
    setWithdrawAmount1,
    setActiveInputSide,
    setIsFullWithdraw,
    hasValidAmounts,
    isAmount0OverBalance,
    isAmount1OverBalance,
  }), [step, decreaseLiquidityState, derivedInfo, hasValidAmounts, isAmount0OverBalance, isAmount1OverBalance, setWithdrawAmount0, setWithdrawAmount1, setActiveInputSide, setIsFullWithdraw]);

  return <DecreaseLiquidityContext.Provider value={value}>{children}</DecreaseLiquidityContext.Provider>;
}

export function useDecreaseLiquidityContext(): DecreaseLiquidityContextType {
  const context = useContext(DecreaseLiquidityContext);
  if (!context) throw new Error("useDecreaseLiquidityContext must be used within DecreaseLiquidityContextProvider");
  return context;
}
