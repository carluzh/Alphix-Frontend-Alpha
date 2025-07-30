"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PlusIcon, RefreshCwIcon, XIcon, CheckIcon, MinusIcon, InfinityIcon, InfoIcon, ActivityIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Dialog, 
  DialogFooter,
  DialogPortal,
  DialogOverlay,
  DialogTitle
} from "@/components/ui/dialog";
import * as RadixDialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { 
    useAccount, 
    useBalance
} from "wagmi";
import { toast } from "sonner";
import { V4_POOL_FEE, V4_POOL_TICK_SPACING, V4_POOL_HOOKS } from "@/lib/swap-constants";
import { TOKEN_DEFINITIONS, TokenSymbol, getAllTokens, CHAIN_ID } from "@/lib/pools-config";
import { baseSepolia } from "@/lib/wagmiConfig";
import { getPoolById, getToken } from "@/lib/pools-config";
import poolsConfig from "../../config/pools.json";
import { type Hex, formatUnits as viemFormatUnits, getAddress, parseUnits as viemParseUnits } from "viem"; 
import { Token } from '@uniswap/sdk-core'; 
import { Pool as V4PoolSDK, Position as V4PositionSDK } from "@uniswap/v4-sdk";
import JSBI from "jsbi"; 
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  ResponsiveContainer, 
  ComposedChart, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ReferenceArea, 
  ReferenceLine, 
  Label as RechartsChartLabel, 
  Bar,
  Cell,
  Area
} from 'recharts';
import { motion } from "framer-motion";
import { useAddLiquidityTransaction } from "./useAddLiquidityTransaction";
import { TokenSelector, TokenSelectorToken } from "../swap/TokenSelector";
import { AnimatePresence } from "framer-motion";
import { readContract, getBalance } from '@wagmi/core';
import { erc20Abi } from 'viem';
import { config } from '@/lib/wagmiConfig';

// Chart data interfaces from AddLiquidityForm
interface DepthChartDataPoint {
  tick: number;
  token0Depth: number;
  normToken0Depth?: number;
  token1Depth?: number;
  unifiedValue?: number;
  normUnifiedValue?: number;
  isUserPosition?: boolean;
  price?: number;
  value?: number;
  cumulativeUnifiedValue?: number;
  displayCumulativeValue?: number;
}

// Utility function (copied from app/liquidity/page.tsx)
const formatTokenDisplayAmount = (amount: string) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0.00";
  
  // Ensure very small positive values always show "< 0.0001" instead of "0.0000"
  if (num > 0 && num < 0.0001) {
    return "< 0.0001";
  }
  
  return num.toFixed(4);
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

export interface AddLiquidityModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onLiquidityAdded: () => void; 
  selectedPoolId?: string;
  sdkMinTick: number;
  sdkMaxTick: number;
  defaultTickSpacing: number;
  poolApr?: string; // New prop for pool APR
}

