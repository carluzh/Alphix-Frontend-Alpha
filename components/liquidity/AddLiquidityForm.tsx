"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Plus, InfoIcon, OctagonX, BadgeCheck, Maximize, CircleHelp, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import Image from "next/image";
import { useAccount, useBalance } from "wagmi";
import { toast } from "sonner";
import { useEthersSigner } from "@/hooks/useEthersSigner";
import { usePercentageInput } from "@/hooks/usePercentageInput";
import { V4_POOL_FEE, V4_POOL_TICK_SPACING, V4_POOL_HOOKS } from "@/lib/swap-constants";
import { DEFAULT_LP_SLIPPAGE, MAX_AUTO_SLIPPAGE_TOLERANCE } from "@/lib/slippage-constants";
import { getStoredDeadlineSeconds } from "@/hooks/useUserSettings";
import { getTokenDefinitions, TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { getPoolById, getToken } from "@/lib/pools-config";
import { formatUnits as viemFormatUnits, parseUnits as viemParseUnits, getAddress } from "viem";

// Helper function to safely parse amounts and prevent scientific notation errors
const safeParseUnits = (amount: string, decimals: number): bigint => {
  // Convert scientific notation to decimal format
  const numericAmount = parseFloat(amount);
  if (isNaN(numericAmount)) {
    throw new Error("Invalid number format");
  }
  
  // Convert to string with full decimal representation (no scientific notation)
  const fullDecimalString = numericAmount.toFixed(decimals);
  
  // Remove trailing zeros after decimal point
  const trimmedString = fullDecimalString.replace(/\.?0+$/, '');
  
  // If the result is just a decimal point, return "0"
  const finalString = trimmedString === '.' ? '0' : trimmedString;
  
  return viemParseUnits(finalString, decimals);
};
import { useAddLiquidityTransactionV2 } from "./useAddLiquidityTransactionV2";
import { motion, AnimatePresence, useAnimation } from "framer-motion";
import { RangeSelectionModalV2 } from "./range-selection/RangeSelectionModalV2";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TransactionFlowPanel } from "./TransactionFlowPanel";
import { SlippageControl } from "@/components/swap/SlippageControl";
import { useUserSlippageTolerance } from "@/hooks/useSlippage";

// Toast utility functions matching swap-interface patterns
const showErrorToast = (title: string, description?: string, action?: { label: string; onClick: () => void }) => {
  toast.error(title, {
    icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
    description: description,
    action: action
  });
};

const showInfoToast = (title: string) => {
  toast(title, {
    icon: React.createElement(InfoIcon, { className: "h-4 w-4" })
  });
};

import { Token } from '@uniswap/sdk-core';
import { Pool as V4PoolSDK } from "@uniswap/v4-sdk";
import JSBI from "jsbi";
import { formatUSD } from "@/lib/format";
import { calculateUserPositionAPY, calculatePositionAPY, formatUserAPY, type PoolMetrics } from "@/lib/apy-calculator";
import { useTokenUSDPrice } from "@/hooks/useTokenUSDPrice";
import { getOptimalBaseToken, getDecimalsForDenomination, convertTickToPrice as convertTickToPriceUtil } from "@/lib/denomination-utils";

// Utility functions
const getTokenIcon = (symbol?: string) => {
  if (!symbol) return "/placeholder-logo.svg";
  const tokenConfig = getToken(symbol);
  return tokenConfig?.icon || "/placeholder-logo.svg";
};

