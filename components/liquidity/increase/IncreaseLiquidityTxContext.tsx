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
import { parseUnits, type Address } from "viem";
import { getTokenDefinitions, getPoolById, type TokenSymbol } from "@/lib/pools-config";
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

// Shared approval utilities
import { buildApprovalRequests, buildApprovalCalldata } from "@/lib/liquidity/hooks/approval";

// Unified Yield deposit hook for ReHypothecation positions
import { useUnifiedYieldDeposit } from "@/lib/liquidity/unified-yield/hooks/useUnifiedYieldDeposit";
import { useUnifiedYieldApprovals } from "@/lib/liquidity/unified-yield/useUnifiedYieldApprovals";
import { buildUnifiedYieldDepositTx, buildDepositParamsFromPreview } from "@/lib/liquidity/unified-yield/buildUnifiedYieldDepositTx";
import type { DepositPreviewResult, UnifiedYieldApprovalStatus } from "@/lib/liquidity/unified-yield/types";

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

  // Unified Yield approval status (for checking if approvals needed)
  unifiedYieldApprovalStatus: UnifiedYieldApprovalStatus | null;
  isCheckingApprovals: boolean;
  refetchApprovals: (overrideAmounts?: { amount0Wei: bigint; amount1Wei: bigint }) => Promise<UnifiedYieldApprovalStatus | null>;
}

const IncreaseLiquidityTxContext = createContext<IncreaseLiquidityTxContextType | null>(null);

