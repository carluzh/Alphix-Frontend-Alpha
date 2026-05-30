"use client";

import React, { createContext, useContext, useState, useMemo, useCallback, type PropsWithChildren } from "react";
import { useAccount } from "wagmi";
import { parseUnits, type Address, type Hash } from "viem";
import { reportError } from "@/lib/observability";
import { getTokenDefinitions, getPoolBySlug, getTokenSymbolByAddress } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { chainIdForMode } from "@/lib/network-mode";
import { useTokenPrices } from "@/hooks/useTokenPrices";
import { useDecreaseLiquidityContext } from "./DecreaseLiquidityContext";

import { type ValidatedLiquidityTxContext } from "@/lib/liquidity/types";

import { usePoolState } from "@/lib/apollo/hooks/usePoolState";

import { useUnifiedYieldWithdraw } from "@/lib/liquidity/unified-yield/hooks/useUnifiedYieldWithdraw";
import { buildUnifiedYieldDecreaseTxContext, buildV4DecreaseTxContext } from "./buildDecreaseTxContext";
type WithdrawPercentage = 25 | 50 | 75 | 100;

export interface DecreaseReceive {
  percent: number;
  amount0: string;
  amount1: string;
}

interface DecreaseLiquidityTxContextType {
  isLoading: boolean;
  error: string | null;
  txContext: ValidatedLiquidityTxContext | null;
  token0USDPrice: number;
  token1USDPrice: number;
  receive: DecreaseReceive | null;
  fetchAndBuildContext: () => Promise<ValidatedLiquidityTxContext | null>;
  clearError: () => void;
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
  const { ensureChain } = useNetwork();
  const { position, withdrawAmount0, withdrawAmount1, isUnifiedYield } = useDecreaseLiquidityContext();

  const networkMode = position.networkMode || 'base';
  const chainId = chainIdForMode(networkMode);
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  const priceSymbols = useMemo(
    () => [position.token0.symbol, position.token1.symbol].filter(Boolean),
    [position.token0.symbol, position.token1.symbol],
  );
  const { prices } = useTokenPrices(priceSymbols, { chainId });

  const poolConfig = useMemo(() => {
    return position.poolId ? getPoolBySlug(position.poolId, networkMode) : null;
  }, [position.poolId, networkMode]);

  const { data: poolStateData } = usePoolState(poolConfig?.poolId ?? '', networkMode);

