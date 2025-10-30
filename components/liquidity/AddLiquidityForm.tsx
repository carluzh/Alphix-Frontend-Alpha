"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PlusIcon, RefreshCwIcon, MinusIcon, ActivityIcon, CheckIcon, InfoIcon, ArrowLeftIcon, OctagonX, BadgeCheck, Maximize, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import Image from "next/image";
import { useAccount, useBalance } from "wagmi";
import { toast } from "sonner";
import { useEthersSigner } from "@/hooks/useEthersSigner";
import { usePercentageInput } from "@/hooks/usePercentageInput";
import { V4_POOL_FEE, V4_POOL_TICK_SPACING, V4_POOL_HOOKS } from "@/lib/swap-constants";
import { TOKEN_DEFINITIONS, TokenSymbol, NATIVE_TOKEN_ADDRESS } from "@/lib/pools-config";
import { getPoolById, getToken } from "@/lib/pools-config";
import { formatUnits as viemFormatUnits, parseUnits as viemParseUnits, getAddress, type Hex } from "viem";

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

// Toast utility functions matching swap-interface patterns
const showErrorToast = (title: string, description?: string, action?: { label: string; onClick: () => void }) => {
  toast.error(title, {
    icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
    description: description,
    action: action
  });
};

const showSuccessToast = (title: string, description?: string) => {
  toast.success(title, {
    icon: React.createElement(BadgeCheck, { className: "h-4 w-4 text-green-500" }),
    description: description
  });
};

const showInfoToast = (title: string) => {
  toast(title, {
    icon: React.createElement(InfoIcon, { className: "h-4 w-4" })
  });
};

import { Token } from '@uniswap/sdk-core';
import { Pool as V4PoolSDK, Position as V4PositionSDK } from "@uniswap/v4-sdk";
import JSBI from "jsbi";
import poolsConfig from "../../config/pools.json";
import { useAllPrices } from "@/components/data/hooks";
import { formatUSD } from "@/lib/format";
import { getOptimalBaseToken, getDecimalsForDenomination } from "@/lib/denomination-utils";
import { calculateUserPositionAPY, formatUserAPY, type PoolMetrics } from "@/lib/user-position-apy";

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

// Chart data interfaces
// Chart data interfaces - now handled in InteractiveRangeChart

export interface AddLiquidityFormProps {
  onLiquidityAdded: (token0Symbol?: string, token1Symbol?: string) => void; 
  selectedPoolId?: string;
  sdkMinTick: number;
  sdkMaxTick: number;
  defaultTickSpacing: number;
  poolApr?: string;
  activeTab: 'deposit' | 'withdraw' | 'swap'; // Added activeTab prop
  // Props for copying position parameters
  initialTickLower?: number;
  initialTickUpper?: number;
  initialToken0Amount?: string;
}

