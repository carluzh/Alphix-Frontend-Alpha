"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PlusIcon, RefreshCwIcon, MinusIcon, ActivityIcon, CheckIcon, InfoIcon, ArrowLeftIcon, OctagonX, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { useAccount, useBalance } from "wagmi";
import { toast } from "sonner";
import { useEthersSigner } from "@/hooks/useEthersSigner";
import { V4_POOL_FEE, V4_POOL_TICK_SPACING, V4_POOL_HOOKS } from "@/lib/swap-constants";
import { TOKEN_DEFINITIONS, TokenSymbol } from "@/lib/pools-config";
import { baseSepolia } from "@/lib/wagmiConfig";
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
import { InteractiveRangeChart } from "./InteractiveRangeChart";
import { RangeSelectionModalV2 } from "./range-selection";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
// import { useWeb3Modal } from '@web3modal/wagmi/react';

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

// Chart data interfaces
interface CustomAxisLabel {
  tickValue: number;    
  displayLabel: string; 
}
import { Token } from '@uniswap/sdk-core';
import { Pool as V4PoolSDK, Position as V4PositionSDK } from "@uniswap/v4-sdk";
import JSBI from "jsbi";
import poolsConfig from "../../config/pools.json";
import { useAllPrices } from "@/components/data/hooks";
import { formatUSD } from "@/lib/format";

// Utility functions
const getTokenIcon = (symbol?: string) => {
  if (!symbol) return "/placeholder-logo.svg";
  const tokenConfig = getToken(symbol);
  return tokenConfig?.icon || "/placeholder-logo.svg";
};

