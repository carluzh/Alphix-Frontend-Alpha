"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PlusIcon, RefreshCwIcon, MinusIcon, ActivityIcon, CheckIcon, InfoIcon, ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import { useAccount, useBalance } from "wagmi";
import { toast } from "sonner";
import { V4_POOL_FEE, V4_POOL_TICK_SPACING, V4_POOL_HOOKS } from "@/lib/swap-constants";
import { TOKEN_DEFINITIONS, TokenSymbol } from "@/lib/pools-config";
import { baseSepolia } from "@/lib/wagmiConfig";
import { getPoolById, getToken } from "@/lib/pools-config";
import { formatUnits as viemFormatUnits, parseUnits as viemParseUnits, getAddress, type Hex } from "viem";
import { useAddLiquidityTransaction } from "./useAddLiquidityTransaction";
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
  Area,
  Line
} from 'recharts';
import { Token } from '@uniswap/sdk-core';
import { Pool as V4PoolSDK, Position as V4PositionSDK } from "@uniswap/v4-sdk";
import JSBI from "jsbi";

// Utility functions
const getTokenIcon = (symbol?: string) => {
  if (!symbol) return "/placeholder-logo.svg";
  const tokenConfig = getToken(symbol);
  return tokenConfig?.icon || "/placeholder-logo.svg";
};

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

// Chart data interfaces
interface CustomAxisLabel {
  tickValue: number;    
  displayLabel: string; 
}

interface HookPosition {
  tickLower: number;
  tickUpper: number;
  liquidity: string;
}

interface Token0DepthDeltaEvent {
  tick: number;
  change: bigint; 
}

interface LiquidityDepthData {
  ticks: number[];
  token0Depths: string[];
  currentPoolTick?: number;
  currentSqrtPriceX96?: string;
  positions?: HookPosition[];
  lastUpdated?: number;
}

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

interface UnifiedValueDeltaEvent {
  tick: number;
  changeInUnifiedValue: number;
}

// Formatted chart data point
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
  cumulativeUnifiedValue?: number; // Added to fix linter error
  displayCumulativeValue?: number; // Added to fix linter error
}

export interface AddLiquidityFormProps {
  onLiquidityAdded: () => void; 
  selectedPoolId?: string;
  sdkMinTick: number;
  sdkMaxTick: number;
  defaultTickSpacing: number;
  poolApr?: string;
  activeTab: 'deposit' | 'withdraw' | 'swap'; // Added activeTab prop
}

