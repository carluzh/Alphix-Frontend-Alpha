"use client";

/**
 * IncreaseLiquidityTxContext - Transaction context for increase liquidity flow
 *
 * Refactored to use Uniswap's step-based executor pattern:
 * - Builds context with increasePositionRequestArgs for async step
 * - Includes approval transaction requests when needed
 * - Includes permit data when needed
 * - Step executor handles ALL steps (approvals, permits, position transaction)
 *
 * @see interface/apps/web/src/pages/IncreaseLiquidity/IncreaseLiquidityTxContext.tsx
 * @see components/liquidity/wizard/ReviewExecuteModal.tsx
 */

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, type PropsWithChildren } from "react";
import { useAccount, useBalance } from "wagmi";
import { parseUnits, type Address, maxUint256 } from "viem";
import { getTokenDefinitions, type TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { useDerivedIncreaseInfo } from "@/lib/liquidity/hooks";
import { useTokenUSDPrice } from "@/hooks/useTokenUSDPrice";
import { usePercentageInput } from "@/hooks/usePercentageInput";
import { useIncreaseLiquidityContext } from "./IncreaseLiquidityContext";
import { getStoredUserSettings } from "@/hooks/useUserSettings";

// Import from transaction module
import {
  buildLiquidityTxContext,
  type MintTxApiResponse,
} from "@/lib/liquidity/transaction";
import {
  LiquidityTransactionType,
  type ValidatedLiquidityTxContext,
  type ValidatedTransactionRequest,
  type SignTypedDataStepFields,
} from "@/lib/liquidity/types";
import { PERMIT2_ADDRESS } from "../liquidity-form-utils";

interface IncreaseLiquidityTxContextType {
  // API/Context state
  isLoading: boolean;
  error: string | null;

  // Transaction context for step executor (contains ALL info for steps)
  txContext: ValidatedLiquidityTxContext | null;

  // Balances and prices
  token0Balance: string;
  token1Balance: string;
  token0USDPrice: number;
  token1USDPrice: number;

  // Dependent amount calculation
  isCalculating: boolean;
  dependentAmount: string | null;
  dependentField: "amount0" | "amount1" | null;

  // Actions
  fetchAndBuildContext: () => Promise<ValidatedLiquidityTxContext | null>;
  handlePercentage0: (percentage: number) => string | void;
  handlePercentage1: (percentage: number) => string | void;
  calculateDependentAmount: (value: string, field: "amount0" | "amount1") => void;
  refetchBalances: () => void;
  clearError: () => void;
}

const IncreaseLiquidityTxContext = createContext<IncreaseLiquidityTxContextType | null>(null);

export function IncreaseLiquidityTxContextProvider({ children }: PropsWithChildren) {
  const { address: accountAddress } = useAccount();
  const { chainId, networkMode } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const { increaseLiquidityState, derivedIncreaseLiquidityInfo, setDerivedInfo, setAmount0, setAmount1 } = useIncreaseLiquidityContext();
  const { position } = increaseLiquidityState;

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txContext, setTxContext] = useState<ValidatedLiquidityTxContext | null>(null);

  // USD prices
  const { price: token0USDPrice } = useTokenUSDPrice(position.token0.symbol as TokenSymbol);
  const { price: token1USDPrice } = useTokenUSDPrice(position.token1.symbol as TokenSymbol);

  // Balances
  const { data: token0BalanceData, refetch: refetchToken0Balance } = useBalance({
    address: accountAddress,
    token: tokenDefinitions[position.token0.symbol as TokenSymbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : tokenDefinitions[position.token0.symbol as TokenSymbol]?.address as `0x${string}`,
    chainId,
    query: { enabled: !!accountAddress && !!chainId }
  });

  const { data: token1BalanceData, refetch: refetchToken1Balance } = useBalance({
    address: accountAddress,
    token: tokenDefinitions[position.token1.symbol as TokenSymbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : tokenDefinitions[position.token1.symbol as TokenSymbol]?.address as `0x${string}`,
    chainId,
    query: { enabled: !!accountAddress && !!chainId }
  });

  const token0Balance = token0BalanceData?.formatted || "0";
  const token1Balance = token1BalanceData?.formatted || "0";

  // Update derived info with balances and prices
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

  // Percentage input handlers
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

  // Dependent amount calculation
  const { calculateDependentAmount, isCalculating, dependentAmount, dependentField } = useDerivedIncreaseInfo({
    position,
    chainId,
    currentPoolTick: null,
    networkMode
  });

  // Update derived info with dependent amount
  useEffect(() => {
    if (!dependentField || !dependentAmount) return;
    if (dependentField === "amount1") {
      setDerivedInfo((prev) => ({ ...prev, formattedAmounts: { ...prev.formattedAmounts, TOKEN1: dependentAmount } }));
    } else if (dependentField === "amount0") {
      setDerivedInfo((prev) => ({ ...prev, formattedAmounts: { ...prev.formattedAmounts, TOKEN0: dependentAmount } }));
    }
  }, [dependentField, dependentAmount, setDerivedInfo]);

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

  /**
   * Fetch API and build complete transaction context for step executor.
   *
   * This builds a context that includes:
   * - approveToken0Request/approveToken1Request when ERC20 approval needed
   * - permit data when Permit2 signature needed
   * - increasePositionRequestArgs for async step to call API with signature
   * - txRequest when all approvals are done
   */
  const fetchAndBuildContext = useCallback(async (): Promise<ValidatedLiquidityTxContext | null> => {
    if (!accountAddress || !chainId) return null;

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
    const tokenId = parseTokenId(position.positionId);

    // Get user settings
    const userSettings = getStoredUserSettings();
    const slippageBps = Math.round(userSettings.slippage * 100);
    const deadlineMinutes = userSettings.deadline;

    try {
      // Call API to check approvals and get permit/tx data
      const response = await fetch("/api/liquidity/prepare-increase-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userAddress: accountAddress,
          tokenId,
          amount0: amount0 || "0",
          amount1: amount1 || "0",
          chainId,
          slippageBps,
          deadlineMinutes,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to prepare transaction");
      }

      // Build request args for async step (needed when permit signing is required)
      // Note: prepare-increase-tx.ts expects amount0/amount1 (not inputAmount/inputTokenSymbol)
      const increasePositionRequestArgs = {
        userAddress: accountAddress,
        tokenId,
        amount0: amount0 || "0",
        amount1: amount1 || "0",
        chainId,
        slippageBps,
        deadlineMinutes,
      };

      // Handle ERC20 approval needed
      if (data.needsApproval && data.approvalType === 'ERC20_TO_PERMIT2') {
        const approvalTokenAddress = data.approvalTokenAddress as Address;
        const isToken0 = approvalTokenAddress.toLowerCase() === token0Config.address.toLowerCase();

        // Build approval transaction request
        const approvalTxRequest: ValidatedTransactionRequest = {
          to: approvalTokenAddress,
          data: buildApprovalData(PERMIT2_ADDRESS),
          value: 0n,
          chainId,
        };

        // Build context with approval step
        const context = buildLiquidityTxContext({
          type: LiquidityTransactionType.Increase,
          apiResponse: { needsApproval: true } as MintTxApiResponse,
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
          amount0: parseUnits(amount0 || "0", token0Config.decimals).toString(),
          amount1: parseUnits(amount1 || "0", token1Config.decimals).toString(),
          chainId,
          approveToken0Request: isToken0 ? approvalTxRequest : undefined,
          approveToken1Request: !isToken0 ? approvalTxRequest : undefined,
          increasePositionRequestArgs,
        });

        setTxContext(context as ValidatedLiquidityTxContext);
        setIsLoading(false);
        return context as ValidatedLiquidityTxContext;
      }

      // Handle Permit2 signature needed
      if (data.needsApproval && data.approvalType === 'PERMIT2_BATCH_SIGNATURE') {
        const permitData = data.permitBatchData;
        const sigDetails = data.signatureDetails;

        // Build permit step fields
        const permit: SignTypedDataStepFields = {
          domain: {
            name: sigDetails.domain.name,
            chainId: sigDetails.domain.chainId,
            verifyingContract: sigDetails.domain.verifyingContract as Address,
          },
          types: sigDetails.types,
          values: permitData.values || permitData,
        };

        // Include permitBatchData in request args so async step can send it with signature
        const increasePositionRequestArgsWithPermit = {
          ...increasePositionRequestArgs,
          permitBatchData: permitData.values || permitData,
        };

        // Build unsigned context with permit and request args for async step
        const context = buildLiquidityTxContext({
          type: LiquidityTransactionType.Increase,
          apiResponse: {
            needsApproval: true,
            permitBatchData: permitData,
            signatureDetails: sigDetails,
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
          amount0: parseUnits(amount0 || "0", token0Config.decimals).toString(),
          amount1: parseUnits(amount1 || "0", token1Config.decimals).toString(),
          chainId,
          permit,
          increasePositionRequestArgs: increasePositionRequestArgsWithPermit,
        });

        setTxContext(context as ValidatedLiquidityTxContext);
        setIsLoading(false);
        return context as ValidatedLiquidityTxContext;
      }

      // Transaction ready - all approvals done
      if (!data.needsApproval && data.create) {
        const context = buildLiquidityTxContext({
          type: LiquidityTransactionType.Increase,
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
          increasePositionRequestArgs,
        });

        setTxContext(context as ValidatedLiquidityTxContext);
        setIsLoading(false);
        return context as ValidatedLiquidityTxContext;
      }

      throw new Error("Unexpected API response");
    } catch (err: any) {
      console.error("[IncreaseLiquidityTxContext] fetchAndBuildContext error:", err);
      setError(err.message || "Failed to prepare transaction");
      setIsLoading(false);
      return null;
    }
  }, [accountAddress, chainId, position, derivedIncreaseLiquidityInfo.formattedAmounts, tokenDefinitions, parseTokenId]);

  const refetchBalances = useCallback(() => {
    refetchToken0Balance();
    refetchToken1Balance();
  }, [refetchToken0Balance, refetchToken1Balance]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

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

/**
 * Helper to build ERC20 approve calldata
 */
function buildApprovalData(spender: Address): `0x${string}` {
  // approve(address spender, uint256 amount)
  // Function selector: 0x095ea7b3
  const selector = "0x095ea7b3";
  const paddedSpender = spender.slice(2).padStart(64, '0');
  const paddedAmount = maxUint256.toString(16).padStart(64, '0');
  return `${selector}${paddedSpender}${paddedAmount}` as `0x${string}`;
}