const formatTokenDisplayAmount = (amount: string, tokenSymbol: TokenSymbol) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0";

  const tokenConfig = TOKEN_DEFINITIONS[tokenSymbol];
  const tokenDecimals = tokenConfig?.decimals ?? 18;

  // Cap display at 10 decimals max, abbreviate if token has more
  let displayDecimals, shouldAbbreviate;

  if (tokenDecimals > 10) {
    displayDecimals = 10;
    shouldAbbreviate = true;
  } else {
    displayDecimals = tokenDecimals;
    shouldAbbreviate = false;
  }

  const formatted = num.toFixed(displayDecimals);

  // Add '...' if token has more than 10 decimals
  return shouldAbbreviate ? formatted + '...' : formatted;
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
  const [priceAtTickLower, setPriceAtTickLower] = useState<string | null>(null);
  const [priceAtTickUpper, setPriceAtTickUpper] = useState<string | null>(null);
  const [currentPoolSqrtPriceX96, setCurrentPoolSqrtPriceX96] = useState<string | null>(null);
  
  // UI state
  const [isInsufficientBalance, setIsInsufficientBalance] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>("Full Range");
  const [isPoolStateLoading, setIsPoolStateLoading] = useState<boolean>(false);
  const [isChartLoading, setIsChartLoading] = useState<boolean>(false);
  const [enhancedAprDisplay, setEnhancedAprDisplay] = useState<string>(poolApr || "Yield N/A");
  const [capitalEfficiencyFactor, setCapitalEfficiencyFactor] = useState<number>(1);
  const [initialDefaultApplied, setInitialDefaultApplied] = useState(false);
  const [baseTokenForPriceDisplay, setBaseTokenForPriceDisplay] = useState<TokenSymbol>('aUSDC');
  
  // UI flow management
  const [depositStep, setDepositStep] = useState<'range' | 'amount'>('amount');
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
  
  // Custom X-axis ticks for chart
  const [customXAxisTicks, setCustomXAxisTicks] = useState<CustomAxisLabel[]>([]);
  
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
  
  // Function to remove number input arrows
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      input[type=number]::-webkit-inner-spin-button,
      input[type=number]::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      input[type=number] {
        -moz-appearance: textfield;
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

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

  // Set initial state based on props
  useEffect(() => {
    setBaseTokenForPriceDisplay(token0Symbol);
  }, [token0Symbol]);

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

  // Auto flip denomination to match InteractiveRangeChart axis when beneficial
  const shouldFlipDenomination = useMemo(() => {
    if (!currentPrice) return false;
    const currentPriceNum = parseFloat(currentPrice);
    if (!isFinite(currentPriceNum) || currentPriceNum <= 0) return false;
    const inverse = 1 / currentPriceNum;
    return inverse > currentPriceNum;
  }, [currentPrice]);

  // Inversion state based on current price (same as shouldFlipDenomination for consistency)
  const isInverted = useMemo(() => shouldFlipDenomination, [shouldFlipDenomination]);

  // Keep denomination aligned with inversion (but freeze while editing)
  useEffect(() => {
    if (editingSide) return;
    const desiredBase = isInverted ? token0Symbol : token1Symbol;
    if (desiredBase && desiredBase !== baseTokenForPriceDisplay) {
      setBaseTokenForPriceDisplay(desiredBase);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInverted, token0Symbol, token1Symbol, editingSide]);

  // Determine optimal denomination for display decimals (match chart priority)
  const optimalDenominationForDecimals = useMemo(() => {
    const quotePriority: Record<string, number> = {
      'aUSDC': 10,
      'aUSDT': 9,
      'USDC': 8,
      'USDT': 7,
      'aETH': 6,
      'ETH': 5,
      'YUSD': 4,
      'mUSDT': 3,
    };
    const t0 = token0Symbol;
    const t1 = token1Symbol;
    const p0 = quotePriority[t0] || 0;
    const p1 = quotePriority[t1] || 0;
    return p1 > p0 ? t1 : t0;
  }, [token0Symbol, token1Symbol]);

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
          setPriceAtTickLower(null);
          setPriceAtTickUpper(null);
          setInitialDefaultApplied(false);
          setActivePreset(isStablePool ? "±1%" : "±15%"); // Reset preset on pool change
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

  // Reset state when tokens change
  useEffect(() => {
    setInitialDefaultApplied(false);
    setTickLower(sdkMinTick.toString());
    setTickUpper(sdkMaxTick.toString());
        setAmount0("");
        setAmount1("");
        setAmount0FullPrecision("");
        setAmount1FullPrecision("");
    setAmount0FullPrecision("");
    setAmount1FullPrecision("");
    setCalculatedData(null);
    setCurrentPoolTick(null);
    setPriceAtTickLower(null);
    setPriceAtTickUpper(null);
    setCurrentPrice(null);
    setActivePreset(isStablePool ? "±1%" : "±15%"); // Reset preset based on pool type
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
            
            // Always show 10 ticks on either side of current price
            const centerTick = poolState.currentPoolTick;
            const halfView = defaultTickSpacing * 10;
            const domainTickLower = centerTick - halfView;
            const domainTickUpper = centerTick + halfView;
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

  // Effect to update custom X-axis ticks when domain changes
  useEffect(() => {
    if (xDomain && xDomain[0] !== undefined && xDomain[1] !== undefined && token0Symbol && token1Symbol) {
      const [minTickDomain, maxTickDomain] = xDomain;
      const desiredTickCount = 3; 
      const newLabels: CustomAxisLabel[] = [];

      const token0Def = TOKEN_DEFINITIONS[token0Symbol];
      const token1Def = TOKEN_DEFINITIONS[token1Symbol];
      const displayDecimals = baseTokenForPriceDisplay === token0Symbol 
        ? (token0Def?.displayDecimals ?? 4) 
        : (token1Def?.displayDecimals ?? 4);

      if (minTickDomain === maxTickDomain) {
        // Simplified: just show one label if domain is a single point
        // Price calculation for a single tick
        let priceAtTick = NaN;
                  if (token0Def?.decimals !== undefined && token1Def?.decimals !== undefined) {
            const decimalAdjFactor = baseTokenForPriceDisplay === token0Symbol 
              ? Math.pow(10, token1Def.decimals - token0Def.decimals)
              : Math.pow(10, token0Def.decimals - token1Def.decimals);
            const rawPrice = baseTokenForPriceDisplay === token0Symbol 
              ? Math.pow(1.0001, -minTickDomain)
              : Math.pow(1.0001, minTickDomain);
            priceAtTick = rawPrice * decimalAdjFactor;
          }
        let label = minTickDomain.toString();
        if (!isNaN(priceAtTick)) {
          if (priceAtTick > 0 && priceAtTick < 0.01) {
            label = '<0.01';
          } else {
            const formatted = priceAtTick.toLocaleString('en-US', { maximumFractionDigits: displayDecimals, minimumFractionDigits: 2 });
            // If it rounds to 0.00 but is actually positive, show <0.01
            label = (formatted === '0.00' && priceAtTick > 0) ? '<0.01' : formatted;
          }
        }
        newLabels.push({ 
          tickValue: minTickDomain, 
          displayLabel: label
        });
      } else if (isFinite(minTickDomain) && isFinite(maxTickDomain)) {
        const range = maxTickDomain - minTickDomain;
        const step = range / (desiredTickCount > 1 ? desiredTickCount - 1 : 1);
        
        for (let i = 0; i < desiredTickCount; i++) {
          const tickVal = Math.round(minTickDomain + (i * step));
          let priceAtTick = NaN;

          if (currentPrice && currentPoolTick !== null) {
            // Use currentPrice as reference (same approach as min/max prices)
            const currentPriceNum = parseFloat(currentPrice);
            const priceDelta = Math.pow(1.0001, tickVal - currentPoolTick);
            
            if (baseTokenForPriceDisplay === token0Symbol) {
              priceAtTick = 1 / (currentPriceNum * priceDelta); // Invert for token0 denomination
            } else {
              priceAtTick = currentPriceNum * priceDelta; // Direct for token1 denomination
            }
          }
          let label = tickVal.toString();
          if (!isNaN(priceAtTick)) {
            if (priceAtTick > 0 && priceAtTick < 0.01) {
              label = '<0.01';
            } else {
              const formatted = priceAtTick.toLocaleString('en-US', { maximumFractionDigits: displayDecimals, minimumFractionDigits: Math.min(2, displayDecimals) });
              // If it rounds to 0.00 but is actually positive, show <0.01
              label = (formatted === '0.00' && priceAtTick > 0) ? '<0.01' : formatted;
            }
          }
          newLabels.push({ 
            tickValue: tickVal, 
            displayLabel: label
          });
        }
      } 
      setCustomXAxisTicks(newLabels);
    } else {
      // Handle non-finite domains if necessary, for now, clear ticks
      setCustomXAxisTicks([]);
      return;
    }
  }, [xDomain, baseTokenForPriceDisplay, token0Symbol, token1Symbol]);

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

    const decimalsForToken0Display = TOKEN_DEFINITIONS[token0Symbol]?.displayDecimals ?? 4;
    const decimalsForToken1Display = TOKEN_DEFINITIONS[token1Symbol]?.displayDecimals ?? 4;

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
    // Use optimal denomination for decimals like the chart; force 2 for USD-denominated
    const baseDisplayToken = optimalDenominationForDecimals;
    const baseDisplayDefault = TOKEN_DEFINITIONS[baseDisplayToken]?.displayDecimals ?? 4;
    const isUSDDenom = baseDisplayToken === 'aUSDT' || baseDisplayToken === 'aUSDC' || baseDisplayToken === 'USDT' || baseDisplayToken === 'USDC' || baseDisplayToken === 'aDAI' || baseDisplayToken === 'DAI';
    const displayDecimals = isUSDDenom ? 2 : baseDisplayDefault;

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

    // Use token's displayDecimals from pools.json
    const tokenConfig = TOKEN_DEFINITIONS[tokenSymbolForDecimals];
    const displayDecimals = tokenConfig?.displayDecimals ?? 4;

    const formatted = numericBalance.toFixed(displayDecimals);
    return formatted;
  };

  // Display balance calculations
  const displayToken0Balance = isLoadingToken0Balance 
    ? "Loading..." 
    : (token0BalanceData ? getFormattedDisplayBalance(parseFloat(token0BalanceData.formatted), token0Symbol) : "~");
  
  const displayToken1Balance = isLoadingToken1Balance 
    ? "Loading..." 
    : (token1BalanceData ? getFormattedDisplayBalance(parseFloat(token1BalanceData.formatted), token1Symbol) : "~");

  // Handle selecting a preset from dropdown
  const handleSelectPreset = (preset: string) => {
    resetTransaction();
    
    setActivePreset(preset);
    setShowPresetSelector(false); // Close the selector
    
    // Apply the selected preset
    if (preset === "Full Range") {
      setTickLower(sdkMinTick.toString());
      setTickUpper(sdkMaxTick.toString());
      setInitialDefaultApplied(true);
      setPriceAtTickLower(null);
      setPriceAtTickUpper(null);
      // Reset viewbox to the ±15% centered style for consistency
      resetChartViewbox(sdkMinTick, sdkMaxTick);
    } else {
      // The percentage presets will be applied by the useEffect that watches activePreset
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

  // Handle direct click to edit price
  const handleClickToEditPrice = (side: 'min' | 'max') => {
    setShowPresetSelector(false);
    setEditingSide(side);
    const labels = computeRangeLabels();
    if (side === 'min') {
      const seed = labels ? labels.left : (minPriceInputString || "");
      setEditingMinPrice(seed.replace(/,/g, ''));
    } else {
      const seed = labels ? labels.right : (maxPriceInputString || "");
      setEditingMaxPrice(seed.replace(/,/g, ''));
    }
  };

  // Removed left/right remapping: left always edits "min" and right edits "max".

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

      const formattedBalance = numericBalance.toFixed(TOKEN_DEFINITIONS[tokenSymbolForDecimals]?.decimals || 18);

      if (isToken0) {
        setAmount0(formattedBalance);
        setActiveInputSide('amount0');
      } else { 
        setAmount1(formattedBalance);
        setActiveInputSide('amount1');
      }
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

    // Determine next step based on current state and approval data
    if (currentTransactionStep === 'idle') {
      // Check what's needed
      if (approvalData.needsToken0ERC20Approval) {
        setCurrentTransactionStep('approving_token0');
        await handleApprove(token0Symbol);
        setCurrentTransactionStep('idle');
        await refetchApprovals();
        return;
      }
      if (approvalData.needsToken1ERC20Approval) {
        setCurrentTransactionStep('approving_token1');
        await handleApprove(token1Symbol);
        setCurrentTransactionStep('idle');
        await refetchApprovals();
        return;
      }
      if ((approvalData.needsToken0Permit || approvalData.needsToken1Permit) && !permitSignature) {
        setCurrentTransactionStep('signing_permit');
        try {
          await signPermit();
          // After signing, don't refetch - the signature is enough for the deposit
          setCurrentTransactionStep('idle');
        } catch (error) {
          // Reset state on error (user rejection or failure)
          setCurrentTransactionStep('idle');
          return;
        }
        return;
      }
      // All approvals/permits done, execute deposit
      setCurrentTransactionStep('depositing');
      await handleDeposit(permitSignature);
      setCurrentTransactionStep('idle');
    }
  };

  // Sign the batch permit
  const signPermit = useCallback(async () => {
    if (!approvalData?.permitBatchData || !approvalData?.signatureDetails) {
      return;
    }

    if (!signer) {
      showErrorToast("Wallet not connected");
      return;
    }

    try {
      toast('Sign in Wallet', {
        icon: React.createElement(InfoIcon, { className: 'h-4 w-4' })
      });

      const signature = await (signer as any)._signTypedData(
        approvalData.signatureDetails.domain,
        approvalData.signatureDetails.types,
        approvalData.permitBatchData
      );

      setPermitSignature(signature);

      // Show success toast
      const currentTime = Math.floor(Date.now() / 1000);
      const sigDeadline = parseInt(approvalData.permitBatchData.sigDeadline || '0');
      const durationSeconds = sigDeadline - currentTime;

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
      if (currentTransactionStep === 'approving_token0') {
        return `Approving ${token0Symbol}...`;
      }
      if (currentTransactionStep === 'approving_token1') {
        return `Approving ${token1Symbol}...`;
      }
      if (currentTransactionStep === 'signing_permit') {
        return 'Signing...';
      }
      if (currentTransactionStep === 'depositing' || isDepositConfirming) {
        return 'Depositing...';
      }
      return 'Processing...';
    }

    // Not in transaction steps yet
    if (!showingTransactionSteps) {
      return 'Deposit';
    }

    // Waiting for approval data to load
    if (!approvalData) {
      return 'Loading...';
    }

    // In transaction steps - show what will happen next
    if (approvalData.needsToken0ERC20Approval) {
      return `Approve ${token0Symbol}`;
    }
    if (approvalData.needsToken1ERC20Approval) {
      return `Approve ${token1Symbol}`;
    }
    if ((approvalData.needsToken0Permit || approvalData.needsToken1Permit) && !permitSignature) {
      return 'Sign Permit';
    }
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
        newTickLower = Math.ceil(newTickLower / defaultTickSpacing) * defaultTickSpacing;
        newTickUpper = Math.floor(newTickUpper / defaultTickSpacing) * defaultTickSpacing;

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
            // Reset viewbox for full range
            resetChartViewbox(sdkMinTick, sdkMaxTick);
        }
    }
  }, [currentPrice, currentPoolTick, activePreset, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper, resetTransaction]);

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
        const calcResponse = await fetch('/api/liquidity/calculate-liquidity-parameters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token0Symbol,
            token1Symbol,
            inputAmount: primaryAmount,
            inputTokenSymbol: primaryTokenSymbol,
            userTickLower: tl,
            userTickUpper: tu,
            chainId,
          }),
        });

        if (!calcResponse.ok) {
          const errorData = await calcResponse.json();
          throw new Error(errorData.message || "Failed to calculate parameters.");
        }

        const result = await calcResponse.json();
        
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
        if (result.priceAtTickLower) setPriceAtTickLower(result.priceAtTickLower);
        if (result.priceAtTickUpper) setPriceAtTickUpper(result.priceAtTickUpper);

        if (inputSide === 'amount0') {
          try {
            const rawFormattedAmount = viemFormatUnits(BigInt(result.amount1), TOKEN_DEFINITIONS[secondaryTokenSymbol]?.decimals || 18);
            const displayAmount = formatTokenDisplayAmount(rawFormattedAmount, secondaryTokenSymbol);
            setAmount1(displayAmount);
            setAmount1FullPrecision(rawFormattedAmount); // Store full precision
          } catch (e) {
            console.error('Error formatting amount1:', e);
            setAmount1("Error");
            showErrorToast("Calculation Error", "Amount parse failed");
            setCalculatedData(null);
          }
        } else {
          try {
            const rawFormattedAmount = viemFormatUnits(BigInt(result.amount0), TOKEN_DEFINITIONS[secondaryTokenSymbol]?.decimals || 18);
            const displayAmount = formatTokenDisplayAmount(rawFormattedAmount, secondaryTokenSymbol);
            setAmount0(displayAmount);
            setAmount0FullPrecision(rawFormattedAmount); // Store full precision
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
        setPriceAtTickLower(null);  
        setPriceAtTickUpper(null);  
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

  // Reset to range view when deposit succeeds
  useEffect(() => {
    if (isDepositSuccess) {
      setShowingTransactionSteps(false);
      setCurrentTransactionStep('idle');
      setPermitSignature(undefined);
    }
  }, [isDepositSuccess]);

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

  // Custom shape for ReferenceArea with rounded top corners
  const RoundedTopReferenceArea = (props: any) => {
    const { x, y, width, height, fill, fillOpacity, strokeOpacity } = props;
    
    // Validate all required numeric props
    if (
      typeof x !== 'number' || isNaN(x) ||
      typeof y !== 'number' || isNaN(y) ||
      typeof width !== 'number' || isNaN(width) ||
      typeof height !== 'number' || isNaN(height) ||
      width <= 0 || height <= 0
    ) {
      console.warn("[RoundedTopReferenceArea] Invalid props received:", { x, y, width, height });
      return null;
    }

    const r = 6;

    const path = `
      M ${x},${y + height} 
      L ${x + width},${y + height}
      L ${x + width},${y + r}
      Q ${x + width},${y} ${x + width - r},${y}
      L ${x + r},${y}
      Q ${x},${y} ${x},${y + r}
      Z
    `;

    // Fallback for very small widths where arcs might look weird
    if (width < 2 * r) {
        return <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={fillOpacity} strokeOpacity={strokeOpacity} />;
    }

    return <path d={path} fill={fill} fillOpacity={fillOpacity} strokeOpacity={strokeOpacity} />;
  };

  // Custom Recharts Tooltip
  const CustomTooltip = ({ active, payload, label, poolToken0Symbol, token0, token1, baseTokenForPrice }: any) => { 
    if (active && payload && payload.length && token0 && token1) {
      const tooltipData = payload[0].payload; 
      const currentTick = tooltipData.tick ?? label;
      const formattedTickLabel = typeof currentTick === 'number' ? currentTick.toLocaleString() : 'N/A'; 
      const displayPoolTokenSymbol = poolToken0Symbol || '';

      let priceAtTickDisplay = "Price N/A";
      const token0Def = TOKEN_DEFINITIONS[token0 as TokenSymbol];
      const token1Def = TOKEN_DEFINITIONS[token1 as TokenSymbol];

      if (token0Def && token1Def && typeof currentTick === 'number') {
        const t0Dec = token0Def.decimals;
        const t1Dec = token1Def.decimals;
        let price = NaN;
        let quoteTokenSymbol = "";
        let priceOfTokenSymbol = "";

        const sdkToken0 = new Token(baseSepolia.id, getAddress(token0Def.address), t0Dec, token0);
        const sdkToken1 = new Token(baseSepolia.id, getAddress(token1Def.address), t1Dec, token1);

        const formToken0IsPoolToken0 = sdkToken0.sortsBefore(sdkToken1);

        if (baseTokenForPrice === token0) { // Show price denominated in token0
            quoteTokenSymbol = token0;
            priceOfTokenSymbol = token1;
            const decimalAdjFactor = Math.pow(10, t1Dec - t0Dec);
            const rawPrice = formToken0IsPoolToken0 
                ? Math.pow(1.0001, -currentTick) 
                : Math.pow(1.0001, currentTick);
            price = rawPrice * decimalAdjFactor;
        } else { // Show price denominated in token1
            quoteTokenSymbol = token1;
            priceOfTokenSymbol = token0;
            const decimalAdjFactor = Math.pow(10, t0Dec - t1Dec);
            const rawPrice = formToken0IsPoolToken0 
                ? Math.pow(1.0001, currentTick)
                : Math.pow(1.0001, -currentTick);
            price = rawPrice * decimalAdjFactor;
        }

        if (!isNaN(price)) {
          const displayDecimals = TOKEN_DEFINITIONS[quoteTokenSymbol as TokenSymbol]?.displayDecimals || 4;
          if (price === Infinity) priceAtTickDisplay = "∞";
          else if (price < 1e-8 && price > 0) priceAtTickDisplay = "<0.00000001";
          else if (price === 0) priceAtTickDisplay = "0";
          else priceAtTickDisplay = price.toLocaleString('en-US', { maximumFractionDigits: displayDecimals, minimumFractionDigits: Math.min(2, displayDecimals) });
          priceAtTickDisplay += ` ${priceOfTokenSymbol}/${quoteTokenSymbol}`;
        } else {
            priceAtTickDisplay = "Price Calc Error";
        }
      } else {
        priceAtTickDisplay = "Price Data Missing";
      }

      return (
        <div className="bg-background border border-border shadow-lg p-2 rounded-md text-xs">
          <p className="font-semibold text-foreground/90">{`Tick: ${formattedTickLabel}`}</p>
          <p className="text-foreground/80 mt-0.5">{`Price: ${priceAtTickDisplay}`}</p>
        </div>
      );
    }
    return null;
  };

  // Chart data state - now handled in InteractiveRangeChart

  // Calculate price range in optimal denomination for display
  const getPriceRangeDisplay = useCallback(() => {
    if (currentPoolTick === null || !currentPrice || !tickLower || !tickUpper) {
      return null;
    }

    const currentPriceNum = parseFloat(currentPrice);
    const lowerTick = parseInt(tickLower);
    const upperTick = parseInt(tickUpper);
    
    // Calculate prices at tick boundaries
    const lowerPriceDelta = Math.pow(1.0001, lowerTick - currentPoolTick);
    const upperPriceDelta = Math.pow(1.0001, upperTick - currentPoolTick);
    
    // Determine optimal denomination (same logic as InteractiveRangeChart)
    // Follow inversion: denominate token0 when inverted, token1 otherwise
    const optimalDenomination = isInverted ? token0Symbol : token1Symbol;
    
    let priceAtLowerTick, priceAtUpperTick;
    
    if (isInverted) {
      // When inverted, swap the displayed order and invert values
      priceAtLowerTick = 1 / (currentPriceNum * lowerPriceDelta);
      priceAtUpperTick = 1 / (currentPriceNum * upperPriceDelta);
    } else {
      priceAtLowerTick = currentPriceNum * lowerPriceDelta;
      priceAtUpperTick = currentPriceNum * upperPriceDelta;
    }
    
    // Get display decimals for the optimal denomination
    // Increase precision for Stable pools when USD denominated
    let displayDecimals = TOKEN_DEFINITIONS[optimalDenomination]?.displayDecimals || 4;
    const poolCfg = selectedPoolId ? getPoolById(selectedPoolId) : null;
    const isStable = (poolCfg?.type || '').toLowerCase() === 'stable';
    
    // For USD-denominated tokens, always use 2 decimals
    // Also check if the prices are in USD range (100-10000) which indicates USD denomination
    const isUSDDenominated = (optimalDenomination === 'aUSDT' || optimalDenomination === 'aUSDC') || 
                            (priceAtLowerTick >= 100 && priceAtLowerTick <= 10000 && priceAtUpperTick >= 100 && priceAtUpperTick <= 10000);
    const finalDisplayDecimals = isUSDDenominated ? (isStable ? 6 : 2) : displayDecimals;
    
    // Temporarily disable console logs during development to reduce spam
    // console.log("[AddLiquidityForm] Price range formatting:", {
    //   optimalDenomination,
    //   displayDecimals,
    //   finalDisplayDecimals,
    //   priceAtLowerTick,
    //   priceAtUpperTick,
    //   isUSDDenominated
    // });
    
    // Format prices with proper decimals
    const formattedLower = priceAtLowerTick.toLocaleString('en-US', { 
      maximumFractionDigits: finalDisplayDecimals, 
      minimumFractionDigits: finalDisplayDecimals 
    });
    const formattedUpper = priceAtUpperTick.toLocaleString('en-US', { 
      maximumFractionDigits: finalDisplayDecimals, 
      minimumFractionDigits: finalDisplayDecimals 
    });
    
    if (tickLower === sdkMinTick.toString() && tickUpper === sdkMaxTick.toString()) {
      return `0.00 - ∞`;
    }

    // Always display ascending by price (left = lower price, right = higher price)
    const lowFirst = priceAtLowerTick <= priceAtUpperTick;
    const leftVal = lowFirst ? formattedLower : formattedUpper;
    const rightVal = lowFirst ? formattedUpper : formattedLower;
    return `${leftVal} - ${rightVal}`;
  }, [currentPoolTick, currentPrice, tickLower, tickUpper, sdkMinTick, sdkMaxTick, token0Symbol, token1Symbol]);

  // Compute precise left/right labels to mirror chart axis (ascending by price)
  const computeRangeLabels = useCallback((): { left: string; right: string } | null => {
    if (currentPoolTick === null || !currentPrice || !tickLower || !tickUpper) return null;
    const currentNum = parseFloat(currentPrice);
    if (!isFinite(currentNum) || currentNum <= 0) return null;
    const lower = parseInt(tickLower);
    const upper = parseInt(tickUpper);
    if (isNaN(lower) || isNaN(upper)) return null;

    // Use baseTokenForPriceDisplay to determine inversion (user's chosen denomination)
    const shouldInvert = baseTokenForPriceDisplay === token0Symbol;
    const priceAt = (tickVal: number) => {
      const priceDelta = Math.pow(1.0001, tickVal - currentPoolTick);
      return shouldInvert ? 1 / (currentNum * priceDelta) : currentNum * priceDelta;
    };

    // Full range special
    if (tickLower === sdkMinTick.toString() && tickUpper === sdkMaxTick.toString()) {
      return { left: '0.00', right: '∞' };
    }

    const pLower = priceAt(lower);
    const pUpper = priceAt(upper);

    const denomToken = shouldInvert ? token0Symbol : token1Symbol;
    const isUsd = denomToken === 'aUSDT' || denomToken === 'aUSDC' || denomToken === 'USDT' || denomToken === 'USDC' || denomToken === 'aDAI' || denomToken === 'DAI';
    const poolCfg = selectedPoolId ? getPoolById(selectedPoolId) : null;
    const isStablePoolType = (poolCfg?.type || '').toLowerCase() === 'stable';
    const decimals = isUsd ? (isStablePoolType ? 6 : 2) : (TOKEN_DEFINITIONS[denomToken]?.displayDecimals ?? 4);

    const points = [
      { tick: lower, price: pLower },
      { tick: upper, price: pUpper },
    ].filter(p => isFinite(p.price) && !isNaN(p.price));

    if (points.length < 2) return null;

    points.sort((a, b) => a.price - b.price);

    const formatVal = (v: number) => {
      if (!isFinite(v)) return '∞';
      if (v > 0 && v < 0.01) return '<0.01';
      const formatted = v.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: Math.min(2, decimals) });
      // If it rounds to 0.00 but is actually positive, show <0.01
      if (formatted === '0.00' && v > 0) return '<0.01';
      return formatted;
    };

    // Always display ascending by price: left = lower, right = higher
    return { left: formatVal(points[0].price), right: formatVal(points[1].price) };
  }, [currentPoolTick, currentPrice, tickLower, tickUpper, token0Symbol, token1Symbol, sdkMinTick, sdkMaxTick, baseTokenForPriceDisplay, selectedPoolId]);

  // const { open } = useWeb3Modal();

  return (
    <div className="space-y-4">
      {/* Tabs for Swap/Deposit/Withdraw - MOVED TO PARENT COMPONENT */}
      {/*
      <div className="flex border-b border-border mb-4">
        <button
          className={`py-2 px-4 text-sm font-medium ${activeTab === 'deposit' 
            ? 'text-foreground border-b-2 border-primary' 
            : 'text-muted-foreground hover:text-foreground/80'}`}
          onClick={() => setActiveTab('deposit')}
        >
          Deposit
        </button>
        <button
          className={`py-2 px-4 text-sm font-medium ${activeTab === 'withdraw' 
            ? 'text-foreground border-b-2 border-primary' 
            : 'text-muted-foreground hover:text-foreground/80'}`}
          onClick={() => {
            setActiveTab('withdraw');
            showInfoToast("Withdraw Coming Soon");
          }}
        >
          Withdraw
        </button>
        <button
          className={`py-2 px-4 text-sm font-medium ${activeTab === 'swap' 
            ? 'text-foreground border-b-2 border-primary' 
            : 'text-muted-foreground hover:text-foreground/80'}`}
          onClick={() => {
            setActiveTab('swap');
            showInfoToast("Swap Coming Soon");
          }}
        >
          Swap
        </button>
      </div>
      */}

      {/* Deposit Tab Content */}
      {activeTab === 'deposit' && (
        <>
          {/* Amount Input Step */}
            <>
            {/* Header removed; now provided by parent container */}
              
              {/* Input for Token 0 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <Button 
                    variant="ghost" 
                    className="h-auto p-0 text-sm font-medium text-foreground hover:bg-transparent hover:text-muted-foreground transition-colors" 
                  >
                    Amount
                  </Button>
                  <div className="flex items-center gap-1">
                    <Button 
                      variant="ghost" 
                      className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" 
                      onClick={() => handleUseFullBalance(token0BalanceData?.formatted || "0", token0Symbol, true)} 
                      disabled={isWorking || isCalculating}
                    >  
                      Balance: {displayToken0Balance} {token0Symbol}
                    </Button>
                  </div>
                </div>
                <motion.div
                  className={cn("rounded-lg bg-muted/30 p-4", { "outline outline-1 outline-muted": isAmount0Focused })}
                  animate={balanceWiggleControls0}
                >
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
                        disabled={isWorking || (isCalculating && activeInputSide === 'amount1')}
                        className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                      />
                      <div className="text-right text-xs text-muted-foreground">
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
                <div className="flex items-center justify-between mb-2">
                  <Button 
                    variant="ghost" 
                    className="h-auto p-0 text-sm font-medium text-foreground hover:bg-transparent hover:text-muted-foreground transition-colors" 
                  >
                    Amount
                  </Button>
                  <div className="flex items-center gap-1">
                    <Button 
                      variant="ghost" 
                      className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" 
                      onClick={() => handleUseFullBalance(token1BalanceData?.formatted || "0", token1Symbol, false)} 
                      disabled={isWorking || isCalculating}
                    > 
                      Balance: {displayToken1Balance} {token1Symbol}
                    </Button>
                  </div>
                </div>
                <motion.div
                  className={cn("rounded-lg bg-muted/30 p-4", { "outline outline-1 outline-muted": isAmount1Focused })}
                  animate={balanceWiggleControls1}
                >
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
                        disabled={isWorking || (isCalculating && activeInputSide === 'amount0')}
                        className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                      />
                      <div className="text-right text-xs text-muted-foreground">
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
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Price Range Label (outside container, matching Amount style) */}
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">Price Range</Label>
                <div className="flex items-center gap-2">
                  {!currentPrice || !minPriceInputString || !maxPriceInputString ? (
                    // Loading skeletons
                    <>
                      <div className="h-4 w-12 bg-muted/50 rounded animate-pulse" />
                      <div className="w-px h-4 bg-border" />
                      <div className="h-4 w-20 bg-muted/50 rounded animate-pulse" />
                    </>
                  ) : (
                    <>
                      {/* Range Type badge - opens modal */}
                      <button
                        type="button"
                        className="px-2 py-0.5 text-xs font-medium rounded-md border border-sidebar-border bg-muted/30 text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                        onClick={() => setShowRangeModal(true)}
                        title="Click to change range"
                      >
                        {(() => {
                          const presetLabels: Record<string, string> = {
                            "Full Range": "Full Range",
                            "±15%": "Conservative",
                            "±8%": "Moderate",
                            "±3%": "Concentrated",
                            "±1%": "Narrow",
                            "±0.5%": "Very Narrow",
                            "±0.1%": "Ultra Narrow"
                          };
                          return activePreset ? (presetLabels[activePreset] || activePreset) : "Custom";
                        })()}
                      </button>
                      {getPriceRangeDisplay() && (
                        <>
                          <div className="w-px h-4 bg-border" />
                          {/* Clickable price range display - opens modal */}
                          <div className="flex items-center gap-1 text-xs">
                            <div
                              className={`${(isDraggingRange === 'left' || isDraggingRange === 'center') ? 'text-white' : 'text-muted-foreground'} hover:text-white px-1 py-1 transition-colors cursor-pointer`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setModalInitialFocusField('min');
                                setShowRangeModal(true);
                              }}
                            >
                              {(() => {
                                const labels = computeRangeLabels();
                                return labels ? labels.left : (minPriceInputString || "0.00");
                              })()}
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
                              {(() => {
                                const labels = computeRangeLabels();
                                return labels ? labels.right : (maxPriceInputString || "∞");
                              })()}
                            </div>
                            {currentPrice && (
                              <TooltipProvider delayDuration={0}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="ml-2 inline-flex items-center gap-1 text-[10px] px-1 py-0.5 rounded border border-sidebar-border text-muted-foreground">
                                      <span className="inline-block w-[2px] h-2" style={{ background: '#e85102' }} />
                                      <span className="select-none">
                                        {(() => {
                                          const inverse = 1 / parseFloat(currentPrice);
                                          const flip = inverse > parseFloat(currentPrice);
                                          const denomToken = flip ? token0Symbol : token1Symbol;
                                          const isUsd = denomToken === 'aUSDT' || denomToken === 'aUSDC' || denomToken === 'USDT' || denomToken === 'USDC' || denomToken === 'aDAI' || denomToken === 'DAI';
                                          const displayDecimals = isUsd ? 2 : (TOKEN_DEFINITIONS[denomToken]?.displayDecimals ?? 4);
                                          const numeric = flip ? inverse : parseFloat(currentPrice);
                                          return isFinite(numeric) ? numeric.toFixed(displayDecimals) : '∞';
                                        })()}
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
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Range Preview Chart OR Transaction Steps (conditional based on flow state) */}
              {!showingTransactionSteps ? (
                <div
                  className={`pt-3 px-3 pb-1.5 border border-dashed rounded-md mb-4 transition-all duration-200 group ${
                    isPoolStateLoading || !isConnected
                      ? 'bg-muted/10'
                      : 'bg-muted/10 cursor-pointer hover:bg-primary/[0.025] hover:border-primary/10'
                  }`}
                  onClick={!isPoolStateLoading && isConnected ? () => setShowRangeModal(true) : undefined}
                >
                  {isPoolStateLoading || !isConnected ? (
                    <div className="w-full h-[100px] relative overflow-hidden flex flex-col items-center justify-center bg-muted/50 rounded-md">
                      <Image
                        src="/LogoIconWhite.svg"
                        alt="Alphix Logo"
                        width={32}
                        height={32}
                        className="animate-pulse opacity-75"
                      />
                    </div>
                  ) : (
                    <div className="relative pointer-events-none h-[100px]">
                      <InteractiveRangeChart
                        key={`chart-${baseTokenForPriceDisplay}`}
                        selectedPoolId={selectedPoolId}
                        chainId={chainId}
                        token0Symbol={token0Symbol}
                        token1Symbol={token1Symbol}
                        currentPoolTick={currentPoolTick}
                        currentPrice={currentPrice}
                        currentPoolSqrtPriceX96={currentPoolSqrtPriceX96}
                        tickLower={tickLower}
                        tickUpper={tickUpper}
                        xDomain={xDomain}
                        onRangeChange={(newLower, newUpper) => {
                          setTickLower(newLower);
                          setTickUpper(newUpper);
                          resetTransaction();
                          setInitialDefaultApplied(true);
                          setActivePreset(null);
                        }}
                        onXDomainChange={(newDomain) => {
                          setXDomain(newDomain);
                        }}
                        sdkMinTick={sdkMinTick}
                        sdkMaxTick={sdkMaxTick}
                        defaultTickSpacing={defaultTickSpacing}
                        poolToken0={poolToken0}
                        poolToken1={poolToken1}
                        onDragStateChange={(state) => setIsDraggingRange(state)}
                        onLoadingChange={(loading) => setIsChartLoading(loading)}
                        forceDenominationBase={baseTokenForPriceDisplay}
                        readOnly={true}
                      />

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

                      {(isChartLoading || isCalculating) && (
                        <div className="absolute inset-0 flex items-center justify-center bg-muted/20 rounded">
                          <Image
                            src="/LogoIconWhite.svg"
                            alt="Loading"
                            width={24}
                            height={24}
                            className="animate-pulse opacity-75"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
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
                                        const totalNeeded = [approvalData.needsToken0ERC20Approval, approvalData.needsToken1ERC20Approval].filter(Boolean).length;
                                        const completed = 2 - totalNeeded;
                                        return `${completed}/2`;
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
                              : (
                                <span className={`text-xs font-mono ${permitSignature ? 'text-green-500' : ''}`}>
                                  {permitSignature ? '1/1' : '0/1'}
                                </span>
                              )
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

              {/* Current Price Display removed per updated UI */}

              {/* Continue Button */}
              {!isConnected ? (
                <div className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30"
                  style={{ backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                >
                  {/* @ts-ignore */}
                  <appkit-button className="absolute inset-0 z-10 block h-full w-full cursor-pointer p-0 opacity-0" />
                  <span className="relative z-0 pointer-events-none">Connect Wallet</span>
                </div>
              ) : (
                <Button
                  className={cn(
                    "w-full",
                    (isWorking || isCalculating || isPoolStateLoading || isCheckingApprovals ||
                    (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) ||
                    isInsufficientBalance) ?
                      "relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
                      :
                      "text-sidebar-primary border border-sidebar-primary bg-[#3d271b] hover:bg-[#3d271b]/90"
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