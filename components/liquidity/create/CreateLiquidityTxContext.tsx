"use client";

/**
 * CreateLiquidityTxContext - Transaction context for creating new positions
 *
 * Wraps useAddLiquidityTransaction hook in a React Context following
 * Uniswap's CreatePositionTxContext pattern.
 *
 * @see interface/apps/web/src/pages/CreatePosition/CreatePositionTxContext.tsx
 */

import React, { createContext, useContext, useMemo, type PropsWithChildren } from "react";
import { useAddLiquidityTransaction, type UseAddLiquidityTransactionProps } from "@/lib/liquidity/hooks";
import type { TokenSymbol } from "@/lib/pools-config";

export type CreateTxStep = "input" | "approve" | "permit" | "mint";

interface CreateLiquidityTxContextType {
  // Approval data
  approvalData: ReturnType<typeof useAddLiquidityTransaction>["approvalData"];
  isCheckingApprovals: boolean;

  // Working states
  isWorking: boolean;
  isApproving: boolean;
  isDepositConfirming: boolean;
  isDepositSuccess: boolean;

  // Actions
  handleApprove: (tokenSymbol: TokenSymbol, exactAmount?: string) => Promise<void>;
  handleDeposit: () => Promise<void>;
  handleZapSwapAndDeposit: () => Promise<void>;
  refetchApprovals: () => void;
  reset: () => void;
}

const CreateLiquidityTxContext = createContext<CreateLiquidityTxContextType | null>(null);

export interface CreateLiquidityTxContextProviderProps extends PropsWithChildren {
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  amount0: string;
  amount1: string;
  tickLower: string;
  tickUpper: string;
  activeInputSide: "amount0" | "amount1" | null;
  calculatedData: any;
  onLiquidityAdded: UseAddLiquidityTransactionProps["onLiquidityAdded"];
  onOpenChange: (isOpen: boolean) => void;
  isZapMode?: boolean;
  zapInputToken?: "token0" | "token1";
  zapSlippageToleranceBps?: number;
  deadlineSeconds?: number;
}

export function CreateLiquidityTxContextProvider({
  children,
  token0Symbol,
  token1Symbol,
  amount0,
  amount1,
  tickLower,
  tickUpper,
  activeInputSide,
  calculatedData,
  onLiquidityAdded,
  onOpenChange,
  isZapMode = false,
  zapInputToken = "token0",
  zapSlippageToleranceBps = 50,
  deadlineSeconds = 1800,
}: CreateLiquidityTxContextProviderProps) {
  const txHook = useAddLiquidityTransaction({
    token0Symbol,
    token1Symbol,
    amount0,
    amount1,
    tickLower,
    tickUpper,
    activeInputSide,
    calculatedData,
    onLiquidityAdded,
    onOpenChange,
    isZapMode,
    zapInputToken,
    zapSlippageToleranceBps,
    deadlineSeconds,
  });

  const value = useMemo<CreateLiquidityTxContextType>(() => ({
    approvalData: txHook.approvalData,
    isCheckingApprovals: txHook.isCheckingApprovals,
    isWorking: txHook.isWorking,
    isApproving: txHook.isApproving,
    isDepositConfirming: txHook.isDepositConfirming,
    isDepositSuccess: txHook.isDepositSuccess,
    handleApprove: txHook.handleApprove,
    handleDeposit: txHook.handleDeposit,
    handleZapSwapAndDeposit: txHook.handleZapSwapAndDeposit,
    refetchApprovals: txHook.refetchApprovals,
    reset: txHook.reset,
  }), [txHook]);

  return (
    <CreateLiquidityTxContext.Provider value={value}>
      {children}
    </CreateLiquidityTxContext.Provider>
  );
}

export function useCreateLiquidityTxContext(): CreateLiquidityTxContextType {
  const context = useContext(CreateLiquidityTxContext);
  if (!context) {
    throw new Error("useCreateLiquidityTxContext must be used within CreateLiquidityTxContextProvider");
  }
  return context;
}