  const unifiedYieldWithdraw = useUnifiedYieldWithdraw({
    hookAddress: position.hookAddress as Address | undefined,
    token0Decimals: tokenDefinitions[getTokenSymbolByAddress(position.token0.address, networkMode) as keyof typeof tokenDefinitions]?.decimals ?? 18,
    token1Decimals: tokenDefinitions[getTokenSymbolByAddress(position.token1.address, networkMode) as keyof typeof tokenDefinitions]?.decimals ?? 18,
    poolId: position.poolId,
    chainId,
    sqrtPriceX96: poolStateData?.sqrtPriceX96,
    maxPriceSlippage: 500,
    networkModeOverride: networkMode,
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txContext, setTxContext] = useState<ValidatedLiquidityTxContext | null>(null);
  const [receive, setReceive] = useState<DecreaseReceive | null>(null);

  const token0USDPrice = prices[position.token0.symbol] ?? 0;
  const token1USDPrice = prices[position.token1.symbol] ?? 0;

  const executeUnifiedYieldWithdraw = useCallback(async (percentage: WithdrawPercentage): Promise<Hash | undefined> => {
    if (!isUnifiedYield || !position.shareBalance) {
      setError("Not a Unified Yield position or no share balance");
      return undefined;
    }

    const ok = await ensureChain(chainIdForMode(networkMode));
    if (!ok) return undefined;

    setIsLoading(true);
    setError(null);

    try {
      const shareBalanceBigInt = parseUnits(position.shareBalance, 18);
      if (shareBalanceBigInt <= 0n) {
        throw new Error("No shares to withdraw");
      }

      const txHash = await unifiedYieldWithdraw.withdrawPercentage(shareBalanceBigInt, percentage);
      setIsLoading(false);
      return txHash;
    } catch (err: any) {
      console.error("[DecreaseLiquidityTxContext] Unified Yield withdraw error:", err);
      reportError(err, {
        domain: "unified-yield",
        action: "withdraw",
        component: "DecreaseLiquidityTxContext",
        networkMode,
        chainId,
        extras: { poolId: position?.poolId, shareBalance: position?.shareBalance, userAddress: accountAddress },
      });
      setError(err.message || "Unified Yield withdrawal failed");
      setIsLoading(false);
      return undefined;
    }
  }, [isUnifiedYield, position.shareBalance, unifiedYieldWithdraw]);

  const fetchAndBuildContext = useCallback(async (): Promise<ValidatedLiquidityTxContext | null> => {
    if (!accountAddress || !chainId) return null;

    const chainOk = await ensureChain(chainIdForMode(networkMode));
    if (!chainOk) return null;

    setIsLoading(true);
    setError(null);

    const token0Symbol = getTokenSymbolByAddress(position.token0.address, networkMode);
    const token1Symbol = getTokenSymbolByAddress(position.token1.address, networkMode);
    const token0Config = token0Symbol ? tokenDefinitions[token0Symbol] : undefined;
    const token1Config = token1Symbol ? tokenDefinitions[token1Symbol] : undefined;
    if (!token0Config || !token1Config) {
      setError("Token configuration not found");
      setIsLoading(false);
      return null;
    }

    const amt0 = parseFloat(withdrawAmount0 || "0");
    const amt1 = parseFloat(withdrawAmount1 || "0");
    const max0 = parseFloat(position.token0.amount || "0");
    const max1 = parseFloat(position.token1.amount || "0");
    const pct0 = max0 > 0 ? amt0 / max0 : 0;
    const pct1 = max1 > 0 ? amt1 / max1 : 0;
    const rawPct = Math.max(pct0, pct1) * 100;
    const decreasePercentage = rawPct >= 99 ? 100 : Math.max(1, Math.min(100, Math.round(rawPct)));

    if (isUnifiedYield && position.hookAddress && position.shareBalance) {
      try {
        const context = buildUnifiedYieldDecreaseTxContext({
          hookAddress: position.hookAddress as Address,
          shareBalance: position.shareBalance,
          userAddress: accountAddress,
          poolId: position.poolId,
          chainId,
          decreasePercentage,
          sqrtPriceX96: poolStateData?.sqrtPriceX96,
          token0Config,
          token1Config,
          withdrawAmount0,
          withdrawAmount1,
        });

        setTxContext(context);
        setIsLoading(false);
        return context;
      } catch (err: any) {
        console.error("[DecreaseLiquidityTxContext] Unified Yield context error:", err);
        reportError(err, {
          domain: "unified-yield",
          action: "buildContext",
          component: "DecreaseLiquidityTxContext",
          networkMode,
          chainId,
          extras: { poolId: position?.poolId, hookAddress: position?.hookAddress, shareBalance: position?.shareBalance, userAddress: accountAddress },
        });
        setError(err.message || "Failed to prepare Unified Yield withdrawal");
        setIsLoading(false);
        return null;
      }
    }

    try {
      const { context, receive: receiveData } = await buildV4DecreaseTxContext({
        userAddress: accountAddress,
        positionId: position.positionId,
        decreasePercentage,
        chainId,
        token0Config,
        token1Config,
      });

      setReceive(receiveData);
      setTxContext(context);
      setIsLoading(false);
      return context;
    } catch (err: any) {
      console.error("[DecreaseLiquidityTxContext] fetchAndBuildContext error:", err);
      reportError(err, {
        domain: "liquidity",
        action: "decrease",
        component: "DecreaseLiquidityTxContext",
        networkMode,
        chainId,
        extras: { poolId: position?.poolId, positionId: position?.positionId, userAddress: accountAddress, withdrawAmount0, withdrawAmount1 },
      });
      setError(err.message || "Failed to prepare transaction");
      setIsLoading(false);
      return null;
    }
  }, [accountAddress, chainId, position, withdrawAmount0, withdrawAmount1, networkMode, tokenDefinitions, isUnifiedYield, poolStateData, ensureChain]);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo(() => ({
    isLoading,
    error,
    txContext,
    token0USDPrice,
    token1USDPrice,
    receive,
    fetchAndBuildContext,
    clearError,
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
    receive,
    fetchAndBuildContext,
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
