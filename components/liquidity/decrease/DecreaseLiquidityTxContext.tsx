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
import { formatUnits, parseUnits, type Address, type Hash } from "viem";
import { getTokenDefinitions, getPoolById, type TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { useTokenPrices } from "@/hooks/useTokenPrices";
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

// Pool state for slippage protection (sqrtPriceX96)
import { usePoolState } from "@/lib/apollo/hooks/usePoolState";

// Unified Yield withdraw hook for ReHypothecation positions
import { useUnifiedYieldWithdraw } from "@/lib/liquidity/unified-yield/hooks/useUnifiedYieldWithdraw";
import { buildUnifiedYieldWithdrawTx, calculateSharesFromPercentage } from "@/lib/liquidity/unified-yield/buildUnifiedYieldWithdrawTx";
import type { WithdrawPercentage } from "@/lib/liquidity/unified-yield/types";

export type DecreaseTxStep = "input" | "withdraw";

interface DecreaseLiquidityTxContextType {
  // API/Context state
  isLoading: boolean;
  error: string | null;

  // Transaction context for step executor (V4 positions only)
  txContext: ValidatedLiquidityTxContext | null;

  // Prices
  token0USDPrice: number;
  token1USDPrice: number;

  // Dependent amount calculation
  isCalculating: boolean;
  calculateWithdrawAmount: (inputAmount: string, inputSide: "amount0" | "amount1") => void;

  // Actions - V4 positions
  fetchAndBuildContext: () => Promise<ValidatedLiquidityTxContext | null>;
  getWithdrawButtonText: () => string;
  clearError: () => void;

  // Unified Yield execution (ReHypothecation positions)
  executeUnifiedYieldWithdraw: (percentage: WithdrawPercentage) => Promise<Hash | undefined>;
  isUnifiedYieldPending: boolean;
  isUnifiedYieldConfirming: boolean;
  isUnifiedYieldSuccess: boolean;
  unifiedYieldTxHash: Hash | undefined;
  resetUnifiedYield: () => void;
}

const DecreaseLiquidityTxContext = createContext<DecreaseLiquidityTxContextType | null>(null);

export function DecreaseLiquidityTxContextProvider({ children }: PropsWithChildren) {
  const { address: accountAddress } = useAccount();
  const { chainId, networkMode } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const { decreaseLiquidityState, derivedDecreaseInfo, setDerivedInfo, isUnifiedYield } = useDecreaseLiquidityContext();
  const { position } = decreaseLiquidityState;
  const { withdrawAmount0, withdrawAmount1 } = derivedDecreaseInfo;

  // Unified price hook - replaces useAllPrices + manual symbol matching
  const priceSymbols = useMemo(
    () => [position.token0.symbol, position.token1.symbol].filter(Boolean),
    [position.token0.symbol, position.token1.symbol]
  );
  const { prices } = useTokenPrices(priceSymbols);

  // Get pool config for subgraphId (needed for pool state query)
  const poolConfig = useMemo(() => {
    return position.poolId ? getPoolById(position.poolId, networkMode) : null;
  }, [position.poolId, networkMode]);

  // Pool state for slippage protection (sqrtPriceX96)
  const { data: poolStateData } = usePoolState(poolConfig?.subgraphId ?? '');

  // Unified Yield withdraw hook - only active for ReHypothecation positions
  const unifiedYieldWithdraw = useUnifiedYieldWithdraw({
    hookAddress: position.hookAddress as Address | undefined,
    token0Decimals: tokenDefinitions[getTokenSymbolByAddress(position.token0.address, networkMode) as keyof typeof tokenDefinitions]?.decimals ?? 18,
    token1Decimals: tokenDefinitions[getTokenSymbolByAddress(position.token1.address, networkMode) as keyof typeof tokenDefinitions]?.decimals ?? 18,
    poolId: position.poolId,
    chainId,
    sqrtPriceX96: poolStateData?.sqrtPriceX96,
    maxPriceSlippage: 500, // 0.05%
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txContext, setTxContext] = useState<ValidatedLiquidityTxContext | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const token0USDPrice = prices[position.token0.symbol] ?? 0;
  const token1USDPrice = prices[position.token1.symbol] ?? 0;

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
   * Execute Unified Yield withdrawal by percentage.
   * For ReHypothecation positions, we burn shares directly from the Hook contract.
   *
   * @param percentage - 25 | 50 | 75 | 100
   */
  const executeUnifiedYieldWithdraw = useCallback(async (percentage: WithdrawPercentage): Promise<Hash | undefined> => {
    if (!isUnifiedYield || !position.shareBalance) {
      setError("Not a Unified Yield position or no share balance");
      return undefined;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Parse share balance from the position
      const shareBalanceBigInt = parseUnits(position.shareBalance, 18);

      if (shareBalanceBigInt <= 0n) {
        throw new Error("No shares to withdraw");
      }

      // Execute withdrawal by percentage
      const txHash = await unifiedYieldWithdraw.withdrawPercentage(shareBalanceBigInt, percentage);
      setIsLoading(false);
      return txHash;
    } catch (err: any) {
      console.error("[DecreaseLiquidityTxContext] Unified Yield withdraw error:", err);
      setError(err.message || "Unified Yield withdrawal failed");
      setIsLoading(false);
      return undefined;
    }
  }, [isUnifiedYield, position.shareBalance, unifiedYieldWithdraw]);

  /**
   * Fetch API and build transaction context for step executor.
   * Decrease operations don't need approvals or permits.
   *
   * For Unified Yield positions: builds txRequest directly (no API call needed)
   * For V4 positions: calls API to build transaction
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

    // =========================================================================
    // UNIFIED YIELD POSITIONS - Build txRequest directly (no API call)
    // =========================================================================
    if (isUnifiedYield && position.hookAddress && position.shareBalance) {
      try {
        // Calculate percentage from withdraw amounts
        const amt0 = parseFloat(withdrawAmount0 || "0");
        const max0 = parseFloat(position.token0.amount || "0");
        const withdrawPercentage = max0 > 0 ? Math.min(100, Math.round((amt0 / max0) * 100)) : 100;

        // Calculate shares to withdraw
        const shareBalanceBigInt = parseUnits(position.shareBalance, 18);
        const sharesToWithdraw = calculateSharesFromPercentage(shareBalanceBigInt, withdrawPercentage);

        // Build the withdraw transaction (with slippage protection)
        const sqrtPriceX96 = poolStateData?.sqrtPriceX96 ? BigInt(poolStateData.sqrtPriceX96) : 0n;
        const txResult = buildUnifiedYieldWithdrawTx({
          hookAddress: position.hookAddress as Address,
          shares: sharesToWithdraw,
          userAddress: accountAddress,
          poolId: position.poolId,
          chainId,
          expectedSqrtPriceX96: sqrtPriceX96,
          maxPriceSlippage: 500, // 0.05%
        });

        // Convert display amounts to raw amounts (wei) for the SDK
        const rawAmount0 = parseUnits(withdrawAmount0 || "0", token0Config.decimals).toString();
        const rawAmount1 = parseUnits(withdrawAmount1 || "0", token1Config.decimals).toString();

        // Build context with UY-specific fields
        const context = buildLiquidityTxContext({
          type: LiquidityTransactionType.Decrease,
          apiResponse: {
            needsApproval: false,
            create: {
              to: txResult.to,
              data: txResult.calldata,
              value: txResult.value?.toString() || "0",
              gasLimit: txResult.gasLimit?.toString(),
            },
            sqrtRatioX96: undefined,
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
          amount0: rawAmount0,
          amount1: rawAmount1,
          chainId,
          // Unified Yield specific fields
          isUnifiedYield: true,
          hookAddress: position.hookAddress as Address,
          poolId: position.poolId,
          sharesToWithdraw,
        });

        setTxContext(context as ValidatedLiquidityTxContext);
        setIsLoading(false);
        return context as ValidatedLiquidityTxContext;
      } catch (err: any) {
        console.error("[DecreaseLiquidityTxContext] Unified Yield context error:", err);
        setError(err.message || "Failed to prepare Unified Yield withdrawal");
        setIsLoading(false);
        return null;
      }
    }

    // =========================================================================
    // V4 POSITIONS - Call API to build transaction
    // =========================================================================
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
  }, [accountAddress, chainId, position, withdrawAmount0, withdrawAmount1, networkMode, tokenDefinitions, parseTokenId, isUnifiedYield, poolStateData]);

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
    // Unified Yield
    executeUnifiedYieldWithdraw,
    isUnifiedYieldPending: unifiedYieldWithdraw.isPending,
    isUnifiedYieldConfirming: unifiedYieldWithdraw.isConfirming,
    isUnifiedYieldSuccess: unifiedYieldWithdraw.isSuccess,
    unifiedYieldTxHash: unifiedYieldWithdraw.txHash,
    resetUnifiedYield: unifiedYieldWithdraw.reset,
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
    executeUnifiedYieldWithdraw,
    unifiedYieldWithdraw.isPending,
    unifiedYieldWithdraw.isConfirming,
    unifiedYieldWithdraw.isSuccess,
    unifiedYieldWithdraw.txHash,
    unifiedYieldWithdraw.reset,
  ]);

  return <DecreaseLiquidityTxContext.Provider value={value}>{children}</DecreaseLiquidityTxContext.Provider>;
}

export function useDecreaseLiquidityTxContext(): DecreaseLiquidityTxContextType {
  const context = useContext(DecreaseLiquidityTxContext);
  if (!context) throw new Error("useDecreaseLiquidityTxContext must be used within DecreaseLiquidityTxContextProvider");
  return context;
}