// Debounce function
function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
  let timeout: NodeJS.Timeout | null = null;

  const debounced = (...args: Parameters<F>) => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    timeout = setTimeout(() => func(...args), waitFor);
  };

  return debounced as (...args: Parameters<F>) => ReturnType<F> | void;
}

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
  onRangeChange?: (rangeInfo: { preset: string | null; label: string; estimatedApy: string; hasUserInteracted: boolean; isCalculating: boolean }) => void;
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
  // Store full precision values for editing
  const [amount0FullPrecision, setAmount0FullPrecision] = useState<string>("");
  const [amount1FullPrecision, setAmount1FullPrecision] = useState<string>("");
  const [tickLower, setTickLower] = useState<string>("");
  const [tickUpper, setTickUpper] = useState<string>("");
  const [currentPoolTick, setCurrentPoolTick] = useState<number | null>(null);
  const [activeInputSide, setActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isAmount0Focused, setIsAmount0Focused] = useState(false);
  const [isAmount1Focused, setIsAmount1Focused] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);

  // OOR input field restrictions
  const [canAddToken0, setCanAddToken0] = useState(true);
  const [canAddToken1, setCanAddToken1] = useState(true);

  // API response data
  const [calculatedData, setCalculatedData] = useState<{
    liquidity: string;
    finalTickLower: number;
    finalTickUpper: number;
    amount0: string; 
    amount1: string; 
    currentPoolTick?: number; 
    currentPrice?: string;    
    priceAtTickLower?: string;
    priceAtTickUpper?: string;
  } | null>(null);

  // Price and range state
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);
  const [currentPoolSqrtPriceX96, setCurrentPoolSqrtPriceX96] = useState<string | null>(null);
  
  // UI state
  const [isInsufficientBalance, setIsInsufficientBalance] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [isPoolStateLoading, setIsPoolStateLoading] = useState<boolean>(false);
  const [isChartLoading, setIsChartLoading] = useState<boolean>(false);
  const [initialDefaultApplied, setInitialDefaultApplied] = useState(false);
  const [baseTokenForPriceDisplay, setBaseTokenForPriceDisplay] = useState<TokenSymbol>(() =>
    getOptimalBaseToken(initialTokens.token0, initialTokens.token1));
  const [estimatedApy, setEstimatedApy] = useState<string>("0.00");
  const [isCalculatingApy, setIsCalculatingApy] = useState(false);
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

  // Notify parent of range/APY changes (mirrors form's visual state)
  useEffect(() => {
    if (onRangeChange) {
      const label = getPresetDisplayLabel(activePreset, isStablePool);
      onRangeChange({
        preset: activePreset,
        label,
        estimatedApy,
        hasUserInteracted,
        isCalculating: isCalculatingApy,
      });
    }
  }, [activePreset, estimatedApy, isStablePool, onRangeChange, getPresetDisplayLabel, hasUserInteracted, isCalculatingApy]);

  // Cache pool metrics and state (fetched once per pool)
  const [cachedPoolMetrics, setCachedPoolMetrics] = useState<{ poolId: string; metrics: any; poolLiquidity: string } | null>(null);

  // Zap mode state
  const [isZapMode, setIsZapMode] = useState(false);
  const [zapInputToken, setZapInputToken] = useState<'token0' | 'token1'>('token0');
  const [zapQuote, setZapQuote] = useState<{
    swapAmount: string;
    expectedToken0Amount: string;
    expectedToken1Amount: string;
    expectedLiquidity: string;
    priceImpact: string;
    leftoverToken0?: string;
    leftoverToken1?: string;
  } | null>(null);

  // Price impact state (for zap mode warnings)
  const [priceImpact, setPriceImpact] = useState<number | null>(null);

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

  // UI flow management
  const [showingTransactionSteps, setShowingTransactionSteps] = useState(false);
  const [showRangeModal, setShowRangeModal] = useState(false);
  const [modalInitialFocusField, setModalInitialFocusField] = useState<'min' | 'max' | null>(null);

  // Chart state
  const [xDomain, setXDomain] = useState<[number, number]>([-120000, 120000]);
  const [currentPriceLine, setCurrentPriceLine] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  
  // Wiggle animation for insufficient approvals
  const [approvalWiggleCount, setApprovalWiggleCount] = useState(0);
  const approvalWiggleControls = useAnimation();

  // Wiggle animation for balance exceeded
  const [balanceWiggleCount0, setBalanceWiggleCount0] = useState(0);
  const [balanceWiggleCount1, setBalanceWiggleCount1] = useState(0);
  const balanceWiggleControls0 = useAnimation();
  const balanceWiggleControls1 = useAnimation();

  const panStartXRef = useRef<number | null>(null);
  const panStartDomainRef = useRef<[number, number] | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  
  // Range drag state (for coloring X/Y while dragging)
  const [isDraggingRange, setIsDraggingRange] = useState<'left' | 'right' | 'center' | null>(null);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [dragStartTickLower, setDragStartTickLower] = useState<number | null>(null);
  const [dragStartTickUpper, setDragStartTickUpper] = useState<number | null>(null);
  const [dragSide, setDragSide] = useState<'left' | 'right' | 'center' | null>(null);
  // Track which side is being edited in the inline price editor
  const [editingSide, setEditingSide] = useState<'min' | 'max' | null>(null);
  
  // Min/Max price input strings
  const [minPriceInputString, setMinPriceInputString] = useState<string>("");
  const [maxPriceInputString, setMaxPriceInputString] = useState<string>("");

  const { address: accountAddress, chainId, isConnected } = useAccount();
  const { networkMode, chainId: targetChainId } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const signer = useEthersSigner();

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

  // Parse displayed token amount strings (handles "< 0.0001" and commas)
  const parseDisplayAmount = useCallback((value?: string): number => {
    if (!value) return 0;
    const trimmed = value.trim();
    if (trimmed.startsWith('<')) {
      const approx = parseFloat(trimmed.replace('<', '').trim().replace(/,/g, ''));
      return Number.isFinite(approx) ? approx : 0;
    }
    const n = parseFloat(trimmed.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }, []);
  
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
  const regularTransaction = useAddLiquidityTransactionV2({
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
  // It already handles zap at lines 179-341 of useAddLiquidityTransactionV2.ts
  const zapTransaction = regularTransaction;

  // Use appropriate hook based on zap mode
  const {
    approvalData,
    isCheckingApprovals,
    isWorking,
    isApproving,
    isDepositConfirming,
    isDepositSuccess,
    handleApprove,
    handleDeposit,
    refetchApprovals,
    reset: resetTransaction,
  } = isZapMode ? {
    // Zap mode - use zap approval data from the transaction hook
    approvalData: zapTransaction.approvalData,
    isCheckingApprovals: zapTransaction.isCheckingApprovals,
    isWorking: zapTransaction.isWorking,
    isApproving: zapTransaction.isApproving,
    isDepositConfirming: zapTransaction.isDepositConfirming,
    isDepositSuccess: zapTransaction.isDepositSuccess,
    handleApprove: zapTransaction.handleApprove,
    handleDeposit: async () => {}, // Not used - zap uses handleZapSwapAndDeposit
    refetchApprovals: zapTransaction.refetchApprovals,
    reset: zapTransaction.reset,
  } : regularTransaction;

  // Track which step we're on manually (no auto-progression)
  const [currentTransactionStep, setCurrentTransactionStep] = useState<'idle' | 'approving_token0' | 'approving_token1' | 'signing_permit' | 'depositing'>('idle');
  const [permitSignature, setPermitSignature] = useState<string>();

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

  // Approval wiggle animation effect
  useEffect(() => {
    if (approvalWiggleCount > 0) {
      approvalWiggleControls.start({
        x: [0, -3, 3, -2, 2, 0],
        transition: { duration: 0.22, ease: 'easeOut' },
      }).catch(() => {});
    }
  }, [approvalWiggleCount, approvalWiggleControls]);

  // Balance wiggle animation effects
  useEffect(() => {
    if (balanceWiggleCount0 > 0) {
      balanceWiggleControls0.start({
        x: [0, -3, 3, -2, 2, 0],
        transition: { duration: 0.22, ease: 'easeOut' },
      }).catch(() => {});
    }
  }, [balanceWiggleCount0, balanceWiggleControls0]);

  useEffect(() => {
    if (balanceWiggleCount1 > 0) {
      balanceWiggleControls1.start({
        x: [0, -3, 3, -2, 2, 0],
        transition: { duration: 0.22, ease: 'easeOut' },
      }).catch(() => {});
    }
  }, [balanceWiggleCount1, balanceWiggleControls1]);

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

  // Keep denomination aligned with optimal base (but freeze while editing)
  useEffect(() => {
    if (editingSide) return;
    const priceNum = currentPrice ? parseFloat(currentPrice) : undefined;
    const desiredBase = getOptimalBaseToken(token0Symbol, token1Symbol, priceNum);
    if (desiredBase && desiredBase !== baseTokenForPriceDisplay) {
      setBaseTokenForPriceDisplay(desiredBase);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token0Symbol, token1Symbol, currentPrice, editingSide]);

  const optimalDenominationForDecimals = useMemo(() => {
    const priceNum = currentPrice ? parseFloat(currentPrice) : undefined;
    return getOptimalBaseToken(token0Symbol, token1Symbol, priceNum);
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
          setPriceImpact(null); // Reset price impact when tokens change
          setTickLower(sdkMinTick.toString());
          setTickUpper(sdkMaxTick.toString());
          setCurrentPoolTick(null);
          setCalculatedData(null);
          setActiveInputSide(null);
          setCurrentPrice(null);
          setInitialDefaultApplied(false);
          setActivePreset(null); // No default preset - user must select
          setBaseTokenForPriceDisplay(t0); // Reset base token for price display
          // Reset chart specific states too
          setCurrentPriceLine(null);
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

  useEffect(() => {
    const tl = parseInt(tickLower);
    const tu = parseInt(tickUpper);
    if (currentPoolTick !== null && currentPoolTick !== undefined && !isNaN(tl) && !isNaN(tu)) {
      const isOOR = currentPoolTick < tl || currentPoolTick > tu;
      if (isOOR) {
        if (currentPoolTick >= tu) {
          setCanAddToken0(false);
          setCanAddToken1(true);
          if (parseFloat(amount0 || '0') > 0) {
            setAmount0('');
            setAmount0FullPrecision('');
          }
        } else if (currentPoolTick <= tl) {
          setCanAddToken0(true);
          setCanAddToken1(false);
          if (parseFloat(amount1 || '0') > 0) {
            setAmount1('');
            setAmount1FullPrecision('');
          }
        }
      } else {
        setCanAddToken0(true);
        setCanAddToken1(true);
      }
    } else {
      setCanAddToken0(true);
      setCanAddToken1(true);
    }
  }, [tickLower, tickUpper, currentPoolTick]);

  // Reset state when tokens change
  useEffect(() => {
    setInitialDefaultApplied(false);
    setTickLower(sdkMinTick.toString());
    setTickUpper(sdkMaxTick.toString());
    setAmount0("");
    setAmount1("");
    setAmount0FullPrecision("");
    setAmount1FullPrecision("");
    setCalculatedData(null);
    setCurrentPoolTick(null);
    setCurrentPrice(null);
    setActivePreset(null); // No default preset - user must select
    setBaseTokenForPriceDisplay(token0Symbol); // Reset base token for price display
    // Reset chart specific states too
    setCurrentPriceLine(null);
  }, [token0Symbol, token1Symbol, chainId, sdkMinTick, sdkMaxTick, isStablePool]);

  // Fetch initial pool state - uses prop if provided, otherwise fetches from API
  useEffect(() => {
    const applyPoolState = (data: { currentPrice: string; currentPoolTick: number; sqrtPriceX96?: string }) => {
      setCurrentPrice(data.currentPrice);
      setCurrentPoolTick(data.currentPoolTick);
      setCurrentPoolSqrtPriceX96(data.sqrtPriceX96?.toString() || null);

      const price = parseFloat(data.currentPrice);
      if (!isNaN(price)) {
        setCurrentPriceLine(price);
        const percentageRange = isStablePool ? 0.05 : 0.20;
        const tickRange = Math.round(Math.log(1 + percentageRange) / Math.log(1.0001));
        setXDomain([data.currentPoolTick - tickRange, data.currentPoolTick + tickRange]);
      } else {
        setCurrentPriceLine(null);
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
        setCurrentPriceLine(null);
        setCurrentPoolSqrtPriceX96(null);
      } finally {
        setIsPoolStateLoading(false);
      }
    };

    if (selectedPoolId) fetchFromApi();
  }, [selectedPoolId, chainId, poolState, isStablePool]);

  // Effect to update price input strings when underlying ticks or base display token changes
  useEffect(() => {
    const numTickLower = parseInt(tickLower);
    const numTickUpper = parseInt(tickUpper);

    // Don't calculate prices if we're still using extreme initial values before pool data loads
    // or if we don't have current pool price data yet
    if (currentPoolTick === null || currentPrice === null) {
      setMinPriceInputString("");
      setMaxPriceInputString("");
      return;
    }
    
    // Also skip if using extreme tick values that haven't been preset-adjusted yet
    const tickRange = Math.abs(numTickUpper - numTickLower);
    if (tickRange > 1000000 && activePreset !== "Full Range") { // Extremely wide range suggests initial values
      setMinPriceInputString("");
      setMaxPriceInputString("");
      return;
    }
    
    // Additional safety check: if we haven't applied a preset yet and we're using extreme values, wait
    if (!initialDefaultApplied && (numTickLower === sdkMinTick || numTickUpper === sdkMaxTick)) {
      setMinPriceInputString("");
      setMaxPriceInputString("");
      return;
    }

    let valForMinInput: number | null = null;
    let valForMaxInput: number | null = null;

    const decimalsForToken0Display = 6;
    const decimalsForToken1Display = 6;

    const rawApiPriceAtTickLower = calculatedData?.priceAtTickLower ? parseFloat(calculatedData.priceAtTickLower) : null;
    const rawApiPriceAtTickUpper = calculatedData?.priceAtTickUpper ? parseFloat(calculatedData.priceAtTickUpper) : null;

    // Define token decimals early for use in both branches
    const token0Dec = tokenDefinitions[token0Symbol]?.decimals;
    const token1Dec = tokenDefinitions[token1Symbol]?.decimals;

    // Use API prices when available, fallback to tick calculation with same logic as currentPrice
    if (baseTokenForPriceDisplay === token0Symbol) {
        // Show prices denominated in token0 - need to invert API prices
        if (rawApiPriceAtTickLower !== null) {
            valForMinInput = 1 / rawApiPriceAtTickLower; // Invert API price
        } else if (!isNaN(numTickLower) && currentPrice) {
            // Fallback: use currentPrice as reference
            const currentPriceNum = parseFloat(currentPrice);
            const priceDelta = Math.pow(1.0001, numTickLower - (currentPoolTick || 0));
            valForMinInput = 1 / (currentPriceNum * priceDelta);
        }
        
        if (rawApiPriceAtTickUpper !== null) {
            valForMaxInput = 1 / rawApiPriceAtTickUpper; // Invert API price
        } else if (!isNaN(numTickUpper) && currentPrice) {
            // Fallback: use currentPrice as reference
            const currentPriceNum = parseFloat(currentPrice);
            const priceDelta = Math.pow(1.0001, numTickUpper - (currentPoolTick || 0));
            valForMaxInput = 1 / (currentPriceNum * priceDelta);
        }
    } else {
        // Show prices denominated in token1 - use API prices directly
        if (rawApiPriceAtTickLower !== null) {
            valForMaxInput = rawApiPriceAtTickLower; // API already handles decimals
        } else if (!isNaN(numTickLower) && currentPrice) {
            // Fallback: use currentPrice as reference for decimal handling
            const currentPriceNum = parseFloat(currentPrice);
            const priceDelta = Math.pow(1.0001, numTickLower - (currentPoolTick || 0));
            valForMaxInput = currentPriceNum * priceDelta;
        }
        
        if (rawApiPriceAtTickUpper !== null) {
            valForMinInput = rawApiPriceAtTickUpper; // API already handles decimals
        } else if (!isNaN(numTickUpper) && currentPrice) {
            // Fallback: use currentPrice as reference for decimal handling
            const currentPriceNum = parseFloat(currentPrice);
            const priceDelta = Math.pow(1.0001, numTickUpper - (currentPoolTick || 0));
            valForMinInput = currentPriceNum * priceDelta;
        }
    }

    let finalMinPriceString = "";
    let finalMaxPriceString = "";
    // Use optimal denomination for decimals like the chart, considering pool type
    const baseDisplayToken = optimalDenominationForDecimals;
    const poolCfg = selectedPoolId ? getPoolById(selectedPoolId) : null;
    const displayDecimals = getDecimalsForDenomination(baseDisplayToken, poolCfg?.type);

    // Formatting for Min Price String
    if (valForMinInput !== null && !isNaN(valForMinInput)) {
        if (valForMinInput >= 0 && valForMinInput < 1e-11) {
            finalMinPriceString = "0";
        } else if (!isFinite(valForMinInput) || valForMinInput > 1e30) {
            finalMinPriceString = "∞";
        } else {
            finalMinPriceString = valForMinInput.toFixed(displayDecimals);
        }
    } else {
        finalMinPriceString = ""; // Show empty for null/NaN values
    }

    // Formatting for Max Price String
    if (valForMaxInput !== null && !isNaN(valForMaxInput)) {
        if (valForMaxInput >= 0 && valForMaxInput < 1e-11) {
            finalMaxPriceString = "0";
        } else if (!isFinite(valForMaxInput) || valForMaxInput > 1e30) {
            finalMaxPriceString = "∞";
        } else {
            finalMaxPriceString = valForMaxInput.toFixed(displayDecimals);
        }
    } else {
        finalMaxPriceString = ""; // Show empty for null/NaN values
    }

    setMinPriceInputString(finalMinPriceString);
    setMaxPriceInputString(finalMaxPriceString);

  }, [tickLower, tickUpper, baseTokenForPriceDisplay, token0Symbol, token1Symbol, sdkMinTick, sdkMaxTick, calculatedData, optimalDenominationForDecimals, activePreset, initialDefaultApplied, currentPoolTick, currentPrice]);

  // Helper function to get formatted display balance
  const getFormattedDisplayBalance = (numericBalance: number | undefined, tokenSymbolForDecimals: TokenSymbol): string => {
    if (numericBalance === undefined || isNaN(numericBalance)) {
      numericBalance = 0;
    }
    if (numericBalance === 0) {
      return "0";
    }

    // Use 6-decimal cap for balance display
    const formatted = numericBalance.toFixed(6);
    return formatted;
  };

  // Display balance calculations
  const displayToken0Balance = isLoadingToken0Balance
    ? <span className="inline-block h-3 w-16 bg-muted/60 rounded animate-pulse" />
    : (token0BalanceData ? getFormattedDisplayBalance(parseFloat(token0BalanceData.formatted), token0Symbol) : "~");

  const displayToken1Balance = isLoadingToken1Balance
    ? <span className="inline-block h-3 w-16 bg-muted/60 rounded animate-pulse" />
    : (token1BalanceData ? getFormattedDisplayBalance(parseFloat(token1BalanceData.formatted), token1Symbol) : "~");

  // Handle selecting a preset from dropdown
  const handleSelectPreset = (preset: string) => {
    resetTransaction();
    setActivePreset(preset);
    setShowPresetSelector(false);
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

  // State for showing inline preset selector
  const [showPresetSelector, setShowPresetSelector] = useState(false);
  
  // State for editing price range
  const [editingMinPrice, setEditingMinPrice] = useState<string>("");
  const [editingMaxPrice, setEditingMaxPrice] = useState<string>("");

  // Click outside handler to close preset selector
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showPresetSelector) {
        const target = event.target as Element;
        if (!target.closest('.preset-selector')) {
          setShowPresetSelector(false);
        }
      }
      if (editingSide) {
        const target = event.target as Element;
        if (!target.closest('.price-range-editor')) {
          handleCancelPriceRangeEdit();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPresetSelector, editingSide]);

  // Handle price input change with immediate updates
  const handlePriceInputChange = (side: 'min' | 'max', value: string) => {
    if (side === 'min') {
      setEditingMinPrice(value);
    } else {
      setEditingMaxPrice(value);
    }

    // Process the input immediately for better UX
    const newTick = convertPriceToValidTick(value, side === 'max');
    if (newTick !== null) {
      if (side === 'min') {
        if (baseTokenForPriceDisplay === token0Symbol) {
          // Min price sets tickLower for token0 denomination
          if (newTick < parseInt(tickUpper)) {
            setTickLower(newTick.toString());
            setInitialDefaultApplied(true);
            setActivePreset(null); // Clear preset when manually editing
          }
        } else {
          // Min price sets tickUpper for token1 denomination
          if (newTick > parseInt(tickLower)) {
            setTickUpper(newTick.toString());
            setInitialDefaultApplied(true);
            setActivePreset(null); // Clear preset when manually editing
          }
        }
      } else {
        if (baseTokenForPriceDisplay === token0Symbol) {
          // Max price sets tickUpper for token0 denomination
          if (newTick > parseInt(tickLower)) {
            setTickUpper(newTick.toString());
            setInitialDefaultApplied(true);
            setActivePreset(null); // Clear preset when manually editing
          }
        } else {
          // Max price sets tickLower for token1 denomination
          if (newTick < parseInt(tickUpper)) {
            setTickLower(newTick.toString());
            setInitialDefaultApplied(true);
            setActivePreset(null); // Clear preset when manually editing
          }
        }
      }
    }
  };

  // Helper function to convert price to nearest valid tick
  const convertPriceToValidTick = useCallback((priceStr: string, isMaxPrice: boolean): number | null => {
    const normalizedStr = (priceStr || '').replace(/[\s,]/g, '');
    const numericPrice = parseFloat(normalizedStr);
    const isInfinityInput = normalizedStr.trim().toLowerCase() === "∞" || normalizedStr.trim().toLowerCase() === "infinity" || normalizedStr.trim().toLowerCase() === "infinite";

    // Handle empty or invalid input
    if (!normalizedStr.trim() || (isNaN(numericPrice) && !isInfinityInput)) {
      return null;
    }

    // Handle infinity input
    if (isInfinityInput) {
      return isMaxPrice ? sdkMaxTick : sdkMinTick;
    }

    // Handle valid numeric input
    if (isNaN(numericPrice) || numericPrice <= 0) {
      return null;
    }

    // Need current price and pool tick as reference points to match display calculation
    if (!currentPrice || currentPoolTick === null) {
      return null;
    }

    const currentPriceNum = parseFloat(currentPrice);
    if (isNaN(currentPriceNum) || currentPriceNum <= 0) {
      return null;
    }

    let newTick: number;
    
    if (baseTokenForPriceDisplay === token0Symbol) {
      // Price is denominated in token0 - we need to invert to match display logic
      // Display calculation: 1 / (currentPrice * Math.pow(1.0001, tick - currentPoolTick))
      // So: price = 1 / (currentPrice * Math.pow(1.0001, tick - currentPoolTick))
      // Solving for tick: Math.pow(1.0001, tick - currentPoolTick) = 1 / (price * currentPrice)
      // tick - currentPoolTick = log(1 / (price * currentPrice)) / log(1.0001)
      // tick = currentPoolTick + log(1 / (price * currentPrice)) / log(1.0001)
      newTick = currentPoolTick + Math.log(1 / (numericPrice * currentPriceNum)) / Math.log(1.0001);
    } else {
      // Price is denominated in token1 - direct calculation to match display logic
      // Display calculation: currentPrice * Math.pow(1.0001, tick - currentPoolTick)
      // So: price = currentPrice * Math.pow(1.0001, tick - currentPoolTick)
      // Solving for tick: Math.pow(1.0001, tick - currentPoolTick) = price / currentPrice
      // tick - currentPoolTick = log(price / currentPrice) / log(1.0001)
      // tick = currentPoolTick + log(price / currentPrice) / log(1.0001)
      newTick = currentPoolTick + Math.log(numericPrice / currentPriceNum) / Math.log(1.0001);
    }

    // Check for invalid results
    if (!isFinite(newTick) || isNaN(newTick)) {
      return null;
    }

    // Round to nearest valid tick spacing
    newTick = Math.round(newTick / defaultTickSpacing) * defaultTickSpacing;

    // Clamp to valid range
    newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));

    return Math.round(newTick); // Ensure integer result
  }, [baseTokenForPriceDisplay, token0Symbol, defaultTickSpacing, sdkMinTick, sdkMaxTick, currentPrice, currentPoolTick]);

  // Handle applying edited prices
  const handleApplyPriceRange = () => {
    setEditingSide(null);
    
    let hasChanges = false;
    let newTickLower = parseInt(tickLower);
    let newTickUpper = parseInt(tickUpper);
    
    // Always map 'min' to lower price display and 'max' to higher price display
    // The convertPriceToValidTick function handles the inversion internally
    
    // Process min price input (always for the lower displayed price)
    if (editingMinPrice !== minPriceInputString) {
      const newTick = convertPriceToValidTick(editingMinPrice, false);
      if (newTick !== null) {
        // When inverted, the "min" display price corresponds to tickUpper
        if (isInverted) {
          newTickUpper = newTick;
        } else {
          newTickLower = newTick;
        }
        hasChanges = true;
      }
    }
    
    // Process max price input (always for the higher displayed price)
    if (editingMaxPrice !== maxPriceInputString) {
      const newTick = convertPriceToValidTick(editingMaxPrice, true);
      if (newTick !== null) {
        // When inverted, the "max" display price corresponds to tickLower
        if (isInverted) {
          newTickLower = newTick;
        } else {
          newTickUpper = newTick;
        }
        hasChanges = true;
      }
    }
    
    // Apply only if resulting ticks form a valid range; avoid error toast on manual input
    if (hasChanges && newTickLower < newTickUpper) {
      // Apply the changes
      if (newTickLower !== parseInt(tickLower)) {
        setTickLower(newTickLower.toString());
        setInitialDefaultApplied(true);
      }
      if (newTickUpper !== parseInt(tickUpper)) {
        setTickUpper(newTickUpper.toString());
        setInitialDefaultApplied(true);
      }
    }
    
    // Reset editing state
    setEditingMinPrice("");
    setEditingMaxPrice("");
  };

  // Handle canceling price range edit
  const handleCancelPriceRangeEdit = () => {
    setEditingSide(null);
    setEditingMinPrice("");
    setEditingMaxPrice("");
  };

  const handleClickToEditPrice = (side: 'min' | 'max') => {
    setShowPresetSelector(false);
    setEditingSide(side);
    if (side === 'min') {
      const seed = rangeLabels ? rangeLabels.left : (minPriceInputString || "");
      setEditingMinPrice(seed.replace(/,/g, ''));
    } else {
      const seed = rangeLabels ? rangeLabels.right : (maxPriceInputString || "");
      setEditingMaxPrice(seed.replace(/,/g, ''));
    }
  };

  // Removed left/right remapping: left always edits "min" and right edits "max".

  // Apply domain constraints to ensure valid tick range
  const applyDomainConstraints = useCallback((minTick: number, maxTick: number): [number, number] => {
    const constrainedMin = Math.max(sdkMinTick, Math.min(sdkMaxTick - 1, minTick));
    const constrainedMax = Math.max(constrainedMin + 1, Math.min(sdkMaxTick, maxTick));
    return [constrainedMin, constrainedMax];
  }, [sdkMinTick, sdkMaxTick]);

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
      setCurrentTransactionStep('idle');
      setPermitSignature(undefined);
    } catch (error) {
      // Handle error
    }
  };

  // Old handlePrepareAndSubmit removed - now using TransactionFlowPanel

  const signPermit = useCallback(async (): Promise<string | undefined> => {
    // Only valid for regular (non-zap) mode - zap mode uses different permit flow
    if (isZapMode || !approvalData || !('permitBatchData' in approvalData) || !approvalData.permitBatchData || !approvalData.signatureDetails) {
      return undefined;
    }

    if (!signer) {
      showErrorToast("Wallet not connected");
      return undefined;
    }

    try {
      // Toast removed - shown by TransactionFlowPanel
      const valuesToSign = approvalData.permitBatchData.values || approvalData.permitBatchData;
      const signature = await (signer as any)._signTypedData(
        approvalData.signatureDetails.domain,
        approvalData.signatureDetails.types,
        valuesToSign
      );
      setPermitSignature(signature);

      const currentTime = Math.floor(Date.now() / 1000);
      const sigDeadline = valuesToSign?.sigDeadline || valuesToSign?.details?.[0]?.expiration || 0;
      const durationSeconds = Number(sigDeadline) - currentTime;
      let durationFormatted = "";
      if (durationSeconds >= 86400) {
        const days = Math.ceil(durationSeconds / 86400);
        durationFormatted = `${days} day${days > 1 ? 's' : ''}`;
      } else if (durationSeconds >= 3600) {
        const hours = Math.ceil(durationSeconds / 3600);
        durationFormatted = `${hours} hour${hours > 1 ? 's' : ''}`;
      } else {
        const minutes = Math.ceil(durationSeconds / 60);
        durationFormatted = `${minutes} minute${minutes > 1 ? 's' : ''}`;
      }

      toast.success('Batch Signature Complete', {
        icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
        description: `Batch permit signed successfully for ${durationFormatted}`
      });
      return signature;
    } catch (error: any) {
      const isUserRejection =
        error.message?.toLowerCase().includes('user rejected') ||
        error.message?.toLowerCase().includes('user denied') ||
        error.code === 4001;

      if (!isUserRejection) {
        showErrorToast("Signature Error", error.message);
      }
      throw error;
    }
  }, [approvalData, signer, isZapMode]);

  // Old getButtonText removed - now using TransactionFlowPanel

  // Effect to auto-apply active percentage preset when currentPrice changes OR when activePreset changes
  useEffect(() => {
    // Ensure currentPrice is valid and we have a preset that requires calculation
    if (activePreset && ["±3%", "±8%", "±15%", "±1%", "±0.5%", "±0.1%"].includes(activePreset)) {
        let percentage = 0;
        if (activePreset === "±3%") percentage = 0.03;
        else if (activePreset === "±8%") percentage = 0.08;
        else if (activePreset === "±15%") percentage = 0.15;
        else if (activePreset === "±1%") percentage = 0.01;
        else if (activePreset === "±0.5%") percentage = 0.005;
        else if (activePreset === "±0.1%") percentage = 0.001;

        let newTickLower: number;
        let newTickUpper: number;

        if (currentPoolTick !== null) {
            // Calculate based on currentPoolTick
            const priceRatioUpper = 1 + percentage;
            const priceRatioLower = 1 - percentage;

            const tickDeltaUpper = Math.round(Math.log(priceRatioUpper) / Math.log(1.0001));
            const tickDeltaLower = Math.round(Math.log(priceRatioLower) / Math.log(1.0001)); // Will be negative

            newTickLower = currentPoolTick + tickDeltaLower;
            newTickUpper = currentPoolTick + tickDeltaUpper;
        } else if (currentPrice) {
            // Fallback to currentPrice if currentPoolTick is not yet available
            const numericCurrentPrice = parseFloat(currentPrice);
            if (isNaN(numericCurrentPrice)) {
                showErrorToast("Invalid Price");
                return;
            }
            const priceLowerTarget = numericCurrentPrice * (1 - percentage);
            const priceUpperTarget = numericCurrentPrice * (1 + percentage);

            newTickLower = Math.log(priceLowerTarget) / Math.log(1.0001);
            newTickUpper = Math.log(priceUpperTarget) / Math.log(1.0001);
        } else {
            // Cannot apply preset yet, waiting for pool data
            return;
        }

        // Align and clamp
        newTickLower = Math.floor(newTickLower / defaultTickSpacing) * defaultTickSpacing;
        newTickUpper = Math.ceil(newTickUpper / defaultTickSpacing) * defaultTickSpacing;

        newTickLower = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickLower));
        newTickUpper = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickUpper));

        if (newTickUpper - newTickLower >= defaultTickSpacing) {
            if (newTickLower.toString() !== tickLower || newTickUpper.toString() !== tickUpper) {
                resetTransaction();
                setTickLower(newTickLower.toString());
                setTickUpper(newTickUpper.toString());
                setInitialDefaultApplied(true); 
                // Reset viewbox for percentage presets using a constant fraction of the selection width.
                // Use ~33% of selection width as margin on each side for ALL non-Full Range presets.
                // Full Range is handled in its own branch below.
                resetChartViewbox(newTickLower, newTickUpper, 1/3, 1/3);
            }
        } else {
             showInfoToast("Preset Range Too Narrow");
        }
    } else if (activePreset === "Full Range") {
        if (tickLower !== sdkMinTick.toString() || tickUpper !== sdkMaxTick.toString()) {
            resetTransaction();
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
        }
    }
  }, [currentPrice, currentPoolTick, activePreset, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper, resetTransaction, isStablePool, resetChartViewbox]);


  // Panning Handlers for Chart
  const handlePanMouseDown = (e: any) => {
    if (e && e.chartX) {
      setIsPanning(true);
      panStartXRef.current = e.chartX;
      panStartDomainRef.current = [...xDomain] as [number, number];
      if (chartContainerRef.current) chartContainerRef.current.style.cursor = 'grabbing';
    }
  };

  const handlePanMouseMove = (e: any) => {
    if (isPanning && e && e.chartX && panStartXRef.current !== null && panStartDomainRef.current !== null) {
      const currentChartX = e.chartX;
      const dxChartPixels = currentChartX - panStartXRef.current;

      const chartWidthInPixels = chartContainerRef.current?.clientWidth || 400;
      const startDomainRange = panStartDomainRef.current[1] - panStartDomainRef.current[0];
      
      const domainShift = (dxChartPixels / chartWidthInPixels) * startDomainRange;
      
      let newMin = panStartDomainRef.current[0] - domainShift;
      let newMax = panStartDomainRef.current[1] - domainShift;

      if (newMin >= newMax) {
        const safetyGap = 0.1;
        newMax = newMin + safetyGap;
      }

      const [constrainedMinTick, constrainedMaxTick] = applyDomainConstraints(newMin, newMax);
      setXDomain([constrainedMinTick, constrainedMaxTick]);
    }
  };

  const handlePanMouseUpOrLeave = () => {
    if (isPanning) {
      setIsPanning(false);
      panStartXRef.current = null;
      panStartDomainRef.current = null;
      if (chartContainerRef.current) chartContainerRef.current.style.cursor = 'grab';
    }
  };

  // Range drag handlers
  const handleRangeDragStart = (e: any) => {
    if (!e || !e.chartX) return;
    
    const currentTickLower = parseInt(tickLower);
    const currentTickUpper = parseInt(tickUpper);
    const chartX = e.chartX;
    
    // Determine which side of the range is being dragged
    const chartWidth = chartContainerRef.current?.clientWidth || 400;
    const [minTick, maxTick] = xDomain;
    const tickRange = maxTick - minTick;
    const pixelsPerTick = chartWidth / tickRange;
    
    const leftBoundaryX = ((currentTickLower - minTick) / tickRange) * chartWidth;
    const rightBoundaryX = ((currentTickUpper - minTick) / tickRange) * chartWidth;
    
    const dragThreshold = 20; // pixels from boundary to consider it a drag
    
    if (Math.abs(chartX - leftBoundaryX) < dragThreshold) {
      setDragSide('left');
    } else if (Math.abs(chartX - rightBoundaryX) < dragThreshold) {
      setDragSide('right');
    } else if (chartX > leftBoundaryX && chartX < rightBoundaryX) {
      setDragSide('center');
    } else {
      return; // Not dragging range
    }
    
    setIsDraggingRange(dragSide);
    setDragStartX(chartX);
    setDragStartTickLower(currentTickLower);
    setDragStartTickUpper(currentTickUpper);
    
    if (chartContainerRef.current) {
      chartContainerRef.current.style.cursor = 'grabbing';
    }
  };

  const handleRangeDragMove = (e: any) => {
    if (!isDraggingRange || !e || !e.chartX || dragStartX === null || 
        dragStartTickLower === null || dragStartTickUpper === null || !dragSide) return;
    
    const chartWidth = chartContainerRef.current?.clientWidth || 400;
    const [minTick, maxTick] = xDomain;
    const tickRange = maxTick - minTick;
    const pixelsPerTick = chartWidth / tickRange;
    
    const deltaX = e.chartX - dragStartX;
    const deltaTicks = deltaX / pixelsPerTick;
    
    let newTickLower = dragStartTickLower;
    let newTickUpper = dragStartTickUpper;
    
    if (dragSide === 'left') {
      newTickLower = Math.max(sdkMinTick, Math.min(sdkMaxTick, dragStartTickLower + deltaTicks));
      newTickLower = Math.ceil(newTickLower / defaultTickSpacing) * defaultTickSpacing;
      if (newTickLower >= newTickUpper - defaultTickSpacing) {
        newTickLower = newTickUpper - defaultTickSpacing;
      }
    } else if (dragSide === 'right') {
      newTickUpper = Math.max(sdkMinTick, Math.min(sdkMaxTick, dragStartTickUpper + deltaTicks));
      newTickUpper = Math.floor(newTickUpper / defaultTickSpacing) * defaultTickSpacing;
      if (newTickUpper <= newTickLower + defaultTickSpacing) {
        newTickUpper = newTickLower + defaultTickSpacing;
      }
    } else if (dragSide === 'center') {
      const rangeWidth = dragStartTickUpper - dragStartTickLower;
      const centerTick = (dragStartTickLower + dragStartTickUpper) / 2;
      const newCenterTick = centerTick + deltaTicks;
      
      newTickLower = Math.max(sdkMinTick, Math.min(sdkMaxTick - rangeWidth, newCenterTick - rangeWidth / 2));
      newTickUpper = Math.max(sdkMinTick + rangeWidth, Math.min(sdkMaxTick, newCenterTick + rangeWidth / 2));
      
      // Align to tick spacing
      newTickLower = Math.ceil(newTickLower / defaultTickSpacing) * defaultTickSpacing;
      newTickUpper = Math.floor(newTickUpper / defaultTickSpacing) * defaultTickSpacing;
    }
    
    if (newTickLower !== parseInt(tickLower) || newTickUpper !== parseInt(tickUpper)) {
      resetTransaction();
      setTickLower(newTickLower.toString());
      setTickUpper(newTickUpper.toString());
      setInitialDefaultApplied(true);
      // Auto-zoom: ensure selected range is at least 20% of current viewport
      const [viewMin, viewMax] = xDomain;
      const viewSize = viewMax - viewMin;
      const selSize = newTickUpper - newTickLower;
      const minSelRatio = 0.2;
      if (viewSize > 0 && selSize / viewSize < minSelRatio) {
        const targetSize = Math.max(defaultTickSpacing * 10, viewSize * minSelRatio);
        const center = (newTickLower + newTickUpper) / 2;
        const newMin = center - targetSize / 2;
        const newMax = center + targetSize / 2;
        const [cMin, cMax] = applyDomainConstraints(newMin, newMax);
        setXDomain([cMin, cMax]);
      }
    }
  };

  const handleRangeDragEnd = () => {
    setIsDraggingRange(null);
    setDragStartX(null);
    setDragStartTickLower(null);
    setDragStartTickUpper(null);
    setDragSide(null);
    
    if (chartContainerRef.current) {
      chartContainerRef.current.style.cursor = 'grab';
    }
  };

  // Debounced function to update tickLower from minPriceInputString
  const debouncedUpdateTickLower = useCallback(
    debounce((priceStr: string) => {
      const numericPrice = parseFloat(priceStr);

      if (!isInverted) {
        if (priceStr.trim() === "0") {
          const newTick = sdkMinTick;
          if (newTick < parseInt(tickUpper)) {
            setTickLower(newTick.toString());
            setInitialDefaultApplied(true);
            // Reset viewbox for manual range change
            resetChartViewbox(newTick, parseInt(tickUpper));
          } else {
            showErrorToast("Invalid Range", "Min tick >= max tick");
          }
          return;
        }
        if (isNaN(numericPrice) || numericPrice < 0) return;

        const priceToConvert = numericPrice;
        if (priceToConvert <= 0) {
          showInfoToast("Invalid Tick Price");
          return;
        }
        let newTick = Math.log(priceToConvert) / Math.log(1.0001);
        newTick = Math.ceil(newTick / defaultTickSpacing) * defaultTickSpacing;
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (activePreset === "Full Range") {
          // When in Full Range, keep the other bound pinned to its extreme
          const pairedUpper = sdkMaxTick;
          setTickLower(newTick.toString());
          setTickUpper(pairedUpper.toString());
          setInitialDefaultApplied(true);
          resetChartViewbox(newTick, pairedUpper);
        } else if (newTick < parseInt(tickUpper)) {
          setTickLower(newTick.toString());
          setInitialDefaultApplied(true);
          resetChartViewbox(newTick, parseInt(tickUpper));
        } else {
          showErrorToast("Invalid Range", "Min > max price");
        }
      } else { // inverted: left edits upper tick (visual flip)
        if (priceStr.trim() === "0") {
          const newTick = sdkMaxTick;
          if (newTick > parseInt(tickLower)) {
            setTickUpper(newTick.toString());
            setInitialDefaultApplied(true);
            // Reset viewbox for manual range change
            resetChartViewbox(parseInt(tickLower), newTick);
          } else {
            showErrorToast("Invalid Range", "Max tick <= min tick");
          }
          return;
        }
        if (isNaN(numericPrice) || numericPrice < 0) return;
        if (numericPrice === 0) return;

        const priceToConvert = 1 / numericPrice;
        if (priceToConvert <= 0) {
          showInfoToast("Invalid Tick Price");
          return;
        }
        let newTick = Math.log(priceToConvert) / Math.log(1.0001);
        newTick = Math.floor(newTick / defaultTickSpacing) * defaultTickSpacing;
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (activePreset === "Full Range") {
          const pairedLower = sdkMinTick;
          setTickUpper(newTick.toString());
          setTickLower(pairedLower.toString());
          setInitialDefaultApplied(true);
          resetChartViewbox(pairedLower, newTick);
        } else if (newTick > parseInt(tickLower)) {
          setTickUpper(newTick.toString());
          setInitialDefaultApplied(true);
          resetChartViewbox(parseInt(tickLower), newTick);
        } else {
          showErrorToast("Invalid Range", "Invalid tick range");
        }
      }
    }, 750), 
    [isInverted, token0Symbol, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper, resetChartViewbox]
  );

  // Debounced function to update tickUpper from maxPriceInputString
  const debouncedUpdateTickUpper = useCallback(
    debounce((priceStr: string) => {
      const numericPrice = parseFloat(priceStr);
      const isInfinityInput = priceStr.trim().toLowerCase() === "∞" || priceStr.trim().toLowerCase() === "infinity" || priceStr.trim().toLowerCase() === "infinite";

      if (!isInverted) {
        if (isInfinityInput) {
          const newTick = sdkMaxTick;
          if (newTick > parseInt(tickLower)) {
            setTickUpper(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
            showErrorToast("Invalid Range", "Max tick <= min tick");
          }
          return;
        }
        if (isNaN(numericPrice) || numericPrice <= 0) return;

        const priceToConvert = numericPrice;
        let newTick = Math.log(priceToConvert) / Math.log(1.0001);
        newTick = Math.floor(newTick / defaultTickSpacing) * defaultTickSpacing;
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (newTick > parseInt(tickLower)) {
          setTickUpper(newTick.toString());
          setInitialDefaultApplied(true);
        } else {
          showErrorToast("Invalid Range", "Max < min price");
        }
      } else { // inverted: right edits lower tick (visual flip)
        if (isInfinityInput) {
          const newTick = sdkMinTick;
          if (newTick < parseInt(tickUpper)) {
            setTickLower(newTick.toString());
            setInitialDefaultApplied(true);
            // Reset viewbox for manual range change
            resetChartViewbox(newTick, parseInt(tickUpper));
          } else {
            showErrorToast("Invalid Range", "Min tick >= max tick");
          }
          return;
        }
        if (isNaN(numericPrice) || numericPrice <= 0) return;
        
        const priceToConvert = 1 / numericPrice;
        if (priceToConvert <= 0) {
          showInfoToast("Invalid Tick Price");
          return;
        }
        let newTick = Math.log(priceToConvert) / Math.log(1.0001);
        newTick = Math.ceil(newTick / defaultTickSpacing) * defaultTickSpacing;
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (newTick < parseInt(tickUpper)) {
          setTickLower(newTick.toString());
          setInitialDefaultApplied(true);
          // Reset viewbox for manual range change
          resetChartViewbox(newTick, parseInt(tickUpper));
        } else {
          showErrorToast("Invalid Range", "Invalid tick range");
        }
      }
    }, 750),
    [isInverted, token0Symbol, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper, resetChartViewbox]
  );

  // Helper function to clean amount values before sending to API
  const cleanAmountForAPI = (amount: string): string => {
    return amount.replace('...', '').trim();
  };

  // Calculate amount based on input and check approvals
  const debouncedCalculateAmountAndCheckApprovals = useCallback(
    debounce(async (currentAmount0: string, currentAmount1: string, currentTickLower: string, currentTickUpper: string, inputSide: 'amount0' | 'amount1', isShowingTransactionSteps: boolean) => {
      if (!chainId) return;

      const tl = parseInt(currentTickLower);
      const tu = parseInt(currentTickUpper);

      if (isNaN(tl) || isNaN(tu) || tl >= tu) {
        setCalculatedData(null);
        // Only reset price impact if not showing transaction steps (it was set on Deposit click)
        if (!isShowingTransactionSteps) {
          setPriceImpact(null);
        }
        if (inputSide === 'amount0') {
          setAmount1("");
          setAmount1FullPrecision("");
        } else {
          setAmount0("");
          setAmount0FullPrecision("");
        }
        showInfoToast("Invalid Range");
        return;
      }

      const primaryAmount = inputSide === 'amount0' ? cleanAmountForAPI(currentAmount0) : cleanAmountForAPI(currentAmount1);
      const primaryTokenSymbol = inputSide === 'amount0' ? token0Symbol : token1Symbol;
      const secondaryTokenSymbol = inputSide === 'amount0' ? token1Symbol : token0Symbol;
      
      if (primaryAmount === "Error" || isNaN(parseFloat(primaryAmount))) {
        setCalculatedData(null);
        // Only reset price impact if not showing transaction steps
        if (!isShowingTransactionSteps) {
          setPriceImpact(null);
        }
        if (inputSide === 'amount0' && currentAmount1 !== "Error") setAmount1("");
        else if (inputSide === 'amount1' && currentAmount0 !== "Error") setAmount0("");
        return;
      }
      
      if (!primaryAmount || parseFloat(primaryAmount) <= 0) {
        setCalculatedData(null);
        // Only reset price impact if not showing transaction steps
        if (!isShowingTransactionSteps) {
          setPriceImpact(null);
        }
        if (inputSide === 'amount0') {
          setAmount1("");
          setAmount1FullPrecision("");
        } else {
          setAmount0("");
          setAmount0FullPrecision("");
        }
        return;
      }

      setIsCalculating(true);
      setCalculatedData(null);
      // Reset zap quote and price impact during input phase - will be calculated on Deposit click
      // BUT: Don't reset if we're already showing transaction steps (price impact was set on Deposit click)
      if (!isShowingTransactionSteps) {
        setZapQuote(null);
        setPriceImpact(null);
      }

      try {
        // For zap mode in input phase, use simple pool price estimation (same as non-zap)
        // Heavy work (swap quote, price impact) happens when Deposit is clicked
        // Original logic for both zap and non-zap mode (simple estimation)
        // Check if position is OOR - follow Uniswap's pattern
        const isOOR = currentPoolTick !== null && currentPoolTick !== undefined &&
                      (currentPoolTick < tl || currentPoolTick > tu);

        let result;

        if (isOOR) {
          const primaryTokenDef = tokenDefinitions[primaryTokenSymbol];
          const primaryAmountWei = viemParseUnits(primaryAmount, primaryTokenDef.decimals);

          result = {
            liquidity: '0',
            finalTickLower: tl,
            finalTickUpper: tu,
            amount0: inputSide === 'amount0' ? primaryAmountWei.toString() : '0',
            amount1: inputSide === 'amount1' ? primaryAmountWei.toString() : '0',
            currentPoolTick,
            currentPrice: currentPrice || undefined,
            priceAtTickLower: undefined,
            priceAtTickUpper: undefined
          };
        } else {
          const { calculateLiquidityParameters } = await import('@/lib/liquidity-math');
          result = await calculateLiquidityParameters({
            token0Symbol,
            token1Symbol,
            inputAmount: primaryAmount,
            inputTokenSymbol: primaryTokenSymbol,
            userTickLower: tl,
            userTickUpper: tu,
            chainId,
          });
        }
        
        setCalculatedData({
          liquidity: result.liquidity, 
          finalTickLower: result.finalTickLower, 
          finalTickUpper: result.finalTickUpper, 
          amount0: result.amount0, 
          amount1: result.amount1, 
          currentPoolTick: result.currentPoolTick,
          currentPrice: result.currentPrice,
          priceAtTickLower: result.priceAtTickLower,
          priceAtTickUpper: result.priceAtTickUpper
        });

        if (typeof result.currentPoolTick === 'number') {
          setCurrentPoolTick(result.currentPoolTick);
        }
        if (result.currentPrice) {
          setCurrentPrice(result.currentPrice); 
          const numericCurrentPrice = parseFloat(result.currentPrice);
          if (!isNaN(numericCurrentPrice)) {
            setCurrentPriceLine(numericCurrentPrice);
          } else {
            setCurrentPriceLine(null);
          }
        } else {
          setCurrentPriceLine(null);
        }

        if (inputSide === 'amount0') {
          try {
            // Format amount1 using token1Symbol decimals (result.amount1 is always in token1 decimals)
            const token1Decimals = tokenDefinitions[token1Symbol]?.decimals;
            if (token1Decimals === undefined) {
              throw new Error(`Missing decimals for token ${token1Symbol}`);
            }
            const amount1BigInt = BigInt(result.amount1);
            // SDK returns maxUint256 for amounts not needed in single-sided (OOR) positions
            const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
            if (amount1BigInt >= MAX_UINT256 / 2n) {
              // If amount is unreasonably large (>= half of maxUint256), treat as 0 (not needed)
              setAmount1("0");
              setAmount1FullPrecision("0");
            } else {
              const rawFormattedAmount = viemFormatUnits(amount1BigInt, token1Decimals);
              const displayAmount = formatTokenDisplayAmount(rawFormattedAmount, token1Symbol);
              setAmount1(displayAmount);
              setAmount1FullPrecision(rawFormattedAmount); // Store full precision
            }
          } catch (e) {
            setAmount1("Error");
            showErrorToast("Calculation Error", "Amount parse failed");
            setCalculatedData(null);
          }
        } else {
          try {
            // Format amount0 using token0Symbol decimals (result.amount0 is always in token0 decimals)
            const token0Decimals = tokenDefinitions[token0Symbol]?.decimals;
            if (token0Decimals === undefined) {
              throw new Error(`Missing decimals for token ${token0Symbol}`);
            }
            const amount0BigInt = BigInt(result.amount0);
            // SDK returns maxUint256 for amounts not needed in single-sided (OOR) positions
            const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
            if (amount0BigInt >= MAX_UINT256 / 2n) {
              // If amount is unreasonably large (>= half of maxUint256), treat as 0 (not needed)
              setAmount0("0");
              setAmount0FullPrecision("0");
            } else {
              const rawFormattedAmount = viemFormatUnits(amount0BigInt, token0Decimals);
              const displayAmount = formatTokenDisplayAmount(rawFormattedAmount, token0Symbol);
              setAmount0(displayAmount);
              setAmount0FullPrecision(rawFormattedAmount); // Store full precision
            }
          } catch (e) {
            setAmount0("Error");
            showErrorToast("Calculation Error", "Amount parse failed");
            setCalculatedData(null);
          }
        }
      } catch (error: any) {
        showErrorToast("Calculation Error", "Estimation failed");
        setCalculatedData(null);
        // Only reset price impact if not showing transaction steps (it was set on Deposit click)
        if (!isShowingTransactionSteps) {
          setPriceImpact(null);
        }
        setCurrentPrice(null);
        setCurrentPoolTick(null);
        setCurrentPriceLine(null);  
        if (inputSide === 'amount0' && currentAmount1 !== "Error") setAmount1(""); 
        else if (inputSide === 'amount1' && currentAmount0 !== "Error") setAmount0("");
      } finally {
        setIsCalculating(false);
      }
    }, 700),
    [accountAddress, chainId, token0Symbol, token1Symbol, zapSlippageToleranceBps, updateAutoSlippage]
  );

  // Trigger calculation when needed
  useEffect(() => {
    const currentDeps = { amount0, amount1, tickLower, tickUpper, activeInputSide, zapSlippageToleranceBps: zapSlippageToleranceBps };
    let shouldCallDebouncedCalc = false;

    if (activeInputSide === 'amount0') {
      if (
        currentDeps.amount0 !== prevCalculationDeps.current.amount0 ||
        currentDeps.tickLower !== prevCalculationDeps.current.tickLower ||
        currentDeps.tickUpper !== prevCalculationDeps.current.tickUpper ||
        currentDeps.activeInputSide !== prevCalculationDeps.current.activeInputSide ||
        (isZapMode && currentDeps.zapSlippageToleranceBps !== prevCalculationDeps.current.zapSlippageToleranceBps)
      ) {
        shouldCallDebouncedCalc = true;
      }
    } else if (activeInputSide === 'amount1') {
      if (
        currentDeps.amount1 !== prevCalculationDeps.current.amount1 ||
        currentDeps.tickLower !== prevCalculationDeps.current.tickLower ||
        currentDeps.tickUpper !== prevCalculationDeps.current.tickUpper ||
        currentDeps.activeInputSide !== prevCalculationDeps.current.activeInputSide ||
        (isZapMode && currentDeps.zapSlippageToleranceBps !== prevCalculationDeps.current.zapSlippageToleranceBps)
      ) {
        shouldCallDebouncedCalc = true;
      }
    } else {
      // No active input side, but amounts or ticks might have changed
      if (
        currentDeps.amount0 !== prevCalculationDeps.current.amount0 ||
        currentDeps.amount1 !== prevCalculationDeps.current.amount1 ||
        currentDeps.tickLower !== prevCalculationDeps.current.tickLower ||
        currentDeps.tickUpper !== prevCalculationDeps.current.tickUpper ||
        (isZapMode && currentDeps.zapSlippageToleranceBps !== prevCalculationDeps.current.zapSlippageToleranceBps)
      ) {
        // Only calculate if there's something to calculate with
        if (parseFloat(currentDeps.amount0) > 0 || parseFloat(currentDeps.amount1) > 0) {
            shouldCallDebouncedCalc = true;
        }
      }
    }

    if (shouldCallDebouncedCalc) {
        const inputSideForCalc = activeInputSide || (parseFloat(amount0) > 0 ? 'amount0' : parseFloat(amount1) > 0 ? 'amount1' : null);
        if (inputSideForCalc) {
            const primaryAmount = inputSideForCalc === 'amount0' ? amount0 : amount1;
            const tlNum = parseInt(tickLower);
            const tuNum = parseInt(tickUpper);
            const ticksAreValid = !isNaN(tlNum) && !isNaN(tuNum) && tlNum < tuNum;

            if (parseFloat(primaryAmount || "0") > 0 && ticksAreValid) {
                debouncedCalculateAmountAndCheckApprovals(amount0, amount1, tickLower, tickUpper, inputSideForCalc, showingTransactionSteps);
            }
            // If primary amount is zero/invalid but was the active side, or ticks invalid, clear the other amount & calculated data.
            else if ((parseFloat(primaryAmount || "0") <= 0 && activeInputSide === inputSideForCalc) || !ticksAreValid) {
                if (inputSideForCalc === 'amount0') setAmount1(""); else setAmount0("");
                setCalculatedData(null);
                if (!ticksAreValid && (parseFloat(amount0) > 0 || parseFloat(amount1) > 0)){
                    showInfoToast("Invalid Range");
                }
            }
        } else {
             // Both amounts are effectively zero, or became zero/invalid, ensure cleanup
        setAmount0("");
        setAmount1("");
        setAmount0FullPrecision("");
        setAmount1FullPrecision("");
            setCalculatedData(null);
            resetTransaction();
            setShowingTransactionSteps(false);
            setCurrentTransactionStep('idle');
            setPermitSignature(undefined);
        }
    } else if (parseFloat(amount0) <= 0 && parseFloat(amount1) <= 0) {
        // Fallback: ensure cleanup if all amounts are zero or invalid, and no calculation was triggered.
        setCalculatedData(null);
        resetTransaction();
        setShowingTransactionSteps(false);
        setCurrentTransactionStep('idle');
        setPermitSignature(undefined);
    }

    prevCalculationDeps.current = currentDeps;
  }, [
    amount0,
    amount1,
    tickLower,
    tickUpper,
    activeInputSide,
    isZapMode,
    zapSlippageToleranceBps,
    showingTransactionSteps,
    debouncedCalculateAmountAndCheckApprovals,
    resetTransaction,
  ]);

  useEffect(() => {
    if (isDepositSuccess) {
      setAmount0("");
      setAmount1("");
      setAmount0FullPrecision("");
      setAmount1FullPrecision("");
      setCalculatedData(null);
      setShowingTransactionSteps(false);
      setCurrentTransactionStep('idle');
      setPermitSignature(undefined);

      resetTransaction();
      refetchApprovals();
    }
  }, [isDepositSuccess, resetTransaction, refetchApprovals]);

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
      const inputTokenSymbol = zapInputToken === 'token0' ? token0Symbol : token1Symbol;
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

  // Fetch pool metrics for APY calculation (cached per pool)
  // Wait for poolState.liquidity to be available before caching to avoid race condition
  useEffect(() => {
    const liquidity = poolState?.liquidity;
    if (!selectedPoolId || !liquidity) return;
    if (cachedPoolMetrics?.poolId === selectedPoolId && cachedPoolMetrics.poolLiquidity !== "0") return;

    (async () => {
      try {
        const resp = await fetch('/api/liquidity/pool-metrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ poolId: selectedPoolId, days: 7 })
        });
        if (resp.ok) {
          const data = await resp.json();
          setCachedPoolMetrics({
            poolId: selectedPoolId,
            metrics: data.metrics,
            poolLiquidity: liquidity
          });
        }
      } catch {}
    })();
  }, [selectedPoolId, cachedPoolMetrics, poolState?.liquidity]);

  // APY calculation effect
  useEffect(() => {
    // Early validation - don't show loading for invalid states
    if (!selectedPoolId || !tickLower || !tickUpper || !currentPoolSqrtPriceX96 || currentPoolTick === null) {
      setEstimatedApy("0.00");
      setIsCalculatingApy(false);
      return;
    }

    const lowerTick = parseInt(tickLower);
    const upperTick = parseInt(tickUpper);

    if (isNaN(lowerTick) || isNaN(upperTick) || lowerTick >= upperTick) {
      setEstimatedApy("0.00");
      setIsCalculatingApy(false);
      return;
    }

    if (!cachedPoolMetrics || cachedPoolMetrics.poolId !== selectedPoolId) {
      setIsCalculatingApy(true);
      return;
    }

    if (!cachedPoolMetrics.metrics || cachedPoolMetrics.metrics.days === 0) {
      setEstimatedApy("—");
      setIsCalculatingApy(false);
      return;
    }

    // Only show loading and calculate for valid states
    setIsCalculatingApy(true);

    const calculateApy = async () => {
      try {
        const poolConfig = getPoolById(selectedPoolId);
        if (!poolConfig) {
          setEstimatedApy("—");
          setIsCalculatingApy(false);
          return;
        }

        const token0Def = tokenDefinitions[token0Symbol];
        const token1Def = tokenDefinitions[token1Symbol];

        if (!token0Def || !token1Def) {
          setEstimatedApy("—");
          setIsCalculatingApy(false);
          return;
        }

        const sdkToken0 = new Token(targetChainId, getAddress(token0Def.address), token0Def.decimals, token0Symbol, token0Symbol);
        const sdkToken1 = new Token(targetChainId, getAddress(token1Def.address), token1Def.decimals, token1Symbol, token1Symbol);

        const sdkPool = new V4PoolSDK(
          sdkToken0,
          sdkToken1,
          V4_POOL_FEE,
          V4_POOL_TICK_SPACING,
          V4_POOL_HOOKS,
          JSBI.BigInt(currentPoolSqrtPriceX96),
          JSBI.BigInt(cachedPoolMetrics.poolLiquidity),
          currentPoolTick
        );

        const amount0Num = parseFloat(amount0 || '0');
        const amount1Num = parseFloat(amount1 || '0');
        const useDefaultAmount = amount0Num <= 0 && amount1Num <= 0;

        let apy: number;

        if (useDefaultAmount) {
          apy = await calculatePositionAPY(
            sdkPool,
            lowerTick,
            upperTick,
            cachedPoolMetrics.metrics as PoolMetrics,
            100
          );
        } else {
          const userLiquidity = calculatedData?.liquidity;
          apy = await calculateUserPositionAPY(
            sdkPool,
            lowerTick,
            upperTick,
            amount0,
            amount1,
            cachedPoolMetrics.metrics as PoolMetrics,
            userLiquidity
          );
        }

        setEstimatedApy(formatUserAPY(apy));
      } catch (error) {
        setEstimatedApy("—");
      } finally {
        setIsCalculatingApy(false);
      }
    };

    const timer = setTimeout(calculateApy, 200);
    return () => clearTimeout(timer);
  }, [selectedPoolId, tickLower, tickUpper, currentPoolSqrtPriceX96, currentPoolTick, token0Symbol, token1Symbol, amount0, amount1, calculatedData, cachedPoolMetrics]);

  // Wrapper for convertTickToPrice that uses component's sdkMinTick and sdkMaxTick
  const convertTickToPrice = useCallback((tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string): string => {
    return convertTickToPriceUtil(tick, currentPoolTick, currentPrice, baseTokenForPriceDisplay, token0Symbol, token1Symbol, sdkMinTick, sdkMaxTick);
  }, [sdkMinTick, sdkMaxTick]);

  const getPriceRangeDisplay = useCallback(() => {
    if (currentPoolTick === null || !currentPrice || !tickLower || !tickUpper) return null;
    const currentPriceNum = parseFloat(currentPrice);
    const lowerTick = parseInt(tickLower);
    const upperTick = parseInt(tickUpper);
    const lowerPriceDelta = Math.pow(1.0001, lowerTick - currentPoolTick);
    const upperPriceDelta = Math.pow(1.0001, upperTick - currentPoolTick);
    const optimalDenomination = isInverted ? token0Symbol : token1Symbol;
    let priceAtLowerTick, priceAtUpperTick;
    if (isInverted) {
      priceAtLowerTick = 1 / (currentPriceNum * lowerPriceDelta);
      priceAtUpperTick = 1 / (currentPriceNum * upperPriceDelta);
    } else {
      priceAtLowerTick = currentPriceNum * lowerPriceDelta;
      priceAtUpperTick = currentPriceNum * upperPriceDelta;
    }
    const poolCfg = selectedPoolId ? getPoolById(selectedPoolId) : null;
    const finalDisplayDecimals = getDecimalsForDenomination(optimalDenomination, poolCfg?.type);
    const formattedLower = priceAtLowerTick.toLocaleString('en-US', { maximumFractionDigits: finalDisplayDecimals, minimumFractionDigits: finalDisplayDecimals });
    const formattedUpper = priceAtUpperTick.toLocaleString('en-US', { maximumFractionDigits: finalDisplayDecimals, minimumFractionDigits: finalDisplayDecimals });
    if (tickLower === sdkMinTick.toString() && tickUpper === sdkMaxTick.toString()) return `0.00 - ∞`;
    const lowFirst = priceAtLowerTick <= priceAtUpperTick;
    const leftVal = lowFirst ? formattedLower : formattedUpper;
    const rightVal = lowFirst ? formattedUpper : formattedLower;
    return `${leftVal} - ${rightVal}`;
  }, [currentPoolTick, currentPrice, tickLower, tickUpper, sdkMinTick, sdkMaxTick, token0Symbol, token1Symbol]);

  const rangeLabels = useMemo((): { left: string; right: string } | null => {
    if (currentPoolTick === null || !currentPrice || !tickLower || !tickUpper) return null;
    const currentNum = parseFloat(currentPrice);
    if (!isFinite(currentNum) || currentNum <= 0) return null;
    const lower = parseInt(tickLower);
    const upper = parseInt(tickUpper);
    if (isNaN(lower) || isNaN(upper)) return null;

    const shouldInvert = baseTokenForPriceDisplay === token0Symbol;
    const priceAt = (tickVal: number) => {
      const priceDelta = Math.pow(1.0001, tickVal - currentPoolTick);
      return shouldInvert ? 1 / (currentNum * priceDelta) : currentNum * priceDelta;
    };
    if (tickLower === sdkMinTick.toString() && tickUpper === sdkMaxTick.toString()) return { left: '0.00', right: '∞' };

    const pLower = priceAt(lower);
    const pUpper = priceAt(upper);

    const denomToken = shouldInvert ? token0Symbol : token1Symbol;
    const poolCfg = selectedPoolId ? getPoolById(selectedPoolId) : null;
    const decimals = getDecimalsForDenomination(denomToken, poolCfg?.type);

    const points = [{ tick: lower, price: pLower }, { tick: upper, price: pUpper }].filter(p => isFinite(p.price) && !isNaN(p.price));
    if (points.length < 2) return null;
    points.sort((a, b) => a.price - b.price);
    const formatVal = (v: number) => {
      if (!isFinite(v)) return '∞';
      const threshold = Math.pow(10, -decimals);
      if (v > 0 && v < threshold) return `<${threshold.toFixed(decimals)}`;
      const formatted = v.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: Math.min(2, decimals) });
      if (formatted === '0.00' && v > 0) return `<${threshold.toFixed(decimals)}`;
      return formatted;
    };
    return { left: formatVal(points[0].price), right: formatVal(points[1].price) };
  }, [currentPoolTick, currentPrice, tickLower, tickUpper, token0Symbol, token1Symbol, sdkMinTick, sdkMaxTick, baseTokenForPriceDisplay, selectedPoolId]);

  const formattedCurrentPrice = useMemo(() => {
    if (!currentPrice) return null;
    const shouldInvert = baseTokenForPriceDisplay === token0Symbol;
    const denomToken = shouldInvert ? token0Symbol : token1Symbol;
    const poolCfg = selectedPoolId ? getPoolById(selectedPoolId) : null;
    const displayDecimals = getDecimalsForDenomination(denomToken, poolCfg?.type);
    const numeric = shouldInvert ? (1 / parseFloat(currentPrice)) : parseFloat(currentPrice);
    if (!isFinite(numeric)) return '∞';
    return numeric.toLocaleString('en-US', { maximumFractionDigits: displayDecimals, minimumFractionDigits: Math.min(2, displayDecimals) });
  }, [currentPrice, baseTokenForPriceDisplay, token0Symbol, selectedPoolId]);

  return (
    <div className="space-y-4">
      {/* Deposit Tab Content */}
      {activeTab === 'deposit' && (
        <>
          {/* Amount Input Step */}
            {/* Header removed; now provided by parent container */}

              {/* Range Section - Step 1 - Hide when showing transaction steps */}
              {!showingTransactionSteps && (
              <div className="border border-dashed rounded-md mb-6 bg-muted/10 p-3">
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
                        {getPriceRangeDisplay() && (
                          <div className="flex items-center gap-1 text-xs">
                            <div
                              className={`${(isDraggingRange === 'left' || isDraggingRange === 'center') ? 'text-white' : 'text-muted-foreground'} hover:text-white px-1 py-1 transition-colors cursor-pointer`}
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
                              className={`${(isDraggingRange === 'right' || isDraggingRange === 'center') ? 'text-white' : 'text-muted-foreground'} hover:text-white px-1 py-1 transition-colors cursor-pointer`}
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
                        return null; // Custom
                      })();

                      // No button is active when activePreset is null (initial state)
                      const isActive = activePreset !== null && activePreset === presetValue;
                      const isCustom = preset === "Custom";

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
                          {isCustom && <Maximize className={`w-3 h-3 relative z-10 ${isActive ? 'text-sidebar-primary' : 'text-muted-foreground'}`} />}
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
                    setAmount0("");
                    setAmount1("");
                    setAmount0FullPrecision("");
                    setAmount1FullPrecision("");
                    setActiveInputSide(null);
                    setCalculatedData(null);
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
                />
              )}

              {/* Single Token Mode Toggle */}
              <div
                onClick={() => {
                  if (isWorking || showingTransactionSteps) return;
                  const newValue = !isZapMode;
                  setIsZapMode(newValue);
                  setAmount0("");
                  setAmount1("");
                  setAmount0FullPrecision("");
                  setAmount1FullPrecision("");
                  setZapQuote(null);
                  setPriceImpact(null);
                  setActiveInputSide(null);
                  setCalculatedData(null);
                  resetTransaction();
                }}
                className={cn(
                  "cursor-pointer hover:bg-muted/20 transition-colors p-4 rounded-lg bg-surface border border-sidebar-border/60 mb-4",
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
                      setAmount0("");
                      setAmount1("");
                      setAmount0FullPrecision("");
                      setAmount1FullPrecision("");
                      setZapQuote(null);
                      setPriceImpact(null);
                      setActiveInputSide(null);
                      setCalculatedData(null);
                      resetTransaction();
                    }}
                    disabled={isWorking || showingTransactionSteps}
                    onClick={(e) => e.stopPropagation()}
                    className="h-5 w-5"
                  />
                </div>
              </div>

              {/* Input for Token 0 - Only show when not in zap mode or when token0 is selected */}
              {(!isZapMode || zapInputToken === 'token0') && (
              <div className="space-y-2">
                <style dangerouslySetInnerHTML={{__html: `
                  @keyframes inputGradientFlow {
                    from { background-position: 0% 0%; }
                    to { background-position: 300% 0%; }
                  }
                  .input-gradient-hover {
                    position: relative;
                    border-radius: 8px;
                  }
                  .input-gradient-hover::before {
                    content: '';
                    position: absolute;
                    inset: -1px;
                    border-radius: 9px;
                    background: linear-gradient(
                      45deg,
                      #f94706,
                      #ff7919 25%,
                      #f94706 50%,
                      #ff7919 75%,
                      #f94706 100%
                    );
                    background-size: 300% 100%;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                    pointer-events: none;
                    z-index: 0;
                    animation: inputGradientFlow 10s linear infinite;
                  }
                  .input-gradient-hover:hover::before,
                  .input-gradient-hover:focus-within::before {
                    opacity: 1;
                  }
                `}} />
                <div className="input-gradient-hover">
                  <motion.div
                    className={cn(
                      "relative z-[1] rounded-lg bg-surface p-4 border transition-colors group",
                      isAmount0Focused ? "border-sidebar-primary" : "border-sidebar-border/60"
                    )}
                    animate={balanceWiggleControls0}
                  >
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-medium">Amount</Label>
                    <Button
                      variant="ghost"
                      className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                      onClick={() => handleUseFullBalance(true)}
                      disabled={!canAddToken0 || isWorking || isCalculating}
                    >
                      {displayToken0Balance} {token0Symbol}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (isZapMode && !showingTransactionSteps) {
                          setZapInputToken('token1');
                          setPriceImpact(null);
                          if (amount0) {
                            setAmount1(amount0);
                            setAmount0("");
                            setActiveInputSide('amount1');
                          }
                        }
                      }}
                      disabled={!isZapMode || showingTransactionSteps}
                      className={cn(
                        "flex items-center gap-1.5 bg-[var(--token-selector-background)] border border-sidebar-border/60 rounded-lg h-11 px-3 transition-colors",
                        isZapMode && !showingTransactionSteps
                          ? "cursor-pointer hover:bg-muted/30"
                          : "cursor-default"
                      )}
                    >
                      <Image src={getTokenIcon(token0Symbol)} alt={token0Symbol} width={20} height={20} className="rounded-full"/>
                      <span className="text-sm font-medium">{token0Symbol}</span>
                      {isZapMode && !showingTransactionSteps && (
                        <ArrowLeftRight className="h-3 w-3 text-muted-foreground ml-0.5" />
                      )}
                    </button>
                    <div className="flex-1">
                      <Input
                        id="amount0"
                        placeholder="0.0"
                        value={amount0}
                        onChange={(e) => {
                          let newValue = e.target.value.replace(',', '.'); // Ensure decimal separator is always period
                          // Only allow numbers, one decimal point, and prevent multiple decimal points
                          newValue = newValue.replace(/[^0-9.]/g, '').replace(/(\..*?)\./g, '$1');

                          // Check if going over balance to trigger wiggle
                          const maxAmount = token0BalanceData ? parseFloat(token0BalanceData.formatted || "0") : 0;
                          const inputAmount = parseFloat(newValue || "0");
                          const prevAmount = parseFloat(amount0 || "0");
                          const wasOver = Number.isFinite(prevAmount) && Number.isFinite(maxAmount) ? prevAmount > maxAmount : false;
                          const isOver = Number.isFinite(inputAmount) && Number.isFinite(maxAmount) ? inputAmount > maxAmount : false;
                          if (isOver && !wasOver) {
                            setBalanceWiggleCount0(c => c + 1);
                          }

                          // Clear full precision when user manually edits
                          setAmount0FullPrecision("");
                          resetTransaction();
                          setShowingTransactionSteps(false);
                          setCurrentTransactionStep('idle');
                          setPermitSignature(undefined);
                          setAmount0(newValue);
                          setActiveInputSide('amount0');
                          setHasUserInteracted(true);
                        }}
                        onFocus={() => {
                          setIsAmount0Focused(true);
                          // Show full precision if current value is abbreviated (has '...')
                          if (amount0FullPrecision && (amount0.includes('...') || amount0FullPrecision !== amount0)) {
                            setAmount0(amount0FullPrecision);
                          }
                        }}
                        onBlur={() => {
                          setIsAmount0Focused(false);
                          // Re-abbreviate if we have full precision and it's not the active input side
                          if (amount0FullPrecision && (!activeInputSide || activeInputSide !== 'amount0')) {
                            const displayAmount = formatTokenDisplayAmount(amount0FullPrecision, token0Symbol);
                            setAmount0(displayAmount);
                          }
                        }}
                        type="text"
                        pattern="[0-9]*\.?[0-9]*"
                        inputMode="decimal"
                        autoComplete="off"
                        disabled={!canAddToken0 || isWorking || (isCalculating && activeInputSide === 'amount1')}
                        className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                      />
                      <div className="relative text-right text-xs min-h-5">
                        {/* USD Value - hide on hover always */}
                        <div className={cn("text-muted-foreground transition-opacity duration-100", {
                          "group-hover:opacity-0": isConnected && token0BalanceData && parseFloat(token0BalanceData.formatted || "0") > 0 && canAddToken0
                        })}>
                          {(() => {
                            const usdPrice = getUSDPriceForSymbol(token0Symbol);

                            // Use precise backend data when available, fallback to display amount
                            if (calculatedData && calculatedData.amount0) {
                              try {
                                const preciseAmount = parseFloat(viemFormatUnits(BigInt(calculatedData.amount0), tokenDefinitions[token0Symbol]?.decimals || 18));
                                return formatUSD(preciseAmount * usdPrice);
                              } catch {
                                // Fallback to display amount if parsing fails
                                const numeric = parseDisplayAmount(amount0);
                                return formatUSD(numeric * usdPrice);
                              }
                            } else {
                              const numeric = parseDisplayAmount(amount0);
                              return formatUSD(numeric * usdPrice);
                            }
                          })()}
                        </div>
                        {/* Percentage buttons - show on hover always */}
                        {isConnected && token0BalanceData && parseFloat(token0BalanceData.formatted || "0") > 0 && canAddToken0 && (
                          <div className="absolute right-0 top-[3px] flex gap-1 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100">
                            {[25, 50, 75, 100].map((percentage, index) => (
                              <motion.div
                                key={percentage}
                                className="opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0"
                                style={{
                                  transitionDelay: `${index * 40}ms`,
                                  transitionDuration: '200ms',
                                  transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
                                }}
                              >
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-5 px-2 text-[10px] font-medium rounded-md border-sidebar-border bg-muted/20 hover:bg-muted/40 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToken0Percentage(percentage);
                                    setActiveInputSide('amount0');
                                    resetTransaction();
                                    setShowingTransactionSteps(false);
                                    setCurrentTransactionStep('idle');
                                    setPermitSignature(undefined);
                                  }}
                                >
                                  {percentage === 100 ? 'MAX' : `${percentage}%`}
                                </Button>
                              </motion.div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  </motion.div>
                </div>
              </div>
              )}

              {/* Plus Icon - Only show when not in zap mode */}
              {!isZapMode && (
              <div className="flex justify-center relative my-0" style={{ height: '20px' }}>
                <style dangerouslySetInnerHTML={{__html: `
                  @keyframes plusGlare {
                    from { background-position: 0% 0%; }
                    to { background-position: 300% 0%; }
                  }
                  .plus-loading-wrapper {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 8px;
                    overflow: visible;
                  }
                  .plus-loading-wrapper::before {
                    content: '';
                    position: absolute;
                    inset: -1px;
                    border-radius: 9px;
                    background: linear-gradient(
                      45deg,
                      #f94706,
                      #ff7919 30%,
                      rgba(0, 0, 0, 0.4) 50%,
                      #f94706 70%,
                      #ff7919 100%
                    );
                    background-size: 300% 100%;
                    opacity: 0;
                    transition: opacity 0.5s ease-out;
                    pointer-events: none;
                    z-index: 0;
                    animation: plusGlare 1.5s linear infinite;
                  }
                  .plus-loading-wrapper.loading::before {
                    opacity: 1;
                  }
                  .plus-loading-inner {
                    position: relative;
                    width: 100%;
                    height: 100%;
                    border-radius: 8px;
                    background: var(--surface-bg);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1;
                  }
                `}} />
                <div className={cn("plus-loading-wrapper", isCalculating && "loading")}>
                  <div className="plus-loading-inner">
                    <Plus className="h-4 w-4" />
                  </div>
                </div>
              </div>
              )}

              {/* Input for Token 1 - Only show when not in zap mode or when token1 is selected */}
              {(!isZapMode || zapInputToken === 'token1') && (
              <div className="space-y-2 mb-4">
                <div className="input-gradient-hover">
                  <motion.div
                    className={cn(
                      "relative z-[1] rounded-lg bg-surface p-4 border transition-colors group",
                      isAmount1Focused ? "border-sidebar-primary" : "border-sidebar-border/60"
                    )}
                    animate={balanceWiggleControls1}
                  >
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-medium">Amount</Label>
                    <Button
                      variant="ghost"
                      className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                      onClick={() => handleUseFullBalance(false)}
                      disabled={!canAddToken1 || isWorking || isCalculating}
                    >
                      {displayToken1Balance} {token1Symbol}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (isZapMode && !showingTransactionSteps) {
                          setZapInputToken('token0');
                          setPriceImpact(null);
                          if (amount1) {
                            setAmount0(amount1);
                            setAmount1("");
                            setActiveInputSide('amount0');
                          }
                        }
                      }}
                      disabled={!isZapMode || showingTransactionSteps}
                      className={cn(
                        "flex items-center gap-1.5 bg-[var(--token-selector-background)] border border-sidebar-border/60 rounded-lg h-11 px-3 transition-colors",
                        isZapMode && !showingTransactionSteps
                          ? "cursor-pointer hover:bg-muted/30"
                          : "cursor-default"
                      )}
                    >
                      <Image src={getTokenIcon(token1Symbol)} alt={token1Symbol} width={20} height={20} className="rounded-full"/>
                      <span className="text-sm font-medium">{token1Symbol}</span>
                      {isZapMode && !showingTransactionSteps && (
                        <ArrowLeftRight className="h-3 w-3 text-muted-foreground ml-0.5" />
                      )}
                    </button>
                    <div className="flex-1">
                      <Input
                        id="amount1"
                        placeholder="0.0"
                        value={amount1}
                        onChange={(e) => {
                          let newValue = e.target.value.replace(',', '.'); // Ensure decimal separator is always period
                          // Only allow numbers, one decimal point, and prevent multiple decimal points
                          newValue = newValue.replace(/[^0-9.]/g, '').replace(/(\..*?)\./g, '$1');

                          // Check if going over balance to trigger wiggle
                          const maxAmount = token1BalanceData ? parseFloat(token1BalanceData.formatted || "0") : 0;
                          const inputAmount = parseFloat(newValue || "0");
                          const prevAmount = parseFloat(amount1 || "0");
                          const wasOver = Number.isFinite(prevAmount) && Number.isFinite(maxAmount) ? prevAmount > maxAmount : false;
                          const isOver = Number.isFinite(inputAmount) && Number.isFinite(maxAmount) ? inputAmount > maxAmount : false;
                          if (isOver && !wasOver) {
                            setBalanceWiggleCount1(c => c + 1);
                          }

                          // Clear full precision when user manually edits
                          setAmount1FullPrecision("");
                          resetTransaction();
                          setShowingTransactionSteps(false);
                          setCurrentTransactionStep('idle');
                          setPermitSignature(undefined);
                          setAmount1(newValue);
                          setActiveInputSide('amount1');
                          setHasUserInteracted(true);
                        }}
                        onFocus={() => {
                          setIsAmount1Focused(true);
                          // Show full precision if current value is abbreviated (has '...')
                          if (amount1FullPrecision && (amount1.includes('...') || amount1FullPrecision !== amount1)) {
                            setAmount1(amount1FullPrecision);
                          }
                        }}
                        onBlur={() => {
                          setIsAmount1Focused(false);
                          // Re-abbreviate if we have full precision and it's not the active input side
                          if (amount1FullPrecision && (!activeInputSide || activeInputSide !== 'amount1')) {
                            const displayAmount = formatTokenDisplayAmount(amount1FullPrecision, token1Symbol);
                            setAmount1(displayAmount);
                          }
                        }}
                        type="text"
                        pattern="[0-9]*\.?[0-9]*"
                        inputMode="decimal"
                        autoComplete="off"
                        disabled={!canAddToken1 || isWorking || (isCalculating && activeInputSide === 'amount0')}
                        className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                      />
                      <div className="relative text-right text-xs min-h-5">
                        {/* USD Value - hide on hover always */}
                        <div className={cn("text-muted-foreground transition-opacity duration-100", {
                          "group-hover:opacity-0": isConnected && token1BalanceData && parseFloat(token1BalanceData.formatted || "0") > 0 && canAddToken1
                        })}>
                          {(() => {
                            const usdPrice = getUSDPriceForSymbol(token1Symbol);

                            // Use precise backend data when available, fallback to display amount
                            if (calculatedData && calculatedData.amount1) {
                              try {
                                const preciseAmount = parseFloat(viemFormatUnits(BigInt(calculatedData.amount1), tokenDefinitions[token1Symbol]?.decimals || 18));
                                return formatUSD(preciseAmount * usdPrice);
                              } catch {
                                // Fallback to display amount if parsing fails
                                const numeric = parseDisplayAmount(amount1);
                                return formatUSD(numeric * usdPrice);
                              }
                            } else {
                              const numeric = parseDisplayAmount(amount1);
                              return formatUSD(numeric * usdPrice);
                            }
                          })()}
                        </div>
                        {/* Percentage buttons - show on hover always */}
                        {isConnected && token1BalanceData && parseFloat(token1BalanceData.formatted || "0") > 0 && canAddToken1 && (
                          <div className="absolute right-0 top-[3px] flex gap-1 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100">
                            {[25, 50, 75, 100].map((percentage, index) => (
                              <motion.div
                                key={percentage}
                                className="opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0"
                                style={{
                                  transitionDelay: `${index * 40}ms`,
                                  transitionDuration: '200ms',
                                  transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
                                }}
                              >
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-5 px-2 text-[10px] font-medium rounded-md border-sidebar-border bg-muted/20 hover:bg-muted/40 transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToken1Percentage(percentage);
                                    setActiveInputSide('amount1');
                                    resetTransaction();
                                    setShowingTransactionSteps(false);
                                    setCurrentTransactionStep('idle');
                                    setPermitSignature(undefined);
                                  }}
                                >
                                  {percentage === 100 ? 'MAX' : `${percentage}%`}
                                </Button>
                              </motion.div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  </motion.div>
                </div>
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
                  onSignPermit={signPermit}
                  onExecute={handleDeposit}
                  onRefetchApprovals={refetchApprovals}
                  onBack={() => {
                    setShowingTransactionSteps(false);
                    resetTransaction();
                    setCurrentTransactionStep('idle');
                    setPermitSignature(undefined);
                  }}
                  onReset={() => {
                    resetTransaction();
                    setCurrentTransactionStep('idle');
                    setPermitSignature(undefined);
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
                  convertTickToPrice={convertTickToPrice}
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
                  onSignPermit={signPermit}
                  onExecuteZap={zapTransaction.handleZapSwapAndDeposit}
                  onExecute={handleDeposit}
                  onRefetchApprovals={refetchApprovals}
                  onBack={() => {
                    setShowingTransactionSteps(false);
                    resetTransaction();
                    setCurrentTransactionStep('idle');
                    setPermitSignature(undefined);
                  }}
                  onReset={() => {
                    resetTransaction();
                    setCurrentTransactionStep('idle');
                    setPermitSignature(undefined);
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
                  convertTickToPrice={convertTickToPrice}
                  zapQuote={zapQuote}
                  currentSlippage={currentSlippage}
                />
              )}

              {/* Continue Button */}
              {!isConnected ? (
                <div className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30"
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

                      // Calculate zap quote and price impact before showing transaction steps
                      setIsCalculating(true);
                      try {
                        const tl = parseInt(tickLower);
                        const tu = parseInt(tickUpper);
                        const primaryTokenSymbol = zapInputToken === 'token0' ? token0Symbol : token1Symbol;
                        const primaryAmount = cleanAmountForAPI(inputAmount);

                        const response = await fetch('/api/liquidity/prepare-zap-mint-tx', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            userAddress: accountAddress || '0x0000000000000000000000000000000000000001',
                            token0Symbol,
                            token1Symbol,
                            inputAmount: primaryAmount,
                            inputTokenSymbol: primaryTokenSymbol,
                            userTickLower: tl,
                            userTickUpper: tu,
                            chainId,
                            slippageTolerance: zapSlippageToleranceBps,
                          }),
                        });

                        if (response.ok) {
                          const data = await response.json();

                          if ('zapQuote' in data) {
                            // Capture price impact from API response (works for both approval and transaction responses)
                            const priceImpactNum = parseFloat(data.zapQuote.priceImpact || "0");
                            if (!isNaN(priceImpactNum) && priceImpactNum > 0) {
                              setPriceImpact(priceImpactNum);
                            } else {
                              setPriceImpact(null);
                            }

                            // Set zap quote for display
                            setZapQuote(data.zapQuote);

                            // Derive an auto slippage suggestion from price impact with a small buffer
                            // Cap at 5.0% max (not 5.5%) to respect user's max slippage limit
                            const priceImpactPercent = Number.parseFloat(data.zapQuote.priceImpact ?? '');
                            const bufferedTarget = Number.isFinite(priceImpactPercent)
                              ? priceImpactPercent + 0.3
                              : DEFAULT_LP_SLIPPAGE;
                            const MAX_SLIPPAGE_FOR_ZAP = 5.0; // Hard cap at 5.0% for zap mode
                            const suggestedAutoSlippage = Math.min(
                              MAX_SLIPPAGE_FOR_ZAP, // Use 5.0% cap instead of MAX_AUTO_SLIPPAGE_TOLERANCE (5.5%)
                              Math.max(DEFAULT_LP_SLIPPAGE, bufferedTarget)
                            );
                            updateAutoSlippage(Number(suggestedAutoSlippage.toFixed(2)));

                            // Update calculated data with actual zap amounts (only if details exist - not present in approval response)
                            if ('details' in data && data.details) {
                              setCalculatedData({
                                amount0: data.details.token0.amount,
                                amount1: data.details.token1.amount,
                                liquidity: data.details.liquidity,
                                finalTickLower: data.details.finalTickLower,
                                finalTickUpper: data.details.finalTickUpper,
                                currentPoolTick: currentPoolTick || undefined,
                                currentPrice: currentPrice || undefined,
                              });
                            }
                          } else {
                            setPriceImpact(null);
                            setZapQuote(null);
                          }
                        } else {
                          const error = await response.json();
                          setPriceImpact(null);
                          setZapQuote(null);
                          // Show error but don't prevent showing transaction steps
                          if (error.message?.includes('Price impact') || error.message?.includes('slippage')) {
                            showErrorToast('Slippage Protection', error.message);
                          } else {
                            showErrorToast('Failed to calculate zap quote', error.message);
                          }
                        }
                      } catch (error: any) {
                        console.error('[AddLiquidityForm] Error calculating zap quote on Deposit:', error);
                        setPriceImpact(null);
                        setZapQuote(null);
                        showErrorToast('Failed to calculate zap quote', error.message);
                      } finally {
                        setIsCalculating(false);
                      }
                    }

                    // Show transaction steps after zap quote is calculated (or immediately for non-zap)
                    setShowingTransactionSteps(true);
                  }}
                  disabled={isWorking ||
                    isCalculating ||
                    isPoolStateLoading ||
                    isCheckingApprovals ||
                    !hasRangeSelected ||
                    (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) ||
                    isInsufficientBalance
                  }
                  style={(isWorking || isCalculating || isPoolStateLoading || isCheckingApprovals ||
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

      {/* Placeholder for Withdraw Tab */}
      {activeTab === 'withdraw' && (
        <div className="flex items-center justify-center h-64 bg-muted/20 rounded-lg">
          <span className="text-muted-foreground">Withdraw functionality coming soon</span>
        </div>
      )}

      {/* Placeholder for Swap Tab */}
      {activeTab === 'swap' && (
        <div className="flex items-center justify-center h-64 bg-muted/20 rounded-lg">
          <span className="text-muted-foreground">Swap functionality coming soon</span>
        </div>
      )}

    </div>
  );
} 