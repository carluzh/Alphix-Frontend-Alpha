"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PlusIcon, RefreshCwIcon, XIcon, CheckIcon, MinusIcon, InfinityIcon, InfoIcon, ActivityIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Dialog, 
  DialogFooter,
  DialogPortal,
  DialogOverlay
} from "@/components/ui/dialog";
import * as RadixDialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { 
    useAccount, 
    useWriteContract, 
    useSendTransaction, 
    useWaitForTransactionReceipt,
    useBalance,
    useSignTypedData
} from "wagmi";
import { toast } from "sonner";
import { TOKEN_DEFINITIONS, TokenSymbol, V4_POOL_FEE, V4_POOL_TICK_SPACING, V4_POOL_HOOKS } from "@/lib/swap-constants";
import { baseSepolia } from "@/lib/wagmiConfig";
import { ERC20_ABI } from "@/lib/abis/erc20";
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
  Label as RechartsChartLabel, // Explicit import for Recharts Label
  Bar,
  Cell,
  Area // Added Area import
} from 'recharts';
import { motion } from "framer-motion";

// Utility function (copied from app/liquidity/page.tsx)
const formatTokenDisplayAmount = (amount: string) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0.00";
  if (num < 0.0001) return "< 0.0001";
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

// Minimal ABI for Permit2.permit function, defined as a full ABI array for robustness
const PERMIT2_PERMIT_ABI_MINIMAL = [
  {
    "inputs": [
      { "internalType": "address", "name": "owner", "type": "address" },
      {
        "components": [
          {
            "components": [
              { "internalType": "address", "name": "token", "type": "address" },
              { "internalType": "uint160", "name": "amount", "type": "uint160" },
              { "internalType": "uint48", "name": "expiration", "type": "uint48" },
              { "internalType": "uint48", "name": "nonce", "type": "uint48" }
            ],
            "internalType": "struct ISignatureTransfer.PermitDetails",
            "name": "details",
            "type": "tuple"
          },
          { "internalType": "address", "name": "spender", "type": "address" },
          { "internalType": "uint256", "name": "sigDeadline", "type": "uint256" }
        ],
        "internalType": "struct ISignatureTransfer.PermitSingle",
        "name": "permitSingle",
        "type": "tuple"
      },
      { "internalType": "bytes", "name": "signature", "type": "bytes" }
    ],
    "name": "permit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const; // Use 'as const' for better type inference with Viem

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
  const { address: accountAddress, chainId } = useAccount();
  const [token0Symbol, setToken0Symbol] = useState<TokenSymbol>('YUSDC');
  const [token1Symbol, setToken1Symbol] = useState<TokenSymbol>('BTCRL');
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
    amount0: string; // Renamed from calculatedAmount0 for consistency with API response
    amount1: string; // Renamed from calculatedAmount1
    currentPoolTick?: number; // Added from API response
    currentPrice?: string;    // Added from API response
    priceAtTickLower?: string;
    priceAtTickUpper?: string;
  } | null>(null);
  // Keep separate state for currentPrice, priceAtTickLower/Upper for now, as other parts of the modal might use them directly.
  // The calculatedData object will now also hold them for the price string effect.
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);
  const [priceAtTickLower, setPriceAtTickLower] = useState<string | null>(null);
  const [priceAtTickUpper, setPriceAtTickUpper] = useState<string | null>(null);
  
  const [isWorking, setIsWorking] = useState(false);
  const [step, setStep] = useState<'input' | 'approve' | 'mint' | 'permit2Sign'>('input');
  const [preparedTxData, setPreparedTxData] = useState<any>(null);

  // New state for Permit2 signature request details
  const [permit2SignatureRequest, setPermit2SignatureRequest] = useState<{
    domain: any;
    types: any;
    primaryType: string;
    message: any;
    permit2Address: Hex;
    approvalTokenSymbol: TokenSymbol; 
  } | null>(null);

  // Replace existing states for tracking Permit2 steps
  const [permit2StepsCompletedCount, setPermit2StepsCompletedCount] = useState<number>(0);
  const [maxPermit2StepsInCurrentTx, setMaxPermit2StepsInCurrentTx] = useState<number>(0);

  // Add new states to track token approvals by token symbol
  const [tokenApprovalStatus, setTokenApprovalStatus] = useState<{
    [tokenSymbol: string]: boolean
  }>({});
  const [tokensRequiringApproval, setTokensRequiringApproval] = useState<number>(0);

  const [activePreset, setActivePreset] = useState<string | null>("±15%");
  const [baseTokenForPriceDisplay, setBaseTokenForPriceDisplay] = useState<TokenSymbol>(token0Symbol);

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

  // --- BEGIN useEffect to calculate custom X-axis ticks ---
  useEffect(() => {
    if (xDomain && xDomain[0] !== undefined && xDomain[1] !== undefined && token0Symbol && token1Symbol) {
      const [minTickDomain, maxTickDomain] = xDomain;
      const desiredTickCount = 3; 
      const newLabels: CustomAxisLabel[] = [];

      const token0Def = TOKEN_DEFINITIONS[token0Symbol];
      const token1Def = TOKEN_DEFINITIONS[token1Symbol];
      const displayDecimals = baseTokenForPriceDisplay === token0Symbol 
        ? (token0Def?.displayDecimals ?? (token0Symbol === 'BTCRL' ? 8 : 4)) 
        : (token1Def?.displayDecimals ?? (token1Symbol === 'BTCRL' ? 8 : 4));

      if (minTickDomain === maxTickDomain) {
        // Simplified: just show one label if domain is a single point
        // Price calculation for a single tick
        let priceAtTick = NaN;
        if (token0Def?.decimals !== undefined && token1Def?.decimals !== undefined) {
          const decimalAdjFactor = baseTokenForPriceDisplay === token0Symbol 
            ? Math.pow(10, token1Def.decimals - token0Def.decimals)
            : Math.pow(10, token0Def.decimals - token1Def.decimals);
          const rawPrice = Math.pow(1.0001, minTickDomain);
          priceAtTick = baseTokenForPriceDisplay === token0Symbol ? rawPrice * decimalAdjFactor : (1 / rawPrice) * decimalAdjFactor;
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

          if (token0Def?.decimals !== undefined && token1Def?.decimals !== undefined) {
            // Price of token1 in terms of token0: P_t1_t0 = (1.0001)^tick * 10^(t1_decimals - t0_decimals)
            // Price of token0 in terms of token1: P_t0_t1 = (1.0001)^(-tick) * 10^(t0_decimals - t1_decimals)
            const rawPriceFactor = Math.pow(1.0001, tickVal);

            if (baseTokenForPriceDisplay === token0Symbol) { // Display price of T1 in T0
              const decimalAdj = Math.pow(10, token1Def.decimals - token0Def.decimals);
              priceAtTick = rawPriceFactor * decimalAdj;
            } else { // Display price of T0 in T1
              const decimalAdj = Math.pow(10, token0Def.decimals - token1Def.decimals);
              priceAtTick = (1 / rawPriceFactor) * decimalAdj; 
            }
          }
          newLabels.push({ 
            tickValue: tickVal, 
            displayLabel: isNaN(priceAtTick) ? tickVal.toString() : priceAtTick.toLocaleString(undefined, { maximumFractionDigits: displayDecimals, minimumFractionDigits: Math.min(2, displayDecimals) }) 
          });
        }
        // REMOVED: The code that was reversing the labels when displaying price of Token0 in terms of Token1
      } 
      setCustomXAxisTicks(newLabels);
    } else {
      // Handle non-finite domains if necessary, for now, clear ticks
      setCustomXAxisTicks([]); // This should be an empty array of CustomAxisLabel
      return;
    }
  }, [xDomain, baseTokenForPriceDisplay, token0Symbol, token1Symbol]);
  // --- END useEffect to calculate custom X-axis ticks ---

  // --- BEGIN Panning State ---
  const [isPanning, setIsPanning] = useState(false);
  const panStartXRef = useRef<number | null>(null);
  const panStartDomainRef = useRef<[number, number] | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null); // Ref for the chart container
  // --- END Panning State ---

  const [minPriceInputString, setMinPriceInputString] = useState<string>("");
  const [maxPriceInputString, setMaxPriceInputString] = useState<string>("");

  const [isPoolStateLoading, setIsPoolStateLoading] = useState<boolean>(false);

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
    const sdkBaseToken0 = new Token(chainId, getAddress(currentToken0Def.addressRaw), currentToken0Def.decimals, currentToken0Def.symbol);
    const sdkBaseToken1 = new Token(chainId, getAddress(currentToken1Def.addressRaw), currentToken1Def.decimals, currentToken1Def.symbol);

    // Sort them to get the canonical poolToken0 and poolToken1
    const [pt0, pt1] = sdkBaseToken0.sortsBefore(sdkBaseToken1)
      ? [sdkBaseToken0, sdkBaseToken1]
      : [sdkBaseToken1, sdkBaseToken0];
    return { poolToken0: pt0, poolToken1: pt1 };
  }, [token0Symbol, token1Symbol, chainId]);
  // --- END Derived Pool Tokens ---

  // --- BEGIN State for Pool's Current SqrtPriceX96 ---
  // TODO: This state needs to be populated reliably, ideally from the same source as currentPoolTick (e.g., get-pool-state API call)
  const [currentPoolSqrtPriceX96, setCurrentPoolSqrtPriceX96] = useState<string | null>(null); // Store as string, convert to JSBI when used
  // --- END State for Pool's Current SqrtPriceX96 ---

  // Define Subgraph URL - consider moving to a constants file if used elsewhere
  const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-v-4/version/latest";

  // Helper function to get the canonical on-chain pool ID (Bytes! string)
  const getDerivedOnChainPoolId = useCallback((): string | null => {
    if (!token0Symbol || !token1Symbol || !chainId) return null;

    const token0Def = TOKEN_DEFINITIONS[token0Symbol];
    const token1Def = TOKEN_DEFINITIONS[token1Symbol];

    if (!token0Def || !token1Def) return null;

    try {
      const sdkToken0 = new Token(chainId, getAddress(token0Def.addressRaw), token0Def.decimals);
      const sdkToken1 = new Token(chainId, getAddress(token1Def.addressRaw), token1Def.decimals);

      const [sortedSdkToken0, sortedSdkToken1] = sdkToken0.sortsBefore(sdkToken1)
        ? [sdkToken0, sdkToken1]
        : [sdkToken1, sdkToken0];
      
      // Ensure V4_POOL_HOOKS is defined and is a valid Address type if needed by V4PoolSDK.getPoolId
      // For now, assuming V4_POOL_HOOKS from constants is correctly formatted (e.g. Hex)
      const poolIdBytes32 = V4PoolSDK.getPoolId(
        sortedSdkToken0,
        sortedSdkToken1,
        V4_POOL_FEE, // Assuming this is a number or compatible type
        V4_POOL_TICK_SPACING, // Assuming this is a number or compatible type
        V4_POOL_HOOKS as Hex // Make sure V4_POOL_HOOKS is compatible, cast if necessary
      );
      return poolIdBytes32.toLowerCase();
    } catch (error) {
      console.error("[AddLiquidityModal] Error deriving on-chain pool ID:", error);
      return null;
    }
  }, [token0Symbol, token1Symbol, chainId]);

  const getTokenIcon = (symbol?: string) => {
    if (symbol?.toUpperCase().includes("YUSD")) return "/YUSD.png";
    if (symbol?.toUpperCase().includes("BTCRL")) return "/BTCRL.png";
    return "/default-token.png";
  };

  const { data: token0BalanceData, isLoading: isLoadingToken0Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[token0Symbol]?.addressRaw as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[token0Symbol]?.addressRaw },
  });

  const { data: token1BalanceData, isLoading: isLoadingToken1Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[token1Symbol]?.addressRaw as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[token1Symbol]?.addressRaw },
  });

  const [initialDefaultApplied, setInitialDefaultApplied] = useState(false);

  useEffect(() => {
    setBaseTokenForPriceDisplay(token0Symbol); 
  }, [token0Symbol]);

  useEffect(() => {
    if (isOpen && selectedPoolId) {
      const parts = selectedPoolId.split('-');
      if (parts.length === 2) {
        const t0 = parts[0].toUpperCase() as TokenSymbol;
        const t1 = parts[1].toUpperCase() as TokenSymbol;
        if (TOKEN_DEFINITIONS[t0] && TOKEN_DEFINITIONS[t1]) {
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
    setBaseTokenForPriceDisplay(token0Symbol); // Reset base token for price display
    // Reset chart specific states too
    setXDomain([-120000, 120000]);
    setCurrentPriceLine(null);
    setMockSelectedPriceRange(null);
  }, [token0Symbol, token1Symbol, chainId, sdkMinTick, sdkMaxTick]);

  // Effect to fetch initial pool state (current price and tick)
  useEffect(() => {
    // Only fetch initial pool state if the modal is open, essential params are present,
    // and we haven't already applied defaults based on a fetched current price.
    // The key is to get the current market price when the context changes (new pool, or first open).
    if (isOpen && token0Symbol && token1Symbol && chainId && !initialDefaultApplied) {
      const fetchPoolState = async () => {
        setIsPoolStateLoading(true);
        // toast.loading("Fetching pool data...", { id: "pool-state-fetch" }); // Redundant if preset application shows loading
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
            // toast.dismiss("pool-state-fetch");
            const errorData = await response.json();
            throw new Error(errorData.message || "Failed to fetch initial pool state.");
          }
          const poolState = await response.json();
          // toast.dismiss("pool-state-fetch");

          if (poolState.currentPrice && typeof poolState.currentPoolTick === 'number') {
            setCurrentPrice(poolState.currentPrice); 
            setCurrentPoolTick(poolState.currentPoolTick);

            // Consume sqrtPriceX96 from the API response
            if (poolState.sqrtPriceX96) { 
              setCurrentPoolSqrtPriceX96(poolState.sqrtPriceX96.toString()); 
              console.log("[AddLiquidityModal] sqrtPriceX96 set from API:", poolState.sqrtPriceX96.toString());
            } else {
              console.warn("[AddLiquidityModal] sqrtPriceX96 not found in get-pool-state response. Token0 depth calculations might be affected.");
              setCurrentPoolSqrtPriceX96(null); 
            }
            
            const numericCurrentPrice = parseFloat(poolState.currentPrice);
            if (!isNaN(numericCurrentPrice)) {
                setCurrentPriceLine(numericCurrentPrice); // This is for a potential price-based reference line, distinct from tick-based xDomain
                
                // Calculate xDomain based on currentPoolTick and +/- 0.50% price change
                if (typeof poolState.currentPoolTick === 'number') {
                  const centerTick = poolState.currentPoolTick;
                  const percentage = 0.30; // 30% price deviation
                  
                  // tick = ln(price) / ln(1.0001)
                  // price = (1.0001)^tick
                  // For a % change from current price P_current (derived from currentTick):
                  // P_upper = P_current * (1 + percentage)
                  // P_lower = P_current * (1 - percentage)
                  // tick_upper = ln( P_current * (1 + percentage) ) / ln(1.0001)
                  //            = ( ln(P_current) + ln(1+percentage) ) / ln(1.0001)
                  //            = currentTick + ln(1+percentage) / ln(1.0001)
                  // tick_lower = currentTick + ln(1-percentage) / ln(1.0001)

                  const tickDeltaUpper = Math.log(1 + percentage) / Math.log(1.0001);
                  const tickDeltaLower = Math.log(1 - percentage) / Math.log(1.0001); // This will be negative

                  const domainTickLower = Math.round(centerTick + tickDeltaLower);
                  const domainTickUpper = Math.round(centerTick + tickDeltaUpper);
                  
                  setXDomain([domainTickLower, domainTickUpper]);
                } else {
                  // Fallback if currentPoolTick is not available, use price-based domain as before
                  setXDomain([numericCurrentPrice * 0.5, numericCurrentPrice * 1.5]); 
                }
            } else {
                setCurrentPriceLine(null); // Explicitly set to null if parsing fails
                // Fallback xDomain if price is invalid and tick is not available
                setXDomain([-120000, 120000]); 
            }
          } else {
            setCurrentPriceLine(null); // Set to null if data is incomplete
            setCurrentPoolSqrtPriceX96(null); // Also clear if main data is incomplete
            throw new Error("Pool state data is incomplete.");
          }
        } catch (error: any) {
          toast.error("Pool Data Error", { description: error.message });
          setCurrentPriceLine(null); // Explicitly set to null on any fetch/processing error
          setCurrentPoolSqrtPriceX96(null); // Clear on error
          // Consider resetting xDomain to a default on error
          // setXDomain([30000, 50000]); 
        } finally {
          setIsPoolStateLoading(false);
        }
      };
      fetchPoolState();
    }
  }, [isOpen, token0Symbol, token1Symbol, chainId, initialDefaultApplied, calculatedData]); // Added calculatedData to prevent re-fetch if amounts already caused a calculation

  // Create a single debounced function that handles both amount calculation and token approval checks
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
      
      // Early return if primaryAmount is "Error" or not a parsable number
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

      // Track tokens needed for approval
      let tokensNeeded = 0;
      if (parseFloat(currentAmount0 || "0") > 0) tokensNeeded += 1;
      if (parseFloat(currentAmount1 || "0") > 0) tokensNeeded += 1;
      setTokensRequiringApproval(tokensNeeded);
      
      // For backward compatibility with existing logic
      let potentialMaxSteps = 0;
      if (parseFloat(currentAmount0 || "0") > 0) potentialMaxSteps += 2;
      if (parseFloat(currentAmount1 || "0") > 0) potentialMaxSteps += 2;
      setMaxPermit2StepsInCurrentTx(potentialMaxSteps);

      try {
        // STEP 1: Calculate liquidity parameters
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
            setAmount1(formatTokenDisplayAmount(viemFormatUnits(BigInt(result.amount1), TOKEN_DEFINITIONS[secondaryTokenSymbol]?.decimals || 18)));
          } catch (e) {
            setAmount1("Error");
            toast.error("Calculation Error", { description: "Could not parse calculated amount for the other token. The amount might be too large or invalid." });
            setCalculatedData(null);
          }
        } else {
          try {
            setAmount0(formatTokenDisplayAmount(viemFormatUnits(BigInt(result.amount0), TOKEN_DEFINITIONS[secondaryTokenSymbol]?.decimals || 18)));
          } catch (e) {
            setAmount0("Error");
            toast.error("Calculation Error", { description: "Could not parse calculated amount for the other token. The amount might be too large or invalid." });
            setCalculatedData(null);
          }
        }

        // STEP 2: After calculation succeeds, check token approvals if connected and not in transaction
        if (
          accountAddress && 
          chainId && 
          (parseFloat(currentAmount0 || "0") > 0 || parseFloat(currentAmount1 || "0") > 0) &&
          step === 'input' &&
          !isWorking
        ) {
          try {
            const approvalResponse = await fetch('/api/liquidity/check-token-approvals', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userAddress: accountAddress,
                token0Symbol,
                token1Symbol,
                amount0: currentAmount0,
                amount1: currentAmount1,
                chainId: chainId,
              }),
            });
            
            if (approvalResponse.ok) {
              const data = await approvalResponse.json();
              
              // Update token approval status
              setTokenApprovalStatus(prev => ({
                ...prev,
                [token0Symbol]: !data.needsToken0Approval,
                [token1Symbol]: !data.needsToken1Approval
              }));
            }
          } catch (error) {
            console.error("[AddLiquidityModal] Error checking token approvals:", error);
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
    [accountAddress, chainId, token0Symbol, token1Symbol, step, isWorking]
  );

  // Replace the two separate useEffect hooks with a single one that uses the combined function
  useEffect(() => {
    if (activeInputSide) {
      if (activeInputSide === 'amount0') {
        debouncedCalculateAmountAndCheckApprovals(amount0, amount1, tickLower, tickUpper, 'amount0');
      } else if (activeInputSide === 'amount1') {
        debouncedCalculateAmountAndCheckApprovals(amount0, amount1, tickLower, tickUpper, 'amount1');
      }
    } else {
      if (parseFloat(amount0) > 0) {
        debouncedCalculateAmountAndCheckApprovals(amount0, amount1, tickLower, tickUpper, 'amount0');
      } else if (parseFloat(amount1) > 0) {
        debouncedCalculateAmountAndCheckApprovals(amount0, amount1, tickLower, tickUpper, 'amount1');
      } else {
        setCalculatedData(null);
      }
    }
  }, [amount0, amount1, tickLower, tickUpper, activeInputSide, debouncedCalculateAmountAndCheckApprovals]);

  const handlePrepareMint = async (isAfterApproval = false) => {
    if (!accountAddress || !chainId) {
      toast.error("Please connect your wallet.");
      return;
    }

    // Determine inputAmount and inputTokenSymbol based on activeInputSide or filled amounts
    let finalInputAmount: string | undefined;
    let finalInputTokenSymbol: TokenSymbol | undefined;

    if (activeInputSide === 'amount0' && amount0 && parseFloat(amount0) > 0) {
        finalInputAmount = amount0;
        finalInputTokenSymbol = token0Symbol;
    } else if (activeInputSide === 'amount1' && amount1 && parseFloat(amount1) > 0) {
        finalInputAmount = amount1;
        finalInputTokenSymbol = token1Symbol;
    } else if (amount0 && parseFloat(amount0) > 0 && (!amount1 || parseFloat(amount1) <= 0)) {
        // If only amount0 is filled and no active side, assume amount0 is the input
        finalInputAmount = amount0;
        finalInputTokenSymbol = token0Symbol;
    } else if (amount1 && parseFloat(amount1) > 0 && (!amount0 || parseFloat(amount0) <= 0)) {
        // If only amount1 is filled and no active side, assume amount1 is the input
        finalInputAmount = amount1;
        finalInputTokenSymbol = token1Symbol;
    } else if (amount0 && parseFloat(amount0) > 0) {
        // Fallback: if both potentially filled but no activeInputSide, prefer amount0 as input
        // This case should ideally be covered by activeInputSide or clear one field logic
        finalInputAmount = amount0;
        finalInputTokenSymbol = token0Symbol;
    } else if (amount1 && parseFloat(amount1) > 0) {
        // Fallback: if only amount1 is filled
        finalInputAmount = amount1;
        finalInputTokenSymbol = token1Symbol;
    }

    if (!finalInputAmount || !finalInputTokenSymbol) {
        toast.error("Please enter an amount for at least one token.");
        // Ensure not to proceed if these are undefined.
        // This check might be redundant if the button is disabled correctly, but good for safety.
        return;
    }

    const finalTickLowerNum = calculatedData?.finalTickLower ?? parseInt(tickLower);
    const finalTickUpperNum = calculatedData?.finalTickUpper ?? parseInt(tickUpper);

    if (isNaN(finalTickLowerNum) || isNaN(finalTickUpperNum) || finalTickLowerNum >= finalTickUpperNum) {
      toast.error("Invalid tick range provided or calculated.");
      return;
    }
    if (token0Symbol === token1Symbol) {
      toast.error("Tokens cannot be the same.");
      return;
    }
    setIsWorking(true);
    if (!isAfterApproval) setStep('input');
    toast.loading("Preparing transaction...", { id: "prepare-mint" });
    try {
      const response = await fetch('/api/liquidity/prepare-mint-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: accountAddress,
          token0Symbol, 
          token1Symbol,
          inputAmount: finalInputAmount,         
          inputTokenSymbol: finalInputTokenSymbol, 
          userTickLower: finalTickLowerNum,
          userTickUpper: finalTickUpperNum,
          chainId: chainId ?? baseSepolia.id,
        }),
      });
      toast.dismiss("prepare-mint");
      const data = await response.json();

      if (!response.ok) {
        const err = new Error(data.message || "Failed to prepare transaction.");
        throw err; 
      }

      setPreparedTxData(data); // Store the raw data

      if (data.needsApproval) {
        if (data.approvalType === 'ERC20_TO_PERMIT2') {
          toast.info(`ERC20 Approval for Permit2 needed for ${data.approvalTokenSymbol}`, {
            description: `You need to approve Permit2 to use your ${data.approvalTokenSymbol}.`
          });
          setStep('approve'); 
        } else if (data.approvalType === 'PERMIT2_SIGNATURE_FOR_PM') {
          toast.info(`Permit2 Signature needed for ${data.approvalTokenSymbol}`, {
            description: `Please sign the message to allow the Position Manager to use your ${data.approvalTokenSymbol} via Permit2.`
          });
          setPermit2SignatureRequest({
            domain: data.signatureDetails.domain,
            types: data.signatureDetails.types,
            primaryType: data.signatureDetails.primaryType,
            message: data.signatureDetails.message,
            permit2Address: data.permit2Address,
            approvalTokenSymbol: data.approvalTokenSymbol
          });
          setStep('permit2Sign');
        } else {
          // Fallback for unknown approval type, though backend should be specific
          toast.error("Unknown Approval Needed", { description: "An unspecified approval is required." });
          setStep('input'); // Or some error step
        }
      } else {
        toast.success("Transaction ready to mint!");
        setPermit2StepsCompletedCount(maxPermit2StepsInCurrentTx); // <-- ADD THIS LINE
        setStep('mint');
      }
    } catch (error: any) {
      toast.dismiss("prepare-mint");
      // Check if the error message indicates the specific Permit2 spender allowance issue
      if (error && typeof error.message === 'string' && 
          (error.message.includes("Position Manager does not have sufficient allowance from Permit2") || 
           error.message.includes("Permit2 allowance for the Position Manager to spend") /* Catches expiration too */) 
         ) {
           toast.error("Permit2 Authorization Incomplete", { 
               description: error.message + " This step often requires signing a message or a separate one-time transaction to authorize the Position Manager via Permit2.",
               duration: 12000 // Longer duration for this important message
           });
      } else {
           toast.error("Error Preparing Transaction", { description: error.message || "Unknown error during preparation." });
      }
      
    } finally {
      if (!isAfterApproval) setIsWorking(false);
    }
  };

  const { data: approveTxHash, error: approveWriteError, isPending: isApproveWritePending, writeContractAsync: approveERC20Async, reset: resetApproveWriteContract } = useWriteContract();
  const { isLoading: isApproving, isSuccess: isApproved, error: approveReceiptError } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { data: mintTxHash, error: mintSendError, isPending: isMintSendPending, sendTransactionAsync, reset: resetSendTransaction } = useSendTransaction();
  const { isLoading: isMintConfirming, isSuccess: isMintConfirmed, error: mintReceiptError } = useWaitForTransactionReceipt({ hash: mintTxHash });

  // Wagmi hooks for Permit2.permit() transaction
  const { 
    data: permit2TxHash, 
    error: permit2SendError, 
    isPending: isPermit2SendPending, 
    writeContractAsync: permit2WriteContractAsync, // Using writeContractAsync for Permit2.permit
    reset: resetPermit2WriteContract 
  } = useWriteContract();
  const { 
    isLoading: isPermit2Confirming, 
    isSuccess: isPermit2Confirmed, 
    error: permit2ReceiptError 
  } = useWaitForTransactionReceipt({ hash: permit2TxHash });

  useEffect(() => {
    if (isApproved) {
      toast.success("Approval successful!");
      
      // If we have approval token info in preparedTxData
      if (preparedTxData?.approvalTokenSymbol) {
        // Mark this token as fully approved
        const approvedToken = preparedTxData.approvalTokenSymbol as TokenSymbol;
        setTokenApprovalStatus(prev => ({
          ...prev,
          [approvedToken]: true
        }));
      }
      
      // Keep original counter for backward compatibility
      setPermit2StepsCompletedCount(prev => prev + 1);
      
      resetApproveWriteContract(); 
      if (preparedTxData) {
        handlePrepareMint(true); 
      }
      setIsWorking(false); 
    }
    if (approveWriteError || approveReceiptError) {
      const errorMsg = approveWriteError?.message || approveReceiptError?.message || "Approval transaction failed.";
      toast.error("Approval failed", { description: errorMsg });
      setIsWorking(false);
      resetApproveWriteContract();
      setPreparedTxData(null);
      setStep('input'); 
    }
  }, [isApproved, approveWriteError, approveReceiptError, preparedTxData, resetApproveWriteContract, handlePrepareMint]);

  const resetInternalTxState = useCallback(() => {
    setStep('input');
    setPreparedTxData(null);
    setPermit2SignatureRequest(null); 
    setIsWorking(false);
    setPermit2StepsCompletedCount(0); 
    setMaxPermit2StepsInCurrentTx(0); 
    setTokenApprovalStatus({});
    setTokensRequiringApproval(0);
    resetApproveWriteContract();
    resetSendTransaction();
    resetPermit2WriteContract();
  }, [resetApproveWriteContract, resetSendTransaction, resetPermit2WriteContract]);

  useEffect(() => {
    if (isMintConfirmed) {
      toast.success("Liquidity minted successfully!", { id: "mint-tx" });
      onLiquidityAdded();
      resetInternalTxState(); // Explicitly reset internal TX state here
      onOpenChange(false);    // Then close the modal
      resetSendTransaction(); // Wagmi hook reset
    }
    if (mintSendError || mintReceiptError) {
      const errorMsg = mintSendError?.message || mintReceiptError?.message || "Minting transaction failed.";
      toast.error("Minting failed", { id: "mint-tx", description: errorMsg });
      
      setIsWorking(false);
      resetSendTransaction();
      // If minting fails, allow user to try again or adjust
      setStep('mint'); // Stay on mint step, or consider 'input' if full reset is better
      // setPreparedTxData(null); // Optional: force re-preparation if mint fails catastrophically
    }
  }, [isMintConfirmed, mintSendError, mintReceiptError, onLiquidityAdded, onOpenChange, resetSendTransaction, resetInternalTxState]);

  // useEffect to handle Permit2.permit() transaction result
  useEffect(() => {
    if (isPermit2Confirmed) {
      toast.success("Permit2 call successful!", { id: "permit2-submit" });
      
      // If we have token info in permit2SignatureRequest
      if (permit2SignatureRequest?.approvalTokenSymbol) {
        // Mark this token as fully approved since the permit2 signature was successful
        const approvedToken = permit2SignatureRequest.approvalTokenSymbol;
        setTokenApprovalStatus(prev => ({
          ...prev,
          [approvedToken]: true
        }));
      }
      
      // Keep original counter for backward compatibility
      setPermit2StepsCompletedCount(prev => prev + 1);
      
      resetPermit2WriteContract();
      if (preparedTxData) {
        handlePrepareMint(true); 
      }
      setIsWorking(false);
    }
    if (permit2SendError || permit2ReceiptError) {
      const errorMsg = permit2SendError?.message || permit2ReceiptError?.message || "Permit2 transaction failed.";
      toast.error("Permit2 Submission Failed", { id: "permit2-submit", description: errorMsg });
      setIsWorking(false);
      resetPermit2WriteContract();
    }
  }, [isPermit2Confirmed, permit2SendError, permit2ReceiptError, preparedTxData, resetPermit2WriteContract, handlePrepareMint]);

  const resetForm = () => {
    setToken0Symbol('YUSDC');
    setToken1Symbol('BTCRL');
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
    setIsWorking(false);
    setStep('input');
    setPreparedTxData(null);
    setInitialDefaultApplied(false);
    setActivePreset("±15%");
    setBaseTokenForPriceDisplay(token0Symbol);
    setPermit2SignatureRequest(null); // Reset Permit2 request state here too

    // Explicitly reset wagmi hook states
    resetApproveWriteContract();
    resetSendTransaction();
    resetPermit2WriteContract(); // Reset Permit2 hook

    // Chart related state resets
    // setPoolDailyFeesUSD(null);
  };

  const handleSetFullRange = () => {
    setTickLower(sdkMinTick.toString());
    setTickUpper(sdkMaxTick.toString());
    setInitialDefaultApplied(true);
  };

  const handleSwapTokens = () => {
    setToken0Symbol(token1Symbol);
    setToken1Symbol(token0Symbol);
    setAmount0(amount1);
    setAmount1(amount0);
    setActiveInputSide(activeInputSide === 'amount0' ? 'amount1' : activeInputSide === 'amount1' ? 'amount0' : null);
    setCalculatedData(null); 
  };

  const handleApprove = async () => {
    if (!preparedTxData?.needsApproval || !approveERC20Async) return;

    if (!accountAddress || chainId === undefined || chainId === null) {
      toast.error("Wallet not connected or chain not identified. Please reconnect.");
      setIsWorking(false);
      return;
    }

    setIsWorking(true);
    toast.loading(`Approving ${preparedTxData.approvalTokenSymbol}...`, { id: "approve-tx" });
    try {
      const approvalAmountBigInt = BigInt(preparedTxData.approvalAmount);

      if (chainId !== baseSepolia.id) {
        toast.error("Network Mismatch", { description: `Please switch to ${baseSepolia.name} to approve this transaction.` });
        setIsWorking(false);
        return;
      }

      await approveERC20Async({
        address: preparedTxData.approvalTokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [preparedTxData.approveToAddress as `0x${string}`, approvalAmountBigInt],
        account: accountAddress,
        chain: baseSepolia,
      });
    } catch (err: any) {
      toast.dismiss("approve-tx");
      
      let detailedErrorMessage = "Unknown error during approval.";
      if (err instanceof Error) {
        detailedErrorMessage = err.message;
        if ((err as any).shortMessage) { detailedErrorMessage = (err as any).shortMessage; }
      }
      toast.error("Failed to send approval transaction.", { description: detailedErrorMessage });
      setIsWorking(false);
      resetApproveWriteContract();
    }
  };

  const handleMint = async () => {
    if (!preparedTxData || preparedTxData.needsApproval || !sendTransactionAsync) return;
    if (!preparedTxData.transaction || typeof preparedTxData.transaction.data !== 'string') {
      toast.error("Minting Error", { description: "Transaction data is missing or invalid. Please try preparing again." });
      setStep('input'); 
      setIsWorking(false);
      return;
    }
    setIsWorking(true);
    toast.loading("Sending mint transaction...", { id: "mint-tx" });
    try {
      const { to, data, value: txValueString } = preparedTxData.transaction;
      const txParams: { to: `0x${string}`; data: Hex; value?: bigint } = {
        to: to as `0x${string}`,
        data: data as Hex,
      };
      if (txValueString && BigInt(txValueString) > 0n) {
        txParams.value = BigInt(txValueString);
      }
      await sendTransactionAsync(txParams);
    } catch (err: any) { 
      let detailedErrorMessage = "Unknown error sending mint transaction.";
      if (err instanceof Error) {
        detailedErrorMessage = err.message;
        if ((err as any).shortMessage) { detailedErrorMessage = (err as any).shortMessage; }
      }
      toast.error("Failed to send mint transaction.", { id: "mint-tx", description: detailedErrorMessage });
      setIsWorking(false);
      resetSendTransaction();
    }
  };

  const getFormattedDisplayBalance = (numericBalance: number | undefined, tokenSymbolForDecimals: TokenSymbol): string => {
    if (numericBalance === undefined || isNaN(numericBalance)) {
      numericBalance = 0;
    }
    if (numericBalance === 0) {
      return "0.000";
    } else if (numericBalance > 0 && numericBalance < 0.001) {
      return "< 0.001";
    } else {
      const displayDecimals = tokenSymbolForDecimals === 'BTCRL' ? 8 : 2;
      return numericBalance.toFixed(displayDecimals);
    }
  };

  const displayToken0Balance = isLoadingToken0Balance ? "Loading..." : (token0BalanceData ? getFormattedDisplayBalance(parseFloat(token0BalanceData.formatted), token0Symbol) : "~");
  const displayToken1Balance = isLoadingToken1Balance ? "Loading..." : (token1BalanceData ? getFormattedDisplayBalance(parseFloat(token1BalanceData.formatted), token1Symbol) : "~");

  const removeNumberInputArrows = () => {
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
      .no-arrows::-webkit-inner-spin-button,
      .no-arrows::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      .no-arrows {
        -moz-appearance: textfield;
      }
    `;
    document.head.appendChild(style);
  };

  useEffect(() => {
    removeNumberInputArrows();
  }, []);

  const handleUseFullBalance = (balanceString: string, tokenSymbolForDecimals: TokenSymbol, isToken0: boolean) => { 
    try {
      const numericBalance = parseFloat(balanceString);
      if (isNaN(numericBalance) || numericBalance <= 0) return;

      const formattedBalance = numericBalance.toFixed(TOKEN_DEFINITIONS[tokenSymbolForDecimals]?.decimals || 18);

      if (isToken0) {
        setAmount0(formattedBalance);
        setActiveInputSide('amount0');
        if (activeInputSide === 'amount0' || activeInputSide === null) { 
            debouncedCalculateAmountAndCheckApprovals(formattedBalance, amount1, tickLower, tickUpper, 'amount0');
        }
      } else { 
        setAmount1(formattedBalance);
        setActiveInputSide('amount1');
         if (activeInputSide === 'amount1' || activeInputSide === null) { 
            debouncedCalculateAmountAndCheckApprovals(amount0, formattedBalance, tickLower, tickUpper, 'amount1');
        }
      }
    } catch (error) {
      
    }
  };

  // Mock function to convert tick to price (highly simplified for mockup)
  const mockTickToPrice = useCallback((tick: number, basePrice = 50000, tickSpacing = 60, priceChangePerTick = 0.0001) => {
    // This is a placeholder. Real conversion is Math.pow(1.0001, tick)
    // For mockup, let's use a simpler linear-ish mapping around a central price
    const numTicks = tick / tickSpacing;
    return basePrice * Math.pow(1 + priceChangePerTick * tickSpacing, numTicks / 100); // Reduced impact for wider view
  }, []);

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
    if (width <= 0 || height <= 0) return null;

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

          const sdkToken0 = new Token(chainId, getAddress(token0Def.addressRaw), token0Def.decimals);
          const sdkToken1 = new Token(chainId, getAddress(token1Def.addressRaw), token1Def.decimals);

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
  useEffect(() => {
    const numTickLower = parseInt(tickLower);
    const numTickUpper = parseInt(tickUpper);

    let valForMinInput: number | null = null;
    let valForMaxInput: number | null = null;

    const decimalsForToken0Display = TOKEN_DEFINITIONS[token0Symbol]?.displayDecimals ?? (token0Symbol === 'BTCRL' ? 8 : 4);
    const decimalsForToken1Display = TOKEN_DEFINITIONS[token1Symbol]?.displayDecimals ?? (token1Symbol === 'BTCRL' ? 8 : 4);

    const rawApiPriceAtTickLower = calculatedData?.priceAtTickLower ? parseFloat(calculatedData.priceAtTickLower) : null;
    const rawApiPriceAtTickUpper = calculatedData?.priceAtTickUpper ? parseFloat(calculatedData.priceAtTickUpper) : null;

    // Define token decimals early for use in both branches
    const token0Dec = TOKEN_DEFINITIONS[token0Symbol]?.decimals;
    const token1Dec = TOKEN_DEFINITIONS[token1Symbol]?.decimals;

    if (baseTokenForPriceDisplay === token0Symbol) {
        // UI Displays: Price of Token1 in terms of Token0 (e.g., BTCRL per YUSDC)
        if (token0Dec !== undefined && token1Dec !== undefined) {
            const decimalAdjFactor = Math.pow(10, token1Dec - token0Dec);

            // Min Price (T1 in T0) at numTickLower
            if (rawApiPriceAtTickLower !== null) { // rawApiPriceAtTickLower is Price(T0 per T1)
                if (rawApiPriceAtTickLower === 0) valForMinInput = Infinity;
                else valForMinInput = 1 / rawApiPriceAtTickLower;
        } else if (!isNaN(numTickLower)) {
            if (numTickLower === sdkMinTick) valForMinInput = 0;
                else valForMinInput = Math.pow(1.0001, numTickLower) * decimalAdjFactor;
            } else {
                valForMinInput = NaN;
        }

            // Max Price (T1 in T0) at numTickUpper
            if (rawApiPriceAtTickUpper !== null) { // rawApiPriceAtTickUpper is Price(T0 per T1)
                if (rawApiPriceAtTickUpper === 0) valForMaxInput = Infinity;
                else valForMaxInput = 1 / rawApiPriceAtTickUpper;
        } else if (!isNaN(numTickUpper)) {
            if (numTickUpper === sdkMaxTick) valForMaxInput = Infinity;
                else valForMaxInput = Math.pow(1.0001, numTickUpper) * decimalAdjFactor;
            } else {
                valForMaxInput = NaN;
            }
        } else {
            valForMinInput = NaN;
            valForMaxInput = NaN;
        }
    } else { // baseTokenForPriceDisplay === token1Symbol
        // UI Displays: Price of Token0 in terms of Token1 (e.g., YUSDC per BTCRL)
        if (token0Dec !== undefined && token1Dec !== undefined) {
            const decimalAdjFactor = Math.pow(10, token0Dec - token1Dec);

            // Min Price (T0 in T1) at numTickUpper
            if (rawApiPriceAtTickUpper !== null) { // rawApiPriceAtTickUpper is Price(T0 per T1)
                if (rawApiPriceAtTickUpper === 0) valForMinInput = Infinity;
                else valForMinInput = 1 / (1 / rawApiPriceAtTickUpper); // Price(T0/T1) = 1 / Price(T1/T0) ; P(T1/T0) at TickUpper is rawApiPriceAtTickUpper
            } else if (!isNaN(numTickUpper)) { // Upper tick corresponds to the MIN T0/T1 price
                // P_raw(T1/T0) at numTickUpper = 1.0001^numTickUpper
                // P_raw(T0/T1) at numTickUpper = 1 / (1.0001^numTickUpper) = 1.0001^(-numTickUpper)
                // Price (T0 in T1) = P_raw(T0/T1) * decimalAdjFactor
                if (numTickUpper === sdkMaxTick) valForMinInput = 0; // At T1/T0 price of Inf, T0/T1 price is 0
                else valForMinInput = Math.pow(1.0001, -numTickUpper) * decimalAdjFactor;
            } else {
                valForMinInput = NaN;
            }

            // Max Price (T0 in T1) at numTickLower
            if (rawApiPriceAtTickLower !== null) { // rawApiPriceAtTickLower is Price(T0 per T1)
                 if (rawApiPriceAtTickLower === 0) valForMaxInput = Infinity;
                 else valForMaxInput = 1 / (1 / rawApiPriceAtTickLower); // Price(T0/T1) = 1 / Price(T1/T0) ; P(T1/T0) at TickLower is rawApiPriceAtTickLower
            } else if (!isNaN(numTickLower)) { // Lower tick corresponds to the MAX T0/T1 price
                // P_raw(T1/T0) at numTickLower = 1.0001^numTickLower
                // P_raw(T0/T1) at numTickLower = 1 / (1.0001^numTickLower) = 1.0001^(-numTickLower)
                // Price (T0 in T1) = P_raw(T0/T1) * decimalAdjFactor
                if (numTickLower === sdkMinTick) valForMaxInput = Infinity; // At T1/T0 price of 0, T0/T1 price is Inf
                else valForMaxInput = Math.pow(1.0001, -numTickLower) * decimalAdjFactor;
            } else {
                valForMaxInput = NaN;
            }
        } else {
            valForMinInput = NaN;
            valForMaxInput = NaN;
        }
    }

    // Ensure min < max after all calculations, only if both are finite numbers
    // This check is only logically necessary when displaying Token1/Token0 price.
    // When displaying Token0/Token1 price, the min/max are naturally derived from upper/lower ticks respectively.
    if (baseTokenForPriceDisplay === token0Symbol && valForMinInput !== null && valForMaxInput !== null && isFinite(valForMinInput) && isFinite(valForMaxInput) && valForMinInput > valForMaxInput) {
        [valForMinInput, valForMaxInput] = [valForMaxInput, valForMinInput];
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

    setMinPriceInputString(finalMinPriceString);
    setMaxPriceInputString(finalMaxPriceString);

  }, [tickLower, tickUpper, baseTokenForPriceDisplay, token0Symbol, token1Symbol, sdkMinTick, sdkMaxTick, calculatedData, currentPoolTick]); // Added currentPoolTick to dependencies
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
                setTickLower(newTickLower.toString());
                setTickUpper(newTickUpper.toString());
                setInitialDefaultApplied(true); 
            }
        } else {
             toast.info("Preset Range Too Narrow", { description: "Selected preset results in an invalid range after tick alignment. Try a wider preset or manual range."});
        }
    } else if (activePreset === "Full Range") {
        if (tickLower !== sdkMinTick.toString() || tickUpper !== sdkMaxTick.toString()) {
            setTickLower(sdkMinTick.toString());
            setTickUpper(sdkMaxTick.toString());
            setInitialDefaultApplied(true); 
        }
    }
  }, [currentPrice, currentPoolTick, activePreset, defaultTickSpacing, sdkMinTick, sdkMaxTick, token0Symbol, token1Symbol, tickLower, tickUpper]);

  // --- BEGIN Fetch Liquidity Depth Data ---
  useEffect(() => {
    const fetchLiquidityDepthData = async () => {
      if (!isOpen || !selectedPoolId || !chainId || currentPoolTick === null) {
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
      } finally {
        setIsFetchingLiquidityDepth(false);
        // Ensure toast is dismissed if it wasn't replaced by success/error/info
        if (toast.dismiss && document.querySelector('[data-sonner-toast][data-id="liquidity-depth-fetch"]')) {
            toast.dismiss("liquidity-depth-fetch");
        }
      }
    };

    fetchLiquidityDepthData();
  }, [isOpen, selectedPoolId, chainId, currentPoolTick, token0Symbol, token1Symbol, getDerivedOnChainPoolId]); // Dependencies ensure re-fetch on pool change when modal is open and tick is known
  // --- END Fetch Liquidity Depth Data ---

  // --- BEGIN Process Raw Positions into Token0 Depth Delta Events ---
  useEffect(() => {
    if (
      rawHookPositions && rawHookPositions.length > 0 &&
      currentPoolTick !== null &&
      currentPoolSqrtPriceX96 !== null && // Ensure sqrtPriceX96 is available
      token0Symbol && token1Symbol && chainId &&
      poolToken0 && poolToken1 // Ensure poolToken0 and poolToken1 are available for decimal formatting
    ) {
      const newProcessedPositions: ProcessedPositionDetail[] = [];

      const token0Def = TOKEN_DEFINITIONS[token0Symbol];
      const token1Def = TOKEN_DEFINITIONS[token1Symbol];

      if (!token0Def || !token1Def) {
        setProcessedPositions(null);
        return;
      }

      try {
        const sdkBaseToken0 = new Token(chainId, getAddress(token0Def.addressRaw), token0Def.decimals);
        const sdkBaseToken1 = new Token(chainId, getAddress(token1Def.addressRaw), token1Def.decimals);
        const [sdkSortedToken0, sdkSortedToken1] = sdkBaseToken0.sortsBefore(sdkBaseToken1) 
            ? [sdkBaseToken0, sdkBaseToken1] 
            : [sdkBaseToken1, sdkBaseToken0];

        // Convert currentPoolSqrtPriceX96 string to JSBI for the SDK
        const poolSqrtPriceX96JSBI = JSBI.BigInt(currentPoolSqrtPriceX96);

        const poolForCalculations = new V4PoolSDK(
          sdkSortedToken0,
          sdkSortedToken1,
          V4_POOL_FEE,
          V4_POOL_TICK_SPACING,
          V4_POOL_HOOKS as Hex,
          poolSqrtPriceX96JSBI, 
          JSBI.BigInt(0), // Placeholder liquidity for the pool object
          currentPoolTick
        );

        for (const position of rawHookPositions) {
          // Assuming rawHookPositions are already filtered for the current pool
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
    // Early exit removed, this effect is now active

    if (sortedNetUnifiedValueChanges && sortedNetUnifiedValueChanges.length > 0 && poolToken0) {
      
      let newData: Array<{ tick: number; cumulativeUnifiedValue: number }> = []; // MODIFIED: const to let
      let currentCumulativeValue = 0;

      // Assuming sortedNetUnifiedValueChanges is already sorted by tick
      
      // MODIFIED LOOP LOGIC to generate pairs of points for vertical steps at change ticks
      for (let i = 0; i < sortedNetUnifiedValueChanges.length; i++) {
        const changeEvent = sortedNetUnifiedValueChanges[i];
        const tick = changeEvent.tick;
        const netChange = changeEvent.netUnifiedToken0Change;

        // Only add points if there's a non-zero net change at this tick
        if (netChange !== 0) {
          const cumulativeValueBefore = currentCumulativeValue;
          const cumulativeValueAfter = currentCumulativeValue + netChange;

          // Add a point at the tick with the cumulative value *before* the change
          newData.push({ tick: tick, cumulativeUnifiedValue: cumulativeValueBefore });

          // Add a point at the tick with the cumulative value *after* the change
          newData.push({ tick: tick, cumulativeUnifiedValue: cumulativeValueAfter });

          // Update current cumulative value for the next iteration
          currentCumulativeValue = cumulativeValueAfter;

          // Optional: Log the points added for this tick
          // console.log(`[PlotterDebug] Added points for Tick ${tick}: (${tick}, ${cumulativeValueBefore.toFixed(8)}) -> (${tick}, ${cumulativeValueAfter.toFixed(8)})`);
        }
      }
      
      // --- BEGIN NORMALIZATION ---
      if (newData.length > 0) {
        let minCumulativeValue = newData[0].cumulativeUnifiedValue;
        for (let i = 1; i < newData.length; i++) {
          if (newData[i].cumulativeUnifiedValue < minCumulativeValue) {
            minCumulativeValue = newData[i].cumulativeUnifiedValue;
          }
        }

        // Only normalize if the min value is significantly above a baseline (e.g., 0)
        // or if we want to ensure it always starts at 0 visually.
        // Forcing it to start at 0 visually:
        if (minCumulativeValue !== 0) { // Check if it's not already starting at 0
          newData = newData.map(point => ({
            ...point,
            cumulativeUnifiedValue: point.cumulativeUnifiedValue - minCumulativeValue
          }));
        }
      }
      // --- END NORMALIZATION ---

      const scaledData = newData.map(point => ({
        ...point,
        // Scale down the Y values for display purposes
        displayCumulativeValue: point.cumulativeUnifiedValue * 0.75 // Scaled to 50%
      }));
      setSimplifiedChartPlotData(scaledData);
    } else if (sortedNetUnifiedValueChanges === null || (sortedNetUnifiedValueChanges && sortedNetUnifiedValueChanges.length === 0)) {
      setSimplifiedChartPlotData(null); // Clear if no data or explicitly empty array
    } else if (!poolToken0) {
      console.warn("[AddLiquidityModal] Cannot generate cumulative plot data: poolToken0 invalid.");
      setSimplifiedChartPlotData(null);
    }
  }, [sortedNetUnifiedValueChanges, poolToken0, sdkMinTick]); 
  // --- END Create Simplified Plot Data (Tick vs. Cumulative Unified Value) ---


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
        if (priceStr.trim() === "0") { // Min price of T0 in T1 is 0 => P_t1_t0_upper is effectively infinity
          const newTick = sdkMaxTick;
          if (newTick > parseInt(tickLower)) {
            setTickUpper(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
            toast.error("Invalid Range", { description: "Min price results in a range where max tick <= min tick." });
          }
          return;
        }
        if (isNaN(numericPrice) || numericPrice < 0) return; // Price of T0 in T1 must be >= 0
        if (numericPrice === 0) { /* handled above */ return; }

        const priceToConvert = 1 / numericPrice; // Convert to P_t1_t0_upper
        if (priceToConvert <= 0) { // Should not happen if numericPrice > 0
          toast.info("Price results in invalid tick", { description: "Converted price is non-positive." });
          return;
        }
        let newTick = Math.log(priceToConvert) / Math.log(1.0001);
        newTick = Math.floor(newTick / defaultTickSpacing) * defaultTickSpacing; // Floor for an upper tick
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (newTick > parseInt(tickLower)) {
          setTickUpper(newTick.toString());
          setInitialDefaultApplied(true);
        } else {
          toast.error("Invalid Range", { description: "Min price (when quoted in other token) must result in a max tick greater than min tick." });
        }
      }
    }, 750), 
    [baseTokenForPriceDisplay, token0Symbol, token1Symbol, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper, setTickLower, setTickUpper, setInitialDefaultApplied]
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
        if (isNaN(numericPrice) || numericPrice <= 0) return; // Max price (P_t1_t0) must be > 0

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
         if (isInfinityInput) { // Max price of T0 in T1 is Infinity => P_t1_t0_lower is effectively 0
          const newTick = sdkMinTick;
          if (newTick < parseInt(tickUpper)) {
            setTickLower(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
            toast.error("Invalid Range", { description: "Max price results in a range where min tick >= max tick." });
          }
          return;
        }
        if (isNaN(numericPrice) || numericPrice <= 0) return; // Price of T0 in T1 (max) must be > 0
        
        const priceToConvert = 1 / numericPrice; // Convert to P_t1_t0_lower
        if (priceToConvert <= 0) { // Should not happen if numericPrice > 0
          toast.info("Price results in invalid tick", { description: "Converted price is non-positive." });
          return;
        }
        let newTick = Math.log(priceToConvert) / Math.log(1.0001);
        newTick = Math.ceil(newTick / defaultTickSpacing) * defaultTickSpacing; // Ceil for a lower tick
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (newTick < parseInt(tickUpper)) {
          setTickLower(newTick.toString());
          setInitialDefaultApplied(true);
        } else {
          toast.error("Invalid Range", { description: "Max price (when quoted in other token) must result in a min tick less than max tick." });
        }
      }
    }, 750),
    [baseTokenForPriceDisplay, token0Symbol, token1Symbol, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper, setTickLower, setTickUpper, setInitialDefaultApplied]
  );

  // New handler for signing and submitting Permit2 message
  const { signTypedDataAsync } = useSignTypedData();

  const handleSignAndSubmitPermit2 = async () => {
    if (!permit2SignatureRequest || !accountAddress || !chainId) {
      toast.error("Permit2 Error", { description: "Missing data for Permit2 signature." });
      return;
    }

    setIsWorking(true);
    toast.loading(`Requesting signature for ${permit2SignatureRequest.approvalTokenSymbol}...`, { id: "permit2-sign" });

    try {
      const { domain, types, primaryType, message, permit2Address, approvalTokenSymbol } = permit2SignatureRequest;
      
      // Ensure message values are correctly typed for signing and for contract call
      const typedMessage = {
        details: {
          token: message.details.token as Hex,
          amount: BigInt(message.details.amount), // uint160 -> BigInt
          expiration: Number(message.details.expiration), // uint48 -> Number
          nonce: Number(message.details.nonce), // uint48 -> Number
        },
        spender: message.spender as Hex,
        sigDeadline: BigInt(message.sigDeadline), // uint256 -> BigInt
      };

      const signature = await signTypedDataAsync({
        domain,
        types,
        primaryType,
        message: typedMessage, // Use the structured message with BigInts
        account: accountAddress,
      });

      toast.dismiss("permit2-sign");
      toast.loading(`Submitting Permit2 for ${approvalTokenSymbol}...`, { id: "permit2-submit" });

      if (!permit2WriteContractAsync) {
        throw new Error ("Permit2 write function not available.");
      }

      await permit2WriteContractAsync({
        address: permit2Address,
        abi: PERMIT2_PERMIT_ABI_MINIMAL, // Pass the full ABI array
        functionName: 'permit',
        args: [
          accountAddress, // owner
          typedMessage,   // permitSingle (already structured correctly for ABI)
          signature       // signature
        ],
        account: accountAddress,
        chain: baseSepolia, // Ensure chain is specified if not default
      });
      // Success will be handled by the useEffect watching isPermit2Confirmed

    } catch (err: any) {
      toast.dismiss("permit2-sign");
      toast.dismiss("permit2-submit");
      let detailedErrorMessage = "Permit2 operation failed.";
      if (err instanceof Error) {
        detailedErrorMessage = err.message;
        if ((err as any).shortMessage) { detailedErrorMessage = (err as any).shortMessage; }
      }
      toast.error("Permit2 Error", { description: detailedErrorMessage });
      setIsWorking(false);
      // Optionally reset to 'input' or allow retry of signing
      // setStep('input'); 
      // setPermit2SignatureRequest(null);
    }
  };

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

      if (token0Def && token1Def && typeof currentTick === 'number') {
        const t0Dec = token0Def.decimals;
        const t1Dec = token1Def.decimals;
        let price = NaN;
        let quoteTokenSymbol = "";
        let priceOfTokenSymbol = "";

        // Determine if the pool's canonical token0 (poolToken0Symbol) matches the modal's token0Symbol (token0)
        // This is to correctly interpret the tick direction for price calculation.
        // The tick value from the chart (currentTick) is always for price of pool's token1 in terms of pool's token0.
        const isPoolToken0MatchingModalToken0 = TOKEN_DEFINITIONS[poolToken0Symbol as TokenSymbol]?.addressRaw.toLowerCase() === token0Def.addressRaw.toLowerCase();

        let actualTickForCalc = currentTick;
        // If the modal's token0 is NOT the pool's token0, then the relationship is flipped.
        // However, the 'tick' from the chart data *should* already be the canonical tick.
        // The price formula Math.pow(1.0001, tick) gives price of T1 in T0 (where T0, T1 are sorted pool tokens)

        if (baseTokenForPrice === token0) { // User wants to see Price of Token1 (modal's token1) in terms of Token0 (modal's token0)
          quoteTokenSymbol = token0;
          priceOfTokenSymbol = token1;
          const decimalAdjFactor = Math.pow(10, t1Dec - t0Dec);
          if (isPoolToken0MatchingModalToken0) {
            // ModalT0 is PoolT0, ModalT1 is PoolT1. Tick directly gives P(PoolT1/PoolT0)
            price = Math.pow(1.0001, actualTickForCalc) * decimalAdjFactor;
          } else {
            // ModalT0 is PoolT1, ModalT1 is PoolT0. Tick gives P(PoolT0/PoolT1) effectively.
            // We want P(ModalT1/ModalT0) = P(PoolT0/PoolT1)
            price = Math.pow(1.0001, actualTickForCalc) * Math.pow(10, t0Dec - t1Dec); // This is P_poolT0_per_poolT1
          }
        } else { // User wants to see Price of Token0 (modal's token0) in terms of Token1 (modal's token1)
          quoteTokenSymbol = token1;
          priceOfTokenSymbol = token0;
          const decimalAdjFactor = Math.pow(10, t0Dec - t1Dec);
          if (isPoolToken0MatchingModalToken0) {
            // ModalT0 is PoolT0, ModalT1 is PoolT1. Tick gives P(PoolT1/PoolT0).
            // We want P(ModalT0/ModalT1) = 1 / P(PoolT1/PoolT0)
            price = (1 / Math.pow(1.0001, actualTickForCalc)) * decimalAdjFactor;
          } else {
            // ModalT0 is PoolT1, ModalT1 is PoolT0. Tick gives P(PoolT0/PoolT1) effectively.
            // We want P(ModalT0/ModalT1) = P(PoolT1/PoolT0)
            price = Math.pow(1.0001, actualTickForCalc) * Math.pow(10, t1Dec - t0Dec); // This is P_poolT1_per_poolT0
          }
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
            "sm:max-w-4xl"
          )}
        >
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
                            // Set the active preset. The useEffect watching [currentPrice, activePreset] will handle tick changes.
                            // Removed the conditional toast based on currentPrice/currentPoolTick as the useEffect handles it.
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
                    {isPoolStateLoading ? (
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
                    ) : null}
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart 
                        data={simplifiedChartPlotData || []} 
                        margin={{ top: 2, right: 5, bottom: 5, left: 5 }} // Reduced right margin to match left
                        onMouseDown={handlePanMouseDown}
                        onMouseMove={handlePanMouseMove}
                        onMouseUp={handlePanMouseUpOrLeave}
                        onMouseLeave={handlePanMouseUpOrLeave}
                      >
                        {/* <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} /> */}
                        <XAxis 
                          dataKey="tick" 
                          type="number" 
                          domain={xDomain} 
                          allowDataOverflow 
                          // tick={{ fontSize: 10, dy: 7 }} // Remove default tick styling, dy was for pushing down
                          tick={false} // Hide default Recharts ticks and labels
                          axisLine={false} // Hide X-axis line
                          // tickFormatter={(value) => value.toLocaleString(undefined, {minimumFractionDigits: 0})} // Formatter will be used in custom div
                          height={1} // Minimize height as it's now invisible
                          tickMargin={0} 
                        >
                           {/* <RechartsChartLabel 
                            offset={-15} 
                            position="insideBottom" 
                            fontSize={10}
                            fill="#a1a1aa"
                          >
                            Tick
                          </RechartsChartLabel> */}
                        </XAxis>
                        
                        <YAxis 
                          hide={true} // Hide the Y-axis
                          yAxisId="leftCumulativeUnifiedValueAxis" 
                          orientation="left"
                          dataKey="cumulativeUnifiedValue" 
                          type="number"
                          allowDecimals={true}
                          tick={{ fontSize: 10 }}
                          tickFormatter={(value) => value.toLocaleString(undefined, {maximumFractionDigits: 2, minimumFractionDigits: 2})} 
                          axisLine={{ stroke: "#a1a1aa", strokeOpacity: 0.5 }}
                          tickLine={{ stroke: "#a1a1aa", strokeOpacity: 0.5 }}
                        >
                          {/* <RechartsChartLabel 
                            angle={-90} 
                            position="insideLeft" 
                            style={{ textAnchor: 'middle', fontSize: 10, fill:'#a1a1aa' }}
                          >
                            {poolToken0 ? `Cumulative Liquidity (in ${poolToken0.symbol})` : "Cumulative Unified Liquidity"}
                          </RechartsChartLabel> */}
                        </YAxis>

                        {/* Hidden Y-Axis for any other reference lines if needed, not directly used by main data now */}
                        <YAxis hide={true} yAxisId="rightHiddenMiscAxis" /> 
                        
                        {simplifiedChartPlotData && simplifiedChartPlotData.length > 0 && (
                          <Area 
                            type="stepBefore" 
                            dataKey="displayCumulativeValue" // Use the scaled value
                            yAxisId="leftCumulativeUnifiedValueAxis" // Changed YAxis ID
                            name={poolToken0 ? `Cumulative Liquidity (in ${poolToken0.symbol})` : "Cumulative Unified Liquidity"} // Updated Name
                            stroke="hsl(var(--chart-2))" 
                            fill="hsl(var(--chart-2))"   
                            fillOpacity={0.2}
                            strokeWidth={1.5}
                          />
                        )}
                        
                        {currentPoolTick !== null && (
                          <ReferenceLine 
                            x={currentPoolTick} 
                            stroke="#e85102" // Orange color for current tick line
                            strokeWidth={1.5} 
                            ifOverflow="extendDomain" // Ensures the line is visible even if currentPoolTick is outside the initial xDomain
                            yAxisId="leftCumulativeUnifiedValueAxis" // Associate with an axis, even if hidden for rendering
                          />
                        )}
                        
                        {/* ReferenceArea and ReferenceLine are based on PRICE, which is not the X-axis now. Temporarily disable them. */}
                        {/* {mockSelectedPriceRange && mockSelectedPriceRange[0] < mockSelectedPriceRange[1] && (
                           <ReferenceArea 
                             x1={mockSelectedPriceRange[0]} 
                             x2={mockSelectedPriceRange[1]} 
                             yAxisId="rightHiddenMiscAxis" 
                             strokeOpacity={0} 
                             fill="#e85102" 
                             fillOpacity={0.25} 
                             ifOverflow="hidden"
                             shape={<RoundedTopReferenceArea />}
                           />
                        )} 
                        
                        {currentPriceLine !== null && (
                          <ReferenceLine 
                            x={currentPriceLine} 
                            stroke="#e85102" 
                            strokeWidth={1.5} 
                            ifOverflow="extendDomain" 
                            yAxisId="rightHiddenMiscAxis" 
                          />
                        )} */}
                        {/* ReferenceArea based on selected Ticks */}
                        {isOpen && !isPoolStateLoading && parseInt(tickLower) < parseInt(tickUpper) && isFinite(parseInt(tickLower)) && isFinite(parseInt(tickUpper)) && (
                          <ReferenceArea 
                            x1={parseInt(tickLower)} 
                            x2={parseInt(tickUpper)} 
                            yAxisId="leftCumulativeUnifiedValueAxis" // Should use the same YAxis as the main data
                            strokeOpacity={0} 
                            fill="#e85102" 
                            fillOpacity={0.25} 
                            ifOverflow="extendDomain" // Use extendDomain to ensure visibility if range is outside initial xDomain
                            shape={<RoundedTopReferenceArea />} // Assuming this shape is still desired
                          />
                        )}
                        
                        {currentPoolTick !== null && (
                          <ReferenceLine 
                            x={currentPoolTick} 
                            stroke="#e85102" 
                            strokeWidth={1.5} 
                            ifOverflow="extendDomain" 
                            yAxisId="leftCumulativeUnifiedValueAxis" // Associate with an axis, even if hidden for rendering
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                    {/* Graph Controls Overlay - only show if chart is active. Zoom/Pan might need tick-based logic. */}
                    {/* {!isPoolStateLoading && currentPriceLine !== null && ( ... )} */}
                    
                  </div>
                  {/* --- END Recharts Graph --- */}

                  {/* --- BEGIN Custom X-Axis Labels Div --- */}
                  <div className="flex justify-between w-full px-[5px] box-border !mt-1"> {/* Match chart right/left margin approx. */}
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
                        {isPoolStateLoading ? (
                          <div className="h-4 w-40 bg-muted/40 rounded animate-pulse"></div>
                        ) : currentPrice && !isCalculating ? (
                          baseTokenForPriceDisplay === token0Symbol ? (
                            // User wants to see: "1 [Token1] = X [Token0]"
                            // currentPrice is Price of T0 in T1 (e.g., YUSDC per BTCRL)
                            // So, to get Price of T1 in T0, we need 1 / currentPrice
                            `1 ${token1Symbol} = ${(1 / parseFloat(currentPrice)).toLocaleString(undefined, { 
                              minimumFractionDigits: TOKEN_DEFINITIONS[token0Symbol]?.displayDecimals || 2, 
                              maximumFractionDigits: TOKEN_DEFINITIONS[token0Symbol]?.displayDecimals || (token0Symbol === 'BTCRL' || token0Symbol === 'YUSDC' ? 4 : 5) // Increased max for precision
                            })} ${token0Symbol}`
                          ) : (
                            // User wants to see: "1 [Token0] = Y [Token1]"
                            // currentPrice is Price of T0 in T1 (e.g., YUSDC per BTCRL)
                            // This is already the value we need.
                            `1 ${token0Symbol} = ${parseFloat(currentPrice).toLocaleString(undefined, { 
                              minimumFractionDigits: TOKEN_DEFINITIONS[token1Symbol]?.displayDecimals || (token1Symbol === 'BTCRL' || token1Symbol === 'YUSDC' ? 6 : 4), // Adjusted min for small values
                              maximumFractionDigits: TOKEN_DEFINITIONS[token1Symbol]?.displayDecimals || (token1Symbol === 'BTCRL' || token1Symbol === 'YUSDC' ? 8 : 5) // Increased max for precision
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
                </CardContent>
              </Card>
            </div>

            <div className="w-full md:w-1/2 flex flex-col space-y-3">
              <Card className="w-full card-gradient border-0 shadow-none flex-grow">
                <CardContent className="px-4 pt-4 pb-4">
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <Label htmlFor="amount0" className="text-sm font-medium">Amount</Label>
                         <div className="flex items-center gap-1">
                           <Button variant="ghost" className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" onClick={() => handleUseFullBalance(token0BalanceData?.formatted || "0", token0Symbol, true)} disabled={isWorking || isCalculating}>  
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
                                  onChange={(e) => { setAmount0(e.target.value); setActiveInputSide('amount0'); }} 
                                  type="number"
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
                           <Button variant="ghost" className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" onClick={() => handleUseFullBalance(token1BalanceData?.formatted || "0", token1Symbol, false)} disabled={isWorking || isCalculating}> 
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
                                onChange={(e) => { setAmount1(e.target.value); setActiveInputSide('amount1'); }} 
                                type="number"
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
                              { (step === 'approve' && (isApproveWritePending || isApproving)) || (step === 'permit2Sign' && (isPermit2SendPending || isPermit2Confirming)) 
                                ? <RefreshCwIcon className="h-4 w-4 animate-spin" />
                                : Object.values(tokenApprovalStatus).filter(Boolean).length >= tokensRequiringApproval && tokensRequiringApproval > 0 
                                  ? <CheckIcon className="h-4 w-4 text-green-500" />
                                  : step === 'approve' || step === 'permit2Sign' || (preparedTxData?.approvalType === 'ERC20_TO_PERMIT2') || (preparedTxData?.approvalType === 'PERMIT2_SIGNATURE_FOR_PM')
                                    ? <span className="text-xs font-mono">{`${Object.values(tokenApprovalStatus).filter(Boolean).length}/${tokensRequiringApproval > 0 ? tokensRequiringApproval : '-'}`}</span>
                                    : tokensRequiringApproval === 0 // No amounts entered
                                      ? <MinusIcon className="h-4 w-4" />
                                      : <span className="text-xs font-mono">{`0/${tokensRequiringApproval > 0 ? tokensRequiringApproval : '-'}`}</span>
                              }
                            </span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span>Send Mint Transaction</span> 
                            <span>
                                {isMintConfirming || isMintSendPending ? 
                                  <ActivityIcon className="h-4 w-4 animate-pulse text-muted-foreground" />
                                 : isMintConfirmed ? <CheckIcon className="h-4 w-4 text-green-500" /> 
                                 : <MinusIcon className="h-4 w-4" />}
                            </span>
                        </div>
                    </div>
                  </div>
                  <DialogFooter className="grid grid-cols-2 gap-3 mt-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (step === 'approve' || step === 'mint' || step === 'permit2Sign') { // Added permit2Sign
                          resetInternalTxState(); 
                        } else {
                          onOpenChange(false);
                        }
                      }}
                      disabled={isCalculating || 
                                (step ==='approve' && (isApproveWritePending || isApproving)) || 
                                (step === 'permit2Sign' && (isPermit2SendPending || isPermit2Confirming)) || // Ensured isPermit2Confirming is checked
                                (step ==='mint' && (isMintSendPending || isMintConfirming))}
                      className="border-slate-300 bg-slate-100 hover:bg-slate-200 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 disabled:opacity-50"
                    >
                      {step === 'approve' || step === 'mint' || step === 'permit2Sign' ? 'Cancel & Edit' : 'Change Pool'}
                    </Button>
                    <Button
                      onClick={() => {
                        if (step === 'input') handlePrepareMint(false);
                        else if (step === 'approve') handleApprove();
                        else if (step === 'permit2Sign') handleSignAndSubmitPermit2(); 
                        else if (step === 'mint') handleMint();
                      }}
                      disabled={isWorking || // Re-checked this whole block
                        isCalculating ||
                        isPoolStateLoading || 
                        isApproveWritePending ||
                        isPermit2SendPending || 
                        isMintSendPending || // Ensured isMintSendPending is checked
                        (step === 'input' && ((!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) || !calculatedData))
                      }
                    >
                      {isPoolStateLoading ? 'Loading Pool...' 
                        : step === 'input' ? 'Deposit' 
                        : step === 'approve' ? `Approve ${preparedTxData?.approvalTokenSymbol || 'Token'} for Permit2` 
                        : step === 'permit2Sign' ? `Sign for ${permit2SignatureRequest?.approvalTokenSymbol || 'Token'} via Permit2`
                        : step === 'mint' ? 'Confirm Mint' 
                        : 'Processing...' 
                      }
                    </Button>
                  </DialogFooter>
                </CardContent>
              </Card>
            </div>
          </div>
        </RadixDialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
} 