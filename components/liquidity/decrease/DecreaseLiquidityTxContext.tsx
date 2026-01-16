"use client";

/**
 * DecreaseLiquidityTxContext - Transaction context for decrease liquidity flow
 *
 * Refactored to use Uniswap's step-based executor pattern:
 * - Calls API to build transaction calldata
 * - Returns context for step executor to handle
 * - No approvals/permits needed for decrease (user is withdrawing)
 *
 * @see components/liquidity/increase/IncreaseLiquidityTxContext.tsx
 * @see components/liquidity/wizard/ReviewExecuteModal.tsx
 */

import React, { createContext, useContext, useState, useMemo, useCallback, type PropsWithChildren } from "react";
import { useAccount } from "wagmi";
import { formatUnits, type Address } from "viem";
import { getTokenDefinitions, type TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { useAllPrices } from "@/lib/apollo/hooks";
import { getTokenSymbolByAddress, debounce } from "@/lib/utils";
import { useDecreaseLiquidityContext } from "./DecreaseLiquidityContext";
import { getStoredUserSettings } from "@/hooks/useUserSettings";

// Import from transaction module
import {
  buildLiquidityTxContext,
  type MintTxApiResponse,
} from "@/lib/liquidity/transaction";
import {
  LiquidityTransactionType,
  type ValidatedLiquidityTxContext,
} from "@/lib/liquidity/types";

export type DecreaseTxStep = "input" | "withdraw";

interface DecreaseLiquidityTxContextType {
  // API/Context state
  isLoading: boolean;
  error: string | null;

  // Transaction context for step executor
  txContext: ValidatedLiquidityTxContext | null;

  // Prices
  token0USDPrice: number;
  token1USDPrice: number;

  // Dependent amount calculation
  isCalculating: boolean;
  calculateWithdrawAmount: (inputAmount: string, inputSide: "amount0" | "amount1") => void;

  // Actions
  fetchAndBuildContext: () => Promise<ValidatedLiquidityTxContext | null>;
  getWithdrawButtonText: () => string;
  clearError: () => void;
}

const DecreaseLiquidityTxContext = createContext<DecreaseLiquidityTxContextType | null>(null);

export function DecreaseLiquidityTxContextProvider({ children }: PropsWithChildren) {
  const { address: accountAddress } = useAccount();
  const { chainId, networkMode } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const { data: allPrices } = useAllPrices();

  const { decreaseLiquidityState, derivedDecreaseInfo, setDerivedInfo } = useDecreaseLiquidityContext();
  const { position } = decreaseLiquidityState;
  const { withdrawAmount0, withdrawAmount1 } = derivedDecreaseInfo;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txContext, setTxContext] = useState<ValidatedLiquidityTxContext | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const getUSDPriceForSymbol = useCallback((symbol?: string): number => {
    if (!symbol) return 0;
    const s = symbol.toUpperCase();
    if (s.includes("BTC")) return allPrices?.BTC ?? 0;
    if (s.includes("ETH")) return allPrices?.ETH ?? 0;
    if (s.includes("USDC")) return allPrices?.USDC ?? 1;
    if (s.includes("USDT")) return allPrices?.USDT ?? 1;
    return 0;
  }, [allPrices]);

  const token0USDPrice = getUSDPriceForSymbol(position.token0.symbol);
  const token1USDPrice = getUSDPriceForSymbol(position.token1.symbol);

  // Helper to parse token ID from position
  const parseTokenId = useCallback((positionId: string): string => {
    const compositeId = positionId.toString();
    const parts = compositeId.split('-');
    const saltHex = parts[parts.length - 1];
    if (saltHex && saltHex !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      try {
        return BigInt(saltHex).toString();
      } catch {
        return compositeId;
      }
    }
    return compositeId;
  }, []);

  // Calculate dependent amount based on input
  const calculateWithdrawAmount = useMemo(() => debounce(async (inputAmount: string, inputSide: "amount0" | "amount1") => {
    if (!position || !inputAmount || parseFloat(inputAmount) <= 0) {
      if (inputSide === "amount0") setDerivedInfo((prev) => ({ ...prev, withdrawAmount1: "" }));
      else setDerivedInfo((prev) => ({ ...prev, withdrawAmount0: "" }));
      return;
    }

    setIsCalculating(true);
    setDerivedInfo((prev) => ({ ...prev, isCalculating: true }));

    try {
      if (!position.isInRange) {
        if (inputSide === "amount0") setDerivedInfo((prev) => ({ ...prev, withdrawAmount1: "0", isCalculating: false }));
        else setDerivedInfo((prev) => ({ ...prev, withdrawAmount0: "0", isCalculating: false }));
        setIsCalculating(false);
        return;
      }

      const token0Symbol = getTokenSymbolByAddress(position.token0.address, networkMode);
      const token1Symbol = getTokenSymbolByAddress(position.token1.address, networkMode);

      if (!token0Symbol || !token1Symbol) {
        // Fallback: simple ratio calculation
        const amount0Total = parseFloat(position.token0.amount);
        const amount1Total = parseFloat(position.token1.amount);
        const inputAmountNum = parseFloat(inputAmount);

        if (inputSide === "amount0") {
          const ratio = inputAmountNum / amount0Total;
          setDerivedInfo((prev) => ({ ...prev, withdrawAmount1: (amount1Total * ratio).toString(), isCalculating: false }));
        } else {
          const ratio = inputAmountNum / amount1Total;
          setDerivedInfo((prev) => ({ ...prev, withdrawAmount0: (amount0Total * ratio).toString(), isCalculating: false }));
        }
        setIsCalculating(false);
        return;
      }

      const { calculateLiquidityParameters } = await import("@/lib/liquidity/liquidity-math");
      const result = await calculateLiquidityParameters({
        token0Symbol,
        token1Symbol,
        inputAmount,
        inputTokenSymbol: inputSide === "amount0" ? token0Symbol : token1Symbol,
        userTickLower: position.tickLower,
        userTickUpper: position.tickUpper,
        chainId,
      });

      if (inputSide === "amount0") {
        const token1Decimals = token1Symbol ? tokenDefinitions[token1Symbol]?.decimals || 18 : 18;
        const amount1Display = formatUnits(BigInt(result.amount1 || "0"), token1Decimals);
        setDerivedInfo((prev) => ({ ...prev, withdrawAmount1: amount1Display, isCalculating: false }));
      } else {
        const token0Decimals = token0Symbol ? tokenDefinitions[token0Symbol]?.decimals || 18 : 18;
        const amount0Display = formatUnits(BigInt(result.amount0 || "0"), token0Decimals);
        setDerivedInfo((prev) => ({ ...prev, withdrawAmount0: amount0Display, isCalculating: false }));
      }
    } catch {
      // Fallback: simple ratio calculation
      const amount0Total = parseFloat(position.token0.amount);
      const amount1Total = parseFloat(position.token1.amount);
      const inputAmountNum = parseFloat(inputAmount);

      if (inputSide === "amount0") {
        const ratio = inputAmountNum / amount0Total;
        setDerivedInfo((prev) => ({ ...prev, withdrawAmount1: (amount1Total * ratio).toString(), isCalculating: false }));
      } else {
        const ratio = inputAmountNum / amount1Total;
        setDerivedInfo((prev) => ({ ...prev, withdrawAmount0: (amount0Total * ratio).toString(), isCalculating: false }));
      }
    }
    setIsCalculating(false);
  }, 300), [position, chainId, networkMode, tokenDefinitions, setDerivedInfo]);

  /**
   * Fetch API and build transaction context for step executor.
   * Decrease operations don't need approvals or permits.
   */
  const fetchAndBuildContext = useCallback(async (): Promise<ValidatedLiquidityTxContext | null> => {
    if (!accountAddress || !chainId) return null;

    setIsLoading(true);
    setError(null);

    const token0Symbol = getTokenSymbolByAddress(position.token0.address, networkMode);
    const token1Symbol = getTokenSymbolByAddress(position.token1.address, networkMode);

    if (!token0Symbol || !token1Symbol) {
      setError("Token configuration not found");
      setIsLoading(false);
      return null;
    }

    const token0Config = tokenDefinitions[token0Symbol];
    const token1Config = tokenDefinitions[token1Symbol];
    if (!token0Config || !token1Config) {
      setError("Token configuration not found");
      setIsLoading(false);
      return null;
    }

    const tokenId = parseTokenId(position.positionId);

    // Check if this is a full burn
    const amt0 = parseFloat(withdrawAmount0 || "0");
    const amt1 = parseFloat(withdrawAmount1 || "0");
    const max0 = parseFloat(position.token0.amount || "0");
    const max1 = parseFloat(position.token1.amount || "0");
    const pct0 = max0 > 0 ? amt0 / max0 : 0;
    const pct1 = max1 > 0 ? amt1 / max1 : 0;
    const nearFull0 = max0 > 0 ? pct0 >= 0.99 : true;
    const nearFull1 = max1 > 0 ? pct1 >= 0.99 : true;
    const isFullBurn = position.isInRange ? nearFull0 && nearFull1 : pct0 >= 0.99 || pct1 >= 0.99;

    // Get user settings
    const userSettings = getStoredUserSettings();
    const slippageBps = Math.round(userSettings.slippage * 100);
    const deadlineMinutes = userSettings.deadline;

    try {
      // Call API to build transaction
      const response = await fetch("/api/liquidity/prepare-decrease-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: accountAddress,
          tokenId,
          decreaseAmount0: withdrawAmount0 || "0",
          decreaseAmount1: withdrawAmount1 || "0",
          chainId,
          isFullBurn,
          slippageBps,
          deadlineMinutes,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to prepare transaction");
      }

      // Build context (decrease doesn't need approvals/permits)
      const context = buildLiquidityTxContext({
        type: LiquidityTransactionType.Decrease,
        apiResponse: {
          needsApproval: false,
          create: data.create,
          sqrtRatioX96: data.sqrtRatioX96,
        } as MintTxApiResponse,
        token0: {
          address: token0Config.address as Address,
          symbol: token0Config.symbol,
          decimals: token0Config.decimals,
          chainId,
        },
        token1: {
          address: token1Config.address as Address,
          symbol: token1Config.symbol,
          decimals: token1Config.decimals,
          chainId,
        },
        amount0: data.details?.token0?.amount || "0",
        amount1: data.details?.token1?.amount || "0",
        chainId,
      });

      setTxContext(context as ValidatedLiquidityTxContext);
      setIsLoading(false);
      return context as ValidatedLiquidityTxContext;
    } catch (err: any) {
      console.error("[DecreaseLiquidityTxContext] fetchAndBuildContext error:", err);
      setError(err.message || "Failed to prepare transaction");
      setIsLoading(false);
      return null;
    }
  }, [accountAddress, chainId, position, withdrawAmount0, withdrawAmount1, networkMode, tokenDefinitions, parseTokenId]);

  // Get button text based on amounts
  const getWithdrawButtonText = useCallback(() => {
    if (!position) return "Withdraw";
    const max0 = parseFloat(position.token0.amount || "0");
    const max1 = parseFloat(position.token1.amount || "0");
    const in0 = parseFloat(withdrawAmount0 || "0");
    const in1 = parseFloat(withdrawAmount1 || "0");

    if (position.isInRange) {
      const near0 = max0 > 0 ? in0 >= max0 * 0.99 : in0 === 0;
      const near1 = max1 > 0 ? in1 >= max1 * 0.99 : in1 === 0;
      return near0 && near1 ? "Withdraw All" : "Withdraw";
    }
    const near0 = max0 > 0 ? in0 >= max0 * 0.99 : false;
    const near1 = max1 > 0 ? in1 >= max1 * 0.99 : false;
    return near0 || near1 ? "Withdraw All" : "Withdraw";
  }, [position, withdrawAmount0, withdrawAmount1]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = useMemo(() => ({
    isLoading,
    error,
    txContext,
    token0USDPrice,
    token1USDPrice,
    isCalculating,
    calculateWithdrawAmount,
    fetchAndBuildContext,
    getWithdrawButtonText,
    clearError,
  }), [
    isLoading,
    error,
    txContext,
    token0USDPrice,
    token1USDPrice,
    isCalculating,
    calculateWithdrawAmount,
    fetchAndBuildContext,
    getWithdrawButtonText,
    clearError,
  ]);

  return <DecreaseLiquidityTxContext.Provider value={value}>{children}</DecreaseLiquidityTxContext.Provider>;
}

export function useDecreaseLiquidityTxContext(): DecreaseLiquidityTxContextType {
  const context = useContext(DecreaseLiquidityTxContext);
  if (!context) throw new Error("useDecreaseLiquidityTxContext must be used within DecreaseLiquidityTxContextProvider");
  return context;
}