export function AddLiquidityForm({ 
  onLiquidityAdded, 
  selectedPoolId,
  sdkMinTick,
  sdkMaxTick,
  defaultTickSpacing,
  poolApr,
  activeTab, // Accept activeTab from props
  initialTickLower,
  initialTickUpper,
  initialToken0Amount,
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
  const [tickLower, setTickLower] = useState<string>(sdkMinTick.toString());
  const [tickUpper, setTickUpper] = useState<string>(sdkMaxTick.toString());
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
  const [enhancedAprDisplay, setEnhancedAprDisplay] = useState<string>(poolApr || "Yield N/A");
  const [capitalEfficiencyFactor, setCapitalEfficiencyFactor] = useState<number>(1);
  const [initialDefaultApplied, setInitialDefaultApplied] = useState(false);
  const [baseTokenForPriceDisplay, setBaseTokenForPriceDisplay] = useState<TokenSymbol>(() =>
    getOptimalBaseToken(initialTokens.token0, initialTokens.token1));
  const [estimatedApy, setEstimatedApy] = useState<string>("0.00");
  const [isCalculatingApy, setIsCalculatingApy] = useState(false);
  // Cache pool metrics and state (fetched once per pool)
  const [cachedPoolMetrics, setCachedPoolMetrics] = useState<{ poolId: string; metrics: any; poolLiquidity: string } | null>(null);

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
  const { data: allPrices } = useAllPrices();
  const signer = useEthersSigner();

  // Map any token symbol (e.g., aUSDC, aETH) to a USD price
  const getUSDPriceForSymbol = useCallback((symbol?: string): number => {
    if (!symbol) return 0;
    const s = symbol.toUpperCase();
    if (s.includes('BTC')) return allPrices?.BTC?.usd ?? 0;
    if (s.includes('ETH')) return allPrices?.ETH?.usd ?? 0;
    if (s.includes('USDC')) return allPrices?.USDC?.usd ?? 1;
    if (s.includes('USDT')) return allPrices?.USDT?.usd ?? 1;
    if (s.includes('DAI')) return allPrices?.DAI?.usd ?? 1;
    return 0;
  }, [allPrices]);

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
    activeInputSide
  });

  // Use the new transaction hooks (Uniswap-style)
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
  } = useAddLiquidityTransactionV2({
    token0Symbol,
    token1Symbol,
    amount0,
    amount1,
    tickLower,
    tickUpper,
    activeInputSide,
    calculatedData,
    onLiquidityAdded,
    onOpenChange: () => {},
  });

  // Track which step we're on manually (no auto-progression)
  const [currentTransactionStep, setCurrentTransactionStep] = useState<'idle' | 'approving_token0' | 'approving_token1' | 'signing_permit' | 'depositing'>('idle');
  const [permitSignature, setPermitSignature] = useState<string>();

  // Balance hooks with refetch
  const { data: token0BalanceData, isLoading: isLoadingToken0Balance, refetch: refetchToken0Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[token0Symbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined : TOKEN_DEFINITIONS[token0Symbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[token0Symbol] },
  });

  const { data: token1BalanceData, isLoading: isLoadingToken1Balance, refetch: refetchToken1Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[token1Symbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined : TOKEN_DEFINITIONS[token1Symbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[token1Symbol] },
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
    { decimals: TOKEN_DEFINITIONS[token0Symbol]?.decimals || 18, symbol: token0Symbol },
    setAmount0WithPrecision
  );

  const handleToken1Percentage = usePercentageInput(
    token1BalanceData,
    { decimals: TOKEN_DEFINITIONS[token1Symbol]?.decimals || 18, symbol: token1Symbol },
    setAmount1WithPrecision
  );

  // Derived pool tokens (for labels/formatting)
  const { poolToken0, poolToken1 } = useMemo(() => {
    if (!token0Symbol || !token1Symbol || !chainId) return { poolToken0: null, poolToken1: null };
      const currentToken0Def = TOKEN_DEFINITIONS[token0Symbol];
  const currentToken1Def = TOKEN_DEFINITIONS[token1Symbol]; 
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
          setTickLower(sdkMinTick.toString());
          setTickUpper(sdkMaxTick.toString());
          setCurrentPoolTick(null);
          setCalculatedData(null);
          setActiveInputSide(null);
          setCurrentPrice(null);
          setInitialDefaultApplied(false);
          setActivePreset(isStablePool ? "±3%" : "±15%"); // Reset preset on pool change (Wide for stable pools)
          setBaseTokenForPriceDisplay(t0); // Reset base token for price display
          // Reset chart specific states too
          setCurrentPriceLine(null);
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
    setActivePreset(isStablePool ? "±3%" : "±15%"); // Reset preset based on pool type (Wide for stable pools)
    setBaseTokenForPriceDisplay(token0Symbol); // Reset base token for price display
    // Reset chart specific states too
    setCurrentPriceLine(null);
  }, [token0Symbol, token1Symbol, chainId, sdkMinTick, sdkMaxTick, isStablePool]);

  // Effect to fetch initial pool state (current price and tick)
  useEffect(() => {
    const fetchPoolState = async () => {
      if (!selectedPoolId || !chainId) return;
      
      setIsPoolStateLoading(true);
      try {
        const poolConfig = getPoolById(selectedPoolId);
        const poolIdParam = poolConfig?.subgraphId || selectedPoolId;

        const response = await fetch(`/api/liquidity/get-pool-state?poolId=${encodeURIComponent(poolIdParam)}`);
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to fetch initial pool state.");
        }
        const poolState = await response.json();

        if (poolState.currentPrice && typeof poolState.currentPoolTick === 'number') {
          setCurrentPrice(poolState.currentPrice); 
          setCurrentPoolTick(poolState.currentPoolTick);

          if (poolState.sqrtPriceX96) { 
            setCurrentPoolSqrtPriceX96(poolState.sqrtPriceX96.toString()); 
          } else {
            setCurrentPoolSqrtPriceX96(null); 
          }
          
          const numericCurrentPrice = parseFloat(poolState.currentPrice);
          if (!isNaN(numericCurrentPrice)) {
            setCurrentPriceLine(numericCurrentPrice);

            // Set initial viewport based on pool type: ±5% for stable, ±20% for volatile
            const centerTick = poolState.currentPoolTick;
            const percentageRange = isStablePool ? 0.05 : 0.20;
            const tickRange = Math.round(Math.log(1 + percentageRange) / Math.log(1.0001));
            const domainTickLower = centerTick - tickRange;
            const domainTickUpper = centerTick + tickRange;
            setXDomain([domainTickLower, domainTickUpper]);

          } else {
            setCurrentPriceLine(null);
          }
        } else {
          setCurrentPriceLine(null);
          setCurrentPoolSqrtPriceX96(null);
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
    
    if (selectedPoolId) {
      fetchPoolState();
    }
  }, [selectedPoolId, chainId]);

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
    const token0Dec = TOKEN_DEFINITIONS[token0Symbol]?.decimals;
    const token1Dec = TOKEN_DEFINITIONS[token1Symbol]?.decimals;

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

  }, [tickLower, tickUpper, baseTokenForPriceDisplay, token0Symbol, token1Symbol, sdkMinTick, sdkMaxTick, calculatedData, optimalDenominationForDecimals]);

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

  // Handle use full balance
  const handleUseFullBalance = (balanceString: string, tokenSymbolForDecimals: TokenSymbol, isToken0: boolean) => {
    try {
      const numericBalance = parseFloat(balanceString);
      if (isNaN(numericBalance) || numericBalance <= 0) return;

      const formattedBalance = formatTokenDisplayAmount(numericBalance.toString(), tokenSymbolForDecimals);

      if (isToken0) {
        setAmount0(formattedBalance);
        setActiveInputSide('amount0');
      } else {
        setAmount1(formattedBalance);
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

  // Handle preparation and submission with manual step progression
  const handlePrepareAndSubmit = async () => {
    if (isInsufficientBalance) {
      showErrorToast("Insufficient Balance");
      return;
    }

    if (parseFloat(amount0 || "0") <= 0 && parseFloat(amount1 || "0") <= 0) {
      showErrorToast("Invalid Amount", "Must be greater than 0");
      return;
    }

    // First click: switch to transaction steps view
    if (!showingTransactionSteps) {
      setShowingTransactionSteps(true);
      return;
    }

    // Wait for approval data to load
    if (!approvalData || isCheckingApprovals) {
      return;
    }

    // Prevent concurrent execution - guard against multiple clicks
    if (currentTransactionStep !== 'idle') {
      return;
    }

    // Determine next step based on current state and approval data
    // Check what's needed - user must click for each step
    if (approvalData.needsToken0ERC20Approval) {
      setCurrentTransactionStep('approving_token0');
      try {
        await handleApprove(token0Symbol);
        // Keep loading state while we wait for blockchain propagation
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Refetch to update approval state
        await refetchApprovals();
        // Only NOW end the loading state - everything is ready
      } catch (error: any) {
        // Only log non-user rejection errors
        const isUserRejection =
          error?.message?.toLowerCase().includes('user rejected') ||
          error?.message?.toLowerCase().includes('user denied') ||
          error?.code === 4001;

        if (!isUserRejection) {
          console.error('Token0 approval failed:', error);
          showErrorToast('Approval Failed', error.message);
        }
      } finally {
        // Always end loading state
        setCurrentTransactionStep('idle');
      }
      return;
    }
    if (approvalData.needsToken1ERC20Approval) {
      setCurrentTransactionStep('approving_token1');
      try {
        await handleApprove(token1Symbol);
        // Keep loading state while we wait for blockchain propagation
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Refetch to update approval state
        await refetchApprovals();
        // Only NOW end the loading state - everything is ready
      } catch (error: any) {
        // Only log non-user rejection errors
        const isUserRejection =
          error?.message?.toLowerCase().includes('user rejected') ||
          error?.message?.toLowerCase().includes('user denied') ||
          error?.code === 4001;

        if (!isUserRejection) {
          console.error('Token1 approval failed:', error);
          showErrorToast('Approval Failed', error.message);
        }
      } finally {
        // Always end loading state
        setCurrentTransactionStep('idle');
      }
      return;
    }

    if (approvalData.permitBatchData && !permitSignature) {
      setCurrentTransactionStep('signing_permit');
      try {
        const freshSignature = await signPermit();
        if (!freshSignature) {
          setCurrentTransactionStep('idle');
          return;
        }
        // Permit signed successfully, keep loading briefly for smooth transition
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        // Only log non-user rejection errors
        const isUserRejection =
          error?.message?.toLowerCase().includes('user rejected') ||
          error?.message?.toLowerCase().includes('user denied') ||
          error?.code === 4001;

        if (!isUserRejection) {
          console.error('Permit signing failed:', error);
        }
      } finally {
        setCurrentTransactionStep('idle');
      }
      return;
    }

    setCurrentTransactionStep('depositing');
    try {
      await handleDeposit(permitSignature);
      // Keep loading until transaction is fully complete
    } catch (error: any) {
      // Only log non-user rejection errors
      const isUserRejection =
        error?.message?.toLowerCase().includes('user rejected') ||
        error?.message?.toLowerCase().includes('user denied') ||
        error?.code === 4001;

      if (!isUserRejection) {
        console.error('Deposit failed:', error);
      }
    } finally {
      setCurrentTransactionStep('idle');
    }
  };

  const signPermit = useCallback(async (): Promise<string | undefined> => {
    if (!approvalData?.permitBatchData || !approvalData?.signatureDetails) {
      return undefined;
    }

    if (!signer) {
      showErrorToast("Wallet not connected");
      return undefined;
    }

    try {
      toast('Sign in Wallet', {
        icon: React.createElement(InfoIcon, { className: 'h-4 w-4' })
      });

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
  }, [approvalData, signer]);

  // Determine button text based on current state and what's needed next
  const getButtonText = () => {
    if (isInsufficientBalance) {
      return 'Insufficient Balance';
    }

    if (isWorking) {
      // Keep the same text as the button that was clicked (no "..." or "ing" suffix)
      if (currentTransactionStep === 'approving_token0') {
        return `Approve ${token0Symbol}`;
      }
      if (currentTransactionStep === 'approving_token1') {
        return `Approve ${token1Symbol}`;
      }
      if (currentTransactionStep === 'signing_permit') {
        return 'Sign Permit';
      }
      if (currentTransactionStep === 'depositing' || isDepositConfirming) {
        return 'Deposit';
      }
      return 'Processing';
    }

    // Not in transaction steps yet
    if (!showingTransactionSteps) {
      return 'Deposit';
    }

    // Waiting for approval data to load or checking approvals
    if (!approvalData || isCheckingApprovals) {
      return 'Preparing...';
    }

    // In transaction steps - show what will happen next
    // Check approvals first
    if (approvalData.needsToken0ERC20Approval) {
      return `Approve ${token0Symbol}`;
    }
    if (approvalData.needsToken1ERC20Approval) {
      return `Approve ${token1Symbol}`;
    }

    // Then check permit - this prevents jumping to Deposit
    if (approvalData.permitBatchData && !permitSignature) {
      return 'Sign Permit';
    }

    // Only show Deposit if everything else is done
    return 'Deposit';
  };

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

  // Effect to calculate Capital Efficiency and Enhanced APR
  useEffect(() => {
    // Initialize or reset if poolApr is not valid or not yet loaded
    if (!poolApr || ["Loading APR...", "APR N/A", "APR Error", "Yield N/A", "Fees N/A"].includes(poolApr)) {
      setEnhancedAprDisplay(poolApr || "Yield N/A");
      setCapitalEfficiencyFactor(1);
      return;
    }

    const tl = parseInt(tickLower);
    const tu = parseInt(tickUpper);
    // Ensure currentPoolTick is also treated as an integer for comparison
    const cPt = currentPoolTick !== null ? Math.round(Number(currentPoolTick)) : null;

    const numericBaseApr = parseFloat(poolApr.replace("%", ""));
    if (isNaN(numericBaseApr)) {
        setEnhancedAprDisplay(poolApr); // Fallback if APR parsing fails
        setCapitalEfficiencyFactor(1);
        return;
    }

    if (isNaN(tl) || isNaN(tu) || tl >= tu) {
      setCapitalEfficiencyFactor(1);
      // If range is invalid, display base APR if in range (or no current price), or 0% if out of range.
      if (activePreset === "Full Range") {
         setEnhancedAprDisplay(poolApr);
      } else {
         setEnhancedAprDisplay("0.00% (Out of Range)");
      }
      return;
    }

    let M = 1;
    let concentrationMethod = 'Full Range';

    // Calculate M based on active preset or manual ticks
    if (activePreset === "Full Range" || (tl <= sdkMinTick && tu >= sdkMaxTick)) {
      M = 1;
      concentrationMethod = 'Full Range';
    } else if (activePreset && ["±3%", "±8%", "±15%", "±1%", "±0.5%", "±0.1%"].includes(activePreset)) {
        // Use the new simplified formula for percentage presets
        let percentage = 0;
        if (activePreset === "±3%") percentage = 0.03;
        else if (activePreset === "±8%") percentage = 0.08;
        else if (activePreset === "±15%") percentage = 0.15;
        else if (activePreset === "±1%") percentage = 0.01;
        else if (activePreset === "±0.5%") percentage = 0.005;
        else if (activePreset === "±0.1%") percentage = 0.001;

        if (percentage > 0) {
             M = 1 / (2 * percentage);
             concentrationMethod = `Preset ${activePreset} (Formula)`;
        } else {
             M = 1;
             concentrationMethod = 'Preset Zero Range?';
        }
         M = Math.min(M, 500);
    } else {
      // Use the existing tick-based calculation for manual ranges
      const P_lower = Math.pow(1.0001, tl);
      const P_upper = Math.pow(1.0001, tu);

      concentrationMethod = 'Manual Range (Tick Formula)';

      if (P_lower <= 0 || !isFinite(P_upper) || P_lower >= P_upper) {
        M = 1; // Invalid range for concentration formula
      } else {
        const priceRatio = P_upper / P_lower;
        const ratio_pow_025 = Math.pow(priceRatio, 0.25);

        if (Math.abs(ratio_pow_025 - 1) < 1e-9) {
            M = 500; // Cap for extremely narrow ranges
        } else {
            const denominator = ratio_pow_025 - (1 / ratio_pow_025);
            if (Math.abs(denominator) < 1e-9) {
                M = 500; // Denominator too small, cap M
            } else {
                M = 2 / denominator;
            }
        }
      }
      M = Math.max(1, M);
      M = Math.min(M, 500);
    }
    setCapitalEfficiencyFactor(parseFloat(M.toFixed(2)));

    // If not full range, and current price is outside the selected ticks, APR is 0
    if (activePreset !== "Full Range" && !(tl <= sdkMinTick && tu >= sdkMaxTick) && cPt !== null && (cPt < tl || cPt > tu)) {
        setEnhancedAprDisplay("0.00% (Out of Range)");
    } else {
        const boostedNumericApr = numericBaseApr * M;
        // Apply a cap to the displayed APR for very narrow ranges
        const cappedBoostedNumericApr = Math.min(boostedNumericApr, numericBaseApr * 500); 
        setEnhancedAprDisplay(`${cappedBoostedNumericApr.toFixed(2)}%`);
    }

  }, [poolApr, activePreset, tickLower, tickUpper, sdkMinTick, sdkMaxTick, currentPoolTick]);

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
    debounce(async (currentAmount0: string, currentAmount1: string, currentTickLower: string, currentTickUpper: string, inputSide: 'amount0' | 'amount1') => {
      if (!chainId) return;

      const tl = parseInt(currentTickLower);
      const tu = parseInt(currentTickUpper);

      if (isNaN(tl) || isNaN(tu) || tl >= tu) {
        setCalculatedData(null);
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
        if (inputSide === 'amount0' && currentAmount1 !== "Error") setAmount1("");
        else if (inputSide === 'amount1' && currentAmount0 !== "Error") setAmount0("");
        return;
      }
      
      if (!primaryAmount || parseFloat(primaryAmount) <= 0) {
        setCalculatedData(null);
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

      try {
        // Check if position is OOR - follow Uniswap's pattern
        const isOOR = currentPoolTick !== null && currentPoolTick !== undefined &&
                      (currentPoolTick < tl || currentPoolTick > tu);

        let result;

        if (isOOR) {
          const primaryTokenDef = TOKEN_DEFINITIONS[primaryTokenSymbol];
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
            const token1Decimals = TOKEN_DEFINITIONS[token1Symbol]?.decimals;
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
            console.error('Error formatting amount1:', e);
            setAmount1("Error");
            showErrorToast("Calculation Error", "Amount parse failed");
            setCalculatedData(null);
          }
        } else {
          try {
            // Format amount0 using token0Symbol decimals (result.amount0 is always in token0 decimals)
            const token0Decimals = TOKEN_DEFINITIONS[token0Symbol]?.decimals;
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
            console.error('Error formatting amount0:', e);
            setAmount0("Error");
            showErrorToast("Calculation Error", "Amount parse failed");
            setCalculatedData(null);
          }
        }
      } catch (error: any) {
        showErrorToast("Calculation Error", "Estimation failed");
        setCalculatedData(null);
        setCurrentPrice(null);
        setCurrentPoolTick(null);
        setCurrentPriceLine(null);  
        if (inputSide === 'amount0' && currentAmount1 !== "Error") setAmount1(""); 
        else if (inputSide === 'amount1' && currentAmount0 !== "Error") setAmount0("");
      } finally {
        setIsCalculating(false);
      }
    }, 700),
    [accountAddress, chainId, token0Symbol, token1Symbol]
  );

  // Trigger calculation when needed
  useEffect(() => {
    const currentDeps = { amount0, amount1, tickLower, tickUpper, activeInputSide };
    let shouldCallDebouncedCalc = false;

    if (activeInputSide === 'amount0') {
      if (
        currentDeps.amount0 !== prevCalculationDeps.current.amount0 ||
        currentDeps.tickLower !== prevCalculationDeps.current.tickLower ||
        currentDeps.tickUpper !== prevCalculationDeps.current.tickUpper ||
        currentDeps.activeInputSide !== prevCalculationDeps.current.activeInputSide
      ) {
        shouldCallDebouncedCalc = true;
      }
    } else if (activeInputSide === 'amount1') {
      if (
        currentDeps.amount1 !== prevCalculationDeps.current.amount1 ||
        currentDeps.tickLower !== prevCalculationDeps.current.tickLower ||
        currentDeps.tickUpper !== prevCalculationDeps.current.tickUpper ||
        currentDeps.activeInputSide !== prevCalculationDeps.current.activeInputSide
      ) {
        shouldCallDebouncedCalc = true;
      }
    } else {
      // No active input side, but amounts or ticks might have changed
      if (
        currentDeps.amount0 !== prevCalculationDeps.current.amount0 ||
        currentDeps.amount1 !== prevCalculationDeps.current.amount1 ||
        currentDeps.tickLower !== prevCalculationDeps.current.tickLower ||
        currentDeps.tickUpper !== prevCalculationDeps.current.tickUpper
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
                debouncedCalculateAmountAndCheckApprovals(amount0, amount1, tickLower, tickUpper, inputSideForCalc);
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
    const t0Def = TOKEN_DEFINITIONS[token0Symbol];
    const t1Def = TOKEN_DEFINITIONS[token1Symbol];
    let insufficient = false;

    if (!t0Def || !t1Def) {
      setIsInsufficientBalance(false);
      return;
    }

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
  }, [amount0, amount1, token0Symbol, token1Symbol, calculatedData, token0BalanceData, token1BalanceData]);

  // Fetch pool metrics and state ONCE per pool (cached)
  useEffect(() => {
    const fetchPoolData = async () => {
      if (!selectedPoolId) return;

      // Check if already cached for this pool
      if (cachedPoolMetrics?.poolId === selectedPoolId) return;

      try {
        const [metricsResponse, stateResponse] = await Promise.all([
          fetch('/api/liquidity/pool-metrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ poolId: selectedPoolId, days: 7 })
          }),
          fetch(`/api/liquidity/get-pool-state?poolId=${encodeURIComponent(selectedPoolId)}`)
        ]);

        if (metricsResponse.ok) {
          const data = await metricsResponse.json();
          let poolLiquidity = "0";

          if (stateResponse.ok) {
            const stateData = await stateResponse.json();
            poolLiquidity = stateData.liquidity || "0";
          }

          setCachedPoolMetrics({
            poolId: selectedPoolId,
            metrics: data.metrics,
            poolLiquidity
          });
        }
      } catch (error) {
        // Silently fail - APY will show as unavailable
      }
    };

    fetchPoolData();
  }, [selectedPoolId, cachedPoolMetrics]);

  useEffect(() => {
    const calculateApy = async () => {
      if (!selectedPoolId || !tickLower || !tickUpper || !currentPoolSqrtPriceX96 || currentPoolTick === null) {
        setEstimatedApy("0.00");
        return;
      }

      const lowerTick = parseInt(tickLower);
      const upperTick = parseInt(tickUpper);

      if (isNaN(lowerTick) || isNaN(upperTick) || lowerTick >= upperTick) {
        setEstimatedApy("0.00");
        return;
      }

      const amount0Num = parseFloat(amount0 || '0');
      const amount1Num = parseFloat(amount1 || '0');
      if (amount0Num <= 0 && amount1Num <= 0) {
        setEstimatedApy("0.00");
        return;
      }

      if (!cachedPoolMetrics || cachedPoolMetrics.poolId !== selectedPoolId) {
        setIsCalculatingApy(true);
        return;
      }

      if (!cachedPoolMetrics.metrics || cachedPoolMetrics.metrics.days === 0) {
        setEstimatedApy("—");
        return;
      }

      setIsCalculatingApy(true);

      try {
        const poolConfig = getPoolById(selectedPoolId);
        if (!poolConfig) {
          setEstimatedApy("—");
          setIsCalculatingApy(false);
          return;
        }

        const token0Def = TOKEN_DEFINITIONS[token0Symbol];
        const token1Def = TOKEN_DEFINITIONS[token1Symbol];

        if (!token0Def || !token1Def) {
          setEstimatedApy("—");
          setIsCalculatingApy(false);
          return;
        }

        const sdkToken0 = poolToken0 || new Token(4002, getAddress(token0Def.address), token0Def.decimals, token0Symbol, token0Symbol);
        const sdkToken1 = poolToken1 || new Token(4002, getAddress(token1Def.address), token1Def.decimals, token1Symbol, token1Symbol);

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

        const userLiquidity = calculatedData?.liquidity;

        const apy = await calculateUserPositionAPY(
          sdkPool,
          lowerTick,
          upperTick,
          amount0,
          amount1,
          cachedPoolMetrics.metrics as PoolMetrics,
          userLiquidity
        );

        const formattedApy = formatUserAPY(apy);
        setEstimatedApy(formattedApy);
      } catch (error) {
        setEstimatedApy("—");
      } finally {
        setIsCalculatingApy(false);
      }
    };

    const timer = setTimeout(() => calculateApy(), 1000);
    return () => clearTimeout(timer);
  }, [selectedPoolId, tickLower, tickUpper, currentPoolSqrtPriceX96, currentPoolTick, token0Symbol, token1Symbol, amount0, amount1, calculatedData, cachedPoolMetrics, poolToken0, poolToken1]);

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
            <>
            {/* Header removed; now provided by parent container */}

              {/* Range Section - Step 1 - Hide when showing transaction steps */}
              {!showingTransactionSteps && (
              <div className="border border-dashed rounded-md mb-6 bg-muted/10 p-3">
                {/* Range Label */}
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium">Range</Label>
                  <div className="flex items-center gap-2">
                    {!currentPrice || !minPriceInputString || !maxPriceInputString ? (
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

                      const isActive = activePreset === presetValue;
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
                />
              )}

              {/* Input for Token 0 */}
              <div className="space-y-2">
                <motion.div
                  className={cn("rounded-lg bg-muted/30 p-4 group", { "outline outline-1 outline-muted": isAmount0Focused })}
                  animate={balanceWiggleControls0}
                >
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-medium">Amount</Label>
                    <Button
                      variant="ghost"
                      className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                      onClick={() => handleUseFullBalance(token0BalanceData?.formatted || "0", token0Symbol, true)}
                      disabled={!canAddToken0 || isWorking || isCalculating}
                    >
                      {displayToken0Balance} {token0Symbol}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                      <Image src={getTokenIcon(token0Symbol)} alt={token0Symbol} width={20} height={20} className="rounded-full"/>
                      <span className="text-sm font-medium">{token0Symbol}</span>
                    </div>
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
                                const preciseAmount = parseFloat(viemFormatUnits(BigInt(calculatedData.amount0), TOKEN_DEFINITIONS[token0Symbol]?.decimals || 18));
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

              {/* Plus Icon */}
              <div className="flex justify-center items-center my-2">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
                  <PlusIcon className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              {/* Input for Token 1 */}
              <div className="space-y-2 mb-4">
                <motion.div
                  className={cn("rounded-lg bg-muted/30 p-4 group", { "outline outline-1 outline-muted": isAmount1Focused })}
                  animate={balanceWiggleControls1}
                >
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-medium">Amount</Label>
                    <Button
                      variant="ghost"
                      className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                      onClick={() => handleUseFullBalance(token1BalanceData?.formatted || "0", token1Symbol, false)}
                      disabled={!canAddToken1 || isWorking || isCalculating}
                    >
                      {displayToken1Balance} {token1Symbol}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                      <Image src={getTokenIcon(token1Symbol)} alt={token1Symbol} width={20} height={20} className="rounded-full"/>
                      <span className="text-sm font-medium">{token1Symbol}</span>
                    </div>
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
                                const preciseAmount = parseFloat(viemFormatUnits(BigInt(calculatedData.amount1), TOKEN_DEFINITIONS[token1Symbol]?.decimals || 18));
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

              {/* Estimated APY Display - Only show in first view, not in transaction steps */}
              {!showingTransactionSteps && (
                <div className="flex items-center justify-between mb-4 px-1">
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span>Estimated APY</span>
                          <CircleHelp className="h-3 w-3" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[240px] text-xs">
                        <p>
                          APY is calculated from historical fee data over the last 7 days,
                          accounting for the liquidity depth change from your position.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <div className="text-xs font-medium">
                    {isCalculatingApy ? (
                      <div className="h-3.5 w-12 bg-muted/50 rounded animate-pulse" />
                    ) : (
                      <span className="text-foreground">{estimatedApy}%</span>
                    )}
                  </div>
                </div>
              )}

              {/* Current Price Display removed per updated UI */}

              {/* Transaction Steps - Show when user clicked deposit */}
              {showingTransactionSteps && (
                <div className="p-3 border border-dashed rounded-md bg-muted/10 mb-4">
                  <p className="text-sm font-medium mb-2 text-foreground/80">Transaction Steps</p>
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    {/* ERC20 Approvals to Permit2 */}
                    <div className="flex items-center justify-between">
                      <span>Token Approvals</span>
                      <span>
                        { isApproving || isCheckingApprovals
                          ? <RefreshCwIcon className="h-4 w-4 animate-spin" />
                          : (
                            <motion.span
                              animate={approvalWiggleControls}
                              className={`text-xs font-mono ${
                                !approvalData?.needsToken0ERC20Approval && !approvalData?.needsToken1ERC20Approval
                                  ? 'text-green-500'
                                  : approvalWiggleCount > 0
                                  ? 'text-red-500'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              {isCheckingApprovals
                                ? 'Checking...'
                                : !approvalData
                                ? '-'
                                : (() => {
                                    // Calculate total approvals needed based on whether tokens are native AND amounts > 0 (single-sided)
                                    const token0IsNative = TOKEN_DEFINITIONS[token0Symbol]?.address === NATIVE_TOKEN_ADDRESS;
                                    const token1IsNative = TOKEN_DEFINITIONS[token1Symbol]?.address === NATIVE_TOKEN_ADDRESS;
                                    const amount0Num = parseFloat(amount0 || '0');
                                    const amount1Num = parseFloat(amount1 || '0');

                                    // Only count non-native tokens with non-zero amounts
                                    const maxNeeded = (token0IsNative || amount0Num === 0 ? 0 : 1) + (token1IsNative || amount1Num === 0 ? 0 : 1);
                                    const totalNeeded = [approvalData.needsToken0ERC20Approval, approvalData.needsToken1ERC20Approval].filter(Boolean).length;
                                    const completed = maxNeeded - totalNeeded;
                                    return `${completed}/${maxNeeded}`;
                                  })()}
                            </motion.span>
                          )
                        }
                      </span>
                    </div>

                    {/* Permit2 Signature */}
                    <div className="flex items-center justify-between">
                      <span>Permit Signature</span>
                      <span>
                        { currentTransactionStep === 'signing_permit'
                          ? <RefreshCwIcon className="h-4 w-4 animate-spin" />
                          : permitSignature
                          ? <span className="text-xs font-mono text-green-500">1/1</span>
                          : <span className="text-xs font-mono">0/1</span>
                        }
                      </span>
                    </div>

                    {/* Deposit Transaction */}
                    <div className="flex items-center justify-between">
                      <span>Deposit Transaction</span>
                      <span>
                        { isDepositConfirming
                          ? <RefreshCwIcon className="h-4 w-4 animate-spin" />
                          : (
                            <span className={`text-xs font-mono ${isDepositSuccess ? 'text-green-500' : ''}`}>
                              {isDepositSuccess ? '1/1' : '0/1'}
                            </span>
                          )
                        }
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Continue Button */}
              {!isConnected ? (
                <div className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30"
                  style={{ backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                >
                  {/* @ts-ignore */}
                  <appkit-button className="absolute inset-0 z-10 block h-full w-full cursor-pointer p-0 opacity-0" />
                  <span className="relative z-0 pointer-events-none">Connect Wallet</span>
                </div>
              ) : showingTransactionSteps ? (
                // Split button layout: Back | Deposit/Approve/etc
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="w-1/3 border-sidebar-border bg-button hover:bg-muted/30"
                    onClick={() => {
                      setShowingTransactionSteps(false);
                      resetTransaction();
                    }}
                    disabled={isWorking}
                    style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                  >
                    Back
                  </Button>
                  <Button
                    className={cn(
                      "flex-1",
                      (isWorking || isCalculating || isPoolStateLoading || isCheckingApprovals ||
                      (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) ||
                      isInsufficientBalance) ?
                        "relative border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
                        :
                        "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
                    )}
                    onClick={handlePrepareAndSubmit}
                    disabled={isWorking ||
                      isCalculating ||
                      isPoolStateLoading ||
                      isCheckingApprovals ||
                      (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) ||
                      isInsufficientBalance
                    }
                    style={(isWorking || isCalculating || isPoolStateLoading || isCheckingApprovals ||
                      (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) ||
                      isInsufficientBalance) ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                  >
                    <span className={cn(
                      (isWorking || isCheckingApprovals || isPoolStateLoading)
                        ? "animate-pulse"
                        : ""
                    )}>
                      {getButtonText()}
                    </span>
                  </Button>
                </div>
              ) : (
                // Single button layout for initial view
                <Button
                  className={cn(
                    "w-full",
                    (isWorking || isCalculating || isPoolStateLoading || isCheckingApprovals ||
                    (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) ||
                    isInsufficientBalance) ?
                      "relative border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
                      :
                      "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
                  )}
                  onClick={handlePrepareAndSubmit}
                  disabled={isWorking ||
                    isCalculating ||
                    isPoolStateLoading ||
                    isCheckingApprovals ||
                    (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) ||
                    isInsufficientBalance
                  }
                  style={(isWorking || isCalculating || isPoolStateLoading || isCheckingApprovals ||
                    (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) ||
                    isInsufficientBalance) ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                >
                  <span className={cn(
                    (isWorking || isCheckingApprovals || isPoolStateLoading)
                      ? "animate-pulse"
                      : ""
                  )}>
                    {getButtonText()}
                  </span>
                </Button>
              )}
            </>
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