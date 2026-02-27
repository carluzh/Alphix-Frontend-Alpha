"use client";

import React, { createContext, useContext, useState, useMemo, useCallback, type Dispatch, type SetStateAction, type PropsWithChildren } from "react";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import { isZapEligiblePool } from "@/lib/liquidity/zap";
import type { UnifiedYieldDepositMode } from "../wizard/types";

export enum IncreaseLiquidityStep { Input = 0, Review = 1 }
export type PositionField = "TOKEN0" | "TOKEN1";

export interface IncreaseLiquidityState {
  position: ProcessedPosition;
  exactField: PositionField;
  exactAmount: string;
  // Zap mode state (for USDS/USDC Unified Yield positions)
  depositMode: UnifiedYieldDepositMode;
  zapInputToken: 'token0' | 'token1' | null;
}

export interface IncreaseLiquidityDerivedInfo {
  formattedAmounts?: { TOKEN0?: string; TOKEN1?: string };
  currencyAmounts?: { TOKEN0?: string; TOKEN1?: string };
  currencyAmountsUSDValue?: { TOKEN0?: number; TOKEN1?: number };
  currencyBalances?: { TOKEN0?: string; TOKEN1?: string };
  error?: string;
}

interface IncreaseLiquidityContextType {
  step: IncreaseLiquidityStep;
  setStep: Dispatch<SetStateAction<IncreaseLiquidityStep>>;
  increaseLiquidityState: IncreaseLiquidityState;
  setIncreaseLiquidityState: Dispatch<SetStateAction<IncreaseLiquidityState>>;
  derivedIncreaseLiquidityInfo: IncreaseLiquidityDerivedInfo;
  setDerivedInfo: Dispatch<SetStateAction<IncreaseLiquidityDerivedInfo>>;
  setAmount0: (value: string) => void;
  setAmount1: (value: string) => void;
  setExactField: (field: PositionField) => void;
  hasValidAmounts: boolean;
  isOverBalance0: boolean;
  isOverBalance1: boolean;
  /** Whether this is a Unified Yield position */
  isUnifiedYield: boolean;
  /** Whether this position is zap-eligible (USDS/USDC Unified Yield) */
  isZapEligible: boolean;
  /** Current deposit mode */
  depositMode: UnifiedYieldDepositMode;
  /** Token selected for zap deposit */
  zapInputToken: 'token0' | 'token1' | null;
  /** Set deposit mode (balanced vs zap) */
  setDepositMode: (mode: UnifiedYieldDepositMode) => void;
  /** Set zap input token */
  setZapInputToken: (token: 'token0' | 'token1' | null) => void;
}

const IncreaseLiquidityContext = createContext<IncreaseLiquidityContextType | null>(null);

export interface IncreaseLiquidityContextProviderProps extends PropsWithChildren {
  position: ProcessedPosition;
  initialAmount0?: string;
  initialAmount1?: string;
}

export function IncreaseLiquidityContextProvider({ children, position, initialAmount0 = "", initialAmount1 = "" }: IncreaseLiquidityContextProviderProps) {
  const [step, setStep] = useState(IncreaseLiquidityStep.Input);

  // Detect if this is a Unified Yield position and if zap is eligible
  const isUnifiedYield = position.isUnifiedYield ?? false;
  const isZapEligible = isUnifiedYield && isZapEligiblePool(position.poolId);

  // Initialize deposit mode based on zap eligibility
  // Default to 'zap' for eligible positions, 'balanced' otherwise
  const initialDepositMode: UnifiedYieldDepositMode = isZapEligible ? 'zap' : 'balanced';
  const initialZapInputToken: 'token0' | 'token1' | null = isZapEligible ? 'token1' : null; // Default to USDC (token1)

  const [increaseLiquidityState, setIncreaseLiquidityState] = useState<IncreaseLiquidityState>({
    position,
    exactField: "TOKEN0",
    exactAmount: initialAmount0,
    depositMode: initialDepositMode,
    zapInputToken: initialZapInputToken,
  });
  const [derivedInfo, setDerivedInfo] = useState<IncreaseLiquidityDerivedInfo>({ formattedAmounts: { TOKEN0: initialAmount0, TOKEN1: initialAmount1 }, currencyAmounts: {}, currencyAmountsUSDValue: {}, currencyBalances: {} });

  const setAmount0 = (value: string) => {
    setIncreaseLiquidityState((prev) => ({ ...prev, exactField: "TOKEN0", exactAmount: value }));
    setDerivedInfo((prev) => ({ ...prev, formattedAmounts: { ...prev.formattedAmounts, TOKEN0: value } }));
  };

  const setAmount1 = (value: string) => {
    setIncreaseLiquidityState((prev) => ({ ...prev, exactField: "TOKEN1", exactAmount: value }));
    setDerivedInfo((prev) => ({ ...prev, formattedAmounts: { ...prev.formattedAmounts, TOKEN1: value } }));
  };

  const setExactField = (field: PositionField) => setIncreaseLiquidityState((prev) => ({ ...prev, exactField: field }));

  // Zap mode setters
  const setDepositMode = useCallback((mode: UnifiedYieldDepositMode) => {
    console.log('[IncreaseLiquidityContext] setDepositMode:', mode);
    setIncreaseLiquidityState((prev) => ({
      ...prev,
      depositMode: mode,
      // When switching to zap mode, default to token1 (USDC) if not already set
      zapInputToken: mode === 'zap' && !prev.zapInputToken ? 'token1' : prev.zapInputToken,
    }));
    // Clear amounts when switching modes
    setDerivedInfo((prev) => ({
      ...prev,
      formattedAmounts: { TOKEN0: '', TOKEN1: '' },
    }));
  }, []);

  const setZapInputToken = useCallback((token: 'token0' | 'token1' | null) => {
    console.log('[IncreaseLiquidityContext] setZapInputToken:', token);
    setIncreaseLiquidityState((prev) => ({
      ...prev,
      zapInputToken: token,
    }));
    // Clear amounts when switching tokens
    setDerivedInfo((prev) => ({
      ...prev,
      formattedAmounts: { TOKEN0: '', TOKEN1: '' },
    }));
  }, []);

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

  const value = useMemo(() => ({
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
    isUnifiedYield,
    // Zap mode
    isZapEligible,
    depositMode: increaseLiquidityState.depositMode,
    zapInputToken: increaseLiquidityState.zapInputToken,
    setDepositMode,
    setZapInputToken,
  }), [step, increaseLiquidityState, derivedInfo, hasValidAmounts, isOverBalance0, isOverBalance1, isUnifiedYield, isZapEligible, setDepositMode, setZapInputToken]);

  return <IncreaseLiquidityContext.Provider value={value}>{children}</IncreaseLiquidityContext.Provider>;
}

export function useIncreaseLiquidityContext(): IncreaseLiquidityContextType {
  const context = useContext(IncreaseLiquidityContext);
  if (!context) throw new Error("useIncreaseLiquidityContext must be used within IncreaseLiquidityContextProvider");
  return context;
}