export function AddLiquidityForm({ 
  onLiquidityAdded, 
  selectedPoolId,
  sdkMinTick,
  sdkMaxTick,
  defaultTickSpacing,
  poolApr,
  activeTab // Accept activeTab from props
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
    return { token0: 'YUSDC' as TokenSymbol, token1: 'BTCRL' as TokenSymbol };
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
  const [activePreset, setActivePreset] = useState<string | null>("±15%");
  const [isPoolStateLoading, setIsPoolStateLoading] = useState<boolean>(false);
  const [enhancedAprDisplay, setEnhancedAprDisplay] = useState<string>(poolApr || "Yield N/A");
  const [capitalEfficiencyFactor, setCapitalEfficiencyFactor] = useState<number>(1);
  const [initialDefaultApplied, setInitialDefaultApplied] = useState(false);
  const [baseTokenForPriceDisplay, setBaseTokenForPriceDisplay] = useState<TokenSymbol>('YUSDC');
  
  // UI flow management
  const [depositStep, setDepositStep] = useState<'range' | 'amount'>('range');
  
  // Chart state
  const [xDomain, setXDomain] = useState<[number, number]>([-120000, 120000]);
  const [currentPriceLine, setCurrentPriceLine] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartXRef = useRef<number | null>(null);
  const panStartDomainRef = useRef<[number, number] | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  
  // Custom X-Axis tick state
  const [customXAxisTicks, setCustomXAxisTicks] = useState<CustomAxisLabel[]>([]);
  
  // Min/Max price input strings
  const [minPriceInputString, setMinPriceInputString] = useState<string>("");
  const [maxPriceInputString, setMaxPriceInputString] = useState<string>("");
  
  const { address: accountAddress, chainId, isConnected } = useAccount();
  
  // Track previous calculation dependencies
  const prevCalculationDeps = useRef({
    amount0,
    amount1,
    tickLower,
    tickUpper,
    activeInputSide
  });

  // Use the transaction hook
  const {
    isWorking,
    step,
    preparedTxData,
    permit2SignatureRequest,
    involvedTokensCount, 
    completedTokensCount,
    
    isApproveWritePending,
    isApproving,
    isMintSendPending,
    isMintConfirming,
    
    handlePrepareMint,
    handleApprove,
    handleSignAndSubmitPermit2,
    handleMint,
    resetTransactionState,
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
    onOpenChange: () => {},
  });

  // Balance hooks
  const { data: token0BalanceData, isLoading: isLoadingToken0Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[token0Symbol]?.address === "0x0000000000000000000000000000000000000000" 
      ? undefined 
      : TOKEN_DEFINITIONS[token0Symbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[token0Symbol] },
  });

  const { data: token1BalanceData, isLoading: isLoadingToken1Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[token1Symbol]?.address === "0x0000000000000000000000000000000000000000" 
      ? undefined 
      : TOKEN_DEFINITIONS[token1Symbol]?.address as `0x${string}` | undefined,
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

  // Set initial state based on props
  useEffect(() => {
    setBaseTokenForPriceDisplay(token0Symbol);
  }, [token0Symbol]);

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
          setBaseTokenForPriceDisplay(t0); // Reset base token for price display
          // Reset chart specific states too
          setCurrentPriceLine(null);
        }
      }
    }
  }, [selectedPoolId, sdkMinTick, sdkMaxTick]);

  // Reset state when tokens change
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
    setBaseTokenForPriceDisplay(token0Symbol); // Reset base token for price display
    // Reset chart specific states too
    setCurrentPriceLine(null);
  }, [token0Symbol, token1Symbol, chainId, sdkMinTick, sdkMaxTick]);

  // Effect to fetch initial pool state (current price and tick)
  useEffect(() => {
    const fetchPoolState = async () => {
      if (!token0Symbol || !token1Symbol || !chainId) return;
      
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
            
            // Set a fixed 20% zoom level around the current tick
            const centerTick = poolState.currentPoolTick;
            const percentage = 0.20; // 20% zoom
            
            const priceRatioUpper = 1 + percentage;
            const priceRatioLower = 1 - percentage;

            // This calculation is now correct for price of T0 in T1
            const tickDeltaForT0T1Upper = Math.round(Math.log(priceRatioUpper) / Math.log(1.0001));
            const tickDeltaForT0T1Lower = Math.round(Math.log(priceRatioLower) / Math.log(1.0001));

            // The prices are symmetrical around the current tick in price space, but not in tick space.
            // We use the larger of the two deltas (in absolute terms) to create a symmetrical zoom in tick space.
            const largestDelta = Math.max(Math.abs(tickDeltaForT0T1Upper), Math.abs(tickDeltaForT0T1Lower));
            
            const domainTickLower = centerTick - largestDelta;
            const domainTickUpper = centerTick + largestDelta;

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
        toast.error("Pool Data Error", { description: error.message });
        setCurrentPriceLine(null);
        setCurrentPoolSqrtPriceX96(null);
      } finally {
        setIsPoolStateLoading(false);
      }
    };
    
    if (selectedPoolId) {
      fetchPoolState();
    }
  }, [selectedPoolId, chainId, token0Symbol, token1Symbol]);

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
        newLabels.push({ 
          tickValue: minTickDomain, 
          displayLabel: isNaN(priceAtTick) ? minTickDomain.toString() : priceAtTick.toLocaleString(undefined, { maximumFractionDigits: displayDecimals, minimumFractionDigits: 2 })
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
    const displayDecimals = baseTokenForPriceDisplay === token0Symbol ? decimalsForToken0Display : decimalsForToken1Display;

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

  }, [tickLower, tickUpper, baseTokenForPriceDisplay, token0Symbol, token1Symbol, sdkMinTick, sdkMaxTick, calculatedData]);

  // Helper function to get formatted display balance
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

  // Display balance calculations
  const displayToken0Balance = isLoadingToken0Balance 
    ? "Loading..." 
    : (token0BalanceData ? getFormattedDisplayBalance(parseFloat(token0BalanceData.formatted), token0Symbol) : "~");
  
  const displayToken1Balance = isLoadingToken1Balance 
    ? "Loading..." 
    : (token1BalanceData ? getFormattedDisplayBalance(parseFloat(token1BalanceData.formatted), token1Symbol) : "~");

  // Handle setting full range
  const handleSetFullRange = () => {
    if (preparedTxData) resetTransactionState();
    setTickLower(sdkMinTick.toString());
    setTickUpper(sdkMaxTick.toString());
    setInitialDefaultApplied(true);
    setActivePreset("Full Range");
    
    // Explicitly trigger recalculation of price inputs to update display
    setPriceAtTickLower(null);
    setPriceAtTickUpper(null);
    
    // Don't change the chart view when selecting full range
    // Keep the current view as is - users can manually zoom if needed
  };

  // Handle transition from range selection to amount input
  const handleContinueToAmount = () => {
    // Validation can go here if needed
    setDepositStep('amount');
  };

  // Handle back button to return to range selection
  const handleBackToRange = () => {
    setDepositStep('range');
    if (preparedTxData) {
      resetTransactionState();
    }
  };
  
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

  // Handle preparation and submission
  const handlePrepareAndSubmit = () => {
    if (isInsufficientBalance) {
      toast.error("Insufficient balance");
      return;
    }
    
    if (parseFloat(amount0 || "0") <= 0 && parseFloat(amount1 || "0") <= 0) {
      toast.error("Amount must be greater than 0");
      return;
    }
    
    handlePrepareMint();
  };

  // Effect to auto-apply active percentage preset when currentPrice changes OR when activePreset changes
  useEffect(() => {
    // Ensure currentPrice is valid and we have a preset that requires calculation
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
  }, [currentPrice, currentPoolTick, activePreset, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper, preparedTxData, resetTransactionState]);

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

  // Debounced function to update tickLower from minPriceInputString
  const debouncedUpdateTickLower = useCallback(
    debounce((priceStr: string) => {
      const numericPrice = parseFloat(priceStr);

      if (baseTokenForPriceDisplay === token0Symbol) {
        if (priceStr.trim() === "0") {
          const newTick = sdkMinTick;
          if (newTick < parseInt(tickUpper)) {
            setTickLower(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
            toast.error("Invalid Range", { description: "Min price results in a range where min tick >= max tick." });
          }
          return;
        }
        if (isNaN(numericPrice) || numericPrice < 0) return;

        const priceToConvert = numericPrice;
        if (priceToConvert <= 0) {
          toast.info("Price results in invalid tick", { description: "The entered price must be positive for tick calculation." });
          return;
        }
        let newTick = Math.log(priceToConvert) / Math.log(1.0001);
        newTick = Math.ceil(newTick / defaultTickSpacing) * defaultTickSpacing;
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (newTick < parseInt(tickUpper)) {
          setTickLower(newTick.toString());
          setInitialDefaultApplied(true);
        } else {
          toast.error("Invalid Range", { description: "Min price must be less than max price." });
        }
      } else { // baseTokenForPriceDisplay === token1Symbol (Min Price input sets actual tickUpper)
        if (priceStr.trim() === "0") {
          const newTick = sdkMaxTick;
          if (newTick > parseInt(tickLower)) {
            setTickUpper(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
            toast.error("Invalid Range", { description: "Min price results in a range where max tick <= min tick." });
          }
          return;
        }
        if (isNaN(numericPrice) || numericPrice < 0) return;
        if (numericPrice === 0) return;

        const priceToConvert = 1 / numericPrice;
        if (priceToConvert <= 0) {
          toast.info("Price results in invalid tick", { description: "Converted price is non-positive." });
          return;
        }
        let newTick = Math.log(priceToConvert) / Math.log(1.0001);
        newTick = Math.floor(newTick / defaultTickSpacing) * defaultTickSpacing;
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (newTick > parseInt(tickLower)) {
          setTickUpper(newTick.toString());
          setInitialDefaultApplied(true);
        } else {
          toast.error("Invalid Range", { description: "Min price (when quoted in other token) must result in a max tick greater than min tick." });
        }
      }
    }, 750), 
    [baseTokenForPriceDisplay, token0Symbol, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper]
  );

  // Debounced function to update tickUpper from maxPriceInputString
  const debouncedUpdateTickUpper = useCallback(
    debounce((priceStr: string) => {
      const numericPrice = parseFloat(priceStr);
      const isInfinityInput = priceStr.trim().toLowerCase() === "∞" || priceStr.trim().toLowerCase() === "infinity";

      if (baseTokenForPriceDisplay === token0Symbol) {
        if (isInfinityInput) {
          const newTick = sdkMaxTick;
          if (newTick > parseInt(tickLower)) {
            setTickUpper(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
            toast.error("Invalid Range", { description: "Max price results in a range where max tick <= min tick." });
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
          toast.error("Invalid Range", { description: "Max price must be greater than min price." });
        }
      } else { // baseTokenForPriceDisplay === token1Symbol (Max Price input sets actual tickLower)
        if (isInfinityInput) {
          const newTick = sdkMinTick;
          if (newTick < parseInt(tickUpper)) {
            setTickLower(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
            toast.error("Invalid Range", { description: "Max price results in a range where min tick >= max tick." });
          }
          return;
        }
        if (isNaN(numericPrice) || numericPrice <= 0) return;
        
        const priceToConvert = 1 / numericPrice;
        if (priceToConvert <= 0) {
          toast.info("Price results in invalid tick", { description: "Converted price is non-positive." });
          return;
        }
        let newTick = Math.log(priceToConvert) / Math.log(1.0001);
        newTick = Math.ceil(newTick / defaultTickSpacing) * defaultTickSpacing;
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (newTick < parseInt(tickUpper)) {
          setTickLower(newTick.toString());
          setInitialDefaultApplied(true);
        } else {
          toast.error("Invalid Range", { description: "Max price (when quoted in other token) must result in a min tick less than max tick." });
        }
      }
    }, 750),
    [baseTokenForPriceDisplay, token0Symbol, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper]
  );

  // Calculate amount based on input and check approvals
  const debouncedCalculateAmountAndCheckApprovals = useCallback(
    debounce(async (currentAmount0: string, currentAmount1: string, currentTickLower: string, currentTickUpper: string, inputSide: 'amount0' | 'amount1') => {
      if (!chainId) return;

      const tl = parseInt(currentTickLower);
      const tu = parseInt(currentTickUpper);

      if (isNaN(tl) || isNaN(tu) || tl >= tu) {
        setCalculatedData(null);
        if (inputSide === 'amount0') setAmount1(""); else setAmount0("");
        toast.info("Invalid Range", { description: "Min tick must be less than max tick." });
        return;
      }

      const primaryAmount = inputSide === 'amount0' ? currentAmount0 : currentAmount1;
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
        if (inputSide === 'amount0') setAmount1(""); else setAmount0("");
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
            const displayAmount = formatTokenDisplayAmount(rawFormattedAmount);
            setAmount1(displayAmount);
          } catch (e) {
            console.error('Error formatting amount1:', e);
            setAmount1("Error");
            toast.error("Calculation Error", { description: "Could not parse calculated amount for the other token. The amount might be too large or invalid." });
            setCalculatedData(null);
          }
        } else {
          try {
            const rawFormattedAmount = viemFormatUnits(BigInt(result.amount0), TOKEN_DEFINITIONS[secondaryTokenSymbol]?.decimals || 18);
            const displayAmount = formatTokenDisplayAmount(rawFormattedAmount);
            setAmount0(displayAmount);
          } catch (e) {
            console.error('Error formatting amount0:', e);
            setAmount0("Error");
            toast.error("Calculation Error", { description: "Could not parse calculated amount for the other token. The amount might be too large or invalid." });
            setCalculatedData(null);
          }
        }
      } catch (error: any) {
        toast.error("Calculation Error", { description: error.message || "Could not estimate amounts." });
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
                    toast.info("Invalid Range", { description: "Min tick must be less than max tick." });
                }
            }
        } else {
             // Both amounts are effectively zero, or became zero/invalid, ensure cleanup
            setAmount0("");
            setAmount1("");
            setCalculatedData(null);
            if (preparedTxData !== null || step !== 'input') {
                resetTransactionState();
            }
        }
    } else if (parseFloat(amount0) <= 0 && parseFloat(amount1) <= 0) {
        // Fallback: ensure cleanup if all amounts are zero or invalid, and no calculation was triggered.
        setCalculatedData(null);
        if (preparedTxData !== null || step !== 'input') {
            resetTransactionState();
        }
    }

    prevCalculationDeps.current = currentDeps;
  }, [
    amount0,
    amount1,
    tickLower,
    tickUpper,
    activeInputSide,
    debouncedCalculateAmountAndCheckApprovals,
    preparedTxData, 
    step,           
    resetTransactionState,
  ]);

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
      try { valueToCheck0AsWei = viemParseUnits(amount0, t0Def.decimals); } catch { /* ignore error if not a valid number */ }
    } else if (calculatedData && BigInt(calculatedData.amount0) > 0n && isAmount1InputPositive) {
      valueToCheck0AsWei = BigInt(calculatedData.amount0);
    }

    let valueToCheck1AsWei: bigint | null = null;
    if (isAmount1InputPositive) {
      try { valueToCheck1AsWei = viemParseUnits(amount1, t1Def.decimals); } catch { /* ignore error if not a valid number */ }
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
          <p className="text-foreground/80 mt-0.5">{`Price: ${priceAtTickDisplay}`}</p>
        </div>
      );
    }
    return null;
  };

  const [chartData, setChartData] = useState<DepthChartDataPoint[]>([]);
  const [isChartDataLoading, setIsChartDataLoading] = useState(false);
  const [liquidityDepthData, setLiquidityDepthData] = useState<LiquidityDepthData | null>(null);
  
  // Define Subgraph URL - same as in AddLiquidityModal.tsx
  const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-test/version/latest";

  // Add required states for liquidity depth handling
  const [rawHookPositions, setRawHookPositions] = useState<HookPosition[] | null>(null);
  const [isFetchingLiquidityDepth, setIsFetchingLiquidityDepth] = useState<boolean>(false);
  const [token0DepthDeltaEvents, setToken0DepthDeltaEvents] = useState<Token0DepthDeltaEvent[] | null>(null);
  const [aggregatedToken0ChangesByTick, setAggregatedToken0ChangesByTick] = useState<Map<number, bigint> | null>(null);
  const [sortedUniqueTicksWithToken0Changes, setSortedUniqueTicksWithToken0Changes] = useState<number[] | null>(null);
  const [simplifiedChartPlotData, setSimplifiedChartPlotData] = useState<Array<{ tick: number; cumulativeUnifiedValue: number, displayCumulativeValue?: number }> | null>(null);
  const [processedPositions, setProcessedPositions] = useState<ProcessedPositionDetail[] | null>(null);
  const [unifiedValueDeltaEvents, setUnifiedValueDeltaEvents] = useState<UnifiedValueDeltaEvent[] | null>(null);
  const [aggregatedUnifiedValueChangesByTick, setAggregatedUnifiedValueChangesByTick] = useState<Map<number, number> | null>(null);
  const [sortedNetUnifiedValueChanges, setSortedNetUnifiedValueChanges] = useState<Array<{ tick: number; netUnifiedToken0Change: number }> | null>(null);

  // Helper function to get the canonical on-chain pool ID (Bytes! string)
  const getDerivedOnChainPoolId = useCallback((): string | null => {
    if (!token0Symbol || !token1Symbol || !chainId || !selectedPoolId) return null;

    // Get the actual pool configuration instead of using hardcoded values
    const poolConfig = getPoolById(selectedPoolId);
    if (!poolConfig) {
      console.error("[AddLiquidityForm] Could not find pool configuration for:", selectedPoolId);
      return null;
    }

    const token0Def = TOKEN_DEFINITIONS[token0Symbol];
    const token1Def = TOKEN_DEFINITIONS[token1Symbol];

    if (!token0Def || !token1Def) return null;

    try {
      const sdkToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals);
      const sdkToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals);

      const [sortedSdkToken0, sortedSdkToken1] = sdkToken0.sortsBefore(sdkToken1)
        ? [sdkToken0, sdkToken1]
        : [sdkToken1, sdkToken0];
      
      // Use the actual pool configuration values
      const poolIdBytes32 = V4PoolSDK.getPoolId(
        sortedSdkToken0,
        sortedSdkToken1,
        poolConfig.fee, 
        poolConfig.tickSpacing, 
        poolConfig.hooks as Hex 
      );
      return poolIdBytes32.toLowerCase();
    } catch (error) {
      console.error("[AddLiquidityForm] Error deriving on-chain pool ID:", error);
      return null;
    }
  }, [token0Symbol, token1Symbol, chainId, selectedPoolId]);

  // Fetch liquidity depth data using the EXACT implementation from AddLiquidityModal
  useEffect(() => {
    const fetchLiquidityDepthData = async () => {
      console.log("[DEBUG] Fetching liquidity depth data with params:", { selectedPoolId, chainId, currentPoolTick });
      if (!selectedPoolId || !chainId || currentPoolTick === null) {
        // Clear previous data if conditions are not met
        console.log("[DEBUG] Missing required params for liquidity depth fetch");
        setRawHookPositions(null);
        return;
      }

      const derivedOnChainPoolId = getDerivedOnChainPoolId();
      console.log("[DEBUG] Derived on-chain pool ID:", derivedOnChainPoolId);
      if (!derivedOnChainPoolId) {
        console.warn("[AddLiquidityForm] Could not derive on-chain pool ID. Skipping liquidity depth fetch.");
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
          console.error("[AddLiquidityForm] GraphQL errors from subgraph:", result.errors);
          throw new Error(`GraphQL error: ${result.errors.map((e: any) => e.message).join(', ')}`);
        }

        if (result.data && result.data.hookPositions) {
          // Adjust type hint for allFetchedPositions
          const allFetchedPositions = result.data.hookPositions as Array<HookPosition & { pool: string }>; 
          console.log(`[AddLiquidityForm] Subgraph returned ${allFetchedPositions.length} total hookPositions before client-side filtering.`);
          
          // Filter client-side using pos.pool directly
          const relevantPositions = allFetchedPositions.filter(
            pos => pos.pool && pos.pool.toLowerCase().trim() === derivedOnChainPoolId.trim()
          );

          setRawHookPositions(relevantPositions);
        } else {
          setRawHookPositions([]);
          console.warn("[AddLiquidityForm] No hookPositions found in GraphQL response or unexpected data structure.");
          toast.info("No liquidity depth data found.");
        }

      } catch (error: any) {
        console.error("[AddLiquidityForm] Error fetching liquidity depth data:", error);
        toast.error("Liquidity Depth Error", { description: error.message });
        setRawHookPositions(null); // Clear data on error
        // Use fallback chart data
        // generateFallbackChartData(); // This function is defined below, but causing a scope issue here. Let's rely on the other fallback mechanisms.
      } finally {
        setIsFetchingLiquidityDepth(false);
        setIsChartDataLoading(false);
      }
    };

    fetchLiquidityDepthData();
  }, [selectedPoolId, chainId, currentPoolTick, token0Symbol, token1Symbol, getDerivedOnChainPoolId]);

  // Process raw positions into processed positions with amounts
  useEffect(() => {
    if (
      rawHookPositions && rawHookPositions.length > 0 &&
      currentPoolTick !== null &&
      currentPoolSqrtPriceX96 !== null && 
      token0Symbol && token1Symbol && chainId &&
      poolToken0 && poolToken1 && selectedPoolId
    ) {
      const poolConfig = getPoolById(selectedPoolId);
      if (!poolConfig) {
        console.error("[AddLiquidityForm] Could not find pool config for processing positions.");
        setProcessedPositions(null);
        return;
      }
      const newProcessedPositions: ProcessedPositionDetail[] = [];

      const token0Def = TOKEN_DEFINITIONS[token0Symbol];
      const token1Def = TOKEN_DEFINITIONS[token1Symbol];

      if (!token0Def || !token1Def) {
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

        // Loop through positions to determine amounts/value
        for (const position of rawHookPositions) {
          if (position.tickLower !== undefined && position.tickUpper !== undefined && position.liquidity !== undefined) {
            // Parse the liquidity string to a JSBI
            const liquidityJSBI = JSBI.BigInt(position.liquidity);
            
            // Try to create an equivalent position object
            const positionInfo = new V4PositionSDK({
              pool: poolForCalculations,
              tickLower: Number(position.tickLower),
              tickUpper: Number(position.tickUpper),
              liquidity: liquidityJSBI
            });
            
            // Extract amounts from position
            const {amount0, amount1} = positionInfo.mintAmounts;
            
            // Format amounts with proper decimals
            const formattedAmount0 = amount0.toString();
            const formattedAmount1 = amount1.toString();
            
            // Convert to numeric amounts for display/calculations
            const numericAmount0 = Number(viemFormatUnits(BigInt(formattedAmount0), token0Def.decimals));
            const numericAmount1 = Number(viemFormatUnits(BigInt(formattedAmount1), token1Def.decimals));
            
            // Convert both tokens to a unified value - simple calculation
            let unifiedValue = 0;
            
            if (currentPrice && !isNaN(parseFloat(currentPrice))) {
              // If token0 is the primary token being displayed
              if (baseTokenForPriceDisplay === token0Symbol) {
                // When token0 is the base, token1 amount is converted using price directly
                unifiedValue = numericAmount0 + (numericAmount1 * parseFloat(currentPrice));
              } else {
                // When token1 is the base, token0 amount is converted using 1/price
                unifiedValue = (numericAmount0 / parseFloat(currentPrice)) + numericAmount1;
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
            console.warn("[AddLiquidityForm] Skipping position due to undefined tickLower, tickUpper, or liquidity:", position);
          }
        }
        setProcessedPositions(newProcessedPositions);
      } catch (error) {
        console.error("[AddLiquidityForm] Error processing positions into ProcessedPositionDetail:", error);
        setProcessedPositions(null);
      }
    } else if (rawHookPositions === null) {
      setProcessedPositions(null); 
    } else if (rawHookPositions && rawHookPositions.length === 0) {
        setProcessedPositions([]);
        console.log("[AddLiquidityForm] No raw positions to process into ProcessedPositionDetail.");
    }
  }, [rawHookPositions, currentPoolTick, currentPoolSqrtPriceX96, token0Symbol, token1Symbol, chainId, poolToken0, poolToken1, currentPrice, baseTokenForPriceDisplay, selectedPoolId]);

  // Create delta events and aggregate them
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

  // Create simplified plot data from sorted net changes
  useEffect(() => {
    console.log("[DEBUG] Chart data effect - sortedNetUnifiedValueChanges:", sortedNetUnifiedValueChanges?.length);
    console.log("[DEBUG] Chart data effect - poolToken0:", poolToken0?.symbol);
    
    if (sortedNetUnifiedValueChanges && sortedNetUnifiedValueChanges.length > 0 && poolToken0) {
      
      let newData: DepthChartDataPoint[] = [];
      let currentCumulativeValue = 0;
      
      // Step through each sorted tick and accumulate changes
      for (const { tick, netUnifiedToken0Change } of sortedNetUnifiedValueChanges) {
        // Add the net change to running total
        currentCumulativeValue += netUnifiedToken0Change;
        
        // Ensure non-negative values (floating point errors can cause small negative values)
        const normalizedCumulativeValue = Math.max(0, currentCumulativeValue);

        // Format for display 
        const displayValue = normalizedCumulativeValue > 0 
          ? normalizedCumulativeValue 
          : undefined; // Skip zero values for display
        
        newData.push({
          tick,
          token0Depth: normalizedCumulativeValue, // Add token0Depth for compatibility
          normToken0Depth: normalizedCumulativeValue > 0 ? 1 : 0, // Normalized to 0-1 range
          cumulativeUnifiedValue: normalizedCumulativeValue,
          displayCumulativeValue: displayValue,
          value: normalizedCumulativeValue // For backward compatibility
        });
      }
      
      setSimplifiedChartPlotData(newData as any);
      setChartData(newData);
      console.log("[DEBUG] Updated chart data with", newData.length, "points from real liquidity data");
      
      /*
      // Dynamically set the xDomain based on the liquidity data
      const ticksWithLiquidity = newData.map(d => d.tick);
      if (ticksWithLiquidity.length > 1) {
        const minTick = Math.min(...ticksWithLiquidity);
        const maxTick = Math.max(...ticksWithLiquidity);
        const range = maxTick - minTick;
        const padding = Math.max(range * 0.1, 50 * (defaultTickSpacing || 60)); 
        setXDomain([Math.floor(minTick - padding), Math.ceil(maxTick + padding)]);
      } else if (currentPoolTick !== null) {
        const padding = 100 * (defaultTickSpacing || 60);
        setXDomain([currentPoolTick - padding, currentPoolTick + padding]);
      }
      */

    } else if (sortedNetUnifiedValueChanges === null) {
      setSimplifiedChartPlotData(null);
      console.log("[DEBUG] No sorted changes data, clearing chart data");
      // Don't clear chart data here, let the fallback mechanism work
    } else {
      // Empty array case, generate simple fallback
      setSimplifiedChartPlotData([]);
      console.log("[DEBUG] Empty sorted changes, using fallback");
      generateFallbackChartData(); // Use the fallback
    }
  }, [sortedNetUnifiedValueChanges, poolToken0, currentPoolTick, defaultTickSpacing]);

  // Generate simplified fallback chart data when API fails
  const generateFallbackChartData = () => {
    if (currentPoolTick === null) return;
    
    console.log("[DEBUG] Generating fallback chart data");
    
    // Use very simple fallback data - this is used only when all other methods fail
    const simpleData: DepthChartDataPoint[] = [];
    const centerTick = currentPoolTick;
    
    // Create a simple bell curve with 5 points - independent of user's selected range
    simpleData.push({ tick: centerTick - 20000, token0Depth: 0, normToken0Depth: 0, value: 0 });
    simpleData.push({ tick: centerTick - 10000, token0Depth: 50, normToken0Depth: 0.5, value: 0.5 });
    simpleData.push({ tick: centerTick, token0Depth: 100, normToken0Depth: 1, value: 1 });
    simpleData.push({ tick: centerTick + 10000, token0Depth: 50, normToken0Depth: 0.5, value: 0.5 });
    simpleData.push({ tick: centerTick + 20000, token0Depth: 0, normToken0Depth: 0, value: 0 });
    
    // Sort by tick for proper rendering
    simpleData.sort((a, b) => a.tick - b.tick);
    
    setChartData(simpleData);
  };

  // Chart container & data
  <div 
    className="w-full h-52 relative rounded-md border bg-muted/30" 
    ref={chartContainerRef}
    style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
  >
    {isPoolStateLoading || isChartDataLoading ? (
      <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-20">
        <Image 
          src="/logo_icon_white.svg" 
          alt="Loading..." 
          width={32}
          height={32}
          className="animate-pulse opacity-75"
        />
      </div>
    ) : !isPoolStateLoading && currentPriceLine === null ? (
      <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-20">
        <span className="text-muted-foreground text-sm px-4 text-center">
          {"Pool data unavailable for chart."}
        </span>
      </div>
    ) : (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart 
          data={simplifiedChartPlotData || (chartData.length > 0 ? chartData : [
            // Fallback data points if no chart data available - independent of user's range
            { tick: (currentPoolTick || 0) - 20000, token0Depth: 0, normToken0Depth: 0, cumulativeUnifiedValue: 0, value: 0 },
            { tick: (currentPoolTick || 0) - 10000, token0Depth: 50, normToken0Depth: 0.5, cumulativeUnifiedValue: 50, value: 0.5 },
            { tick: (currentPoolTick || 0), token0Depth: 100, normToken0Depth: 1, cumulativeUnifiedValue: 100, value: 1 },
            { tick: (currentPoolTick || 0) + 10000, token0Depth: 50, normToken0Depth: 0.5, cumulativeUnifiedValue: 50, value: 0.5 },
            { tick: (currentPoolTick || 0) + 20000, token0Depth: 0, normToken0Depth: 0, cumulativeUnifiedValue: 0, value: 0 }
          ])} 
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
          
          {/* Use the same chart visualizations as AddLiquidityModal */}
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
          
          {!isPoolStateLoading && parseInt(tickLower) < parseInt(tickUpper) && isFinite(parseInt(tickLower)) && isFinite(parseInt(tickUpper)) && (
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
    )}
  </div>

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
            toast.info("Withdraw functionality coming soon");
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
            toast.info("Swap functionality coming soon");
          }}
        >
          Swap
        </button>
      </div>
      */}

      {/* Deposit Tab Content */}
      {activeTab === 'deposit' && (
        <>
          {/* Range Selection Step */}
          {depositStep === 'range' && (
            <>
              {/* Price Range Selection */}
              <div className="flex items-center gap-2 mb-4">
                <Button
                  variant={activePreset === "Full Range" ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 px-2 text-xs rounded-md"
                  onClick={handleSetFullRange}
                >
                  Full Range
                </Button>
                <div className="h-5 w-px bg-border mx-1" />
                {["±3%", "±8%", "±15%"].map((preset) => (
                  <Button
                    key={preset}
                    variant={activePreset === preset ? "secondary" : "outline"}
                    size="sm"
                    className="h-8 px-2 text-xs rounded-md"
                    onClick={() => {
                      if (preparedTxData) resetTransactionState();
                      setActivePreset(preset);
                    }}
                  >
                    {preset}
                  </Button>
                ))}
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="h-8 flex items-center bg-green-500/20 text-green-500 px-2 py-0.5 rounded-sm text-xs font-medium cursor-help ml-auto">
                        {enhancedAprDisplay}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-sm font-medium mb-1">Predicted APR</p>
                      <p className="text-xs text-muted-foreground">
                        Calculated using current volume and adjusted by a capital efficiency factor of 
                        <span className="font-semibold text-foreground"> {capitalEfficiencyFactor.toLocaleString(undefined, {minimumFractionDigits: 1, maximumFractionDigits: 2})}x</span>. Actual returns might deviate.
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

              {/* Chart Container */}
              <div 
                className="w-full h-52 relative rounded-md border bg-muted/30" 
                ref={chartContainerRef}
                style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
              >
                {isPoolStateLoading || isChartDataLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-20">
                    <Image 
                      src="/logo_icon_white.svg" 
                      alt="Loading..." 
                      width={32}
                      height={32}
                      className="animate-pulse opacity-75"
                    />
                  </div>
                ) : !isPoolStateLoading && currentPriceLine === null ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-20">
                    <span className="text-muted-foreground text-sm px-4 text-center">
                      {"Pool data unavailable for chart."}
                    </span>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart 
                      data={simplifiedChartPlotData || (chartData.length > 0 ? chartData : [
                        // Fallback data points if no chart data available - independent of user's range
                        { tick: (currentPoolTick || 0) - 20000, token0Depth: 0, normToken0Depth: 0, cumulativeUnifiedValue: 0, value: 0 },
                        { tick: (currentPoolTick || 0) - 10000, token0Depth: 50, normToken0Depth: 0.5, cumulativeUnifiedValue: 50, value: 0.5 },
                        { tick: (currentPoolTick || 0), token0Depth: 100, normToken0Depth: 1, cumulativeUnifiedValue: 100, value: 1 },
                        { tick: (currentPoolTick || 0) + 10000, token0Depth: 50, normToken0Depth: 0.5, cumulativeUnifiedValue: 50, value: 0.5 },
                        { tick: (currentPoolTick || 0) + 20000, token0Depth: 0, normToken0Depth: 0, cumulativeUnifiedValue: 0, value: 0 }
                      ])} 
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
                      
                      {/* Use the same chart visualizations as AddLiquidityModal */}
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
                      
                      {!isPoolStateLoading && parseInt(tickLower) < parseInt(tickUpper) && isFinite(parseInt(tickLower)) && isFinite(parseInt(tickUpper)) && (
                        <ReferenceArea 
                          x1={parseInt(tickLower)} 
                          x2={parseInt(tickUpper)} 
                          yAxisId="leftAxis"
                          strokeOpacity={0} 
                          fill="#e85102" 
                          fillOpacity={0.25} 
                          ifOverflow="extendDomain"
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
                )}
              </div>

              {/* Custom X-Axis Labels */}
              <div className="flex justify-between w-full px-[5px] box-border mt-1 mb-4">
                {customXAxisTicks.map((labelItem, index) => (
                  <span key={index} className="text-xs text-muted-foreground">
                    {labelItem.displayLabel}
                  </span>
                ))}
              </div>

              {/* Min/Max Price Inputs */}
              <TooltipProvider delayDuration={100}>
                <div className="space-y-1 mb-4">
                  <div className="flex justify-between items-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-xs text-muted-foreground cursor-default hover:underline">Min Price</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p className="text-xs text-muted-foreground">The minimum price at which your position earns fees. Below this point, your position converts fully to {baseTokenForPriceDisplay === token0Symbol ? token0Symbol : token1Symbol}.</p>
                      </TooltipContent>
                    </Tooltip>
                    {isPoolStateLoading ? (
                      <div className="h-5 w-24 bg-muted/40 rounded-md animate-pulse ml-auto"></div>
                    ) : (
                      <span className="w-28 border-0 bg-transparent text-right text-sm leading-5 font-medium text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto cursor-default">
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
                        <p className="text-xs text-muted-foreground">The maximum price at which your position earns fees. Beyond this point, your position converts fully to {baseTokenForPriceDisplay === token0Symbol ? token1Symbol : token0Symbol}.</p>
                      </TooltipContent>
                    </Tooltip>
                    {isPoolStateLoading ? (
                      <div className="h-5 w-24 bg-muted/40 rounded-md animate-pulse ml-auto"></div>
                    ) : (
                      <span className="w-28 border-0 bg-transparent text-right text-sm leading-5 font-medium text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto cursor-default">
                        {maxPriceInputString || "0.00"}
                      </span>
                    )}
                  </div>
                </div>
              </TooltipProvider>

              {/* Current Price Display */}
              <div className="pt-2 mb-4">
                <div className="border-t border-border/70 my-2" />
                <div className="flex justify-between items-center space-x-2">
                  <span className="text-xs text-muted-foreground">
                    {isPoolStateLoading ? (
                      <div className="h-4 w-40 bg-muted/40 rounded animate-pulse"></div>
                    ) : currentPrice && !isCalculating ? (
                      baseTokenForPriceDisplay === token0Symbol ? (
                        `1 ${token0Symbol} = ${(1 / parseFloat(currentPrice)).toLocaleString(undefined, { 
                          minimumFractionDigits: TOKEN_DEFINITIONS[token0Symbol]?.displayDecimals || 2, 
                          maximumFractionDigits: TOKEN_DEFINITIONS[token0Symbol]?.displayDecimals || 4
                        })} ${token1Symbol}`
                      ) : (
                        `1 ${token1Symbol} = ${parseFloat(currentPrice).toLocaleString(undefined, { 
                          minimumFractionDigits: TOKEN_DEFINITIONS[token1Symbol]?.displayDecimals || 2,
                          maximumFractionDigits: TOKEN_DEFINITIONS[token1Symbol]?.displayDecimals || 4
                        })} ${token0Symbol}`
                      )
                    ) : isCalculating ? (
                      "Calculating price..."
                    ) : (
                      "Price unavailable"
                    )}
                  </span>
                  <div className="flex space-x-1">
                    <Button
                      variant={baseTokenForPriceDisplay === token0Symbol ? "secondary" : "outline"}
                      size="sm"
                      className="h-7 px-2 text-xs rounded-md"
                      onClick={() => setBaseTokenForPriceDisplay(token0Symbol)}
                    >
                      {token0Symbol}
                    </Button>
                    <Button
                      variant={baseTokenForPriceDisplay === token1Symbol ? "secondary" : "outline"}
                      size="sm"
                      className="h-7 px-2 text-xs rounded-md"
                      onClick={() => setBaseTokenForPriceDisplay(token1Symbol)}
                    >
                      {token1Symbol}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Continue Button */}
              {!isConnected ? (
                <div className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md bg-accent text-accent-foreground px-3 text-sm font-medium transition-colors hover:bg-accent/90 shadow-md">
                  <span className="relative z-0">Connect Wallet</span>
                </div>
              ) : (
                <Button
                  className="w-full"
                  onClick={handleContinueToAmount}
                  disabled={isPoolStateLoading}
                >
                  {isPoolStateLoading ? 'Loading Pool...' : 'Continue'}
                </Button>
              )}
            </>
          )}

          {/* Amount Input Step */}
          {depositStep === 'amount' && (
            <>
              {/* Header with back button */}
              <div className="flex items-center mb-4">
                <Button 
                  variant="ghost"
                  size="sm"
                  className="p-0 h-8 w-8"
                  onClick={handleBackToRange}
                >
                  <ArrowLeftIcon className="h-4 w-4" />
                </Button>
                <span className="ml-2 text-sm font-medium">Specify Amount</span>
              </div>
              
              {/* Input for Token 0 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="amount0" className="text-sm font-medium">Amount</Label>
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
                <div className="rounded-lg bg-muted/30 p-4">
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
                          const newValue = e.target.value; 
                          if (preparedTxData) { resetTransactionState(); } 
                          setAmount0(newValue); 
                          setActiveInputSide('amount0'); 
                        }} 
                        type={amount0.startsWith('<') ? "text" : "number"}
                        disabled={isWorking || (isCalculating && activeInputSide === 'amount1')}
                        className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                      />
                    </div>
                  </div>
                </div>
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
                  <Label htmlFor="amount1" className="text-sm font-medium">Amount</Label>
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
                <div className="rounded-lg bg-muted/30 p-4">
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
                          const newValue = e.target.value; 
                          if (preparedTxData) { resetTransactionState(); } 
                          setAmount1(newValue); 
                          setActiveInputSide('amount1'); 
                        }} 
                        type={amount1.startsWith('<') ? "text" : "number"}
                        disabled={isWorking || (isCalculating && activeInputSide === 'amount0')}
                        className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Transaction Steps Re-added for 'amount' step */}
              <div className="p-3 border border-dashed rounded-md bg-muted/10 mb-4">
                <p className="text-sm font-medium mb-2 text-foreground/80">Transaction Steps</p>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>Select Price Range</span>
                    <CheckIcon className="h-4 w-4 text-green-500" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Specify Amount</span>
                    <CheckIcon className="h-4 w-4 text-green-500" />
                  </div>
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
                      : isMintConfirming ? <CheckIcon className="h-4 w-4 text-green-500" />
                      : <MinusIcon className="h-4 w-4" />}
                    </span>
                  </div>
                </div>
              </div>

              {/* Continue Button */}
              {!isConnected ? (
                <div className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md bg-accent text-accent-foreground px-3 text-sm font-medium transition-colors hover:bg-accent/90 shadow-md">
                  <span className="relative z-0">Connect Wallet</span>
                </div>
              ) : (
                <Button
                  className="w-full"
                  onClick={() => {
                    if (step === 'input') handlePrepareAndSubmit();
                    else if (step === 'approve') handleApprove();
                    else if (step === 'permit2Sign') handleSignAndSubmitPermit2();
                    else if (step === 'mint') handleMint();
                  }}
                  disabled={isWorking || 
                    isCalculating ||
                    isPoolStateLoading || 
                    isApproveWritePending ||
                    isMintSendPending ||
                    (step === 'input' && (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) && !preparedTxData) ||
                    (step === 'input' && isInsufficientBalance)
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
            </>
          )}
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