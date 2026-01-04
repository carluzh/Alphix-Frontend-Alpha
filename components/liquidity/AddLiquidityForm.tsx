"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Plus, BadgeCheck, Maximize, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useAccount, useBalance } from "wagmi";
import { toast } from "sonner";
import { usePercentageInput } from "@/hooks/usePercentageInput";
import { V4_POOL_FEE, V4_POOL_TICK_SPACING, V4_POOL_HOOKS } from "@/lib/swap-constants";
import { getStoredDeadlineSeconds } from "@/hooks/useUserSettings";
import { getTokenDefinitions, TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { getPoolById, getToken } from "@/lib/pools-config";
import { getAddress } from "viem";

import { safeParseUnits } from "@/lib/liquidity/utils/parsing/amountParsing";
import { getAddableTokens, calculateTicksFromPercentage } from "@/lib/liquidity/utils/calculations";
import { useMintState, useMintActionHandlers } from "@/lib/liquidity/state";
import { PositionField } from "@/lib/liquidity/types";
import { useAddLiquidityTransaction, useAddLiquidityCalculation, usePositionAPR } from "@/lib/liquidity/hooks";
import { useRangeDisplay } from "./hooks/useRangeDisplay";
import { useZapQuote } from "./hooks/useZapQuote";
import { motion } from "framer-motion";
import { useBalanceWiggle } from "./hooks/useBalanceWiggle";
import { RangeSelectionModalV2 } from "./range-selection/RangeSelectionModalV2";
import { TokenAmountInput } from "./TokenAmountInput";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TransactionFlowPanel } from "./TransactionFlowPanel";
import { SlippageControl } from "@/components/settings/SlippageControl";
import { useUserSlippageTolerance } from "@/hooks/useSlippage";
import { showErrorToast as baseShowErrorToast, showInfoToast as baseShowInfoToast } from "@/lib/ui/toasts";

// Wrapper functions to maintain existing call signature
const showErrorToast = (title: string, description?: string, action?: { label: string; onClick: () => void }) => {
  baseShowErrorToast(title, { description, action });
};

const showInfoToast = (title: string) => {
  baseShowInfoToast(title);
};

import { Token } from '@uniswap/sdk-core';
import { useTokenUSDPrice } from "@/hooks/useTokenUSDPrice";
import { getOptimalBaseToken, convertTickToPrice as convertTickToPriceUtil } from "@/lib/denomination-utils";

export interface AddLiquidityFormProps {
  onLiquidityAdded: (token0Symbol?: string, token1Symbol?: string) => void;
  selectedPoolId?: string;
  sdkMinTick: number;
  sdkMaxTick: number;
  defaultTickSpacing: number;
  activeTab: 'deposit' | 'withdraw' | 'swap';
  initialTickLower?: number;
  initialTickUpper?: number;
  initialToken0Amount?: string;
  onRangeChange?: (rangeInfo: { preset: string | null; label: string; estimatedApr: string; hasUserInteracted: boolean; isCalculating: boolean }) => void;
  poolState?: { currentPrice: string; currentPoolTick: number; sqrtPriceX96: string; liquidity?: string };
}

