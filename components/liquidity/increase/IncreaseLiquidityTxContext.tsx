"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, type PropsWithChildren } from "react";
import { useAccount, useBalance } from "wagmi";
import { formatUnits, type Address } from "viem";
import { reportError } from "@/lib/observability";
import { formatTokenDisplayAmount } from "@/lib/utils";
import { getTokenDefinitions, getPoolBySlug, type TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { chainIdForMode } from "@/lib/network-mode";
import { useDerivedIncreaseInfo } from "@/lib/liquidity/hooks";
import { useTokenPrices } from "@/hooks/useTokenPrices";
import { usePercentageInput } from "@/hooks/usePercentageInput";
import { useIncreaseLiquidityContext } from "./IncreaseLiquidityContext";

import { type ValidatedLiquidityTxContext } from "@/lib/liquidity/types";

import { usePoolState } from "@/lib/apollo/hooks/usePoolState";

import { useUnifiedYieldDeposit } from "@/lib/liquidity/unified-yield/hooks/useUnifiedYieldDeposit";
import { useUnifiedYieldApprovals } from "@/lib/liquidity/unified-yield/useUnifiedYieldApprovals";
import type { UnifiedYieldApprovalStatus } from "@/lib/liquidity/unified-yield/types";
import { buildUnifiedYieldIncreaseContext, buildV4IncreaseContext } from "./buildIncreaseTxContext";

interface IncreaseLiquidityTxContextType {
  isLoading: boolean;
  error: string | null;
  txContext: ValidatedLiquidityTxContext | null;
  token0Balance: string;
  token1Balance: string;
  token0USDPrice: number;
  token1USDPrice: number;
  isCalculating: boolean;
  dependentAmount: string | null;
  dependentField: "amount0" | "amount1" | null;
  fetchAndBuildContext: () => Promise<ValidatedLiquidityTxContext | null>;
  handlePercentage0: (percentage: number) => string | void;
  handlePercentage1: (percentage: number) => string | void;
  calculateDependentAmount: (value: string, field: "amount0" | "amount1") => void;
  refetchBalances: () => void;
  clearError: () => void;
  unifiedYieldApprovalStatus: UnifiedYieldApprovalStatus | null;
  isCheckingApprovals: boolean;
  refetchApprovals: (overrideAmounts?: { amount0Wei: bigint; amount1Wei: bigint }) => Promise<UnifiedYieldApprovalStatus | null>;
}

const IncreaseLiquidityTxContext = createContext<IncreaseLiquidityTxContextType | null>(null);

export function IncreaseLiquidityTxContextProvider({ children }: PropsWithChildren) {
  const { address: accountAddress, isConnected } = useAccount();
  const { ensureChain } = useNetwork();
  const {
    increaseLiquidityState,
    derivedIncreaseLiquidityInfo,
    setDerivedInfo,
    setAmount0,
    setAmount1,
    isUnifiedYield,
  } = useIncreaseLiquidityContext();
  const { position, exactField } = increaseLiquidityState;

  const networkMode = position.networkMode || 'base';
  const chainId = chainIdForMode(networkMode);
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  const poolConfig = useMemo(() => {
    return position.poolId ? getPoolBySlug(position.poolId, networkMode) : null;
  }, [position.poolId, networkMode]);

  const { data: poolStateData } = usePoolState(poolConfig?.poolId ?? '', networkMode);

  const unifiedYieldDeposit = useUnifiedYieldDeposit({
    hookAddress: poolConfig?.hooks as Address | undefined,
    token0Address: tokenDefinitions[position.token0.symbol as TokenSymbol]?.address as Address | undefined,
    token1Address: tokenDefinitions[position.token1.symbol as TokenSymbol]?.address as Address | undefined,
    token0Decimals: tokenDefinitions[position.token0.symbol as TokenSymbol]?.decimals ?? 18,
    token1Decimals: tokenDefinitions[position.token1.symbol as TokenSymbol]?.decimals ?? 18,
    poolId: position.poolId,
    chainId,
    sqrtPriceX96: poolStateData?.sqrtPriceX96,
    maxPriceSlippage: 500,
    networkModeOverride: networkMode,
  });

  const {
    data: unifiedYieldApprovalStatus,
    isLoading: isCheckingApprovals,
    refetch: refetchApprovals,
  } = useUnifiedYieldApprovals(
    {
      userAddress: accountAddress as Address | undefined,
      token0Address: tokenDefinitions[position.token0.symbol as TokenSymbol]?.address as Address | undefined,
      token1Address: tokenDefinitions[position.token1.symbol as TokenSymbol]?.address as Address | undefined,
      amount0Wei: unifiedYieldDeposit.lastPreview?.amount0 ?? 0n,
      amount1Wei: unifiedYieldDeposit.lastPreview?.amount1 ?? 0n,
      hookAddress: poolConfig?.hooks as Address | undefined,
      chainId,
    },
    {
      enabled: isUnifiedYield && !!unifiedYieldDeposit.lastPreview && !!accountAddress,
    }
  );

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txContext, setTxContext] = useState<ValidatedLiquidityTxContext | null>(null);

  const increasePriceSymbols = useMemo(
    () => [position.token0.symbol, position.token1.symbol].filter(Boolean),
    [position.token0.symbol, position.token1.symbol]
  );
  const { prices: increasePrices } = useTokenPrices(increasePriceSymbols, { chainId });
  const token0USDPrice = increasePrices[position.token0.symbol] || null;
  const token1USDPrice = increasePrices[position.token1.symbol] || null;

  const { data: token0BalanceData, refetch: refetchToken0Balance } = useBalance({
    address: accountAddress,
    token: tokenDefinitions[position.token0.symbol as TokenSymbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : tokenDefinitions[position.token0.symbol as TokenSymbol]?.address as `0x${string}`,
    chainId,
    query: { enabled: isConnected && !!accountAddress && !!chainId }
  });

  const { data: token1BalanceData, refetch: refetchToken1Balance } = useBalance({
    address: accountAddress,
    token: tokenDefinitions[position.token1.symbol as TokenSymbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : tokenDefinitions[position.token1.symbol as TokenSymbol]?.address as `0x${string}`,
    chainId,
    query: { enabled: isConnected && !!accountAddress && !!chainId }
  });

  const token0Balance = token0BalanceData?.formatted || "0";
  const token1Balance = token1BalanceData?.formatted || "0";

  useEffect(() => {
    setDerivedInfo((prev) => ({
      ...prev,
      currencyBalances: { TOKEN0: token0Balance, TOKEN1: token1Balance },
      currencyAmountsUSDValue: {
        TOKEN0: parseFloat(prev.formattedAmounts?.TOKEN0 || "0") * (token0USDPrice || 0),
        TOKEN1: parseFloat(prev.formattedAmounts?.TOKEN1 || "0") * (token1USDPrice || 0)
      }
    }));
  }, [token0Balance, token1Balance, token0USDPrice, token1USDPrice, setDerivedInfo]);

  const handlePercentage0 = usePercentageInput(
    token0BalanceData,
    { decimals: tokenDefinitions[position.token0.symbol as TokenSymbol]?.decimals || 18, symbol: position.token0.symbol as TokenSymbol },
    setAmount0
  );
  const handlePercentage1 = usePercentageInput(
    token1BalanceData,
    { decimals: tokenDefinitions[position.token1.symbol as TokenSymbol]?.decimals || 18, symbol: position.token1.symbol as TokenSymbol },
    setAmount1
  );

  const v4DerivedInfo = useDerivedIncreaseInfo({
    position,
    chainId,
    currentPoolTick: null,
    networkMode
  });

  const calculateDependentAmount = useCallback(async (
    inputAmount: string,
    inputSide: "amount0" | "amount1"
  ) => {
    if (isUnifiedYield && poolConfig?.hooks) {
      const hookInputSide = inputSide === "amount0" ? "token0" : "token1";
      const inputDecimals = inputSide === "amount0"
        ? (tokenDefinitions[position.token0.symbol as TokenSymbol]?.decimals ?? 18)
        : (tokenDefinitions[position.token1.symbol as TokenSymbol]?.decimals ?? 18);
      await unifiedYieldDeposit.getPreview(inputAmount, hookInputSide, inputDecimals);
    } else {
      v4DerivedInfo.calculateDependentAmount(inputAmount, inputSide);
    }
  }, [isUnifiedYield, poolConfig?.hooks, tokenDefinitions, position, unifiedYieldDeposit, v4DerivedInfo]);

  const uyPreview = unifiedYieldDeposit.lastPreview;
  const isCalculating = isUnifiedYield ? false : v4DerivedInfo.isCalculating;
  const dependentAmount = isUnifiedYield
    ? (uyPreview?.inputSide === 'token0' ? uyPreview?.amount1Formatted : uyPreview?.amount0Formatted) ?? null
    : v4DerivedInfo.dependentAmount;
  const dependentField = isUnifiedYield
    ? (uyPreview?.inputSide === 'token0' ? 'amount1' : uyPreview?.inputSide === 'token1' ? 'amount0' : null)
    : v4DerivedInfo.dependentField;

  useEffect(() => {
    if (!dependentField || !dependentAmount) return;
    if (dependentField === "amount1") {
      setDerivedInfo((prev) => ({ ...prev, formattedAmounts: { ...prev.formattedAmounts, TOKEN1: dependentAmount } }));
    } else if (dependentField === "amount0") {
      setDerivedInfo((prev) => ({ ...prev, formattedAmounts: { ...prev.formattedAmounts, TOKEN0: dependentAmount } }));
    }
  }, [dependentField, dependentAmount, setDerivedInfo]);

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

  const fetchAndBuildContext = useCallback(async (): Promise<ValidatedLiquidityTxContext | null> => {
    if (!accountAddress || !chainId) return null;

    const ok = await ensureChain(chainIdForMode(networkMode));
    if (!ok) return null;

    setIsLoading(true);
    setError(null);

    const token0Config = tokenDefinitions[position.token0.symbol as TokenSymbol];
    const token1Config = tokenDefinitions[position.token1.symbol as TokenSymbol];
    if (!token0Config || !token1Config) {
      setError("Token configuration not found");
      setIsLoading(false);
      return null;
    }

    const { TOKEN0: amount0, TOKEN1: amount1 } = derivedIncreaseLiquidityInfo.formattedAmounts || {};

    if (isUnifiedYield) {
      if (!poolConfig?.hooks) {
        console.error('[IncreaseLiquidityTxContext] Unified Yield mode but pool.hooks is missing');
        setError("Pool hook address not configured for Unified Yield");
        setIsLoading(false);
        return null;
      }
    }

    if (isUnifiedYield && poolConfig?.hooks) {
      const preview = unifiedYieldDeposit.lastPreview;
      if (!preview || preview.shares === 0n) {
        setError("Please enter an amount first");
        setIsLoading(false);
        return null;
      }
      try {
        const context = await buildUnifiedYieldIncreaseContext({
          accountAddress,
          chainId,
          token0Config,
          token1Config,
          hookAddress: poolConfig.hooks as Address,
          poolId: position.poolId,
          preview,
          sqrtPriceX96: poolStateData?.sqrtPriceX96,
          refetchApprovals,
        });

        setTxContext(context);
        setIsLoading(false);
        return context;
      } catch (err: any) {
        console.error("[IncreaseLiquidityTxContext] Unified Yield context error:", err);
        reportError(err, {
          domain: "unified-yield",
          action: "buildContext",
          component: "IncreaseLiquidityTxContext",
          networkMode,
          chainId,
          extras: { poolId: position?.poolId, hookAddress: poolConfig?.hooks, userAddress: accountAddress },
        });
        setError(err.message || "Failed to prepare Unified Yield deposit");
        setIsLoading(false);
        return null;
      }
    }

    const tokenId = parseTokenId(position.positionId);

    // Tell Uniswap which field is independent — otherwise it defaults to token0 and
    // recomputes a token1 amount that breaks MAX deposits when the user is editing token1.
    const inputSide: 'token0' | 'token1' = exactField === 'TOKEN1' ? 'token1' : 'token0';

    const syncAmountsFromApi = (apiDetails: { token0: { amount: string }; token1: { amount: string } }) => {
      const formatted0 = formatTokenDisplayAmount(
        formatUnits(BigInt(apiDetails.token0.amount), token0Config.decimals),
        token0Config.symbol as TokenSymbol,
        networkMode,
      );
      const formatted1 = formatTokenDisplayAmount(
        formatUnits(BigInt(apiDetails.token1.amount), token1Config.decimals),
        token1Config.symbol as TokenSymbol,
        networkMode,
      );
      setDerivedInfo((prev) => ({
        ...prev,
        formattedAmounts: { ...prev.formattedAmounts, TOKEN0: formatted0, TOKEN1: formatted1 },
      }));
    };

    try {
      const context = await buildV4IncreaseContext({
        accountAddress,
        chainId,
        token0Config,
        token1Config,
        tokenId,
        amount0: amount0 || "0",
        amount1: amount1 || "0",
        inputSide,
        syncAmountsFromApi,
      });

      setTxContext(context);
      setIsLoading(false);
      return context;
    } catch (err: any) {
      console.error("[IncreaseLiquidityTxContext] fetchAndBuildContext error:", err);
      reportError(err, {
        domain: "liquidity",
        action: "increase",
        component: "IncreaseLiquidityTxContext",
        networkMode,
        chainId,
        extras: { poolId: position?.poolId, positionId: position?.positionId, userAddress: accountAddress },
      });
      setError(err.message || "Failed to prepare transaction");
      setIsLoading(false);
      return null;
    }
  }, [accountAddress, chainId, position, exactField, derivedIncreaseLiquidityInfo.formattedAmounts, tokenDefinitions, parseTokenId, isUnifiedYield, poolConfig, unifiedYieldDeposit, refetchApprovals, poolStateData]);

  const refetchBalances = useCallback(() => {
    refetchToken0Balance();
    refetchToken1Balance();
  }, [refetchToken0Balance, refetchToken1Balance]);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo(() => ({
    isLoading,
    error,
    txContext,
    token0Balance,
    token1Balance,
    token0USDPrice: token0USDPrice || 0,
    token1USDPrice: token1USDPrice || 0,
    isCalculating,
    dependentAmount,
    dependentField,
    fetchAndBuildContext,
    handlePercentage0,
    handlePercentage1,
    calculateDependentAmount,
    refetchBalances,
    clearError,
    unifiedYieldApprovalStatus,
    isCheckingApprovals,
    refetchApprovals,
  }), [
    isLoading,
    error,
    txContext,
    token0Balance,
    token1Balance,
    token0USDPrice,
    token1USDPrice,
    isCalculating,
    dependentAmount,
    dependentField,
    fetchAndBuildContext,
    handlePercentage0,
    handlePercentage1,
    calculateDependentAmount,
    refetchBalances,
    clearError,
    unifiedYieldApprovalStatus,
    isCheckingApprovals,
    refetchApprovals,
  ]);

  return (
    <IncreaseLiquidityTxContext.Provider value={value}>
      {children}
    </IncreaseLiquidityTxContext.Provider>
  );
}

export function useIncreaseLiquidityTxContext(): IncreaseLiquidityTxContextType {
  const context = useContext(IncreaseLiquidityTxContext);
  if (!context) throw new Error("useIncreaseLiquidityTxContext must be used within IncreaseLiquidityTxContextProvider");
  return context;
}
