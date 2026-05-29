"use client";

import React, { createContext, useContext, useState, useMemo, useCallback, type PropsWithChildren } from "react";
import { useAccount } from "wagmi";
import { parseUnits, type Address, type Hash } from "viem";
import * as Sentry from "@sentry/nextjs";
import { getTokenDefinitions, getPoolBySlug, getTokenSymbolByAddress } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { chainIdForMode } from "@/lib/network-mode";
import { useTokenPrices } from "@/hooks/useTokenPrices";
import { useDecreaseLiquidityContext } from "./DecreaseLiquidityContext";

import {
  buildLiquidityTxContext,
  type MintTxApiResponse,
} from "@/lib/liquidity/transaction";
import {
  LiquidityTransactionType,
  type ValidatedLiquidityTxContext,
} from "@/lib/liquidity/types";

import { usePoolState } from "@/lib/apollo/hooks/usePoolState";

import { useUnifiedYieldWithdraw } from "@/lib/liquidity/unified-yield/hooks/useUnifiedYieldWithdraw";
import { buildUnifiedYieldWithdrawTx, calculateSharesFromPercentage } from "@/lib/liquidity/unified-yield/buildUnifiedYieldWithdrawTx";
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
      Sentry.captureException(err, {
        tags: { component: "DecreaseLiquidityTxContext", operation: "executeUnifiedYieldWithdraw" },
        extra: { poolId: position?.poolId, shareBalance: position?.shareBalance, userAddress: accountAddress, chainId },
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
        const shareBalanceBigInt = parseUnits(position.shareBalance, 18);
        const sharesToWithdraw = calculateSharesFromPercentage(shareBalanceBigInt, decreasePercentage);
        const sqrtPriceX96 = poolStateData?.sqrtPriceX96 ? BigInt(poolStateData.sqrtPriceX96) : 0n;
        const txResult = buildUnifiedYieldWithdrawTx({
          hookAddress: position.hookAddress as Address,
          shares: sharesToWithdraw,
          userAddress: accountAddress,
          poolId: position.poolId,
          chainId,
          expectedSqrtPriceX96: sqrtPriceX96,
          maxPriceSlippage: 500,
        });

        const rawAmount0 = parseUnits(withdrawAmount0 || "0", token0Config.decimals).toString();
        const rawAmount1 = parseUnits(withdrawAmount1 || "0", token1Config.decimals).toString();

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
          } as MintTxApiResponse,
          token0: { address: token0Config.address as Address, symbol: token0Config.symbol, decimals: token0Config.decimals, chainId },
          token1: { address: token1Config.address as Address, symbol: token1Config.symbol, decimals: token1Config.decimals, chainId },
          amount0: rawAmount0,
          amount1: rawAmount1,
          chainId,
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
        Sentry.captureException(err, {
          tags: { component: "DecreaseLiquidityTxContext", operation: "buildUnifiedYieldContext" },
          extra: { poolId: position?.poolId, hookAddress: position?.hookAddress, shareBalance: position?.shareBalance, userAddress: accountAddress, chainId },
        });
        setError(err.message || "Failed to prepare Unified Yield withdrawal");
        setIsLoading(false);
        return null;
      }
    }

    try {
      const compositeId = position.positionId.toString();
      const saltHex = compositeId.split('-').at(-1);
      let tokenId = compositeId;
      if (saltHex && saltHex !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
        try { tokenId = BigInt(saltHex).toString(); } catch {}
      }
      const response = await fetch("/api/liquidity/prepare-decrease-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: accountAddress,
          tokenId,
          decreasePercentage,
          chainId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to prepare transaction");
      }
      if (!data.details?.token0?.amount || !data.details?.token1?.amount) {
        throw new Error("Uniswap LP API response missing token amounts");
      }

      setReceive({ percent: decreasePercentage, amount0: data.details.token0.amount, amount1: data.details.token1.amount });

      const context = buildLiquidityTxContext({
        type: LiquidityTransactionType.Decrease,
        apiResponse: { needsApproval: false, create: data.create } as MintTxApiResponse,
        token0: { address: token0Config.address as Address, symbol: token0Config.symbol, decimals: token0Config.decimals, chainId },
        token1: { address: token1Config.address as Address, symbol: token1Config.symbol, decimals: token1Config.decimals, chainId },
        amount0: data.details.token0.amount,
        amount1: data.details.token1.amount,
        chainId,
      });

      setTxContext(context as ValidatedLiquidityTxContext);
      setIsLoading(false);
      return context as ValidatedLiquidityTxContext;
    } catch (err: any) {
      console.error("[DecreaseLiquidityTxContext] fetchAndBuildContext error:", err);
      Sentry.captureException(err, {
        tags: { component: "DecreaseLiquidityTxContext", operation: "fetchAndBuildContext" },
        extra: { poolId: position?.poolId, positionId: position?.positionId, userAddress: accountAddress, chainId, withdrawAmount0, withdrawAmount1 },
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