export function AddLiquidityForm({
  onLiquidityAdded,
  selectedPoolId,
  sdkMinTick,
  sdkMaxTick,
  defaultTickSpacing,
  activeTab,
  initialTickLower,
  initialTickUpper,
  initialToken0Amount,
  onRangeChange,
  poolState,
}: AddLiquidityFormProps) {
  // Basic state management - initialize tokens based on selected pool
  const getInitialTokens = () => {
    if (selectedPoolId) {
      const poolConfig = getPoolById(selectedPoolId);
      if (poolConfig) {
        return {
          token0: poolConfig.currency0.symbol as TokenSymbol,
          token1: poolConfig.currency1.symbol as TokenSymbol
        };
      }
    }
    // Default fallback
    return { token0: 'aUSDC' as TokenSymbol, token1: 'aUSDT' as TokenSymbol };
  };

  const initialTokens = getInitialTokens();
  const isStablePool = useMemo(() => {
    if (!selectedPoolId) return false;
    const poolCfg = getPoolById(selectedPoolId);
    return (poolCfg?.type || '').toLowerCase() === 'stable';
  }, [selectedPoolId]);
  const presetOptions = useMemo(() => {
    return isStablePool ? ["±1%", "±0.5%", "±0.1%", "Full Range"] : ["Full Range", "±15%", "±8%", "±3%"]; 
  }, [isStablePool]);
  const [token0Symbol, setToken0Symbol] = useState<TokenSymbol>(initialTokens.token0);
  const [token1Symbol, setToken1Symbol] = useState<TokenSymbol>(initialTokens.token1);
  const [amount0, setAmount0] = useState<string>("");
  const [amount1, setAmount1] = useState<string>("");

  // Use Zustand store for range and full precision state (Uniswap pattern)
  const mintState = useMintState();
  const { onLeftRangeInput, onRightRangeInput, onSetFullRange, onSetFullPrecision, onResetMintState } = useMintActionHandlers();

  // Derived from store - tick range
  const tickLower = mintState.leftRangeTypedValue;
  const tickUpper = mintState.rightRangeTypedValue;
  const setTickLower = onLeftRangeInput;
  const setTickUpper = onRightRangeInput;

  // Derived from store - full precision amounts
  const amount0FullPrecision = mintState.fullPrecisionValue0;
  const amount1FullPrecision = mintState.fullPrecisionValue1;
  const setAmount0FullPrecision = (value: string) => onSetFullPrecision(PositionField.TOKEN0, value);
  const setAmount1FullPrecision = (value: string) => onSetFullPrecision(PositionField.TOKEN1, value);

  // Consolidated reset for amounts - reduces duplicate code
  const resetAmounts = useCallback(() => {
    setAmount0("");
    setAmount1("");
    onSetFullPrecision(PositionField.TOKEN0, "");
    onSetFullPrecision(PositionField.TOKEN1, "");
  }, [onSetFullPrecision]);

  const [currentPoolTick, setCurrentPoolTick] = useState<number | null>(null);
  const [activeInputSide, setActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isAmount0Focused, setIsAmount0Focused] = useState(false);
  const [isAmount1Focused, setIsAmount1Focused] = useState(false);

  // OOR input field restrictions
  const [canAddToken0, setCanAddToken0] = useState(true);
  const [canAddToken1, setCanAddToken1] = useState(true);

  // Price and range state
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);
  const [currentPoolSqrtPriceX96, setCurrentPoolSqrtPriceX96] = useState<string | null>(null);
  
  // UI state
  const [isInsufficientBalance, setIsInsufficientBalance] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [isPoolStateLoading, setIsPoolStateLoading] = useState<boolean>(false);
  const [initialDefaultApplied, setInitialDefaultApplied] = useState(false);
  const [baseTokenForPriceDisplay, setBaseTokenForPriceDisplay] = useState<TokenSymbol>(() =>
    getOptimalBaseToken(initialTokens.token0, initialTokens.token1));
  const [hasUserInteracted, setHasUserInteracted] = useState(false);

  // Helper to convert internal preset values to display labels
  const getPresetDisplayLabel = useCallback((preset: string | null, isStable: boolean): string => {
    if (!preset) return "Select Range";
    if (preset === "Full Range") return "Full Range";
    // Volatile pools: ±15% = Wide, ±3% = Narrow
    // Stable pools: ±3% = Wide, ±0.5% = Narrow
    if (isStable) {
      if (preset === "±3%" || preset === "±1%") return "Wide";
      if (preset === "±0.5%" || preset === "±0.1%") return "Narrow";
    } else {
      if (preset === "±15%") return "Wide";
      if (preset === "±8%") return "Wide";
      if (preset === "±3%") return "Narrow";
    }
    return "Custom";
  }, []);

  // Zap mode state
  const [isZapMode, setIsZapMode] = useState(false);
  const [zapInputToken, setZapInputToken] = useState<'token0' | 'token1'>('token0');

  // UI flow management
  const [showingTransactionSteps, setShowingTransactionSteps] = useState(false);
  const [showRangeModal, setShowRangeModal] = useState(false);
  const [modalInitialFocusField, setModalInitialFocusField] = useState<'min' | 'max' | null>(null);

  // Chart state
  const [xDomain, setXDomain] = useState<[number, number]>([-120000, 120000]);

  // Wiggle animation for balance exceeded - uses shared hook
  const { controls: balanceWiggleControls0, triggerWiggle: triggerWiggle0 } = useBalanceWiggle();
  const { controls: balanceWiggleControls1, triggerWiggle: triggerWiggle1 } = useBalanceWiggle();

  const { address: accountAddress, chainId, isConnected } = useAccount();
  const { networkMode, chainId: targetChainId } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  // Calculation hook - handles debounced amount calculation (replaces inline debouncedCalculateAmountAndCheckApprovals)
  const {
    calculate: triggerCalculation,
    calculatedData,
    isCalculating,
    error: calculationError,
    dependentAmount,
    dependentAmountFullPrecision,
    dependentField,
    reset: resetCalculation,
  } = useAddLiquidityCalculation({
    token0Symbol,
    token1Symbol,
    chainId,
  });

  // Sync dependent amount from calculation hook to UI state
  useEffect(() => {
    if (!dependentField || !dependentAmount) return;

    if (dependentField === 'amount1') {
      setAmount1(dependentAmount);
      setAmount1FullPrecision(dependentAmountFullPrecision);
    } else if (dependentField === 'amount0') {
      setAmount0(dependentAmount);
      setAmount0FullPrecision(dependentAmountFullPrecision);
    }
  }, [dependentField, dependentAmount, dependentAmountFullPrecision]);

  // Sync pool state from calculation results
  useEffect(() => {
    if (!calculatedData) return;

    if (typeof calculatedData.currentPoolTick === 'number') {
      setCurrentPoolTick(calculatedData.currentPoolTick);
    }
    if (calculatedData.currentPrice) {
      setCurrentPrice(calculatedData.currentPrice);
    }
  }, [calculatedData]);

  // Show toast on calculation error
  useEffect(() => {
    if (calculationError) {
      showInfoToast(calculationError);
    }
  }, [calculationError]);

  // Get USD prices using mid-price quotes (replaces CoinGecko/useAllPrices)
  const token0USDPrice = useTokenUSDPrice(token0Symbol);
  const token1USDPrice = useTokenUSDPrice(token1Symbol);

  // Slippage tolerance hook (for zap mode)
  const {
    currentSlippage,
    isAuto: isAutoSlippage,
    autoSlippage: autoSlippageValue,
    setSlippage,
    setAutoMode,
    setCustomMode,
    updateAutoSlippage,
  } = useUserSlippageTolerance();

  // Convert slippage percentage to basis points for API calls
  const zapSlippageToleranceBps = useMemo(() => {
    return Math.round(currentSlippage * 100); // Convert percentage to basis points (e.g., 0.5% -> 50 bps)
  }, [currentSlippage]);

  // Zap quote hook - handles zap quote fetching and price impact calculation
  const {
    zapQuote,
    priceImpact,
    isPreparingZap,
    fetchZapQuote,
    resetZapState,
    setPriceImpact,
    setZapQuote,
  } = useZapQuote({
    token0Symbol,
    token1Symbol,
    chainId,
    zapSlippageToleranceBps,
    updateAutoSlippage,
  });

  // Price impact warning thresholds (matching Uniswap)
  const PRICE_IMPACT_MEDIUM = 3; // 3%
  const PRICE_IMPACT_HIGH = 5; // 5%

  const priceImpactWarning = useMemo(() => {
    // Only show warning in zap mode
    if (!isZapMode) {
      return null;
    }

    // Get price impact from state or zapQuote as fallback
    const currentPriceImpact = priceImpact !== null
      ? priceImpact
      : (zapQuote?.priceImpact ? parseFloat(zapQuote.priceImpact) : null);

    if (currentPriceImpact === null || isNaN(currentPriceImpact)) {
      return null;
    }

    if (currentPriceImpact >= PRICE_IMPACT_HIGH) {
      return { severity: 'high' as const, message: `Very high price impact: ${currentPriceImpact.toFixed(2)}%` };
    }
    if (currentPriceImpact >= PRICE_IMPACT_MEDIUM) {
      return { severity: 'medium' as const, message: `High price impact: ${currentPriceImpact.toFixed(2)}%` };
    }
    return null;
  }, [priceImpact, zapQuote?.priceImpact, isZapMode]);

  // Map any token symbol to USD price using the new hook
  const getUSDPriceForSymbol = useCallback((symbol?: string): number => {
    if (!symbol) return 0;
    // Use the appropriate hook based on symbol
    if (symbol === token0Symbol) {
      return token0USDPrice.price ?? 0;
    }
    if (symbol === token1Symbol) {
      return token1USDPrice.price ?? 0;
    }
    return 0;
  }, [token0Symbol, token1Symbol, token0USDPrice.price, token1USDPrice.price]);

  // Track previous calculation dependencies
  const prevCalculationDeps = useRef({
    amount0,
    amount1,
    tickLower,
    tickUpper,
    activeInputSide,
    zapSlippageToleranceBps: zapSlippageToleranceBps
  });

  const userDeadlineSeconds = getStoredDeadlineSeconds();

  // Use the same transaction hook for both regular and zap modes
  const regularTransaction = useAddLiquidityTransaction({
    token0Symbol,
    token1Symbol,
    amount0,
    amount1,
    tickLower,
    tickUpper,
    activeInputSide,
    calculatedData,
    onLiquidityAdded,
    onOpenChange: setShowingTransactionSteps,
    isZapMode,
    zapInputToken,
    zapSlippageToleranceBps: isZapMode ? zapSlippageToleranceBps : undefined,
    deadlineSeconds: userDeadlineSeconds,
  });

  // For zap mode, just use the regular transaction hook
  // It already handles zap mode internally
  const zapTransaction = regularTransaction;

  // Use appropriate hook based on zap mode
  const {
    approvalData,
    isCheckingApprovals,
    isWorking,
    isDepositSuccess,
    handleApprove,
    handleDeposit,
    refetchApprovals,
    reset: resetTransaction,
  } = isZapMode ? {
    approvalData: zapTransaction.approvalData,
    isCheckingApprovals: zapTransaction.isCheckingApprovals,
    isWorking: zapTransaction.isWorking,
    isDepositSuccess: zapTransaction.isDepositSuccess,
    handleApprove: zapTransaction.handleApprove,
    handleDeposit: async () => {},
    refetchApprovals: zapTransaction.refetchApprovals,
    reset: zapTransaction.reset,
  } : regularTransaction;

  // Balance hooks with refetch
  const { data: token0BalanceData, isLoading: isLoadingToken0Balance, refetch: refetchToken0Balance } = useBalance({
    address: accountAddress,
    token: tokenDefinitions[token0Symbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined : tokenDefinitions[token0Symbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!tokenDefinitions[token0Symbol] },
  });

  const { data: token1BalanceData, isLoading: isLoadingToken1Balance, refetch: refetchToken1Balance } = useBalance({
    address: accountAddress,
    token: tokenDefinitions[token1Symbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined : tokenDefinitions[token1Symbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!tokenDefinitions[token1Symbol] },
  });

  // Percentage input handlers using the new shared hook
  // Wrapper to update both display and full precision states
  const setAmount0WithPrecision = useCallback((value: string) => {
    setAmount0(value);
    setAmount0FullPrecision(value);
  }, []);

  const setAmount1WithPrecision = useCallback((value: string) => {
    setAmount1(value);
    setAmount1FullPrecision(value);
  }, []);

  const handleToken0Percentage = usePercentageInput(
    token0BalanceData,
    { decimals: tokenDefinitions[token0Symbol]?.decimals || 18, symbol: token0Symbol },
    setAmount0WithPrecision
  );

  const handleToken1Percentage = usePercentageInput(
    token1BalanceData,
    { decimals: tokenDefinitions[token1Symbol]?.decimals || 18, symbol: token1Symbol },
    setAmount1WithPrecision
  );

  // Derived pool tokens (for labels/formatting)
  const { poolToken0, poolToken1 } = useMemo(() => {
    if (!token0Symbol || !token1Symbol || !chainId) return { poolToken0: null, poolToken1: null };
      const currentToken0Def = tokenDefinitions[token0Symbol];
  const currentToken1Def = tokenDefinitions[token1Symbol]; 
    if (!currentToken0Def || !currentToken1Def) return { poolToken0: null, poolToken1: null };

    // Create SDK Token instances using the modal's currently selected token0Symbol and token1Symbol
    const sdkBaseToken0 = new Token(chainId, getAddress(currentToken0Def.address), currentToken0Def.decimals, currentToken0Def.symbol);
    const sdkBaseToken1 = new Token(chainId, getAddress(currentToken1Def.address), currentToken1Def.decimals, currentToken1Def.symbol);

    // Sort them to get the canonical poolToken0 and poolToken1
    const [pt0, pt1] = sdkBaseToken0.sortsBefore(sdkBaseToken1)
      ? [sdkBaseToken0, sdkBaseToken1]
      : [sdkBaseToken1, sdkBaseToken0];
    return { poolToken0: pt0, poolToken1: pt1 };
  }, [token0Symbol, token1Symbol, chainId]);

  // Listen for balance refresh events
  useEffect(() => {
    if (!accountAddress) return;
    const onRefresh = () => { refetchToken0Balance(); refetchToken1Balance(); };
    const onStorage = (e: StorageEvent) => {
      if (e.key === `walletBalancesRefreshAt_${accountAddress}`) onRefresh();
    };
    window.addEventListener('walletBalancesRefresh', onRefresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('walletBalancesRefresh', onRefresh);
      window.removeEventListener('storage', onStorage);
    };
  }, [accountAddress, refetchToken0Balance, refetchToken1Balance]);

  // Determine if prices should be inverted based on baseTokenForPriceDisplay
  const isInverted = useMemo(() =>
    baseTokenForPriceDisplay === token0Symbol, [baseTokenForPriceDisplay, token0Symbol]);

  // Keep denomination aligned with optimal base
  useEffect(() => {
    const priceNum = currentPrice ? parseFloat(currentPrice) : undefined;
    const desiredBase = getOptimalBaseToken(token0Symbol, token1Symbol, priceNum);
    if (desiredBase && desiredBase !== baseTokenForPriceDisplay) {
      setBaseTokenForPriceDisplay(desiredBase);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token0Symbol, token1Symbol, currentPrice]);

  // Setup tokens based on selectedPoolId
  useEffect(() => {
    if (selectedPoolId) {
      // Get pool configuration from pools.json
      const poolConfig = getPoolById(selectedPoolId);
      if (poolConfig) {
        const token0Config = getToken(poolConfig.currency0.symbol);
        const token1Config = getToken(poolConfig.currency1.symbol);
        
        if (token0Config && token1Config) {
          const t0 = token0Config.symbol as TokenSymbol;
          const t1 = token1Config.symbol as TokenSymbol;
          
          setToken0Symbol(t0);
          setToken1Symbol(t1);
        setAmount0("");
        setAmount1("");
        setAmount0FullPrecision("");
        setAmount1FullPrecision("");
          resetZapState(); // Reset zap state when tokens change
          setTickLower(sdkMinTick.toString());
          setTickUpper(sdkMaxTick.toString());
          setCurrentPoolTick(null);
          resetCalculation();
          setActiveInputSide(null);
          setCurrentPrice(null);
          setInitialDefaultApplied(false);
          setActivePreset(null); // No default preset - user must select
          setBaseTokenForPriceDisplay(t0); // Reset base token for price display
          setHasUserInteracted(false); // Reset interaction state on pool change
        }
      }
    }
  }, [selectedPoolId, sdkMinTick, sdkMaxTick, isStablePool]);

  // Apply initial parameters from position copying
  useEffect(() => {
    if (initialTickLower !== undefined && initialTickUpper !== undefined) {
      setTickLower(initialTickLower.toString());
      setTickUpper(initialTickUpper.toString());
      setActivePreset(null); // Clear preset when copying parameters
      setInitialDefaultApplied(true);
    }
    if (initialToken0Amount !== undefined) {
      setAmount0(initialToken0Amount);
      setActiveInputSide('amount0');
    }
  }, [initialTickLower, initialTickUpper, initialToken0Amount]);

  // OOR detection - uses shared utility
  useEffect(() => {
    const tl = parseInt(tickLower);
    const tu = parseInt(tickUpper);
    if (currentPoolTick === null || isNaN(tl) || isNaN(tu)) {
      setCanAddToken0(true);
      setCanAddToken1(true);
      return;
    }
    const { canAddToken0: canAdd0, canAddToken1: canAdd1 } = getAddableTokens(currentPoolTick, tl, tu);
    setCanAddToken0(canAdd0);
    setCanAddToken1(canAdd1);
    // Clear amounts for disabled tokens
    if (!canAdd0 && parseFloat(amount0 || '0') > 0) {
      setAmount0('');
      setAmount0FullPrecision('');
    }
    if (!canAdd1 && parseFloat(amount1 || '0') > 0) {
      setAmount1('');
      setAmount1FullPrecision('');
    }
  }, [tickLower, tickUpper, currentPoolTick]);

  // Reset state when tokens change
  useEffect(() => {
    setInitialDefaultApplied(false);
    onSetFullRange(sdkMinTick.toString(), sdkMaxTick.toString());
    resetAmounts();
    resetCalculation();
    setCurrentPoolTick(null);
    setCurrentPrice(null);
    setActivePreset(null);
    setBaseTokenForPriceDisplay(token0Symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token0Symbol, token1Symbol, chainId, sdkMinTick, sdkMaxTick, isStablePool]);

  // Fetch initial pool state - uses prop if provided, otherwise fetches from API
  useEffect(() => {
    const applyPoolState = (data: { currentPrice: string; currentPoolTick: number; sqrtPriceX96?: string }) => {
      setCurrentPrice(data.currentPrice);
      setCurrentPoolTick(data.currentPoolTick);
      setCurrentPoolSqrtPriceX96(data.sqrtPriceX96?.toString() || null);

      const price = parseFloat(data.currentPrice);
      if (!isNaN(price)) {
        const percentageRange = isStablePool ? 0.05 : 0.20;
        const tickRange = Math.round(Math.log(1 + percentageRange) / Math.log(1.0001));
        setXDomain([data.currentPoolTick - tickRange, data.currentPoolTick + tickRange]);
      }
    };

    if (poolState?.currentPrice && typeof poolState?.currentPoolTick === 'number') {
      setIsPoolStateLoading(false);
      applyPoolState(poolState);
      return;
    }

    const fetchFromApi = async () => {
      if (!selectedPoolId || !chainId) return;
      setIsPoolStateLoading(true);
      try {
        const poolIdParam = getPoolById(selectedPoolId)?.subgraphId || selectedPoolId;
        const response = await fetch(`/api/liquidity/get-pool-state?poolId=${encodeURIComponent(poolIdParam)}`);
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to fetch pool state.");
        }
        const data = await response.json();
        if (data.currentPrice && typeof data.currentPoolTick === 'number') {
          applyPoolState(data);
        } else {
          throw new Error("Pool state data is incomplete.");
        }
      } catch (error: any) {
        showErrorToast("Pool Data Error", error.message);
        setCurrentPoolSqrtPriceX96(null);
      } finally {
        setIsPoolStateLoading(false);
      }
    };

    if (selectedPoolId) fetchFromApi();
  }, [selectedPoolId, chainId, poolState, isStablePool]);

  // Handle selecting a preset from dropdown
  const handleSelectPreset = (preset: string) => {
    resetTransaction();
    setActivePreset(preset);
    setHasUserInteracted(true);

    if (preset === "Full Range") {
      setTickLower(sdkMinTick.toString());
      setTickUpper(sdkMaxTick.toString());
      setInitialDefaultApplied(true);
      if (currentPoolTick !== null) {
        const widePct = isStablePool ? 0.03 : 0.15;
        const tickDelta = Math.round(Math.log(1 + widePct) / Math.log(1.0001));
        const viewportLower = Math.floor((currentPoolTick - tickDelta) / defaultTickSpacing) * defaultTickSpacing;
        const viewportUpper = Math.ceil((currentPoolTick + tickDelta) / defaultTickSpacing) * defaultTickSpacing;
        resetChartViewbox(viewportLower, viewportUpper, 1/3, 1/3);
      }
    } else {
      setInitialDefaultApplied(true);
    }
  };

  // Reset chart viewbox to fit the chosen range with configurable margins (fractions of selection width)
  const resetChartViewbox = useCallback((newTickLower: number, newTickUpper: number, leftMarginFrac: number = 0.05, rightMarginFrac: number = 0.05) => {
    if (newTickLower === newTickUpper) return;

    // Fit selection plus a small margin
    const rangeWidth = newTickUpper - newTickLower;
    const leftMarginTicks = Math.round(rangeWidth * Math.max(0, leftMarginFrac));
    const rightMarginTicks = Math.round(rangeWidth * Math.max(0, rightMarginFrac));
    const newMinTick = newTickLower - leftMarginTicks;
    const newMaxTick = newTickUpper + rightMarginTicks;
    setXDomain([newMinTick, newMaxTick]);
  }, []);

  // Handle use full balance - now uses the same percentage hook as the MAX button
  const handleUseFullBalance = (isToken0: boolean) => {
    try {
      // Use the percentage hook with 100% to get exact balance
      if (isToken0) {
        handleToken0Percentage(100);
        setActiveInputSide('amount0');
      } else {
        handleToken1Percentage(100);
        setActiveInputSide('amount1');
      }

      // Reset transaction state when balance is used
      resetTransaction();
      setShowingTransactionSteps(false);
    } catch {
      // Ignore balance errors
    }
  };


  // Effect to auto-apply active percentage preset when currentPrice changes OR when activePreset changes
  useEffect(() => {
    if (!activePreset || currentPoolTick === null) return;

    // Parse percentage from preset string (e.g., "±3%" -> 3)
    const PRESET_PERCENTAGES: Record<string, number> = {
      "±0.1%": 0.1, "±0.5%": 0.5, "±1%": 1, "±3%": 3, "±8%": 8, "±15%": 15
    };

    if (activePreset === "Full Range") {
      if (tickLower !== sdkMinTick.toString() || tickUpper !== sdkMaxTick.toString()) {
        resetTransaction();
        setTickLower(sdkMinTick.toString());
        setTickUpper(sdkMaxTick.toString());
        setInitialDefaultApplied(true);
        // Viewport for full range
        const [viewportLower, viewportUpper] = calculateTicksFromPercentage(
          isStablePool ? 3 : 15, isStablePool ? 3 : 15, currentPoolTick, defaultTickSpacing
        );
        resetChartViewbox(viewportLower, viewportUpper, 1/3, 1/3);
      }
      return;
    }

    const percentValue = PRESET_PERCENTAGES[activePreset];
    if (!percentValue) return;

    // Use shared utility for tick calculation
    let [newTickLower, newTickUpper] = calculateTicksFromPercentage(
      percentValue, percentValue, currentPoolTick, defaultTickSpacing
    );

    // Clamp to valid range
    newTickLower = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickLower));
    newTickUpper = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickUpper));

    if (newTickUpper - newTickLower >= defaultTickSpacing) {
      if (newTickLower.toString() !== tickLower || newTickUpper.toString() !== tickUpper) {
        resetTransaction();
        setTickLower(newTickLower.toString());
        setTickUpper(newTickUpper.toString());
        setInitialDefaultApplied(true);
        resetChartViewbox(newTickLower, newTickUpper, 1/3, 1/3);
      }
    } else {
      showInfoToast("Preset Range Too Narrow");
    }
  }, [currentPoolTick, activePreset, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper, resetTransaction, isStablePool, resetChartViewbox]);


  // Trigger calculation when inputs change
  useEffect(() => {
    const prev = prevCalculationDeps.current;
    const ticksChanged = tickLower !== prev.tickLower || tickUpper !== prev.tickUpper;
    const slippageChanged = isZapMode && zapSlippageToleranceBps !== prev.zapSlippageToleranceBps;
    const inputSideChanged = activeInputSide !== prev.activeInputSide;

    // Check if relevant inputs changed
    let shouldCalculate = false;
    if (activeInputSide === 'amount0') {
      shouldCalculate = amount0 !== prev.amount0 || ticksChanged || inputSideChanged || slippageChanged;
    } else if (activeInputSide === 'amount1') {
      shouldCalculate = amount1 !== prev.amount1 || ticksChanged || inputSideChanged || slippageChanged;
    } else {
      const amountsChanged = amount0 !== prev.amount0 || amount1 !== prev.amount1;
      const hasAmount = parseFloat(amount0) > 0 || parseFloat(amount1) > 0;
      shouldCalculate = (amountsChanged || ticksChanged || slippageChanged) && hasAmount;
    }

    if (shouldCalculate) {
      const inputSideForCalc = activeInputSide || (parseFloat(amount0) > 0 ? 'amount0' : parseFloat(amount1) > 0 ? 'amount1' : null);
      if (inputSideForCalc) {
        const primaryAmount = inputSideForCalc === 'amount0' ? amount0 : amount1;
        const tlNum = parseInt(tickLower);
        const tuNum = parseInt(tickUpper);
        const ticksAreValid = !isNaN(tlNum) && !isNaN(tuNum) && tlNum < tuNum;

        if (parseFloat(primaryAmount || "0") > 0 && ticksAreValid) {
          // Use calculation hook instead of inline function
          triggerCalculation({
            amount0,
            amount1,
            tickLower,
            tickUpper,
            inputSide: inputSideForCalc,
            currentPoolTick,
            currentPrice,
            isShowingTransactionSteps: showingTransactionSteps,
          });
          // Reset zap state during input phase
          if (!showingTransactionSteps) {
            resetZapState();
          }
        } else if ((parseFloat(primaryAmount || "0") <= 0 && activeInputSide === inputSideForCalc) || !ticksAreValid) {
          if (inputSideForCalc === 'amount0' && amount1 !== "") setAmount1("");
          else if (inputSideForCalc === 'amount1' && amount0 !== "") setAmount0("");
          resetCalculation();
          if (!ticksAreValid && (parseFloat(amount0) > 0 || parseFloat(amount1) > 0)) {
            showInfoToast("Invalid Range");
          }
        }
      } else {
        // Both amounts are zero - cleanup
        if (amount0 !== "" || amount1 !== "") {
          setAmount0("");
          setAmount1("");
        }
        if (amount0FullPrecision !== "" || amount1FullPrecision !== "") {
          setAmount0FullPrecision("");
          setAmount1FullPrecision("");
        }
        resetCalculation();
        resetTransaction();
        setShowingTransactionSteps(false);
      }
    } else if (parseFloat(amount0) <= 0 && parseFloat(amount1) <= 0) {
      resetCalculation();
      resetTransaction();
      setShowingTransactionSteps(false);
    }

    prevCalculationDeps.current = { amount0, amount1, tickLower, tickUpper, activeInputSide, zapSlippageToleranceBps };
  }, [
    amount0, amount1, tickLower, tickUpper, activeInputSide, isZapMode,
    zapSlippageToleranceBps, showingTransactionSteps, currentPoolTick, currentPrice,
    triggerCalculation, resetCalculation, resetTransaction,
  ]);

  useEffect(() => {
    if (isDepositSuccess) {
      setAmount0("");
      setAmount1("");
      setAmount0FullPrecision("");
      setAmount1FullPrecision("");
      resetCalculation();
      setShowingTransactionSteps(false);
      resetTransaction();
      refetchApprovals();
    }
  }, [isDepositSuccess, resetTransaction, refetchApprovals, resetCalculation]);

  // Check for insufficient balance
  useEffect(() => {
    const t0Def = tokenDefinitions[token0Symbol];
    const t1Def = tokenDefinitions[token1Symbol];
    let insufficient = false;

    if (!t0Def || !t1Def) {
      setIsInsufficientBalance(false);
      return;
    }

    // ZAP MODE: Only check the input token balance
    if (isZapMode) {
      const inputTokenDef = zapInputToken === 'token0' ? t0Def : t1Def;
      const inputBalanceData = zapInputToken === 'token0' ? token0BalanceData : token1BalanceData;
      const inputAmount = zapInputToken === 'token0' ? amount0 : amount1;

      const isInputPositive = parseFloat(inputAmount || "0") > 0;
      if (isInputPositive && inputBalanceData?.value) {
        try {
          const valueToCheck = safeParseUnits(inputAmount, inputTokenDef.decimals);
          if (valueToCheck > inputBalanceData.value) {
            insufficient = true;
          }
        } catch {
          // ignore parsing errors
        }
      }

      setIsInsufficientBalance(insufficient);
      return;
    }

    // TWO-TOKEN MODE: Check both token balances
    const isAmount0InputPositive = parseFloat(amount0 || "0") > 0;
    const isAmount1InputPositive = parseFloat(amount1 || "0") > 0;

    let valueToCheck0AsWei: bigint | null = null;
    if (isAmount0InputPositive) {
      try { valueToCheck0AsWei = safeParseUnits(amount0, t0Def.decimals); } catch { /* ignore error if not a valid number */ }
    } else if (calculatedData && BigInt(calculatedData.amount0) > 0n && isAmount1InputPositive) {
      valueToCheck0AsWei = BigInt(calculatedData.amount0);
    }

    let valueToCheck1AsWei: bigint | null = null;
    if (isAmount1InputPositive) {
      try { valueToCheck1AsWei = safeParseUnits(amount1, t1Def.decimals); } catch { /* ignore error if not a valid number */ }
    } else if (calculatedData && BigInt(calculatedData.amount1) > 0n && isAmount0InputPositive) {
      valueToCheck1AsWei = BigInt(calculatedData.amount1);
    }

    if (valueToCheck0AsWei !== null && valueToCheck0AsWei > 0n && token0BalanceData?.value) {
      if (valueToCheck0AsWei > token0BalanceData.value) {
        insufficient = true;
      }
    }

    if (!insufficient && valueToCheck1AsWei !== null && valueToCheck1AsWei > 0n && token1BalanceData?.value) {
      if (valueToCheck1AsWei > token1BalanceData.value) {
        insufficient = true;
      }
    }

    // Additional check: if calculatedData is present and an amount is required but its input field is zero/empty.
    if (!insufficient && calculatedData) {
        if (!isAmount0InputPositive && BigInt(calculatedData.amount0) > 0n && token0BalanceData?.value) {
            if (BigInt(calculatedData.amount0) > token0BalanceData.value) {
                insufficient = true;
            }
        }
        if (!insufficient && !isAmount1InputPositive && BigInt(calculatedData.amount1) > 0n && token1BalanceData?.value) {
            if (BigInt(calculatedData.amount1) > token1BalanceData.value) {
                insufficient = true;
            }
        }
    }

    setIsInsufficientBalance(insufficient);
  }, [amount0, amount1, token0Symbol, token1Symbol, calculatedData, token0BalanceData, token1BalanceData, isZapMode, zapInputToken]);

  const hasRangeSelected = (activePreset !== null || initialDefaultApplied) && tickLower !== "" && tickUpper !== "";

  // APR calculation hook
  const { estimatedApr, isCalculatingApr, cachedPoolMetrics } = usePositionAPR({
    selectedPoolId,
    tickLower,
    tickUpper,
    currentPoolTick,
    currentPoolSqrtPriceX96,
    token0Symbol,
    token1Symbol,
    amount0,
    amount1,
    calculatedData,
    poolLiquidity: poolState?.liquidity,
    chainId: targetChainId,
    networkMode,
  });

  // Notify parent of range/APR changes (mirrors form's visual state)
  useEffect(() => {
    if (onRangeChange) {
      const label = getPresetDisplayLabel(activePreset, isStablePool);
      onRangeChange({
        preset: activePreset,
        label,
        estimatedApr,
        hasUserInteracted,
        isCalculating: isCalculatingApr,
      });
    }
  }, [activePreset, estimatedApr, isStablePool, onRangeChange, getPresetDisplayLabel, hasUserInteracted, isCalculatingApr]);

  // Wrapper for convertTickToPrice
  const convertTickToPrice = useCallback((tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string): string => {
    return convertTickToPriceUtil(tick, currentPoolTick, currentPrice, baseTokenForPriceDisplay, token0Symbol, token1Symbol);
  }, []);

  // Range display hook - calculates formatted prices and labels
  const { rangeLabels, formattedCurrentPrice, minPriceInputString, maxPriceInputString } = useRangeDisplay({
    tickLower,
    tickUpper,
    currentPoolTick,
    currentPrice,
    baseTokenForPriceDisplay,
    token0Symbol,
    token1Symbol,
    sdkMinTick,
    sdkMaxTick,
    selectedPoolId,
    activePreset,
    initialDefaultApplied,
    calculatedData,
  });

  return (
    <div className="space-y-4">
      {/* Deposit Tab Content */}
      {activeTab === 'deposit' && (
        <>
          {/* Amount Input Step */}
            {/* Header removed; now provided by parent container */}

              {/* Range Section - Step 1 - Hide when showing transaction steps */}
              {!showingTransactionSteps && (
              <div className="border border-dashed rounded-md bg-muted/10 p-3">
                {/* Range Label */}
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium">Range</Label>
                  <div className="flex items-center gap-2">
                    {activePreset === null ? (
                      // No range selected - show prompt
                      <span className="text-xs text-muted-foreground">Please Select Range</span>
                    ) : !currentPrice || !minPriceInputString || !maxPriceInputString ? (
                      // Loading skeletons
                      <>
                        <div className="h-4 w-12 bg-muted/50 rounded animate-pulse" />
                        <div className="h-4 w-20 bg-muted/50 rounded animate-pulse" />
                      </>
                    ) : (
                      <>
                        {/* Clickable price range display - opens modal */}
                        {rangeLabels && (
                          <div className="flex items-center gap-1 text-xs min-w-0">
                            <div
                              className={cn(
                                "text-muted-foreground hover:text-white px-1 py-1 transition-colors cursor-pointer",
                                "truncate max-w-[110px] sm:max-w-[160px]"
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                setModalInitialFocusField('min');
                                setShowRangeModal(true);
                              }}
                            >
                              {rangeLabels ? rangeLabels.left : (minPriceInputString || "0.00")}
                            </div>
                            <span className="text-muted-foreground">-</span>
                            <div
                              className={cn(
                                "text-muted-foreground hover:text-white px-1 py-1 transition-colors cursor-pointer",
                                "truncate max-w-[110px] sm:max-w-[160px]"
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                setModalInitialFocusField('max');
                                setShowRangeModal(true);
                              }}
                            >
                              {rangeLabels ? rangeLabels.right : (maxPriceInputString || "∞")}
                            </div>
                            {currentPrice && (
                              <TooltipProvider delayDuration={0}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="ml-2 inline-flex items-center gap-1 text-[10px] px-1 py-0.5 rounded border border-sidebar-border text-muted-foreground">
                                      <span className="inline-block w-[2px] h-2" style={{ background: '#e85102' }} />
                                      <span className="select-none">
                                        {formattedCurrentPrice}
                                      </span>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                    Current Pool Price
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Range Buttons */}
                {!showingTransactionSteps ? (
                  <div className="grid grid-cols-4 gap-2">
                    {["Full Range", "Wide", "Narrow", "Custom"].map((preset) => {
                      // Map labels to internal preset values
                      const presetValue = (() => {
                        if (preset === "Full Range") return "Full Range";
                        if (preset === "Wide") return isStablePool ? "±3%" : "±15%";
                        if (preset === "Narrow") return isStablePool ? "±0.5%" : "±3%";
                        return "Custom"; // Custom
                      })();

                      const isCustom = preset === "Custom";
                      // Custom is active when user has interacted and activePreset doesn't match any standard preset
                      const standardPresets = ["Full Range", isStablePool ? "±3%" : "±15%", isStablePool ? "±0.5%" : "±3%"];
                      const isActive = isCustom
                        ? (hasUserInteracted && initialDefaultApplied && !standardPresets.includes(activePreset || ""))
                        : (activePreset !== null && activePreset === presetValue);

                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            if (preset === "Custom") {
                              setShowRangeModal(true);
                            } else {
                              handleSelectPreset(presetValue!);
                            }
                          }}
                          className={`relative h-10 px-2 flex items-center justify-center gap-1.5 rounded-md border transition-all duration-200 overflow-hidden text-[11px] font-medium cursor-pointer ${
                            isActive
                              ? 'text-sidebar-primary border-sidebar-primary bg-button-primary'
                              : 'border-sidebar-border bg-button hover:bg-accent hover:brightness-110 hover:border-white/30 text-white'
                          }`}
                          style={!isActive ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                        >
                          {isCustom && <Maximize className={`w-3 h-3 relative z-10 max-[399px]:hidden ${isActive ? 'text-sidebar-primary' : 'text-muted-foreground'}`} />}
                          <span className="relative z-10">{preset}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              )}

              {/* Range Selection Modal - Only show when NOT in transaction steps */}
              {!showingTransactionSteps && (
                <RangeSelectionModalV2
                  isOpen={showRangeModal}
                  onClose={() => {
                    setShowRangeModal(false);
                    setModalInitialFocusField(null);
                  }}
                  onConfirm={(newTickLower, newTickUpper, selectedPreset, denomination) => {
                    setTickLower(newTickLower);
                    setTickUpper(newTickUpper);
                    resetTransaction();
                    setInitialDefaultApplied(true);
                    // Set the preset from the modal instead of clearing it
                    setActivePreset(selectedPreset || null);
                    setHasUserInteracted(true);
                    // Sync denomination with modal
                    if (denomination) {
                      setBaseTokenForPriceDisplay(denomination);
                    }
                    // Reset amount inputs when range changes
                    resetAmounts();
                    setActiveInputSide(null);
                    resetCalculation();
                    setModalInitialFocusField(null);
                  }}
                  initialTickLower={tickLower}
                  initialTickUpper={tickUpper}
                  initialActivePreset={activePreset}
                  selectedPoolId={selectedPoolId}
                  chainId={chainId}
                  token0Symbol={token0Symbol}
                  token1Symbol={token1Symbol}
                  currentPrice={currentPrice}
                  currentPoolTick={currentPoolTick}
                  currentPoolSqrtPriceX96={currentPoolSqrtPriceX96}
                  minPriceDisplay={minPriceInputString}
                  maxPriceDisplay={maxPriceInputString}
                  baseTokenSymbol={baseTokenForPriceDisplay}
                  sdkMinTick={sdkMinTick}
                  sdkMaxTick={sdkMaxTick}
                  defaultTickSpacing={defaultTickSpacing}
                  xDomain={xDomain}
                  onXDomainChange={(newDomain) => setXDomain(newDomain)}
                  poolToken0={poolToken0}
                  poolToken1={poolToken1}
                  presetOptions={presetOptions}
                  isInverted={isInverted}
                  initialFocusField={modalInitialFocusField}
                  poolMetricsData={cachedPoolMetrics}
                  poolType={selectedPoolId ? getPoolById(selectedPoolId)?.type : undefined}
                />
              )}

              {/* Single Token Mode Toggle */}
              <div
                onClick={() => {
                  if (isWorking || showingTransactionSteps) return;
                  setIsZapMode(!isZapMode);
                  resetAmounts();
                  resetZapState();
                  setActiveInputSide(null);
                  resetCalculation();
                  resetTransaction();
                }}
                className={cn(
                  "cursor-pointer hover:bg-muted/20 transition-colors p-4 rounded-lg bg-surface border border-sidebar-border/60",
                  isWorking || showingTransactionSteps ? "opacity-50 pointer-events-none" : ""
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="zap-mode" className="text-sm font-medium cursor-pointer">Single Token Mode</Label>
                    <TooltipProvider delayDuration={0}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <CircleHelp className="h-3 w-3 text-muted-foreground" onClick={(e) => e.stopPropagation()} />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[280px] text-xs">
                          <p className="mb-2">Provide liquidity using a single token. We'll automatically swap the optimal amount to maximize your liquidity.</p>
                          <p className="text-[10px] text-muted-foreground/90">Note: Large deposits relative to pool liquidity may experience higher price impact during the swap.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Checkbox
                    id="zap-mode"
                    checked={isZapMode}
                    onCheckedChange={(checked) => {
                      if (isWorking || showingTransactionSteps) return;
                      setIsZapMode(checked === true);
                      resetAmounts();
                      resetZapState();
                      setActiveInputSide(null);
                      resetCalculation();
                      resetTransaction();
                    }}
                    disabled={isWorking || showingTransactionSteps}
                    onClick={(e) => e.stopPropagation()}
                    className="h-5 w-5"
                  />
                </div>
              </div>

              {/* Input for Token 0 */}
              {(!isZapMode || zapInputToken === 'token0') && (
                <TokenAmountInput
                  tokenSymbol={token0Symbol}
                  amount={amount0}
                  fullPrecisionAmount={amount0FullPrecision}
                  balanceData={token0BalanceData}
                  isLoadingBalance={isLoadingToken0Balance}
                  isFocused={isAmount0Focused}
                  canAdd={canAddToken0}
                  isWorking={isWorking}
                  isCalculating={isCalculating}
                  isConnected={isConnected}
                  isZapMode={isZapMode}
                  showingTransactionSteps={showingTransactionSteps}
                  isOtherInputActive={activeInputSide === 'amount1'}
                  calculatedAmountWei={calculatedData?.amount0}
                  tokenDecimals={tokenDefinitions[token0Symbol]?.decimals || 18}
                  wiggleControls={balanceWiggleControls0}
                  onAmountChange={(value) => {
                    setAmount0FullPrecision("");
                    resetTransaction();
                    setShowingTransactionSteps(false);
                    setAmount0(value);
                    setActiveInputSide('amount0');
                    setHasUserInteracted(true);
                  }}
                  onFocus={() => setIsAmount0Focused(true)}
                  onBlur={() => setIsAmount0Focused(false)}
                  onUseFullBalance={() => handleUseFullBalance(true)}
                  onPercentageClick={(pct) => {
                    handleToken0Percentage(pct);
                    setActiveInputSide('amount0');
                    resetTransaction();
                    setShowingTransactionSteps(false);
                  }}
                  onZapTokenSwitch={() => {
                    if (isZapMode && !showingTransactionSteps) {
                      setZapInputToken('token1');
                      resetZapState();
                      if (amount0) { setAmount1(amount0); setAmount0(""); setActiveInputSide('amount1'); }
                    }
                  }}
                  triggerWiggle={triggerWiggle0}
                  getUSDPrice={() => getUSDPriceForSymbol(token0Symbol)}
                />
              )}

              {/* Plus Icon - Only show when not in zap mode */}
              {!isZapMode && (
              <div className="flex justify-center relative my-0" style={{ height: '20px' }}>
                <div className={cn("plus-loading-wrapper", isCalculating && "loading")}>
                  <div className="plus-loading-inner">
                    <Plus className="h-4 w-4" />
                  </div>
                </div>
              </div>
              )}

              {/* Input for Token 1 */}
              {(!isZapMode || zapInputToken === 'token1') && (
                <div className="mb-4">
                  <TokenAmountInput
                    tokenSymbol={token1Symbol}
                    amount={amount1}
                    fullPrecisionAmount={amount1FullPrecision}
                    balanceData={token1BalanceData}
                    isLoadingBalance={isLoadingToken1Balance}
                    isFocused={isAmount1Focused}
                    canAdd={canAddToken1}
                    isWorking={isWorking}
                    isCalculating={isCalculating}
                    isConnected={isConnected}
                    isZapMode={isZapMode}
                    showingTransactionSteps={showingTransactionSteps}
                    isOtherInputActive={activeInputSide === 'amount0'}
                    calculatedAmountWei={calculatedData?.amount1}
                    tokenDecimals={tokenDefinitions[token1Symbol]?.decimals || 18}
                    wiggleControls={balanceWiggleControls1}
                    onAmountChange={(value) => {
                      setAmount1FullPrecision("");
                      resetTransaction();
                      setShowingTransactionSteps(false);
                      setAmount1(value);
                      setActiveInputSide('amount1');
                      setHasUserInteracted(true);
                    }}
                    onFocus={() => setIsAmount1Focused(true)}
                    onBlur={() => setIsAmount1Focused(false)}
                    onUseFullBalance={() => handleUseFullBalance(false)}
                    onPercentageClick={(pct) => {
                      handleToken1Percentage(pct);
                      setActiveInputSide('amount1');
                      resetTransaction();
                      setShowingTransactionSteps(false);
                    }}
                    onZapTokenSwitch={() => {
                      if (isZapMode && !showingTransactionSteps) {
                        setZapInputToken('token0');
                        resetZapState();
                        if (amount1) { setAmount0(amount1); setAmount1(""); setActiveInputSide('amount0'); }
                      }
                    }}
                    triggerWiggle={triggerWiggle1}
                    getUSDPrice={() => getUSDPriceForSymbol(token1Symbol)}
                  />
                </div>
              )}



              {/* Transaction Steps - Show when user clicked deposit */}
              {showingTransactionSteps && !isZapMode && (
                <TransactionFlowPanel
                  isActive={showingTransactionSteps}
                  approvalData={approvalData}
                  isCheckingApprovals={isCheckingApprovals}
                  token0Symbol={token0Symbol}
                  token1Symbol={token1Symbol}
                  isDepositSuccess={isDepositSuccess}
                  onApproveToken={regularTransaction.handleApprove}
                  onExecute={handleDeposit}
                  onRefetchApprovals={refetchApprovals}
                  onBack={() => {
                    setShowingTransactionSteps(false);
                    resetTransaction();
                  }}
                  onReset={() => {
                    resetTransaction();
                  }}
                  executeButtonLabel="Deposit"
                  showBackButton={true}
                  autoProgressOnApproval={false}
                  calculatedData={calculatedData}
                  tickLower={tickLower}
                  tickUpper={tickUpper}
                  amount0={amount0}
                  amount1={amount1}
                  currentPrice={currentPrice}
                  currentPoolTick={currentPoolTick}
                  currentPoolSqrtPriceX96={currentPoolSqrtPriceX96}
                  selectedPoolId={selectedPoolId}
                  getUsdPriceForSymbol={getUSDPriceForSymbol}
                />
              )}

              {/* Zap Transaction Flow - Uses same panel, hook handles zap logic internally */}
              {showingTransactionSteps && isZapMode && (
                <TransactionFlowPanel
                  isActive={showingTransactionSteps}
                  approvalData={approvalData}
                  isCheckingApprovals={isCheckingApprovals}
                  token0Symbol={token0Symbol}
                  token1Symbol={token1Symbol}
                  isDepositSuccess={isDepositSuccess}
                  isZapMode={true}
                  zapInputToken={zapInputToken}
                  onApproveToken={handleApprove}
                  onExecuteZap={zapTransaction.handleZapSwapAndDeposit}
                  onExecute={handleDeposit}
                  onRefetchApprovals={refetchApprovals}
                  onBack={() => {
                    setShowingTransactionSteps(false);
                    resetTransaction();
                  }}
                  onReset={() => {
                    resetTransaction();
                  }}
                  executeButtonLabel="Execute Zap"
                  showBackButton={true}
                  autoProgressOnApproval={false}
                  slippageControl={
                    <SlippageControl
                      currentSlippage={currentSlippage}
                      isAuto={isAutoSlippage}
                      autoSlippage={autoSlippageValue}
                      onSlippageChange={setSlippage}
                      onAutoToggle={setAutoMode}
                      onCustomToggle={setCustomMode}
                    />
                  }
                  priceImpactWarning={priceImpactWarning}
                  calculatedData={calculatedData}
                  tickLower={tickLower}
                  tickUpper={tickUpper}
                  amount0={amount0}
                  amount1={amount1}
                  currentPrice={currentPrice}
                  currentPoolTick={currentPoolTick}
                  currentPoolSqrtPriceX96={currentPoolSqrtPriceX96}
                  selectedPoolId={selectedPoolId}
                  getUsdPriceForSymbol={getUSDPriceForSymbol}
                  zapQuote={zapQuote}
                  currentSlippage={currentSlippage}
                />
              )}

              {/* Continue Button */}
              {!isConnected ? (
                <div className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:bg-accent hover:brightness-110 hover:border-white/30 text-white"
                  style={{ backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                >
                  {/* @ts-expect-error custom element provided by wallet kit */}
                  <appkit-button className="absolute inset-0 z-10 block h-full w-full cursor-pointer p-0 opacity-0" />
                  <span className="relative z-0 pointer-events-none">Connect Wallet</span>
                </div>
              ) : !showingTransactionSteps ? (
                // Single button layout for initial view
                <Button
                  className={cn(
                    "w-full",
                    (isWorking || isCalculating || isPoolStateLoading || isCheckingApprovals ||
                    !hasRangeSelected ||
                    (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) ||
                    isInsufficientBalance) ?
                      "relative border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
                      :
                      "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
                  )}
                  onClick={async () => {
                    if (!hasRangeSelected) {
                      showErrorToast("Select Range", "Please select a price range first");
                      return;
                    }
                    if (isInsufficientBalance) {
                      showErrorToast("Insufficient Balance");
                      return;
                    }
                    if (parseFloat(amount0 || "0") <= 0 && parseFloat(amount1 || "0") <= 0) {
                      showErrorToast("Invalid Amount", "Must be greater than 0");
                      return;
                    }

                    // For zap mode, validate input amount and calculate zap quote with price impact
                    if (isZapMode) {
                      const inputAmount = zapInputToken === 'token0' ? amount0 : amount1;
                      if (!inputAmount || parseFloat(inputAmount) <= 0) {
                        showErrorToast("Invalid Amount", "Must provide input amount");
                        return;
                      }

                      // Calculate zap quote using hook
                      try {
                        const success = await fetchZapQuote({
                          zapInputToken,
                          inputAmount,
                          tickLower,
                          tickUpper,
                          accountAddress,
                        });
                        if (!success) return;
                      } catch (error: any) {
                        // Show error toast for zap failures
                        if (error.message?.includes('Price impact') || error.message?.includes('slippage')) {
                          showErrorToast('Slippage Protection', error.message);
                        } else {
                          showErrorToast('Failed to calculate zap quote', error.message);
                        }
                        return;
                      }
                    }

                    // Show transaction steps after zap quote is calculated (or immediately for non-zap)
                    setShowingTransactionSteps(true);
                  }}
                  disabled={isWorking ||
                    isCalculating ||
                    isPreparingZap ||
                    isPoolStateLoading ||
                    isCheckingApprovals ||
                    !hasRangeSelected ||
                    (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) ||
                    isInsufficientBalance
                  }
                  style={(isWorking || isCalculating || isPreparingZap || isPoolStateLoading || isCheckingApprovals ||
                    !hasRangeSelected ||
                    (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) ||
                    isInsufficientBalance) ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                >
                  <span className={cn(
                    (isCalculating || isPoolStateLoading)
                      ? "animate-pulse"
                      : ""
                  )}>
                    {!hasRangeSelected ? 'Select Range' : isInsufficientBalance ? 'Insufficient Balance' : 'Deposit'}
                  </span>
                </Button>
              ) : null}
        </>
      )}
    </div>
  );
} 