export function IncreaseLiquidityTxContextProvider({ children }: PropsWithChildren) {
  const { address: accountAddress } = useAccount();
  const { chainId, networkMode } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const { increaseLiquidityState, derivedIncreaseLiquidityInfo, setDerivedInfo, setAmount0, setAmount1, isUnifiedYield } = useIncreaseLiquidityContext();
  const { position, exactField } = increaseLiquidityState;

  // Get pool config for Unified Yield (hook address)
  const poolConfig = useMemo(() => {
    return position.poolId ? getPoolById(position.poolId, networkMode) : null;
  }, [position.poolId, networkMode]);

  // Unified Yield deposit hook - only active for ReHypothecation positions
  const unifiedYieldDeposit = useUnifiedYieldDeposit({
    hookAddress: poolConfig?.hooks as Address | undefined,
    token0Address: tokenDefinitions[position.token0.symbol as TokenSymbol]?.address as Address | undefined,
    token1Address: tokenDefinitions[position.token1.symbol as TokenSymbol]?.address as Address | undefined,
    token0Decimals: tokenDefinitions[position.token0.symbol as TokenSymbol]?.decimals ?? 18,
    token1Decimals: tokenDefinitions[position.token1.symbol as TokenSymbol]?.decimals ?? 18,
    poolId: position.poolId,
    chainId,
  });

  // Unified Yield approval checking hook - uses preview from deposit hook
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

  // Dependent amount calculation - V4 uses liquidity math, UY uses Hook preview
  const v4DerivedInfo = useDerivedIncreaseInfo({
    position,
    chainId,
    currentPoolTick: null,
    networkMode
  });

  // Calculate dependent amount - wraps V4 or UY logic based on position type
  const calculateDependentAmount = useCallback(async (
    inputAmount: string,
    inputSide: "amount0" | "amount1"
  ) => {
    if (isUnifiedYield && poolConfig?.hooks) {
      // Unified Yield: Use Hook preview (stores result in unifiedYieldDeposit.lastPreview)
      const hookInputSide = inputSide === "amount0" ? "token0" : "token1";
      const inputDecimals = inputSide === "amount0"
        ? (tokenDefinitions[position.token0.symbol as TokenSymbol]?.decimals ?? 18)
        : (tokenDefinitions[position.token1.symbol as TokenSymbol]?.decimals ?? 18);
      await unifiedYieldDeposit.getPreview(inputAmount, hookInputSide, inputDecimals);
    } else {
      // V4: Use standard liquidity math calculation
      v4DerivedInfo.calculateDependentAmount(inputAmount, inputSide);
    }
  }, [isUnifiedYield, poolConfig?.hooks, tokenDefinitions, position, unifiedYieldDeposit, v4DerivedInfo]);

  // Derive values from the appropriate source
  const uyPreview = unifiedYieldDeposit.lastPreview;
  const isCalculating = isUnifiedYield ? false : v4DerivedInfo.isCalculating; // UY preview is sync from hook
  const dependentAmount = isUnifiedYield
    ? (uyPreview?.inputSide === 'token0' ? uyPreview?.amount1Formatted : uyPreview?.amount0Formatted) ?? null
    : v4DerivedInfo.dependentAmount;
  const dependentField = isUnifiedYield
    ? (uyPreview?.inputSide === 'token0' ? 'amount1' : uyPreview?.inputSide === 'token1' ? 'amount0' : null)
    : v4DerivedInfo.dependentField;

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

    // =========================================================================
    // UNIFIED YIELD POSITIONS - Build context with deposit tx (no API call)
    // =========================================================================
    // For Unified Yield, we MUST have poolConfig and hooks - don't fall through to V4
    if (isUnifiedYield) {
      if (!poolConfig?.hooks) {
        console.error('[IncreaseLiquidityTxContext] Unified Yield mode but pool.hooks is missing');
        setError("Pool hook address not configured for Unified Yield");
        setIsLoading(false);
        return null;
      }
    }

    if (isUnifiedYield && poolConfig?.hooks) {
      try {
        const hookAddress = poolConfig.hooks as Address;

        // Use the preview from the deposit hook (same preview used for display)
        const preview = unifiedYieldDeposit.lastPreview;
        if (!preview || preview.shares === 0n) {
          setError("Please enter an amount first");
          setIsLoading(false);
          return null;
        }

        // Check approvals with preview amounts
        const approvalCheck = await refetchApprovals({ amount0Wei: preview.amount0, amount1Wei: preview.amount1 });

        // Build approval txRequests if needed
        let approveToken0Request: ValidatedTransactionRequest | undefined;
        let approveToken1Request: ValidatedTransactionRequest | undefined;

        if (approvalCheck?.token0NeedsApproval) {
          approveToken0Request = {
            to: token0Config.address as Address,
            data: buildApprovalCalldata(hookAddress, preview.amount0),
            value: 0n,
            chainId,
          };
        }
        if (approvalCheck?.token1NeedsApproval) {
          approveToken1Request = {
            to: token1Config.address as Address,
            data: buildApprovalCalldata(hookAddress, preview.amount1),
            value: 0n,
            chainId,
          };
        }

        // Build deposit params from preview
        const depositParams = buildDepositParamsFromPreview(
          preview,
          hookAddress,
          token0Config.address as Address,
          token1Config.address as Address,
          accountAddress,
          position.poolId,
          chainId
        );

        // Build deposit transaction
        const depositTx = buildUnifiedYieldDepositTx(depositParams);

        // Build context with UY-specific fields
        const context = buildLiquidityTxContext({
          type: LiquidityTransactionType.Increase,
          apiResponse: {
            needsApproval: false,
            create: {
              to: depositTx.to,
              data: depositTx.calldata,
              value: depositTx.value?.toString() || "0",
              gasLimit: depositTx.gasLimit?.toString(),
              chainId,
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
          amount0: preview.amount0.toString(),
          amount1: preview.amount1.toString(),
          chainId,
          approveToken0Request,
          approveToken1Request,
          // Unified Yield specific fields
          isUnifiedYield: true,
          hookAddress,
          poolId: position.poolId,
          sharesToMint: preview.shares,
        });

        setTxContext(context as ValidatedLiquidityTxContext);
        setIsLoading(false);
        return context as ValidatedLiquidityTxContext;
      } catch (err: any) {
        console.error("[IncreaseLiquidityTxContext] Unified Yield context error:", err);
        setError(err.message || "Failed to prepare Unified Yield deposit");
        setIsLoading(false);
        return null;
      }
    }

    // =========================================================================
    // V4 POSITIONS - Call API to build transaction
    // =========================================================================
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

      // Handle ERC20 approval needed (API now includes permit data for complete step generation)
      if (data.needsApproval && data.approvalType === 'ERC20_TO_PERMIT2') {
        const approvalTokenAddress = data.approvalTokenAddress as Address;
        const isToken0 = approvalTokenAddress.toLowerCase() === token0Config.address.toLowerCase();

        // Build approval transaction request using shared modular helper
        // Respects user's approval mode setting (exact vs infinite)
        const rawAmount0 = parseUnits(amount0 || "0", token0Config.decimals);
        const rawAmount1 = parseUnits(amount1 || "0", token1Config.decimals);
        const approvals = buildApprovalRequests({
          needsToken0: isToken0,
          needsToken1: !isToken0,
          token0Address: token0Config.address as Address,
          token1Address: token1Config.address as Address,
          spender: PERMIT2_ADDRESS,
          amount0: rawAmount0,
          amount1: rawAmount1,
          chainId,
        });

        // Build permit step fields from API response (API now includes this with ERC20_TO_PERMIT2)
        const permitData = data.permitBatchData;
        const sigDetails = data.signatureDetails;
        let permit: SignTypedDataStepFields | undefined;

        if (permitData?.values && sigDetails?.domain) {
          permit = {
            domain: {
              name: sigDetails.domain.name,
              chainId: sigDetails.domain.chainId,
              verifyingContract: sigDetails.domain.verifyingContract as Address,
            },
            types: sigDetails.types,
            values: permitData.values || permitData,
          };
        }

        // Include permitBatchData in request args so async step can send it with signature
        const increasePositionRequestArgsWithPermit = permit ? {
          ...increasePositionRequestArgs,
          permitBatchData: permitData.values || permitData,
        } : increasePositionRequestArgs;

        // Build context with approval step AND permit data for complete step generation
        // The step generator will create: [approval] -> [permit signature] -> [async position tx]
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
          amount0: rawAmount0.toString(),
          amount1: rawAmount1.toString(),
          chainId,
          approveToken0Request: approvals.token0,
          approveToken1Request: approvals.token1,
          permit,
          increasePositionRequestArgs: increasePositionRequestArgsWithPermit,
        });

        setTxContext(context as ValidatedLiquidityTxContext);
        setIsLoading(false);
        return context as ValidatedLiquidityTxContext;
      }

      // Log full API response for debugging
      console.log('[IncreaseLiquidityTxContext] API response:', {
        needsApproval: data.needsApproval,
        approvalType: data.approvalType,
        hasCreate: !!data.create,
        hasPermitBatchData: !!data.permitBatchData,
        hasSignatureDetails: !!data.signatureDetails,
        fullData: data,
      });

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
        console.log('[IncreaseLiquidityTxContext] Building context with:', {
          needsApproval: data.needsApproval,
          hasCreate: !!data.create,
          create: data.create,
          token0Address: token0Config.address,
          token1Address: token1Config.address,
          amount0: data.details?.token0?.amount,
          amount1: data.details?.token1?.amount,
        });

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

        console.log('[IncreaseLiquidityTxContext] Built context:', {
          type: context.type,
          hasAction: !!context.action,
          hasTxRequest: !!(context as any).txRequest,
          unsigned: (context as any).unsigned,
          txRequest: (context as any).txRequest,
        });

        setTxContext(context as ValidatedLiquidityTxContext);
        setIsLoading(false);
        return context as ValidatedLiquidityTxContext;
      }

      console.log('[IncreaseLiquidityTxContext] Unexpected API response:', data);
      throw new Error("Unexpected API response");
    } catch (err: any) {
      console.error("[IncreaseLiquidityTxContext] fetchAndBuildContext error:", err);
      setError(err.message || "Failed to prepare transaction");
      setIsLoading(false);
      return null;
    }
  }, [accountAddress, chainId, position, derivedIncreaseLiquidityInfo.formattedAmounts, tokenDefinitions, parseTokenId, isUnifiedYield, poolConfig, unifiedYieldDeposit, refetchApprovals]);

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
    // Unified Yield approval status (for checking if approvals needed)
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

