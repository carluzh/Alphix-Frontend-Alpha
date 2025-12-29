"use client";

import React, { createContext, useContext, useState, useMemo, useCallback, type PropsWithChildren } from "react";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { getTokenDefinitions, type TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { useDecreaseLiquidity, type DecreasePositionData } from "@/lib/liquidity/hooks";
import { useAllPrices } from "@/components/data/hooks";
import { getTokenSymbolByAddress, debounce } from "@/lib/utils";
import { useDecreaseLiquidityContext } from "./DecreaseLiquidityContext";

export type DecreaseTxStep = "input" | "withdraw";

interface DecreaseLiquidityTxContextType {
  txStep: DecreaseTxStep;
  setTxStep: (step: DecreaseTxStep) => void;
  isWorking: boolean;
  error: string | null;
  isSuccess: boolean;
  txHash: `0x${string}` | null;
  token0USDPrice: number;
  token1USDPrice: number;
  feesForWithdraw: { amount0: string; amount1: string } | null;
  calculateWithdrawAmount: (inputAmount: string, inputSide: "amount0" | "amount1") => void;
  executeWithdraw: () => void;
  getWithdrawButtonText: () => string;
}

const DecreaseLiquidityTxContext = createContext<DecreaseLiquidityTxContextType | null>(null);

export function DecreaseLiquidityTxContextProvider({ children }: PropsWithChildren) {
  const { address: accountAddress } = useAccount();
  const { chainId, networkMode } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const { data: allPrices } = useAllPrices();

  const { decreaseLiquidityState, derivedDecreaseInfo, setDerivedInfo } = useDecreaseLiquidityContext();
  const { position, activeInputSide } = decreaseLiquidityState;
  const { withdrawAmount0, withdrawAmount1 } = derivedDecreaseInfo;

  const [txStep, setTxStep] = useState<DecreaseTxStep>("input");
  const [error, setError] = useState<string | null>(null);

  const { decreaseLiquidity, isLoading: isDecreasingLiquidity, isSuccess, hash: txHash } = useDecreaseLiquidity({
    onLiquidityDecreased: () => {},
  });

  const getUSDPriceForSymbol = useCallback((symbol?: string): number => {
    if (!symbol) return 0;
    const s = symbol.toUpperCase();
    if (s.includes("BTC")) return allPrices?.BTC?.usd ?? 0;
    if (s.includes("ETH")) return allPrices?.ETH?.usd ?? 0;
    if (s.includes("USDC")) return allPrices?.USDC?.usd ?? 1;
    if (s.includes("USDT")) return allPrices?.USDT?.usd ?? 1;
    return 0;
  }, [allPrices]);

  const token0USDPrice = getUSDPriceForSymbol(position.token0.symbol);
  const token1USDPrice = getUSDPriceForSymbol(position.token1.symbol);

  const calculateWithdrawAmount = useMemo(() => debounce(async (inputAmount: string, inputSide: "amount0" | "amount1") => {
    if (!position || !inputAmount || parseFloat(inputAmount) <= 0) {
      if (inputSide === "amount0") setDerivedInfo((prev) => ({ ...prev, withdrawAmount1: "" }));
      else setDerivedInfo((prev) => ({ ...prev, withdrawAmount0: "" }));
      return;
    }

    setDerivedInfo((prev) => ({ ...prev, isCalculating: true }));

    try {
      if (!position.isInRange) {
        if (inputSide === "amount0") setDerivedInfo((prev) => ({ ...prev, withdrawAmount1: "0", isCalculating: false }));
        else setDerivedInfo((prev) => ({ ...prev, withdrawAmount0: "0", isCalculating: false }));
        return;
      }

      const token0Symbol = getTokenSymbolByAddress(position.token0.address, networkMode);
      const token1Symbol = getTokenSymbolByAddress(position.token1.address, networkMode);

      if (!token0Symbol || !token1Symbol) {
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
        return;
      }

      const { calculateLiquidityParameters } = await import("@/lib/liquidity-math");
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
  }, 300), [position, chainId, networkMode, tokenDefinitions, setDerivedInfo]);

  const executeWithdraw = useCallback(() => {
    if (!position || !accountAddress) return;

    setError(null);
    const token0Symbol = getTokenSymbolByAddress(position.token0.address, networkMode);
    const token1Symbol = getTokenSymbolByAddress(position.token1.address, networkMode);

    if (!token0Symbol || !token1Symbol) {
      setError("Token configuration is invalid.");
      return;
    }

    const amt0 = parseFloat(withdrawAmount0 || "0");
    const amt1 = parseFloat(withdrawAmount1 || "0");
    const max0 = parseFloat(position.token0.amount || "0");
    const max1 = parseFloat(position.token1.amount || "0");
    const pct0 = max0 > 0 ? amt0 / max0 : 0;
    const pct1 = max1 > 0 ? amt1 / max1 : 0;
    const effectivePct = Math.max(pct0, pct1) * 100;
    const nearFull0 = max0 > 0 ? pct0 >= 0.99 : true;
    const nearFull1 = max1 > 0 ? pct1 >= 0.99 : true;
    const isBurnAll = position.isInRange ? nearFull0 && nearFull1 : pct0 >= 0.99 || pct1 >= 0.99;

    const decreaseData: DecreasePositionData = {
      tokenId: position.positionId,
      token0Symbol,
      token1Symbol,
      decreaseAmount0: withdrawAmount0 || "0",
      decreaseAmount1: withdrawAmount1 || "0",
      isFullBurn: isBurnAll,
      poolId: position.poolId,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      enteredSide: activeInputSide === "amount0" ? "token0" : activeInputSide === "amount1" ? "token1" : undefined,
    };

    const pctRounded = isBurnAll ? 100 : Math.max(0, Math.min(100, Math.round(effectivePct)));
    decreaseLiquidity(decreaseData, position.isInRange ? pctRounded : 0);
  }, [position, accountAddress, networkMode, withdrawAmount0, withdrawAmount1, activeInputSide, decreaseLiquidity]);

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

  const value = useMemo(() => ({
    txStep,
    setTxStep,
    isWorking: isDecreasingLiquidity,
    error,
    isSuccess,
    txHash: txHash ?? null,
    token0USDPrice,
    token1USDPrice,
    feesForWithdraw: null,
    calculateWithdrawAmount,
    executeWithdraw,
    getWithdrawButtonText,
  }), [txStep, isDecreasingLiquidity, error, isSuccess, txHash, token0USDPrice, token1USDPrice, calculateWithdrawAmount, executeWithdraw, getWithdrawButtonText]);

  return <DecreaseLiquidityTxContext.Provider value={value}>{children}</DecreaseLiquidityTxContext.Provider>;
}

export function useDecreaseLiquidityTxContext(): DecreaseLiquidityTxContextType {
  const context = useContext(DecreaseLiquidityTxContext);
  if (!context) throw new Error("useDecreaseLiquidityTxContext must be used within DecreaseLiquidityTxContextProvider");
  return context;
}