export function AddLiquidityModal({ 
  isOpen, 
  onOpenChange, 
  onLiquidityAdded, 
  selectedPoolId,
  sdkMinTick,
  sdkMaxTick,
  defaultTickSpacing,
  poolApr // Destructure new prop
}: AddLiquidityModalProps) {
  const { address: accountAddress, chainId, isConnected } = useAccount(); // Added isConnected



  // Initialize tokens based on selected pool
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
    // Start with empty tokens - no pre-chosen pair
    return { token0: '' as TokenSymbol, token1: '' as TokenSymbol };
  };

  const initialTokens = getInitialTokens();
  const [token0Symbol, setToken0Symbol] = useState<TokenSymbol>(initialTokens.token0);
  const [token1Symbol, setToken1Symbol] = useState<TokenSymbol>(initialTokens.token1);
  const [amount0, setAmount0] = useState<string>("");
  const [amount1, setAmount1] = useState<string>("");
  const [tickLower, setTickLower] = useState<string>(sdkMinTick.toString());
  const [tickUpper, setTickUpper] = useState<string>(sdkMaxTick.toString());
  const [currentPoolTick, setCurrentPoolTick] = useState<number | null>(null);
  const [activeInputSide, setActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
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
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);
  const [priceAtTickLower, setPriceAtTickLower] = useState<string | null>(null);
  const [priceAtTickUpper, setPriceAtTickUpper] = useState<string | null>(null);
  
  // Use the transaction hook
  const {
    isWorking,
    step,
    preparedTxData,
    permit2SignatureRequest,
    // Remove tokenApprovalStatus, tokensRequiringApproval, permit2StepsCompletedCount, maxPermit2StepsInCurrentTx
    // tokenApprovalStatus, 
    // tokensRequiringApproval, 
    // permit2StepsCompletedCount, 
    // maxPermit2StepsInCurrentTx,
    involvedTokensCount, // NEW
    completedTokensCount, // NEW
    
    isApproveWritePending,
    isApproving,
    isMintSendPending,
    isMintConfirming,
    
    handlePrepareMint,
    handleApprove,
    handleSignAndSubmitPermit2,
    handleMint,
    resetTransactionState,
    
    // Remove setTokensRequiringApproval, setMaxPermit2StepsInCurrentTx
    // setTokensRequiringApproval, 
    // setMaxPermit2StepsInCurrentTx, 
  } = useAddLiquidityTransaction({
    token0Symbol,
    token1Symbol,
    amount0,
    amount1,
    tickLower,
    tickUpper,
    activeInputSide,
    calculatedData,
    onLiquidityAdded,
    onOpenChange,
  });

  const prevCalculationDeps = useRef({
    amount0,
    amount1,
    tickLower,
    tickUpper,
    activeInputSide
  });

  const [isInsufficientBalance, setIsInsufficientBalance] = useState(false);

  const [activePreset, setActivePreset] = useState<string | null>("±15%");
  const [baseTokenForPriceDisplay, setBaseTokenForPriceDisplay] = useState<TokenSymbol>(token0Symbol);

  // Token selection state
  const [availableTokens, setAvailableTokens] = useState<TokenSelectorToken[]>([]);

  // --- BEGIN New Chart State ---
  const [xDomain, setXDomain] = useState<[number, number]>([-120000, 120000]); // Default wide tick range
  const [currentPriceLine, setCurrentPriceLine] = useState<number | null>(null);
  const [mockSelectedPriceRange, setMockSelectedPriceRange] = useState<[number, number] | null>(null);
  // --- END New Chart State ---

  // --- BEGIN Custom X-Axis Tick State ---
  interface CustomAxisLabel {
    tickValue: number;    // The actual tick value for positioning or data mapping
    displayLabel: string; // The string to display (price)
  }
  const [customXAxisTicks, setCustomXAxisTicks] = useState<CustomAxisLabel[]>([]);
  // --- END Custom X-Axis Tick State ---



  // --- BEGIN Panning State ---
  const [isPanning, setIsPanning] = useState(false);
  const panStartXRef = useRef<number | null>(null);
  const panStartDomainRef = useRef<[number, number] | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null); // Ref for the chart container
  // --- END Panning State ---

  const [chartData, setChartData] = useState<DepthChartDataPoint[]>([]);
  const [isChartDataLoading, setIsChartDataLoading] = useState(false);

  const [minPriceInputString, setMinPriceInputString] = useState<string>("");
  const [maxPriceInputString, setMaxPriceInputString] = useState<string>("");

  const [isPoolStateLoading, setIsPoolStateLoading] = useState<boolean>(false);

  const [derivedPoolId, setDerivedPoolId] = useState<string | undefined>(selectedPoolId);

  useEffect(() => {
    if (token0Symbol && token1Symbol) {
        const poolConfig = poolsConfig.pools.find(p =>
            ((p.currency0.symbol === token0Symbol && p.currency1.symbol === token1Symbol) ||
             (p.currency0.symbol === token1Symbol && p.currency1.symbol === token0Symbol)) &&
            p.enabled
        );
        setDerivedPoolId(poolConfig?.id);
    } else {
        setDerivedPoolId(undefined);
    }
  }, [token0Symbol, token1Symbol]);

  // State for capital efficiency enhanced APR
  const [capitalEfficiencyFactor, setCapitalEfficiencyFactor] = useState<number>(1);
  const [enhancedAprDisplay, setEnhancedAprDisplay] = useState<string>(poolApr || "Yield N/A");

  // --- BEGIN Liquidity Depth Data State ---
  interface HookPosition {
    tickLower: number;
    tickUpper: number;
    liquidity: string;
  }
  const [rawHookPositions, setRawHookPositions] = useState<HookPosition[] | null>(null);
  const [isFetchingLiquidityDepth, setIsFetchingLiquidityDepth] = useState<boolean>(false);
  // --- END Liquidity Depth Data State ---

  // --- BEGIN Liquidity Delta Events State ---
  interface Token0DepthDeltaEvent { // Renamed interface
    tick: number;
    change: bigint; // Using JavaScript BigInt for amount0 equivalent
  }
  const [token0DepthDeltaEvents, setToken0DepthDeltaEvents] = useState<Token0DepthDeltaEvent[] | null>(null); // Renamed state
  // --- END Liquidity Delta Events State ---

  // --- BEGIN Aggregated & Sorted Tick States ---
  const [aggregatedToken0ChangesByTick, setAggregatedToken0ChangesByTick] = useState<Map<number, bigint> | null>(null);
  const [sortedUniqueTicksWithToken0Changes, setSortedUniqueTicksWithToken0Changes] = useState<number[] | null>(null);
  // --- END Aggregated & Sorted Tick States ---

  // --- BEGIN Simplified Chart Plot Data ---
  const [simplifiedChartPlotData, setSimplifiedChartPlotData] = useState<Array<{ tick: number; cumulativeUnifiedValue: number }> | null>(null);
  // --- END Simplified Chart Plot Data ---

  // --- BEGIN Processed Position Details State ---
  interface ProcessedPositionDetail {
    tickLower: number;
    tickUpper: number;
    liquidity: string;
    amount0: string;
    amount1: string;
    numericAmount0: number;
    numericAmount1: number;
    unifiedValueInToken0: number; 
  }
  const [processedPositions, setProcessedPositions] = useState<ProcessedPositionDetail[] | null>(null);
  // --- END Processed Position Details State ---

  // --- BEGIN Unified Value Delta Events State ---
  interface UnifiedValueDeltaEvent {
    tick: number;
    changeInUnifiedValue: number;
  }
  const [unifiedValueDeltaEvents, setUnifiedValueDeltaEvents] = useState<UnifiedValueDeltaEvent[] | null>(null);
  // --- END Unified Value Delta Events State ---

  // --- BEGIN Aggregated & Sorted Unified Value Changes States ---
  const [aggregatedUnifiedValueChangesByTick, setAggregatedUnifiedValueChangesByTick] = useState<Map<number, number> | null>(null);
  const [sortedNetUnifiedValueChanges, setSortedNetUnifiedValueChanges] = useState<Array<{ tick: number; netUnifiedToken0Change: number }> | null>(null);
  // --- END Aggregated & Sorted Unified Value Changes States ---

  // --- BEGIN Derived Pool Tokens (for labels/formatting) ---
  const { poolToken0, poolToken1 } = useMemo(() => {
    if (!token0Symbol || !token1Symbol || !chainId) return { poolToken0: null, poolToken1: null };
      const currentToken0Def = TOKEN_DEFINITIONS[token0Symbol!]; // Renamed to avoid conflict
  const currentToken1Def = TOKEN_DEFINITIONS[token1Symbol!]; // Renamed to avoid conflict
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
  // --- END Derived Pool Tokens ---

  // --- BEGIN useEffect to calculate custom X-axis ticks ---
  useEffect(() => {
    if (xDomain && xDomain[0] !== undefined && xDomain[1] !== undefined && token0Symbol && token1Symbol && poolToken0 && poolToken1) {
      const [minTickDomain, maxTickDomain] = xDomain;
      const desiredTickCount = 3; 
      const newLabels: CustomAxisLabel[] = [];

      const token0Def = TOKEN_DEFINITIONS[token0Symbol];
      const token1Def = TOKEN_DEFINITIONS[token1Symbol];
      const displayDecimals = baseTokenForPriceDisplay === token0Symbol 
        ? (token0Def?.displayDecimals ?? (token0Symbol === 'aBTC' ? 8 : 4)) 
        : (token1Def?.displayDecimals ?? (token1Symbol === 'aBTC' ? 8 : 4));

      if (!token0Def || !token1Def) {
        setCustomXAxisTicks([]);
        return;
      }

      // Use the same corrected logic as tooltip and min/max prices
      const isUserOrderMatchingCanonical = poolToken0.address.toLowerCase() === token0Def.address.toLowerCase();
      const canonicalToken0Decimals = poolToken0.decimals;
      const canonicalToken1Decimals = poolToken1.decimals;

      // Helper function to calculate price from tick using corrected logic
      const calculatePriceFromTick = (tick: number): number => {
        if (baseTokenForPriceDisplay === token0Symbol) {
          // User wants to see price of token1 in terms of token0
          let finalDecimalAdjFactor: number;
          let priceCalculationFunc: (tick: number) => number;
          
          if (isUserOrderMatchingCanonical) {
            // token0=canonicalToken0, token1=canonicalToken1
            finalDecimalAdjFactor = Math.pow(10, canonicalToken1Decimals - canonicalToken0Decimals);
            priceCalculationFunc = (tick) => Math.pow(1.0001, -tick);
          } else {
            // token0=canonicalToken1, token1=canonicalToken0
            finalDecimalAdjFactor = Math.pow(10, canonicalToken0Decimals - canonicalToken1Decimals);
            priceCalculationFunc = (tick) => 1 / Math.pow(1.0001, -tick);
          }
          
          return priceCalculationFunc(tick) * finalDecimalAdjFactor;
        } else {
          // User wants to see price of token0 in terms of token1
          let finalDecimalAdjFactor: number;
          let priceCalculationFunc: (tick: number) => number;
          
          if (isUserOrderMatchingCanonical) {
            // token0=canonicalToken0, token1=canonicalToken1
            finalDecimalAdjFactor = Math.pow(10, canonicalToken0Decimals - canonicalToken1Decimals);
            priceCalculationFunc = (tick) => 1 / Math.pow(1.0001, -tick);
          } else {
            // token0=canonicalToken1, token1=canonicalToken0
            finalDecimalAdjFactor = Math.pow(10, canonicalToken1Decimals - canonicalToken0Decimals);
            priceCalculationFunc = (tick) => Math.pow(1.0001, -tick);
          }
          
          return priceCalculationFunc(tick) * finalDecimalAdjFactor;
        }
      };

      if (minTickDomain === maxTickDomain) {
        // Simplified: just show one label if domain is a single point
        const priceAtTick = calculatePriceFromTick(minTickDomain);
        newLabels.push({ 
          tickValue: minTickDomain, 
          displayLabel: isNaN(priceAtTick) ? minTickDomain.toString() : priceAtTick.toLocaleString(undefined, { maximumFractionDigits: displayDecimals, minimumFractionDigits: 2 })
        });
      } else if (isFinite(minTickDomain) && isFinite(maxTickDomain)) {
        const range = maxTickDomain - minTickDomain;
        const step = range / (desiredTickCount > 1 ? desiredTickCount - 1 : 1);
        
        for (let i = 0; i < desiredTickCount; i++) {
          const tickVal = Math.round(minTickDomain + (i * step));
          const priceAtTick = calculatePriceFromTick(tickVal);
          
          newLabels.push({ 
            tickValue: tickVal, 
            displayLabel: isNaN(priceAtTick) ? tickVal.toString() : priceAtTick.toLocaleString(undefined, { maximumFractionDigits: displayDecimals, minimumFractionDigits: Math.min(2, displayDecimals) }) 
          });
        }
      } 
      setCustomXAxisTicks(newLabels);
    } else {
      // Handle non-finite domains if necessary, for now, clear ticks
      setCustomXAxisTicks([]);
      return;
    }
  }, [xDomain, baseTokenForPriceDisplay, token0Symbol, token1Symbol, poolToken0, poolToken1]);
  // --- END useEffect to calculate custom X-axis ticks ---

  // --- BEGIN State for Pool's Current SqrtPriceX96 ---
  // TODO: This state needs to be populated reliably, ideally from the same source as currentPoolTick (e.g., get-pool-state API call)
  const [currentPoolSqrtPriceX96, setCurrentPoolSqrtPriceX96] = useState<string | null>(null); // Store as string, convert to JSBI when used
  // --- END State for Pool's Current SqrtPriceX96 ---

  // Define Subgraph URL - consider moving to a constants file if used elsewhere
  const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-test/version/latest";

  // Helper function to get the canonical on-chain pool ID (Bytes! string)
  const getDerivedOnChainPoolId = useCallback((): string | null => {
    if (!token0Symbol || !token1Symbol || !chainId) return null;

    const token0Def = TOKEN_DEFINITIONS[token0Symbol];
    const token1Def = TOKEN_DEFINITIONS[token1Symbol];

    if (!token0Def || !token1Def) return null;

    try {
      const sdkToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals);
      const sdkToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals);

      const [sortedSdkToken0, sortedSdkToken1] = sdkToken0.sortsBefore(sdkToken1)
        ? [sdkToken0, sdkToken1]
        : [sdkToken1, sdkToken0];
      
      // Find the pool config for the selected tokens to get fee, tickSpacing, and hooks
      const poolConfig = poolsConfig.pools.find(p =>
        (p.currency0.symbol === token0Symbol && p.currency1.symbol === token1Symbol) ||
        (p.currency0.symbol === token1Symbol && p.currency1.symbol === token0Symbol)
      );

      if (!poolConfig) {
        console.warn(`[AddLiquidityModal] No pool config found for tokens: ${token0Symbol}/${token1Symbol}`);
        return null;
      }
      
      const poolIdBytes32 = V4PoolSDK.getPoolId(
        sortedSdkToken0,
        sortedSdkToken1,
        poolConfig.fee,
        poolConfig.tickSpacing,
        poolConfig.hooks as Hex
      );
      return poolIdBytes32.toLowerCase();
    } catch (error) {
      console.error("[AddLiquidityModal] Error deriving on-chain pool ID:", error);
      return null;
    }
  }, [token0Symbol, token1Symbol, chainId]);

  const getTokenIcon = (symbol?: string) => {
    if (!symbol) return "/placeholder-logo.svg";
    const tokenConfig = getToken(symbol);
    return tokenConfig?.icon || "/placeholder-logo.svg";
  };

  const { data: token0BalanceData, isLoading: isLoadingToken0Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[token0Symbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[token0Symbol]?.address && !!token0Symbol },
  });

  const { data: token1BalanceData, isLoading: isLoadingToken1Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[token1Symbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[token1Symbol]?.address && !!token1Symbol },
  });

  const [initialDefaultApplied, setInitialDefaultApplied] = useState(false);

  // Helper function to determine the better base token for price display
  const determineBaseTokenForPriceDisplay = useCallback((token0: TokenSymbol, token1: TokenSymbol): TokenSymbol => {
    if (!token0 || !token1) return token0;

    // Priority order for quote tokens (these should be the base for price display)
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

    const token0Priority = quotePriority[token0] || 0;
    const token1Priority = quotePriority[token1] || 0;

    // Return the token with higher priority (better quote currency)
    // If priorities are equal, default to token0
    return token1Priority > token0Priority ? token1 : token0;
  }, []);

  useEffect(() => {
    if (token0Symbol && token1Symbol) {
      const bestBaseToken = determineBaseTokenForPriceDisplay(token0Symbol, token1Symbol);
      setBaseTokenForPriceDisplay(bestBaseToken);
    } else if (token0Symbol) {
    setBaseTokenForPriceDisplay(token0Symbol); 
    }
  }, [token0Symbol, token1Symbol, determineBaseTokenForPriceDisplay]);

  useEffect(() => {
    if (isOpen && selectedPoolId) {
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
          setTickLower(sdkMinTick.toString());
          setTickUpper(sdkMaxTick.toString());
          setCurrentPoolTick(null);
          setCalculatedData(null);
          setActiveInputSide(null);
          setCurrentPrice(null); 
          setPriceAtTickLower(null); 
          setPriceAtTickUpper(null);
          setInitialDefaultApplied(false);
          setActivePreset("±15%"); // Reset preset on pool change
          // Base token for price display will be set by the useEffect
          // Reset chart specific states too
          setXDomain([-120000, 120000]);
          setCurrentPriceLine(null);
          setMockSelectedPriceRange(null);
          // Do not reset xDomain here, allow it to be driven by new data or reset explicitly if needed
        }
      }
    }
  }, [isOpen, selectedPoolId, sdkMinTick, sdkMaxTick]);

  useEffect(() => {
    setInitialDefaultApplied(false);
    setTickLower(sdkMinTick.toString());
    setTickUpper(sdkMaxTick.toString());
    setAmount0("");
    setAmount1("");
    setCalculatedData(null);
    setCurrentPoolTick(null); 
    setPriceAtTickLower(null);
    setPriceAtTickUpper(null);
    setCurrentPrice(null);
    setActivePreset("±15%"); // Reset preset on token/chain change
    // Base token for price display will be set by the useEffect
    // Reset chart specific states too
    setXDomain([-120000, 120000]);
    setCurrentPriceLine(null);
    setMockSelectedPriceRange(null);
  }, [token0Symbol, token1Symbol, chainId, sdkMinTick, sdkMaxTick]);

  // Effect to fetch initial pool state (current price and tick)
  useEffect(() => {
    const fetchPoolState = async () => {
      if (!token0Symbol || !token1Symbol || !chainId || !isOpen) return;

      setIsPoolStateLoading(true);
      try {
        const response = await fetch('/api/liquidity/get-pool-state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token0Symbol,
            token1Symbol,
            chainId,
          }),
        });
        
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
              if (typeof poolState.currentPoolTick === 'number') {
                const centerTick = poolState.currentPoolTick;
                const percentage = 0.30;
                const tickDeltaUpper = Math.log(1 + percentage) / Math.log(1.0001);
                const tickDeltaLower = Math.log(1 - percentage) / Math.log(1.0001);
                const domainTickLower = Math.round(centerTick + tickDeltaLower);
                const domainTickUpper = Math.round(centerTick + tickDeltaUpper);
                setXDomain([domainTickLower, domainTickUpper]);
              } else {
                setXDomain([numericCurrentPrice * 0.5, numericCurrentPrice * 1.5]); 
              }
          } else {
              setCurrentPriceLine(null);
              setXDomain([-120000, 120000]); 
          }
        } else {
          setCurrentPriceLine(null);
          setCurrentPoolSqrtPriceX96(null);
          throw new Error("Pool state data is incomplete.");
        }
      } catch (error: any) {
        toast.error("Pool Data Error", { description: error.message });
        setCurrentPriceLine(null);
        setCurrentPoolSqrtPriceX96(null);
      } finally {
        setIsPoolStateLoading(false);
      }
    };

    if (derivedPoolId) {
      fetchPoolState();
    } else {
      // If no pool is derived (e.g., one token cleared), reset relevant state
      setCurrentPrice(null);
      setCurrentPoolTick(null);
      setCurrentPriceLine(null);
      setCurrentPoolSqrtPriceX96(null);
    }
  }, [isOpen, derivedPoolId, token0Symbol, token1Symbol, chainId]);

  // Effect to populate available tokens for selection
  useEffect(() => {
    if (isOpen) {
      const tokensRecord = getAllTokens();
      const tokenSelectorTokens: TokenSelectorToken[] = Object.values(tokensRecord).map(token => ({
        address: token.address as `0x${string}`,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        icon: token.icon,
        usdPrice: 1 // Default price, will be updated by TokenSelector
      }));
      setAvailableTokens(tokenSelectorTokens);
    }
  }, [isOpen]);

  // Token selection handlers
  const handleToken0Select = (token: TokenSelectorToken) => {
    setToken0Symbol(token.symbol as TokenSymbol);
    setAmount0("");
    setAmount1("");
    setCalculatedData(null);
    setActiveInputSide(null);
  };

  const handleToken1Select = (token: TokenSelectorToken) => {
    setToken1Symbol(token.symbol as TokenSymbol);
    setAmount0("");
    setAmount1("");
    setCalculatedData(null);
    setActiveInputSide(null);
  };

  // --- BEGIN Panning Handlers ---
  const handlePanMouseDown = (e: any) => {
    if (e && e.chartX) { // e.chartX is provided by Recharts
      setIsPanning(true);
      panStartXRef.current = e.chartX;
      panStartDomainRef.current = [...xDomain] as [number, number]; // Store current domain
      if (chartContainerRef.current) chartContainerRef.current.style.cursor = 'grabbing';
    }
  };

  const handlePanMouseMove = (e: any) => {
    if (isPanning && e && e.chartX && panStartXRef.current !== null && panStartDomainRef.current !== null) {
      const currentChartX = e.chartX;
      const dxChartPixels = currentChartX - panStartXRef.current;

      // Estimate chart plot area width
      const chartWidthInPixels = chartContainerRef.current?.clientWidth || 400;
      const startDomainRange = panStartDomainRef.current[1] - panStartDomainRef.current[0];
      
      // Calculate domain shift based on pixel movement
      const domainShift = (dxChartPixels / chartWidthInPixels) * startDomainRange;
      
      // Standard behavior - dragging right shifts view right (decreases domain values)
      let newMin = panStartDomainRef.current[0] - domainShift;
      let newMax = panStartDomainRef.current[1] - domainShift;

      // Ensure min is not greater than max
      if (newMin >= newMax) {
        const safetyGap = 0.1;
        newMax = newMin + safetyGap;
      }

      setXDomain([newMin, newMax]);
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
  // --- END Panning Handlers ---

  // Effect to update mock selected price range based on activePreset and currentPriceLine/xDomain
  useEffect(() => {
    if (!currentPriceLine) return; // Don't calculate if no current price

    let newRange: [number, number] | null = null;
    const base = currentPriceLine;

    switch (activePreset) {
      case "Full Range":
        // Use a significant portion of the current xDomain or a wider fixed range
        newRange = [xDomain[0] + (xDomain[1] - xDomain[0]) * 0.05, xDomain[1] - (xDomain[1] - xDomain[0]) * 0.05];
        break;
      case "±3%":
        newRange = [base * 0.97, base * 1.03];
        break;
      case "±8%":
        newRange = [base * 0.92, base * 1.08];
        break;
      case "±15%":
        newRange = [base * 0.85, base * 1.15];
        break;
      default:
        // If no preset or an unknown one, clear the mock range or use last known priceAtTickLower/Upper
        // For now, let's try to use priceAtTickLower/Upper if they are valid
        const ptl = parseFloat(priceAtTickLower || "");
        const ptu = parseFloat(priceAtTickUpper || "");
        if (!isNaN(ptl) && !isNaN(ptu) && ptl < ptu && ptu < 1e10 && ptl > 1e-10) { // Added sanity check for extreme values
            newRange = [ptl, ptu];
        } else {
            newRange = null; // Or set to a default small range if needed
        }
        break;
    }
    if (newRange && newRange[0] >= newRange[1]) newRange = null; // Ensure min < max

    setMockSelectedPriceRange(newRange);

  }, [activePreset, currentPriceLine, xDomain, priceAtTickLower, priceAtTickUpper]);

  // Debug useEffect for actual priceAtTickLower/Upper changes (can be removed later)
  useEffect(() => {
    const ptlNum = parseFloat(priceAtTickLower || "");
    const ptuNum = parseFloat(priceAtTickUpper || "");
    if (!isNaN(ptlNum) && !isNaN(ptuNum) && ptlNum < ptuNum) {
      
    }
  }, [priceAtTickLower, priceAtTickUpper, xDomain]);

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

  // --- BEGIN Effect to fetch Pool APR data (currently 24h fees) ---
  // This effect is no longer needed as APR is passed as a prop.
  // It can be removed or commented out if there's a chance it might be re-enabled for other fee data.
  /*
  useEffect(() => {
    if (isOpen && selectedPoolId && token0Symbol && token1Symbol && chainId) {
      const fetchPoolFeeData = async () => {
        setPoolAPR("Loading APR...");
        setPoolDailyFeesUSD(null);
        try {
          const token0Def = TOKEN_DEFINITIONS[token0Symbol];
          const token1Def = TOKEN_DEFINITIONS[token1Symbol];

          if (!token0Def || !token1Def) {
            
            setPoolAPR("APR N/A");
            return;
          }

                  const sdkToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals);
        const sdkToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals);

          const [sortedSdkToken0, sortedSdkToken1] = sdkToken0.sortsBefore(sdkToken1)
            ? [sdkToken0, sdkToken1]
            : [sdkToken1, sdkToken0];
          
          const poolIdBytes32 = V4PoolSDK.getPoolId(
            sortedSdkToken0,
            sortedSdkToken1,
            V4_POOL_FEE,
            V4_POOL_TICK_SPACING,
            V4_POOL_HOOKS
          );

          const response = await fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${poolIdBytes32}&days=1`);
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || "Failed to fetch 24h fee data");
          }
          const feeData = await response.json();
          
          const fees24h = parseFloat(feeData.feesUSD);
          if (!isNaN(fees24h)) {
            setPoolDailyFeesUSD(fees24h.toLocaleString(undefined, { style: 'currency', currency: 'USD' }));
            
            setPoolAPR("APR (TVL N/A)"); // Placeholder until TVL is implemented
          } else {
            setPoolAPR("Fees N/A");
          }

        } catch (error: any) {
          
          setPoolAPR("APR Error");
          setPoolDailyFeesUSD(null);
        }
      };

      fetchPoolFeeData();
    }
  }, [isOpen, selectedPoolId, token0Symbol, token1Symbol, chainId]);
  */
  // --- END Effect to fetch Pool APR data ---

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
      // For an invalid range, it's always out of range conceptually unless it's full range.
      if (activePreset === "Full Range") { // Keep full range APR if invalid ticks occur in full range mode
         setEnhancedAprDisplay(poolApr);
      } else { // For any other invalid range, it's out of range.
         setEnhancedAprDisplay("0.00% (Out of Range)");
      }
      return;
    }

    let M = 1;
    let concentrationMethod = 'Full Range'; // For logging

    // Calculate M based on active preset or manual ticks
    if (activePreset === "Full Range" || (tl <= sdkMinTick && tu >= sdkMaxTick)) {
      M = 1;
      concentrationMethod = 'Full Range';
    } else if (activePreset && ["±3%", "±8%", "±15%"].includes(activePreset)) {
        // Use the new simplified formula for percentage presets
        let percentage = 0;
        if (activePreset === "±3%") percentage = 0.03;
        else if (activePreset === "±8%") percentage = 0.08;
        else if (activePreset === "±15%") percentage = 0.15;

        if (percentage > 0) {
             M = 1 / (2 * percentage);
             concentrationMethod = `Preset ${activePreset} (Formula)`;
        } else {
             M = 1; // Should not happen with current presets, but as a safety
             concentrationMethod = 'Preset Zero Range?';
        }
         M = Math.min(M, 500); // Apply the same cap as the tick-based method
    }
     else {
      // Use the existing tick-based calculation for manual ranges (activePreset is null)
      const P_lower = Math.pow(1.0001, tl);
      const P_upper = Math.pow(1.0001, tu);

      concentrationMethod = 'Manual Range (Tick Formula)';

      if (P_lower <= 0 || !isFinite(P_upper) || P_lower >= P_upper) {
        M = 1; // Invalid range for concentration formula
      } else {
        const priceRatio = P_upper / P_lower;
        const ratio_pow_025 = Math.pow(priceRatio, 0.25);

        if (Math.abs(ratio_pow_025 - 1) < 1e-9) { // Pu is extremely close to Pl
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
      M = Math.max(1, M); // Ensure factor is at least 1 (should be, unless P_lower > P_upper was missed)
      M = Math.min(M, 500); // General cap for sanity, adjustable
    }
    setCapitalEfficiencyFactor(parseFloat(M.toFixed(2)));

    // If not full range, and current price is outside the selected ticks, APR is 0
    if (activePreset !== "Full Range" && !(tl <= sdkMinTick && tu >= sdkMaxTick) && cPt !== null && (cPt < tl || cPt > tu)) {
        setEnhancedAprDisplay("0.00% (Out of Range)");
    } else {
        const boostedNumericApr = numericBaseApr * M;
         // Apply a cap to the displayed APR for very narrow ranges, matching the M cap
        const cappedBoostedNumericApr = Math.min(boostedNumericApr, numericBaseApr * 500); 
        setEnhancedAprDisplay(`${cappedBoostedNumericApr.toFixed(2)}%`);
    }

  }, [poolApr, activePreset, tickLower, tickUpper, sdkMinTick, sdkMaxTick, currentPoolTick]);

  // Effect to update price input strings when underlying ticks or base display token changes
  // REFACTORED: Now properly handles token order - ensures consistent calculations regardless of user selection order
  useEffect(() => {
    const numTickLower = parseInt(tickLower);
    const numTickUpper = parseInt(tickUpper);

    let valForMinInput: number | null = null;
    let valForMaxInput: number | null = null;

          const decimalsForToken0Display = TOKEN_DEFINITIONS[token0Symbol]?.displayDecimals ?? (token0Symbol === 'aBTC' ? 8 : 4);
      const decimalsForToken1Display = TOKEN_DEFINITIONS[token1Symbol]?.displayDecimals ?? (token1Symbol === 'aBTC' ? 8 : 4);

    const rawApiPriceAtTickLower = calculatedData?.priceAtTickLower ? parseFloat(calculatedData.priceAtTickLower) : null;
    const rawApiPriceAtTickUpper = calculatedData?.priceAtTickUpper ? parseFloat(calculatedData.priceAtTickUpper) : null;

    // Get token definitions and check canonical order
    const token0Def = TOKEN_DEFINITIONS[token0Symbol];
    const token1Def = TOKEN_DEFINITIONS[token1Symbol];

    if (!token0Def || !token1Def || !poolToken0 || !poolToken1) {
      setMinPriceInputString("");
      setMaxPriceInputString("");
      return;
    }

    // Check if user's token order matches canonical pool order
    const isUserOrderMatchingCanonical = poolToken0.address.toLowerCase() === token0Def.address.toLowerCase();
    
    // Calculate prices based on canonical pool order, then display appropriately
    // Always work with canonical pool tokens for consistent tick interpretation
    const canonicalToken0Decimals = poolToken0.decimals;
    const canonicalToken1Decimals = poolToken1.decimals;
    
    // Token order and decimals are now properly handled using canonical pool order
    
    if (baseTokenForPriceDisplay === token0Symbol) {
        // User wants to see price of token1 in terms of token0
        let finalDecimalAdjFactor: number;
        let priceCalculationFunc: (tick: number) => number;
        
        if (isUserOrderMatchingCanonical) {
            // token0=canonicalToken0, token1=canonicalToken1
            // Want price of canonicalToken1 in canonicalToken0 terms
            finalDecimalAdjFactor = Math.pow(10, canonicalToken1Decimals - canonicalToken0Decimals);
            priceCalculationFunc = (tick) => Math.pow(1.0001, -tick);
            console.log(`[Decimal Factor] Matching case: 10^(${canonicalToken1Decimals}-${canonicalToken0Decimals}) = ${finalDecimalAdjFactor}`);
        } else {
            // token0=canonicalToken1, token1=canonicalToken0
            // Want price of canonicalToken0 in canonicalToken1 terms = 1 / (price of canonicalToken1 in canonicalToken0)
            finalDecimalAdjFactor = Math.pow(10, canonicalToken0Decimals - canonicalToken1Decimals);
            priceCalculationFunc = (tick) => 1 / Math.pow(1.0001, -tick);
            console.log(`[Decimal Factor] Non-matching case: 10^(${canonicalToken0Decimals}-${canonicalToken1Decimals}) = ${finalDecimalAdjFactor}`);
        }
        
        if (rawApiPriceAtTickLower !== null) {
            valForMaxInput = rawApiPriceAtTickLower * finalDecimalAdjFactor;
        } else if (!isNaN(numTickLower)) {
            valForMaxInput = priceCalculationFunc(numTickLower) * finalDecimalAdjFactor;
        }
        
        if (rawApiPriceAtTickUpper !== null) {
            valForMinInput = rawApiPriceAtTickUpper * finalDecimalAdjFactor;
        } else if (!isNaN(numTickUpper)) {
            valForMinInput = priceCalculationFunc(numTickUpper) * finalDecimalAdjFactor;
        }
    } else {
        // User wants to see price of token0 in terms of token1
        let finalDecimalAdjFactor: number;
        let priceCalculationFunc: (tick: number) => number;
        
        if (isUserOrderMatchingCanonical) {
            // token0=canonicalToken0, token1=canonicalToken1
            // Want price of canonicalToken0 in canonicalToken1 terms = 1 / (price of canonicalToken1 in canonicalToken0)
            finalDecimalAdjFactor = Math.pow(10, canonicalToken0Decimals - canonicalToken1Decimals);
            priceCalculationFunc = (tick) => 1 / Math.pow(1.0001, -tick);
        } else {
            // token0=canonicalToken1, token1=canonicalToken0
            // Want price of canonicalToken1 in canonicalToken0 terms
            finalDecimalAdjFactor = Math.pow(10, canonicalToken1Decimals - canonicalToken0Decimals);
            priceCalculationFunc = (tick) => Math.pow(1.0001, -tick);
        }
        
        if (rawApiPriceAtTickLower !== null) {
            valForMinInput = (1 / rawApiPriceAtTickLower) * finalDecimalAdjFactor;
        } else if (!isNaN(numTickLower)) {
            valForMinInput = priceCalculationFunc(numTickLower) * finalDecimalAdjFactor;
        }
        
        if (rawApiPriceAtTickUpper !== null) {
            valForMaxInput = (1 / rawApiPriceAtTickUpper) * finalDecimalAdjFactor;
        } else if (!isNaN(numTickUpper)) {
            valForMaxInput = priceCalculationFunc(numTickUpper) * finalDecimalAdjFactor;
        }
    }

    let finalMinPriceString = "";
    let finalMaxPriceString = "";
    const displayDecimals = baseTokenForPriceDisplay === token0Symbol ? decimalsForToken0Display : decimalsForToken1Display;

    // Formatting for Min Price String
    if (valForMinInput !== null) {
        if (valForMinInput >= 0 && valForMinInput < 1e-11) { // Ensure positive or zero, then check if very small
            finalMinPriceString = "0";
        } else if (!isFinite(valForMinInput) || valForMinInput > 1e30) { // Check if Infinity or very large
            finalMinPriceString = "∞";
        } else { // Otherwise, format as a number
            finalMinPriceString = valForMinInput.toFixed(displayDecimals);
        }
    }

    // Formatting for Max Price String
    if (valForMaxInput !== null) {
        if (valForMaxInput >= 0 && valForMaxInput < 1e-11) { // Ensure positive or zero, then check if very small
            finalMaxPriceString = "0";
        } else if (!isFinite(valForMaxInput) || valForMaxInput > 1e30) { // Check if Infinity or very large
            finalMaxPriceString = "∞";
        } else { // Otherwise, format as a number
            finalMaxPriceString = valForMaxInput.toFixed(displayDecimals);
        }
    }

    // --- BEGIN USER REQUESTED LOG ---
    // Corrected variable names for logging
    const logTickUpper = numTickUpper; // Use numTickUpper
    const logCurrentPoolTick = currentPoolTick !== null ? Number(currentPoolTick) : null; // Use currentPoolTick

    const token0Decimals_forLog = TOKEN_DEFINITIONS[token0Symbol]?.decimals ?? 18;
    const token1Decimals_forLog = TOKEN_DEFINITIONS[token1Symbol]?.decimals ?? 18;
    const decimalAdjustmentFactor_forLog = Math.pow(10, token1Decimals_forLog - token0Decimals_forLog);

    const pTickAtCurrent_forLog = logCurrentPoolTick !== null ? Math.pow(1.0001, logCurrentPoolTick) : null;
    const pTickAtUpper_forLog = !isNaN(logTickUpper) ? Math.pow(1.0001, logTickUpper) : null;

    const actualPriceT1perT0AtCurrentPoolTick_forLog = pTickAtCurrent_forLog !== null ? pTickAtCurrent_forLog * decimalAdjustmentFactor_forLog : null;
    const actualPriceT1perT0AtUpperTick_forLog = pTickAtUpper_forLog !== null ? pTickAtUpper_forLog * decimalAdjustmentFactor_forLog : null;

    const displayDecimalsForT0_forLog = TOKEN_DEFINITIONS[token0Symbol]?.displayDecimals ?? 2;

    // Debug log to verify calculated prices
    console.log(`[Price Display] Min: ${finalMinPriceString}, Max: ${finalMaxPriceString} (denominated in ${baseTokenForPriceDisplay})`);

    setMinPriceInputString(finalMinPriceString);
    setMaxPriceInputString(finalMaxPriceString);

  }, [tickLower, tickUpper, baseTokenForPriceDisplay, token0Symbol, token1Symbol, sdkMinTick, sdkMaxTick, calculatedData, currentPoolTick, poolToken0, poolToken1]); // Added currentPoolTick, poolToken0, poolToken1 to dependencies
  // Effect to auto-apply active percentage preset when currentPrice changes OR when activePreset changes
  useEffect(() => {
    // Ensure currentPrice is valid and we have a preset that requires calculation
    //MODIFIED: Now bases off currentPoolTick if available, falling back to currentPrice only if tick is null.
    if (activePreset && ["±3%", "±8%", "±15%"].includes(activePreset)) {
        let percentage = 0;
        if (activePreset === "±3%") percentage = 0.03;
        else if (activePreset === "±8%") percentage = 0.08;
        else if (activePreset === "±15%") percentage = 0.15;

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
                toast.error("Preset Error", { description: "Cannot apply preset: current price is invalid and pool tick unavailable." });
                return;
            }
            const priceLowerTarget = numericCurrentPrice * (1 - percentage);
            const priceUpperTarget = numericCurrentPrice * (1 + percentage);

            newTickLower = Math.log(priceLowerTarget) / Math.log(1.0001);
            newTickUpper = Math.log(priceUpperTarget) / Math.log(1.0001);
        } else {
            // Cannot apply preset yet, waiting for pool data
            // toast.info("Preset Info", { description: "Waiting for pool data to apply preset." }); // Optional: can be noisy
            return;
        }

        // Align and clamp
        newTickLower = Math.ceil(newTickLower / defaultTickSpacing) * defaultTickSpacing;
        newTickUpper = Math.floor(newTickUpper / defaultTickSpacing) * defaultTickSpacing;

        newTickLower = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickLower));
        newTickUpper = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickUpper));

        if (newTickUpper - newTickLower >= defaultTickSpacing) {
            if (newTickLower.toString() !== tickLower || newTickUpper.toString() !== tickUpper) {
                if (preparedTxData) resetTransactionState();
                setTickLower(newTickLower.toString());
                setTickUpper(newTickUpper.toString());
                setInitialDefaultApplied(true); 
            }
        } else {
             toast.info("Preset Range Too Narrow", { description: "Selected preset results in an invalid range after tick alignment. Try a wider preset or manual range."});
        }
    } else if (activePreset === "Full Range") {
        if (tickLower !== sdkMinTick.toString() || tickUpper !== sdkMaxTick.toString()) {
            if (preparedTxData) resetTransactionState();
            setTickLower(sdkMinTick.toString());
            setTickUpper(sdkMaxTick.toString());
            setInitialDefaultApplied(true); 
        }
    }
  }, [currentPrice, currentPoolTick, activePreset, defaultTickSpacing, sdkMinTick, sdkMaxTick, token0Symbol, token1Symbol, tickLower, tickUpper, preparedTxData, resetTransactionState]);

  // --- BEGIN Fetch Liquidity Depth Data ---
  useEffect(() => {
    const fetchLiquidityDepthData = async () => {
      if (!isOpen || !derivedPoolId || !chainId || currentPoolTick === null) {
        // Clear previous data if conditions are not met (e.g., modal closed, pool changed before tick loaded)
        setRawHookPositions(null);
        return;
      }

      const derivedOnChainPoolId = getDerivedOnChainPoolId();
      if (!derivedOnChainPoolId) {
        console.warn("[AddLiquidityModal] Could not derive on-chain pool ID. Skipping liquidity depth fetch.");
        setRawHookPositions(null);
        return;
      }

      setIsFetchingLiquidityDepth(true);
      setIsChartDataLoading(true);

      try {
        const graphqlQuery = {
          query: `
            query GetAllHookPositionsForDepth {
              hookPositions(first: 1000, orderBy: liquidity, orderDirection: desc) { # Fetches top 1000 by liquidity
                pool # Fetch pool ID string directly
                tickLower
                tickUpper
                liquidity
              }
            }
          `,
          // No variables needed for this broad query
        };

        const queryPayload = { query: graphqlQuery.query };

        const response = await fetch(SUBGRAPH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(queryPayload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Network response was not ok: ${response.status} ${response.statusText}. Details: ${errorText}`);
        }

        const result = await response.json();

        if (result.errors) {
          console.error("[AddLiquidityModal] GraphQL errors from subgraph:", result.errors);
          throw new Error(`GraphQL error: ${result.errors.map((e: any) => e.message).join(', ')}`);
        }

        if (result.data && result.data.hookPositions) {
          // Adjust type hint for allFetchedPositions
          const allFetchedPositions = result.data.hookPositions as Array<HookPosition & { pool: string }>; 
          console.log(`[AddLiquidityModal] Subgraph returned ${allFetchedPositions.length} total hookPositions before client-side filtering.`);
          
          // Filter client-side using pos.pool directly
          const relevantPositions = allFetchedPositions.filter(
            pos => pos.pool && pos.pool.toLowerCase().trim() === derivedOnChainPoolId.trim()
          );

          setRawHookPositions(relevantPositions);
        } else {
          setRawHookPositions([]);
          console.warn("[AddLiquidityModal] No hookPositions found in GraphQL response or unexpected data structure.");
          toast.info("No liquidity depth data found.", { id: "liquidity-depth-fetch" });
        }

      } catch (error: any) {
        console.error("[AddLiquidityModal] Error fetching liquidity depth data:", error);
        toast.error("Liquidity Depth Error", { id: "liquidity-depth-fetch", description: error.message });
        setRawHookPositions(null); // Clear data on error
        generateFallbackChartData();
      } finally {
        setIsFetchingLiquidityDepth(false);
        setIsChartDataLoading(false);
        // Ensure toast is dismissed if it wasn't replaced by success/error/info
        if (toast.dismiss && document.querySelector('[data-sonner-toast][data-id="liquidity-depth-fetch"]')) {
            toast.dismiss("liquidity-depth-fetch");
        }
      }
    };

    if (token0Symbol && token1Symbol && token0Symbol !== '' && token1Symbol !== '') {
      fetchLiquidityDepthData();
    }
  }, [isOpen, derivedPoolId, chainId, currentPoolTick, token0Symbol, token1Symbol, getDerivedOnChainPoolId]); // Dependencies ensure re-fetch on pool change when modal is open and tick is known
  // --- END Fetch Liquidity Depth Data ---

  // Generate simplified fallback chart data when API fails
  const generateFallbackChartData = () => {
    if (currentPoolTick === null) return;
    
    const simpleData: DepthChartDataPoint[] = [];
    const centerTick = currentPoolTick;
    
    simpleData.push({ tick: centerTick - 20000, token0Depth: 0, normToken0Depth: 0, value: 0 });
    simpleData.push({ tick: centerTick - 10000, token0Depth: 50, normToken0Depth: 0.5, value: 0.5 });
    simpleData.push({ tick: centerTick, token0Depth: 100, normToken0Depth: 1, value: 1 });
    simpleData.push({ tick: centerTick + 10000, token0Depth: 50, normToken0Depth: 0.5, value: 0.5 });
    simpleData.push({ tick: centerTick + 20000, token0Depth: 0, normToken0Depth: 0, value: 0 });
    
    simpleData.sort((a, b) => a.tick - b.tick);
    
    setChartData(simpleData);
  };

  // --- BEGIN Process Raw Positions into Token0 Depth Delta Events ---
  useEffect(() => {
    if (
      rawHookPositions && rawHookPositions.length > 0 &&
      currentPoolTick !== null &&
      currentPoolSqrtPriceX96 !== null && // Ensure sqrtPriceX96 is available
      token0Symbol && token1Symbol && chainId &&
      poolToken0 && poolToken1 && // Ensure poolToken0 and poolToken1 are available for decimal formatting
      token0Symbol !== '' && token1Symbol !== '' // Ensure both tokens are selected
    ) {
      const newProcessedPositions: ProcessedPositionDetail[] = [];

      const token0Def = TOKEN_DEFINITIONS[token0Symbol];
      const token1Def = TOKEN_DEFINITIONS[token1Symbol];

      if (!token0Def || !token1Def) {
        setProcessedPositions(null);
        return;
      }

      const poolConfig = poolsConfig.pools.find(p =>
        ((p.currency0.symbol === token0Symbol && p.currency1.symbol === token1Symbol) ||
         (p.currency0.symbol === token1Symbol && p.currency1.symbol === token0Symbol)) &&
        p.enabled
      );

      if (!poolConfig) {
        console.error(`[AddLiquidityModal] Could not find pool config for processing positions: ${token0Symbol}/${token1Symbol}`);
        setProcessedPositions(null);
        return;
      }

      try {
        const sdkBaseToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals);
        const sdkBaseToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals);
        const [sdkSortedToken0, sdkSortedToken1] = sdkBaseToken0.sortsBefore(sdkBaseToken1) 
            ? [sdkBaseToken0, sdkBaseToken1] 
            : [sdkBaseToken1, sdkBaseToken0];

        // Convert currentPoolSqrtPriceX96 string to JSBI for the SDK
        const poolSqrtPriceX96JSBI = JSBI.BigInt(currentPoolSqrtPriceX96);

        const poolForCalculations = new V4PoolSDK(
          sdkSortedToken0,
          sdkSortedToken1,
          poolConfig.fee,
          poolConfig.tickSpacing,
          poolConfig.hooks as Hex,
          poolSqrtPriceX96JSBI, 
          JSBI.BigInt(0), // Placeholder liquidity for the pool object
          currentPoolTick
        );

        for (const position of rawHookPositions) {
          if (Number(position.tickLower) >= Number(position.tickUpper)) {
            console.warn("[AddLiquidityModal] Skipping position with invalid tick ordering:", position);
            continue;
          }
          if (position.tickLower !== undefined && position.tickUpper !== undefined && position.liquidity !== undefined) {
            const v4Position = new V4PositionSDK({
              pool: poolForCalculations,
              tickLower: Number(position.tickLower),
              tickUpper: Number(position.tickUpper),
              liquidity: JSBI.BigInt(position.liquidity)
            });

            // amount0 and amount1 from the SDK are for the sorted pool tokens
            const calculatedAmount0_JSBI = v4Position.amount0.quotient;
            const calculatedAmount1_JSBI = v4Position.amount1.quotient;

            // Format them into strings using the correct decimals
            // poolToken0 and poolToken1 from useMemo are already sorted correctly.
            const formattedAmount0 = viemFormatUnits(BigInt(calculatedAmount0_JSBI.toString()), poolToken0.decimals);
            const formattedAmount1 = viemFormatUnits(BigInt(calculatedAmount1_JSBI.toString()), poolToken1.decimals);
            
            const numericAmount0 = parseFloat(formattedAmount0);
            const numericAmount1 = parseFloat(formattedAmount1);

            let unifiedValue = numericAmount0;
            if (currentPrice && numericAmount1 > 0) {
              const price = parseFloat(currentPrice);
              if (!isNaN(price) && price > 0) {
                // currentPrice is price of T0 in T1. To convert T1 amount to T0 equivalent, we use this directly.
                // If currentPrice were price of T1 in T0, we would divide by price.
                unifiedValue += numericAmount1 * price; 
              }
            }

            newProcessedPositions.push({
              tickLower: Number(position.tickLower),
              tickUpper: Number(position.tickUpper),
              liquidity: position.liquidity,
              amount0: formattedAmount0,
              amount1: formattedAmount1,
              numericAmount0: numericAmount0,
              numericAmount1: numericAmount1,
              unifiedValueInToken0: unifiedValue,
            });
          } else {
            console.warn("[AddLiquidityModal] Skipping position due to undefined tickLower, tickUpper, or liquidity:", position);
          }
        }
        setProcessedPositions(newProcessedPositions);
      } catch (error) {
        console.error("[AddLiquidityModal] Error processing positions into ProcessedPositionDetail:", error);
        setProcessedPositions(null);
      }
    } else if (rawHookPositions === null) {
      setProcessedPositions(null); 
    } else if (rawHookPositions && rawHookPositions.length === 0) {
        setProcessedPositions([]);
        console.log("[AddLiquidityModal] No raw positions to process into ProcessedPositionDetail.");
    }
     // If prerequisites are not met, allow previous data to persist until new valid data is processed or rawHookPositions becomes null.

  }, [rawHookPositions, currentPoolTick, currentPoolSqrtPriceX96, token0Symbol, token1Symbol, chainId, poolToken0, poolToken1, currentPrice]); // Added poolToken0, poolToken1, currentPrice
  // --- END Process Raw Positions into Token0 Depth Delta Events ---

  // --- BEGIN Process Unified Values from Positions (Delta Events, Aggregation, Sorting) ---
  useEffect(() => {
    if (processedPositions && processedPositions.length > 0) {
      const newDeltaEvents: UnifiedValueDeltaEvent[] = [];
      for (const pos of processedPositions) {
        if (pos.unifiedValueInToken0 !== 0) { // Only create events if there's a non-zero change
          newDeltaEvents.push({ tick: pos.tickLower, changeInUnifiedValue: pos.unifiedValueInToken0 });
          newDeltaEvents.push({ tick: pos.tickUpper, changeInUnifiedValue: -pos.unifiedValueInToken0 });
        }
      }
      setUnifiedValueDeltaEvents(newDeltaEvents);

      // Step 2: Aggregate Unified Value Changes per Tick
      const newAggregatedChanges = new Map<number, number>();
      for (const event of newDeltaEvents) {
        const currentChangeForTick = newAggregatedChanges.get(event.tick) || 0;
        newAggregatedChanges.set(event.tick, currentChangeForTick + event.changeInUnifiedValue);
      }
      setAggregatedUnifiedValueChangesByTick(newAggregatedChanges);
      // Log the map entries for verification
      const aggregatedMapEntriesForLog = Array.from(newAggregatedChanges.entries()).map(([tick, change]) => ({ tick, netChange: change.toFixed(8) }));

      // Step 3: Sort Unique Ticks with Aggregated Changes
      const sortedTicks = Array.from(newAggregatedChanges.keys()).sort((a, b) => a - b);
      const newSortedNetChanges: Array<{ tick: number; netUnifiedToken0Change: number }> = sortedTicks.map(tick => ({
        tick: tick,
        netUnifiedToken0Change: newAggregatedChanges.get(tick) || 0
      }));
      setSortedNetUnifiedValueChanges(newSortedNetChanges);

    } else if (processedPositions === null) {
      setUnifiedValueDeltaEvents(null);
      setAggregatedUnifiedValueChangesByTick(null);
      setSortedNetUnifiedValueChanges(null);
    } else { // processedPositions is an empty array
      setUnifiedValueDeltaEvents([]);
      setAggregatedUnifiedValueChangesByTick(new Map());
      setSortedNetUnifiedValueChanges([]);
    }
  }, [processedPositions]);
  // --- END Process Unified Values from Positions ---

  // --- BEGIN Create Simplified Plot Data (Tick vs. Cumulative Unified Value) ---
  useEffect(() => {
    if (sortedNetUnifiedValueChanges && sortedNetUnifiedValueChanges.length > 0 && poolToken0) {
      
      let newData: DepthChartDataPoint[] = [];
      let currentCumulativeValue = 0;

      for (const { tick, netUnifiedToken0Change } of sortedNetUnifiedValueChanges) {
        currentCumulativeValue += netUnifiedToken0Change;
        const normalizedCumulativeValue = Math.max(0, currentCumulativeValue);
        const displayValue = normalizedCumulativeValue > 0 ? normalizedCumulativeValue : undefined;
        
        newData.push({
          tick,
          token0Depth: normalizedCumulativeValue,
          normToken0Depth: normalizedCumulativeValue > 0 ? 1 : 0,
          cumulativeUnifiedValue: normalizedCumulativeValue,
          displayCumulativeValue: displayValue,
          value: normalizedCumulativeValue
        });
      }
      
      setSimplifiedChartPlotData(newData as any);
      setChartData(newData);
    } else if (sortedNetUnifiedValueChanges === null) {
      setSimplifiedChartPlotData(null);
    } else {
      setSimplifiedChartPlotData([]);
      generateFallbackChartData();
    }
  }, [sortedNetUnifiedValueChanges, poolToken0, currentPoolTick, defaultTickSpacing]);
  // --- END Create Simplified Plot Data (Tick vs. Cumulative Unified Value) ---


  // Helper function to convert display price to canonical tick
  // This ensures consistent calculations regardless of user's token selection order
  const convertDisplayPriceToCanonicalTick = useCallback((displayPrice: number): number => {
    if (!poolToken0 || !poolToken1) return NaN;
    
    const token0Def = TOKEN_DEFINITIONS[token0Symbol];
    const token1Def = TOKEN_DEFINITIONS[token1Symbol];
    if (!token0Def || !token1Def) return NaN;

    const isUserOrderMatchingCanonical = poolToken0.address.toLowerCase() === token0Def.address.toLowerCase();
    
    // Convert display price back to canonical tick
    let rawPrice: number;
    
    if (baseTokenForPriceDisplay === token0Symbol) {
      // Display price is token1 in terms of token0
      let decimalAdjFactor = Math.pow(10, token1Def.decimals - token0Def.decimals);
      
      if (isUserOrderMatchingCanonical) {
        // Want: tick where Math.pow(1.0001, -tick) * decimalAdjFactor = displayPrice
        rawPrice = displayPrice / decimalAdjFactor;
        return -Math.log(rawPrice) / Math.log(1.0001);
      } else {
        // Want: tick where (1 / Math.pow(1.0001, tick)) * decimalAdjFactor = displayPrice  
        rawPrice = displayPrice / decimalAdjFactor;
        return Math.log(1 / rawPrice) / Math.log(1.0001);
      }
    } else {
      // Display price is token0 in terms of token1
      let decimalAdjFactor = Math.pow(10, token0Def.decimals - token1Def.decimals);
      
      if (isUserOrderMatchingCanonical) {
        // Want: tick where Math.pow(1.0001, tick) * decimalAdjFactor = displayPrice
        rawPrice = displayPrice / decimalAdjFactor;
        return Math.log(rawPrice) / Math.log(1.0001);
      } else {
        // Want: tick where (1 / Math.pow(1.0001, -tick)) * decimalAdjFactor = displayPrice
        rawPrice = displayPrice / decimalAdjFactor;
        return -Math.log(1 / rawPrice) / Math.log(1.0001);
      }
    }
  }, [token0Symbol, token1Symbol, baseTokenForPriceDisplay, poolToken0, poolToken1]);

  // Debounced function to update tickLower from minPriceInputString
  const debouncedUpdateTickLower = useCallback(
    debounce((priceStr: string) => {
      if (!poolToken0 || !poolToken1) return;

        if (priceStr.trim() === "0") {
        // Handle zero price case
        const newTick = baseTokenForPriceDisplay === token0Symbol ? sdkMinTick : sdkMaxTick;
        const targetTickFn = baseTokenForPriceDisplay === token0Symbol ? setTickLower : setTickUpper;
        const comparisonTick = baseTokenForPriceDisplay === token0Symbol ? parseInt(tickUpper) : parseInt(tickLower);
        const isValidRange = baseTokenForPriceDisplay === token0Symbol ? newTick < comparisonTick : newTick > comparisonTick;

        if (isValidRange) {
          targetTickFn(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
          toast.error("Invalid Range", { description: "Min price results in an invalid range." });
          }
          return;
        }

      const numericPrice = parseFloat(priceStr);
      if (isNaN(numericPrice) || numericPrice <= 0) return;

      let newTick = convertDisplayPriceToCanonicalTick(numericPrice);
      if (isNaN(newTick)) return;

      // Apply tick spacing alignment
      if (baseTokenForPriceDisplay === token0Symbol) {
        // This affects the max price display, which corresponds to tickUpper
        newTick = Math.floor(newTick / defaultTickSpacing) * defaultTickSpacing;
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
          if (newTick > parseInt(tickLower)) {
            setTickUpper(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
          toast.error("Invalid Range", { description: "Min price must result in a valid range." });
          }
      } else {
        // This affects the min price display, which corresponds to tickLower
        newTick = Math.ceil(newTick / defaultTickSpacing) * defaultTickSpacing;
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (newTick < parseInt(tickUpper)) {
          setTickLower(newTick.toString());
          setInitialDefaultApplied(true);
        } else {
          toast.error("Invalid Range", { description: "Min price must result in a valid range." });
        }
      }
    }, 750), 
    [baseTokenForPriceDisplay, token0Symbol, token1Symbol, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper, setTickLower, setTickUpper, setInitialDefaultApplied, poolToken0, poolToken1, convertDisplayPriceToCanonicalTick]
  );

  // Debounced function to update tickUpper from maxPriceInputString
  const debouncedUpdateTickUpper = useCallback(
    debounce((priceStr: string) => {
      if (!poolToken0 || !poolToken1) return;

      const isInfinityInput = priceStr.trim().toLowerCase() === "∞" || priceStr.trim().toLowerCase() === "infinity";

        if (isInfinityInput) {
        // Handle infinity price case
        const newTick = baseTokenForPriceDisplay === token0Symbol ? sdkMaxTick : sdkMinTick;
        const targetTickFn = baseTokenForPriceDisplay === token0Symbol ? setTickUpper : setTickLower;
        const comparisonTick = baseTokenForPriceDisplay === token0Symbol ? parseInt(tickLower) : parseInt(tickUpper);
        const isValidRange = baseTokenForPriceDisplay === token0Symbol ? newTick > comparisonTick : newTick < comparisonTick;

        if (isValidRange) {
          targetTickFn(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
          toast.error("Invalid Range", { description: "Max price results in an invalid range." });
          }
          return;
        }

      const numericPrice = parseFloat(priceStr);
      if (isNaN(numericPrice) || numericPrice <= 0) return;

      let newTick = convertDisplayPriceToCanonicalTick(numericPrice);
      if (isNaN(newTick)) return;

      // Apply tick spacing alignment
      if (baseTokenForPriceDisplay === token0Symbol) {
        // This affects the min price display, which corresponds to tickLower
        newTick = Math.ceil(newTick / defaultTickSpacing) * defaultTickSpacing;
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
          if (newTick < parseInt(tickUpper)) {
            setTickLower(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
          toast.error("Invalid Range", { description: "Max price must result in a valid range." });
          }
      } else {
        // This affects the max price display, which corresponds to tickUpper
        newTick = Math.floor(newTick / defaultTickSpacing) * defaultTickSpacing;
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (newTick > parseInt(tickLower)) {
          setTickUpper(newTick.toString());
          setInitialDefaultApplied(true);
        } else {
          toast.error("Invalid Range", { description: "Max price must result in a valid range." });
        }
      }
    }, 750),
    [baseTokenForPriceDisplay, token0Symbol, token1Symbol, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper, setTickLower, setTickUpper, setInitialDefaultApplied, poolToken0, poolToken1, convertDisplayPriceToCanonicalTick]
  );

  // --- BEGIN Custom Recharts Tooltip (Updated for Cumulative) ---
  const CustomTooltip = ({ active, payload, label, poolToken0Symbol, token0, token1, baseTokenForPrice }: any) => { 
    if (active && payload && payload.length && token0 && token1) {
      const tooltipData = payload[0].payload; 
      const currentTick = tooltipData.tick; // 'label' is often the same, but payload.tick is more direct
      const formattedTickLabel = currentTick ? currentTick.toLocaleString() : 'N/A'; 
      const cumulativeValue = tooltipData.cumulativeUnifiedValue ? tooltipData.cumulativeUnifiedValue.toLocaleString(undefined, {maximumFractionDigits: 8}) : 'N/A';
      const displayPoolTokenSymbol = poolToken0Symbol || '';

      let priceAtTickDisplay = "Price N/A";
      const token0Def = TOKEN_DEFINITIONS[token0 as TokenSymbol];
      const token1Def = TOKEN_DEFINITIONS[token1 as TokenSymbol];

      if (token0Def && token1Def && typeof currentTick === 'number' && poolToken0 && poolToken1) {
        let price = NaN;
        let quoteTokenSymbol = "";
        let priceOfTokenSymbol = "";

        // Use the same logic as the main price calculation
        const isUserOrderMatchingCanonical = poolToken0.address.toLowerCase() === token0Def.address.toLowerCase();
        const canonicalToken0Decimals = poolToken0.decimals;
        const canonicalToken1Decimals = poolToken1.decimals;

        if (baseTokenForPrice === token0) {
          // User wants to see price of token1 in terms of token0
          quoteTokenSymbol = token0;
          priceOfTokenSymbol = token1;
          
          let finalDecimalAdjFactor: number;
          let priceCalculationFunc: (tick: number) => number;
          
          if (isUserOrderMatchingCanonical) {
            // token0=canonicalToken0, token1=canonicalToken1
            // Want price of canonicalToken1 in canonicalToken0 terms
            finalDecimalAdjFactor = Math.pow(10, canonicalToken1Decimals - canonicalToken0Decimals);
            priceCalculationFunc = (tick) => Math.pow(1.0001, -tick);
          } else {
            // token0=canonicalToken1, token1=canonicalToken0
            // Want price of canonicalToken0 in canonicalToken1 terms = 1 / (price of canonicalToken1 in canonicalToken0)
            finalDecimalAdjFactor = Math.pow(10, canonicalToken0Decimals - canonicalToken1Decimals);
            priceCalculationFunc = (tick) => 1 / Math.pow(1.0001, -tick);
          }
          
          price = priceCalculationFunc(currentTick) * finalDecimalAdjFactor;
        } else {
          // User wants to see price of token0 in terms of token1
          quoteTokenSymbol = token1;
          priceOfTokenSymbol = token0;
          
          let finalDecimalAdjFactor: number;
          let priceCalculationFunc: (tick: number) => number;
          
          if (isUserOrderMatchingCanonical) {
            // token0=canonicalToken0, token1=canonicalToken1
            // Want price of canonicalToken0 in canonicalToken1 terms = 1 / (price of canonicalToken1 in canonicalToken0)
            finalDecimalAdjFactor = Math.pow(10, canonicalToken0Decimals - canonicalToken1Decimals);
            priceCalculationFunc = (tick) => 1 / Math.pow(1.0001, -tick);
          } else {
            // token0=canonicalToken1, token1=canonicalToken0
            // Want price of canonicalToken1 in canonicalToken0 terms
            finalDecimalAdjFactor = Math.pow(10, canonicalToken1Decimals - canonicalToken0Decimals);
            priceCalculationFunc = (tick) => Math.pow(1.0001, -tick);
          }
          
          price = priceCalculationFunc(currentTick) * finalDecimalAdjFactor;
        }

        if (!isNaN(price)) {
          const displayDecimals = TOKEN_DEFINITIONS[quoteTokenSymbol as TokenSymbol]?.displayDecimals || 4;
          if (price === Infinity) priceAtTickDisplay = "∞";
          else if (price < 1e-8 && price > 0) priceAtTickDisplay = "<0.00000001";
          else if (price === 0) priceAtTickDisplay = "0";
          else priceAtTickDisplay = price.toLocaleString(undefined, { maximumFractionDigits: displayDecimals, minimumFractionDigits: Math.min(2, displayDecimals) });
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
          <p style={{ color: payload[0].fill }}>
            {`Cumulative Liquidity (${displayPoolTokenSymbol}): ${cumulativeValue}`}
          </p>
          <p className="text-foreground/80 mt-0.5">{`Price: ${priceAtTickDisplay}`}</p>
        </div>
      );
    }
    return null;
  };
  // --- END Custom Recharts Tooltip (Updated for Cumulative) ---

  // Remove the custom LiquidityTokenSelector and add state for chooser
  const [tokenChooserOpen, setTokenChooserOpen] = useState<null | 'token0' | 'token1'>(null);
  const [tokenSearchTerm, setTokenSearchTerm] = useState('');

  // Move these above the return so they are always defined
  const getFormattedDisplayBalance = (numericBalance: number | undefined, tokenSymbolForDecimals: TokenSymbol): string => {
    if (numericBalance === undefined || isNaN(numericBalance)) {
      numericBalance = 0;
    }
    if (numericBalance === 0) {
      return "0.000";
    } else if (numericBalance > 0 && numericBalance < 0.001) {
      return "< 0.001";
    } else {
      const displayDecimals = TOKEN_DEFINITIONS[tokenSymbolForDecimals]?.displayDecimals ?? 4;
      return numericBalance.toFixed(displayDecimals);
    }
  };
  const displayToken0Balance = !token0Symbol ? "~" : (isLoadingToken0Balance ? "Loading..." : (token0BalanceData ? getFormattedDisplayBalance(parseFloat(token0BalanceData.formatted), token0Symbol) : "~"));
  const displayToken1Balance = !token1Symbol ? "~" : (isLoadingToken1Balance ? "Loading..." : (token1BalanceData ? getFormattedDisplayBalance(parseFloat(token1BalanceData.formatted), token1Symbol) : "~"));

  // Get available tokens for a given token based on existing pools
  const getAvailableTokensForToken = useCallback((tokenSymbol: string): TokenSelectorToken[] => {
    if (!tokenSymbol) return availableTokens; // If no token selected, show all tokens
    
    // Get all enabled pools
    const enabledPools = poolsConfig.pools.filter(pool => pool.enabled);
    
    // Find pools that contain the selected token
    const poolsWithToken = enabledPools.filter(pool => 
      pool.currency0.symbol === tokenSymbol || pool.currency1.symbol === tokenSymbol
    );
    
    // Extract the other token from each pool
    const availableTokenSymbols = new Set<string>();
    poolsWithToken.forEach(pool => {
      if (pool.currency0.symbol === tokenSymbol) {
        availableTokenSymbols.add(pool.currency1.symbol);
      } else {
        availableTokenSymbols.add(pool.currency0.symbol);
      }
    });
    
    // Return tokens that have pools with the selected token
    const availableTokensForSelection = availableTokens.filter(token => availableTokenSymbols.has(token.symbol));
    
    // Debug logging
    console.log(`[AddLiquidityModal] Token selection for ${tokenSymbol}:`, {
      enabledPools: enabledPools.length,
      poolsWithToken: poolsWithToken.length,
      availableTokenSymbols: Array.from(availableTokenSymbols),
      availableTokensForSelection: availableTokensForSelection.map(t => t.symbol)
    });
    
    return availableTokensForSelection;
  }, [availableTokens]);

  // Filter tokens for the chooser
  const filteredTokens = useMemo(() => {
    if (!tokenChooserOpen) return [];
    
    const otherTokenSymbol = tokenChooserOpen === 'token0' ? token1Symbol : token0Symbol;
    
    // If the other token is selected, show only tokens that have pools with it
    // If no other token is selected, show all tokens
    const availableTokensForSelection = otherTokenSymbol ? 
      getAvailableTokensForToken(otherTokenSymbol) : 
      availableTokens;
    
    const filtered = availableTokensForSelection
      .filter(token => token.symbol !== otherTokenSymbol) // Exclude the other selected token
      .filter(token => {
        if (!tokenSearchTerm) return true;
        const search = tokenSearchTerm.toLowerCase();
        return (
          token.symbol.toLowerCase().includes(search) ||
          token.name.toLowerCase().includes(search) ||
          token.address.toLowerCase().includes(search)
        );
      });
    
    // Debug logging
    console.log(`[AddLiquidityModal] Filtered tokens for ${tokenChooserOpen}:`, {
      otherTokenSymbol,
      availableTokensForSelection: availableTokensForSelection.map(t => t.symbol),
      filtered: filtered.map(t => t.symbol),
      searchTerm: tokenSearchTerm
    });
    
    return filtered;
  }, [availableTokens, tokenChooserOpen, tokenSearchTerm, token0Symbol, token1Symbol, getAvailableTokensForToken]);

  const handleTokenSelect = (token: TokenSelectorToken) => {
    if (tokenChooserOpen === 'token0') {
      handleToken0Select(token);
    } else {
      handleToken1Select(token);
    }
    setTokenChooserOpen(null);
    setTokenSearchTerm('');
  };

  // Add back missing functions
  const resetForm = () => {
    setToken0Symbol('');
    setToken1Symbol('');
    setAmount0("");
    setAmount1("");
    setTickLower(sdkMinTick.toString());
    setTickUpper(sdkMaxTick.toString());
    setCurrentPoolTick(null);
    setActiveInputSide(null);
    setCalculatedData(null);
    setCurrentPrice(null); 
    setPriceAtTickLower(null); 
    setPriceAtTickUpper(null);
    resetTransactionState();
    setInitialDefaultApplied(false);
    setActivePreset("±15%");
    // Base token for price display will be reset when tokens are cleared
  };

  const handleSetFullRange = () => {
    if (preparedTxData) resetTransactionState();
    setTickLower(sdkMinTick.toString());
    setTickUpper(sdkMaxTick.toString());
    setInitialDefaultApplied(true);
  };

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
      // Handle error silently
    }
  };

  // Real balance fetching for token chooser using wagmi core
  const [tokenBalances, setTokenBalances] = useState<Record<string, { balance: string; usdValue: number; isLoading: boolean }>>({});

  useEffect(() => {
    if (!tokenChooserOpen || !isConnected || chainId !== CHAIN_ID || !accountAddress) {
      // Reset balances when not ready
      const resetBalances: Record<string, { balance: string; usdValue: number; isLoading: boolean }> = {};
      filteredTokens.forEach(token => {
        resetBalances[token.address] = {
          balance: "~",
          usdValue: 0,
          isLoading: false
        };
      });
      setTokenBalances(resetBalances);
      return;
    }

    // Set loading state
    const loadingBalances: Record<string, { balance: string; usdValue: number; isLoading: boolean }> = {};
    filteredTokens.forEach(token => {
      loadingBalances[token.address] = {
        balance: "Loading...",
        usdValue: 0,
        isLoading: true
      };
    });
    setTokenBalances(loadingBalances);

    // Fetch balances for all tokens
    const fetchBalances = async () => {
      const newBalances: Record<string, { balance: string; usdValue: number; isLoading: boolean }> = {};

      for (const token of filteredTokens) {
        try {
          let balance = '0';
          
          if (token.address === "0x0000000000000000000000000000000000000000") {
            // Native ETH balance
            const ethBalance = await getBalance(config, {
              address: accountAddress,
              chainId: CHAIN_ID,
            });
            balance = viemFormatUnits(ethBalance.value, 18); // ETH has 18 decimals
          } else {
            // ERC20 token
            const result = await readContract(config, {
              address: token.address,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [accountAddress],
              chainId: CHAIN_ID,
            });
            
            balance = viemFormatUnits(result, token.decimals);
          }

          const numericBalance = parseFloat(balance);
          const usdValue = numericBalance * (token.usdPrice || 1);

          newBalances[token.address] = {
            balance: getFormattedDisplayBalance(numericBalance, token.symbol as TokenSymbol),
            usdValue,
            isLoading: false
          };
        } catch (error) {
          console.error(`Error fetching balance for ${token.symbol}:`, error);
          newBalances[token.address] = {
            balance: "Error",
            usdValue: 0,
            isLoading: false
          };
        }
      }

      setTokenBalances(newBalances);
    };

    fetchBalances();
  }, [tokenChooserOpen, isConnected, chainId, accountAddress, filteredTokens]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { 
        onOpenChange(open); 
        if (!open) {
            resetForm();
        }
    }}>
      <DialogPortal>
        <DialogOverlay />
        <RadixDialogPrimitive.Content
          aria-label="Add Liquidity"
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
            "sm:max-w-4xl" // Keep the larger modal size
          )}
        >
          <DialogTitle className="sr-only">Add Liquidity</DialogTitle>
          <div className="flex flex-col md:flex-row gap-6">
            <div className="w-full md:w-1/2 flex flex-col space-y-3">
              <Card className="w-full card-gradient border-0 shadow-none flex-grow">
                <CardContent className="px-4 pt-4 pb-4 flex flex-col space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center">
                      <Button
                          key="Full Range"
                          variant={activePreset === "Full Range" ? "secondary" : "outline"}
                          size="sm"
                          className="h-8 px-2 text-xs rounded-md"
                          onClick={() => {
                            if (preparedTxData) resetTransactionState();
                            setActivePreset("Full Range");
                            handleSetFullRange();
                          }}
                        >
                          Full Range
                        </Button>
                        <div className="h-5 w-px bg-border ml-2 mr-2" />
                      {["±3%", "±8%", "±15%"].map((preset, index) => (
                        <Button
                          key={preset}
                          variant={activePreset === preset ? "secondary" : "outline"}
                          size="sm"
                          className={`h-8 px-2 text-xs rounded-md ${index === 0 ? '' : 'ml-1'}`}
                          onClick={() => {
                            if (preparedTxData) resetTransactionState();
                            setActivePreset(preset); 
                          }}
                        >
                          {preset}
                        </Button>
                      ))}
                    </div>
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="h-8 flex items-center bg-green-500/20 text-green-500 px-2 py-0.5 rounded-sm text-xs font-medium cursor-help">
                            {enhancedAprDisplay}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-sm font-medium mb-1">Predicted APR</p>
                          <p className="text-xs text-muted-foreground">
                            Calculated using current volume and adjusted by a capital efficiency factor of 
                            <span className="font-semibold text-foreground"> {capitalEfficiencyFactor.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 2})}x</span>. Actual returns might deviate.
                            {activePreset !== "Full Range" && !(parseInt(tickLower) <= sdkMinTick && parseInt(tickUpper) >= sdkMaxTick)}
                          </p>
                          {poolApr && !["Loading APR...", "APR N/A", "APR Error", "Yield N/A", "Fees N/A"].includes(poolApr) && enhancedAprDisplay !== poolApr && enhancedAprDisplay !== "0.00% (Out of Range)" &&
                            <p className="text-xs text-muted-foreground mt-1.5">
                              Base Pool APR: <span className="font-semibold text-foreground">{poolApr}</span>
                            </p>
                          }
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>

                  {/* --- BEGIN Recharts Graph --- */}
                  <div className="w-full h-52 relative rounded-md border bg-muted/30" ref={chartContainerRef} style={{ cursor: isPanning ? 'grabbing' : 'grab' }}>
                    {isPoolStateLoading || isChartDataLoading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-20">
                            <Image 
                              src="/LogoIconWhite.svg" 
                              alt="Loading..." 
                              width={32}
                              height={32}
                              className="animate-pulse opacity-75"
                            />
                        </div>
                    ) : !isPoolStateLoading && currentPriceLine === null ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-20">
                            <span className="text-muted-foreground text-sm px-4 text-center" style={{ fontFamily: 'Consolas, monospace' }}>
                                {!isConnected ? "No Wallet Connected" : 
                                 (!token0Symbol || !token1Symbol || token0Symbol === '' || token1Symbol === '') ? "Select tokens to view chart." :
                                 "Pool data unavailable for chart."}
                            </span>
                        </div>
                    ) : null}
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart 
                        data={simplifiedChartPlotData || (chartData.length > 0 ? chartData : [])} 
                        margin={{ top: 2, right: 5, bottom: 5, left: 5 }}
                        onMouseDown={handlePanMouseDown}
                        onMouseMove={handlePanMouseMove}
                        onMouseUp={handlePanMouseUpOrLeave}
                        onMouseLeave={handlePanMouseUpOrLeave}
                      >
                        <XAxis 
                          dataKey="tick" 
                          type="number" 
                          domain={xDomain} 
                          allowDataOverflow 
                          tick={false}
                          axisLine={false}
                          height={1}
                          tickMargin={0} 
                        />
                        <YAxis 
                          hide={true}
                          yAxisId="leftAxis" 
                          orientation="left"
                          dataKey={simplifiedChartPlotData ? "cumulativeUnifiedValue" : "normToken0Depth"} 
                          type="number"
                          domain={[0, 'auto']}
                          allowDecimals={true}
                          tick={{ fontSize: 10 }}
                          axisLine={{ stroke: "#a1a1aa", strokeOpacity: 0.5 }}
                          tickLine={{ stroke: "#a1a1aa", strokeOpacity: 0.5 }}
                        />
                        
                        {simplifiedChartPlotData ? (
                          <Area 
                            type="stepAfter" 
                            dataKey="displayCumulativeValue"
                            yAxisId="leftAxis"
                            name={poolToken0 ? `Cumulative Liquidity (in ${poolToken0.symbol})` : "Cumulative Unified Liquidity"}
                            stroke="hsl(var(--chart-2, #a1a1aa))" 
                            fill="hsl(var(--chart-2, #a1a1aa))"    
                            fillOpacity={0.2}
                            strokeWidth={1.5}
                          />
                        ) : (
                          <Area
                            type="stepAfter"
                            dataKey="normToken0Depth"
                            stroke="#a1a1aa"
                            fill="#a1a1aa"
                            fillOpacity={0.2}
                            strokeWidth={1.5}
                            strokeOpacity={0.4}
                            yAxisId="leftAxis"
                          />
                        )}
                        
                        {currentPoolTick !== null && (
                          <ReferenceLine 
                            x={currentPoolTick} 
                            stroke="#e85102"
                            strokeWidth={1.5} 
                            ifOverflow="extendDomain"
                            yAxisId="leftAxis"
                          />
                        )}
                        
                        {isOpen && !isPoolStateLoading && parseInt(tickLower) < parseInt(tickUpper) && isFinite(parseInt(tickLower)) && isFinite(parseInt(tickUpper)) && (
                          <ReferenceArea 
                            x1={parseInt(tickLower)} 
                            x2={parseInt(tickUpper)} 
                            yAxisId="leftAxis"
                            strokeOpacity={0} 
                            fill="#e85102" 
                            fillOpacity={0.25} 
                            ifOverflow="extendDomain"
                            shape={<RoundedTopReferenceArea />}
                          />
                        )}
                        
                        <RechartsTooltip
                          content={
                            <CustomTooltip 
                              poolToken0Symbol={poolToken0?.symbol}
                              token0={token0Symbol}
                              token1={token1Symbol}
                              baseTokenForPrice={baseTokenForPriceDisplay}
                            />
                          }
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  {/* --- END Recharts Graph --- */}

                  {/* --- BEGIN Custom X-Axis Labels Div --- */}
                  <div className="flex justify-between w-full px-[5px] box-border !mt-1">
                    {customXAxisTicks.map((labelItem, index) => (
                      <span key={index} className="text-xs text-muted-foreground">
                        {labelItem.displayLabel}
                      </span>
                    ))}
                  </div>
                  {/* --- END Custom X-Axis Labels Div --- */}

                  <TooltipProvider delayDuration={100}>
                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-muted-foreground cursor-default hover:underline">Min Price</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs text-muted-foreground">The minimum price at which your position earns fees. Below this point, your position converts fully to {token1Symbol}.</p>
                          </TooltipContent>
                        </Tooltip>
                        {isPoolStateLoading ? (
                          <div className="h-5 w-24 bg-muted/40 rounded-md animate-pulse ml-auto"></div>
                        ) : (
                           <span className="w-28 border-0 bg-transparent text-right text-sm leading-5 font-medium text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto no-arrows cursor-default">
                             {minPriceInputString || "0.00"}
                           </span>
                        )}
                      </div>
                      <div className="flex justify-between items-center">
                         <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-muted-foreground cursor-default hover:underline">Max Price</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <p className="text-xs text-muted-foreground">The maximum price at which your position earns fees. Beyond this point, your position converts fully to {token0Symbol}.</p>
                          </TooltipContent>
                        </Tooltip>
                        {isPoolStateLoading ? (
                          <div className="h-5 w-24 bg-muted/40 rounded-md animate-pulse ml-auto"></div>
                        ) : (
                           <span className="w-28 border-0 bg-transparent text-right text-sm leading-5 font-medium text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto no-arrows cursor-default">
                             {maxPriceInputString || "0.00"}
                           </span>
                        )}
                      </div>
                    </div>
                  </TooltipProvider>

                  <div className="pt-2">
                    <div className="border-t border-border/70 my-2" />
                    <div className="flex justify-between items-center space-x-2">
                      <span className="text-xs text-muted-foreground">
                        {!token0Symbol || !token1Symbol || token0Symbol === '' || token1Symbol === '' ? (
                          <div className="h-4 w-40 bg-muted/40 rounded animate-pulse"></div>
                        ) : isPoolStateLoading ? (
                          <div className="h-4 w-40 bg-muted/40 rounded animate-pulse"></div>
                        ) : currentPrice && !isCalculating ? (
                          baseTokenForPriceDisplay === token0Symbol ? (
                            `1 ${token1Symbol} = ${(1 / parseFloat(currentPrice)).toLocaleString(undefined, { 
                              minimumFractionDigits: TOKEN_DEFINITIONS[token0Symbol]?.displayDecimals || 2, 
                              maximumFractionDigits: TOKEN_DEFINITIONS[token0Symbol]?.displayDecimals || 4
                            })} ${token0Symbol}`
                          ) : (
                            `1 ${token0Symbol} = ${parseFloat(currentPrice).toLocaleString(undefined, { 
                              minimumFractionDigits: TOKEN_DEFINITIONS[token1Symbol]?.displayDecimals || 2,
                              maximumFractionDigits: TOKEN_DEFINITIONS[token1Symbol]?.displayDecimals || 4
                            })} ${token1Symbol}`
                          )
                        ) : isCalculating ? (
                          "Calculating price..."
                        ) : (
                          "Price unavailable"
                        )
                        }
                      </span>
                      <div className="flex space-x-1">
                        {!token0Symbol || token0Symbol === '' ? (
                          <div className="h-7 w-16 bg-muted/40 rounded animate-pulse"></div>
                        ) : (
                          <Button
                            variant={baseTokenForPriceDisplay === token0Symbol ? "secondary" : "outline"}
                            size="sm"
                            className="h-7 px-2 text-xs rounded-md"
                            onClick={() => setBaseTokenForPriceDisplay(token0Symbol)}
                          >
                            {token0Symbol}
                          </Button>
                        )}
                        {!token1Symbol || token1Symbol === '' ? (
                          <div className="h-7 w-16 bg-muted/40 rounded animate-pulse"></div>
                        ) : (
                          <Button
                            variant={baseTokenForPriceDisplay === token1Symbol ? "secondary" : "outline"}
                            size="sm"
                            className="h-7 px-2 text-xs rounded-md"
                            onClick={() => setBaseTokenForPriceDisplay(token1Symbol)}
                          >
                            {token1Symbol}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="w-full md:w-1/2 flex flex-col space-y-3">
              {tokenChooserOpen ? (
                <Card className="w-full card-gradient border-0 shadow-none flex-grow">
                  <CardContent className="px-4 pt-4 pb-4">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-sm font-medium">Select Token</h2>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs rounded-md"
                          onClick={() => {
                            resetForm();
                            setTokenChooserOpen(null);
                            setTokenSearchTerm('');
                          }}
                        >
                          Clear
                        </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-full"
                        onClick={() => {
                          setTokenChooserOpen(null);
                          setTokenSearchTerm('');
                        }}
                      >
                        <XIcon className="h-3 w-3" />
                      </Button>
                      </div>
                    </div>

                    {/* Search Input */}
                    <div className="mb-4">
                      <div className="relative">
                        <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Search tokens..."
                          value={tokenSearchTerm}
                          onChange={(e) => setTokenSearchTerm(e.target.value)}
                          className="pl-9 rounded-lg bg-muted/30 border-0 focus-visible:ring-1 focus-visible:ring-muted-foreground/30 h-10 text-sm"
                          autoFocus
                        />
                      </div>
                    </div>

                    {/* Token List */}
                    <div className="overflow-y-auto" style={{ maxHeight: '400px' }}>
                      {filteredTokens.length === 0 ? (
                        <div className="p-6 text-center text-muted-foreground text-sm">
                          No tokens found matching "{tokenSearchTerm}"
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {filteredTokens.map((token) => {
                            const isSelected = token.symbol === (tokenChooserOpen === 'token0' ? token0Symbol : token1Symbol);
                            
                            return (
                              <button
                                key={token.address}
                                className={cn(
                                  "w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left rounded-lg",
                                  {
                                    "bg-muted/30": isSelected
                                  }
                                )}
                                onClick={() => handleTokenSelect(token)}
                              >
                                <Image 
                                  src={token.icon} 
                                  alt={token.symbol} 
                                  width={28} 
                                  height={28} 
                                  className="rounded-full"
                                />
                                <div className="flex-1">
                                  <div className="flex items-center justify-between">
                                    <div className="flex flex-col">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium">{token.symbol}</span>
                                        {isSelected && (
                                          <CheckIcon className="h-3 w-3 text-primary" />
                                        )}
                                      </div>
                                      <div className="text-xs text-muted-foreground font-mono">
                                        {token.address.slice(0, 6)}...{token.address.slice(-4)}
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-sm font-medium">
                                        {tokenBalances[token.address]?.isLoading ? (
                                          <div className="h-4 w-16 bg-muted/60 rounded animate-pulse"></div>
                                        ) : (
                                          tokenBalances[token.address]?.balance || "~"
                                        )}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        {tokenBalances[token.address]?.isLoading ? (
                                          <div className="h-3 w-12 bg-muted/60 rounded animate-pulse"></div>
                                        ) : (
                                          `$${tokenBalances[token.address]?.usdValue.toFixed(2) || "0.00"}`
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="w-full card-gradient border-0 shadow-none flex-grow">
                  <CardContent className="px-4 pt-4 pb-4">
                                          <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <Label htmlFor="amount0" className="text-sm font-medium">Amount</Label>
                          <div className="flex items-center gap-1">
                            {token0Symbol ? (
                              <Button variant="ghost" className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" onClick={() => handleUseFullBalance(token0BalanceData?.formatted || "0", token0Symbol, true)} disabled={isWorking || isCalculating}>  
                                Balance: {displayToken0Balance} {token0Symbol}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">Balance: ~</span>
                            )}
                          </div>
                        </div>
                        <div className="rounded-lg bg-muted/30 p-4">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2 cursor-pointer" onClick={() => setTokenChooserOpen('token0')}>
                              {token0Symbol ? (
                                <Image src={getTokenIcon(token0Symbol)} alt={token0Symbol} width={20} height={20} className="rounded-full"/>
                              ) : (
                                <div className="w-5 h-5 rounded-full bg-muted-foreground/30"></div>
                              )}
                              <span className="text-sm font-medium">{token0Symbol || "Select"}</span>
                              <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="flex-1">
                              <Input
                                id="amount0"
                                placeholder="0.0"
                                value={amount0}
                                onChange={(e) => { 
                                  const newValue = e.target.value; 
                                  if (preparedTxData) { resetTransactionState(); } 
                                  setAmount0(newValue); 
                                  setActiveInputSide('amount0'); 
                                }} 
                                type={amount0.startsWith('<') ? "text" : "number"}
                                disabled={isWorking || isCalculating && activeInputSide === 'amount1'}
                                className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto no-arrows"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    <div className="flex justify-center items-center mb-2">
                      <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
                        <PlusIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <Label htmlFor="amount1" className="text-sm font-medium">Amount</Label>
                        <div className="flex items-center gap-1">
                          {token1Symbol ? (
                            <Button variant="ghost" className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" onClick={() => handleUseFullBalance(token1BalanceData?.formatted || "0", token1Symbol, false)} disabled={isWorking || isCalculating}> 
                              Balance: {displayToken1Balance} {token1Symbol}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Balance: ~</span>
                          )}
                        </div>
                      </div>
                      <div className="rounded-lg bg-muted/30 p-4">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2 cursor-pointer" onClick={() => setTokenChooserOpen('token1')}>
                            {token1Symbol ? (
                              <Image src={getTokenIcon(token1Symbol)} alt={token1Symbol} width={20} height={20} className="rounded-full"/>
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-muted-foreground/30"></div>
                            )}
                            <span className="text-sm font-medium">{token1Symbol || "Select"}</span>
                            <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1">
                            <Input
                              id="amount1"
                              placeholder="0.0"
                              value={amount1}
                              onChange={(e) => { 
                                const newValue = e.target.value; 
                                if (preparedTxData) { resetTransactionState(); } 
                                setAmount1(newValue); 
                                setActiveInputSide('amount1'); 
                              }} 
                              type={amount1.startsWith('<') ? "text" : "number"}
                              disabled={isWorking || isCalculating && activeInputSide === 'amount0'}
                              className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto no-arrows"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 border border-dashed rounded-md bg-muted/10">
                      <p className="text-sm font-medium mb-2 text-foreground/80">Transaction Steps</p>
                      <div className="space-y-1.5 text-xs text-muted-foreground">
                          <div className="flex items-center justify-between">
                              <span>Token Approvals</span>
                              <span>
                                { (step === 'approve' && (isApproveWritePending || isApproving)) || 
                                  (step === 'permit2Sign' && isWorking) 
                                  ? <RefreshCwIcon className="h-4 w-4 animate-spin" />
                                  : (
                                    <span className={`text-xs font-mono ${completedTokensCount === involvedTokensCount && involvedTokensCount > 0 ? 'text-green-500' : ''}`}>
                                      {`${completedTokensCount}/${involvedTokensCount > 0 ? involvedTokensCount : '-'}`}
                                    </span>
                                  )
                                }
                              </span>
                          </div>
                          <div className="flex items-center justify-between">
                              <span>Send Mint Transaction</span> 
                              <span>
                                  {isMintConfirming || isMintSendPending ? 
                                    <ActivityIcon className="h-4 w-4 animate-pulse text-muted-foreground" />
                                   : isMintConfirming ? <CheckIcon className="h-4 w-4 text-green-500" />  // Changed from isMintConfirmed
                                   : <MinusIcon className="h-4 w-4" />}
                              </span>
                          </div>
                      </div>
                    </div>
                    <DialogFooter className="grid grid-cols-2 gap-3 mt-4">
                      <div 
                        onClick={() => {
                          if (step === 'approve' || step === 'mint' || step === 'permit2Sign') {
                            resetTransactionState(); 
                          } else {
                            onOpenChange(false);
                          }
                        }}
                        className={`relative flex h-10 cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 ${
                          isCalculating || 
                          (step ==='approve' && (isApproveWritePending || isApproving)) || 
                          (step === 'permit2Sign' && isWorking) ||
                          (step ==='mint' && (isMintSendPending || isMintConfirming)) ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        <span className="relative z-0 pointer-events-none">{step === 'approve' || step === 'mint' || step === 'permit2Sign' ? 'Cancel & Edit' : 'Change Pool'}</span>
                      </div>
                      {!isConnected ? (
                        <div className="relative flex h-10 cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30" style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
                          <div className="absolute inset-0 z-10 block h-full w-full cursor-pointer p-0 opacity-0" />
                          <span className="relative z-0 pointer-events-none">Connect Wallet</span>
                        </div>
                      ) : (
                        <Button
                          onClick={() => {
                            if (step === 'input') handlePrepareMint(); // User explicitly clicks to prepare/proceed
                            else if (step === 'approve') handleApprove();
                            else if (step === 'permit2Sign') handleSignAndSubmitPermit2();
                            else if (step === 'mint') handleMint();
                          }}
                          disabled={isWorking || 
                            isCalculating ||
                            isPoolStateLoading || 
                            isApproveWritePending ||
                            isMintSendPending ||
                            // Disable main button if in input step, no amounts, AND no existing preparedTxData to re-attempt/proceed with.
                            (step === 'input' && (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) && !preparedTxData) ||
                            (step === 'input' && isInsufficientBalance) // New condition: disable if insufficient balance in input step
                          }
                        >
                          {isPoolStateLoading ? 'Loading Pool...' 
                            : step === 'input' ? (preparedTxData && (parseFloat(amount0 || "0") > 0 || parseFloat(amount1 || "0") > 0) ? 'Proceed' : 'Prepare Deposit') 
                            : step === 'approve' ? `Approve ${preparedTxData?.approvalTokenSymbol || 'Token'}` 
                            : step === 'permit2Sign' ? 'Sign Permission'
                            : step === 'mint' ? 'Confirm Mint' 
                            : 'Processing...' 
                          }
                        </Button>
                      )}
                    </DialogFooter>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </RadixDialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
} 