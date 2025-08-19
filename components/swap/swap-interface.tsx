"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import {
  ArrowDownIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  SettingsIcon,
  SlashIcon,
  CheckIcon,
  ArrowRightIcon,
  FileTextIcon,
  ExternalLinkIcon,
  ActivityIcon,
  PenIcon,
  WalletIcon,
  MinusIcon,
  CoinsIcon,
  InfoIcon,
  XIcon,
} from "lucide-react"
import Image from "next/image"
import { useAccount, useBalance, useSignTypedData, useWriteContract, useWaitForTransactionReceipt } from "wagmi"
import { motion, AnimatePresence } from "framer-motion"
import React from "react"
import { switchChain } from '@wagmi/core'
import { config, baseSepolia } from "../../lib/wagmiConfig";
import { toast } from "sonner";
import { getAddress, parseUnits, type Address, type Hex } from "viem"
import { publicClient } from "../../lib/viemClient";
import { useIsMobile } from "@/hooks/use-is-mobile";

import {
  getAllTokens,
  getToken,
  createTokenSDK,
  TokenSymbol,
  TOKEN_DEFINITIONS,
  CHAIN_ID
} from "@/lib/pools-config"
import {
  PERMIT2_ADDRESS,
  UNIVERSAL_ROUTER_ADDRESS,
  UniversalRouterAbi,
  Erc20AbiDefinition,
  PERMIT_TYPES,
  getPermit2Domain,
} from "@/lib/swap-constants"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// Modal Imports
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";

// Chart Import
import { DynamicFeeChart, generateMockFeeHistory } from "../dynamic-fee-chart";
import { DynamicFeeChartPreview } from "../dynamic-fee-chart-preview";
import { PulsatingDot } from "../pulsating-dot";
import { getFromCache, setToCache, getPoolDynamicFeeCacheKey } from "@/lib/client-cache";
import { getPoolByTokens } from "@/lib/pools-config";
import { findBestRoute, SwapRoute, PoolHop } from "@/lib/routing-engine";

// Import the new view components
import { SwapInputView } from './SwapInputView';
import { SwapReviewView } from './SwapReviewView';
import { SwapSuccessView } from './SwapSuccessView';

// Define FeeHistoryPoint interface if not already defined/imported (it's defined in dynamic-fee-chart.tsx but not exported from there for direct use here yet)
// For now, let's assume we can use 'any' or define a local version for the state type if direct import is an issue.
interface FeeHistoryPoint {
  timeLabel: string;
  volumeTvlRatio: number;
  emaRatio: number;
  dynamicFee: number;
}

const TARGET_CHAIN_ID = baseSepolia.id; // Changed from 1301 to baseSepolia.id
const MaxUint160 = BigInt('0xffffffffffffffffffffffffffffffffffffffff'); // 2**160 - 1

// Helper function to get price mapping for tokens
const getTokenPriceMapping = (tokenSymbol: string): 'BTC' | 'USDC' | 'ETH' => {
  // Map our tokens to coingecko price types
  switch (tokenSymbol) {
    case 'aBTC':
      return 'BTC';
    case 'aUSDC':
    case 'aUSDT':
      return 'USDC'; // Using USDC price for all USD stablecoins
    case 'aETH':
    case 'ETH':
      return 'ETH';
    default:
      return 'USDC'; // Default fallback
  }
};

// Helper function to create Token instances from pools config
const createTokenFromConfig = (tokenSymbol: string, prices: { BTC: number; USDC: number; ETH?: number } = { BTC: 77000, USDC: 1, ETH: 3500 }): Token | null => {
  const tokenConfig = getToken(tokenSymbol);
  if (!tokenConfig) return null;
  
  const priceType = getTokenPriceMapping(tokenSymbol);
  const usdPrice = prices[priceType] || 1;
  
  // Ensure displayDecimals has a proper fallback
      const displayDecimals = tokenConfig.displayDecimals ?? (tokenSymbol === 'aBTC' ? 8 : 4);
  
  return {
    address: tokenConfig.address as Address,
    symbol: tokenConfig.symbol,
    name: tokenConfig.name,
    decimals: tokenConfig.decimals,
    displayDecimals: displayDecimals,
    balance: "0.000",
    value: "$0.00",
    icon: tokenConfig.icon,
    usdPrice: usdPrice,
  };
};

// Get available tokens for swap
const getAvailableTokens = (prices?: { BTC: number; USDC: number; ETH?: number }): Token[] => {
  const allTokens = getAllTokens();
  return Object.keys(allTokens)
    .map(symbol => createTokenFromConfig(symbol, prices))
    .filter(Boolean) as Token[];
};

// Enhanced Token interface
export interface Token {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  displayDecimals: number; // Add displayDecimals for proper formatting
  balance: string; // Fetched balance, formatted string
  value: string;   // USD value based on fetched balance and usdPrice, formatted string "$X.YZ"
  icon: string;
  usdPrice: number; // Fixed USD price
}

    // Initialize default tokens (aUSDC and aUSDT as defaults)
const getInitialTokens = (prices?: { BTC: number; USDC: number; ETH: number }) => {
  const availableTokens = getAvailableTokens(prices);
  const defaultFrom = availableTokens.find(t => t.symbol === 'aUSDC') || availableTokens[0];
  const defaultTo = availableTokens.find(t => t.symbol === 'aUSDT') || availableTokens[1];
  
  return { defaultFrom, defaultTo, availableTokens };
};

// Enhanced swap flow states
type SwapState = "input" | "review" | "swapping" | "success" | "error";

// Detailed swap progress states
export type SwapProgressState = "init" | "checking_allowance" | "needs_approval" | "approving" | "waiting_approval" | "approval_complete" | "needs_signature" | "signing_permit" | "signature_complete" | "building_tx" | "executing_swap" | "waiting_confirmation" | "complete" | "error" | "ready_to_swap";

// Transaction information for success state
export interface SwapTxInfo {
  hash: string;
  fromAmount: string;
  fromSymbol: string;
  toAmount: string;
  toSymbol: string;
  explorerUrl: string;
}

// Interface for Fee Details
export interface FeeDetail {
  name: string;
  value: string;
  type: "percentage" | "usd";
}

// Inline SVG Icon components for toasts
const SuccessToastIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-80">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3ZM19.5 12C19.5 16.1421 16.1421 19.5 12 19.5C7.85786 19.5 4.5 16.1421 4.5 12C4.5 7.85786 7.85786 4.5 12 4.5C16.9706 4.5 19.5 7.85786 19.5 12ZM11.1464 15.8536L16.0964 10.9036L15.0358 9.84298L11.1464 13.7324L8.96421 11.5503L7.90355 12.6109L11.1464 15.8536Z" fill="#6ed246"/>
  </svg>
);

const WarningToastIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-80">
    <path fillRule="evenodd" clipRule="evenodd" d="M19.5 12C19.5 16.1421 16.1421 19.5 12 19.5C7.85786 19.5 4.5 16.1421 4.5 12C4.5 7.85786 7.85786 4.5 12 4.5C16.9706 4.5 19.5 7.85786 19.5 12ZM21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12ZM11.25 13.5V8.25H12.75V13.5H11.25ZM11.25 15.75V14.25H12.75V15.75H11.25Z" fill="#e94c4c"/>
  </svg>
);

// ADDED: Info Toast Icon
const InfoToastIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-80">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3ZM19.5 12C19.5 16.1421 16.1421 19.5 12 19.5C7.85786 19.5 4.5 16.1421 4.5 12C4.5 7.85786 7.85786 4.5 12 4.5C16.9706 4.5 19.5 7.85786 19.5 12ZM11.25 13.5V8.25H12.75V13.5H11.25ZM11.25 15.75V14.25H12.75V15.75H11.25Z" fill="#f2d769"/> {/* Yellow color */}
  </svg>
);

// Interface for OutlineArcIcon props
export interface OutlineArcIconProps {
  actualPercentage: number;
  steppedPercentage: number;
  hoverPercentage?: number | null;
  isOverLimit?: boolean; // ADDED: To indicate actualPercentage > 100%
  size?: number;
  className?: string;
}

// OutlineArcIcon component definition
export function OutlineArcIcon({ actualPercentage, steppedPercentage, hoverPercentage, isOverLimit, size = 16, className }: OutlineArcIconProps) {
  const r = 6; const cx = 8; const cy = 8; const strokeWidth = 2; // INCREASED strokeWidth
  const clampedActualPercentageForDisplay = Math.max(0, Math.min(100, actualPercentage));
  const angleStartOffset = -Math.PI / 2;

  const actualIsAStepValue = [0, 25, 50, 75, 100].includes(clampedActualPercentageForDisplay);
  const isTrulyManualInputMode = clampedActualPercentageForDisplay > 0 && !actualIsAStepValue;

  let displayPercentage: number;
  let displayMode: 'over_limit' | 'hover' | 'manual_arc' | 'step_slice_or_line';

  if (isOverLimit) {
    displayMode = 'over_limit';
    displayPercentage = 100;
  } else if (hoverPercentage != null) {
    displayMode = 'hover';
    displayPercentage = Math.max(0, Math.min(100, hoverPercentage));
  } else if (isTrulyManualInputMode) {
    displayMode = 'manual_arc';
    displayPercentage = clampedActualPercentageForDisplay;
  } else {
    displayMode = 'step_slice_or_line';
    if (actualIsAStepValue) {
      displayPercentage = clampedActualPercentageForDisplay;
    } else {
      displayPercentage = steppedPercentage;
    }
  }
  
  let manualArcPathData = "";
  if (displayMode === 'manual_arc') {
    const arcAmount = Math.max(1, displayPercentage);
    const angleEndManual = angleStartOffset + (arcAmount / 100) * (2 * Math.PI);
    const startXManual = cx + r * Math.cos(angleStartOffset);
    const startYManual = cy + r * Math.sin(angleStartOffset);
    const endXManual = cx + r * Math.cos(angleEndManual);
    const endYManual = cy + r * Math.sin(angleEndManual);
    const largeArcFlagManual = arcAmount >= 50 ? 1 : 0;
    manualArcPathData = `M ${startXManual},${startYManual} A ${r},${r} 0 ${largeArcFlagManual} 1 ${endXManual},${endYManual}`;
  }

  const verticalLinePath = `M ${cx},${cy - r} L ${cx},${cy + r}`;
  const getPieSlicePath = (percentageToDraw: number): string => {
    if (percentageToDraw <= 0 || percentageToDraw >= 100) return "";
    const angleEnd = angleStartOffset + (percentageToDraw / 100) * (2 * Math.PI);
    const startX = cx + r * Math.cos(angleStartOffset);
    const startY = cy + r * Math.sin(angleStartOffset);
    const endX = cx + r * Math.cos(angleEnd);
    const endY = cy + r * Math.sin(angleEnd);
    const largeArcFlag = percentageToDraw >= 50 ? 1 : 0;
    return `M ${cx},${cy} L ${startX},${startY} A ${r},${r} 0 ${largeArcFlag} 1 ${endX},${endY} Z`;
  };

  const errorRedColor = "#e94c4c";
  const darkerMutedGray = "#575757"; // UPDATED to #575757

  const baseCircleStroke = 
    displayMode === 'over_limit' ? errorRedColor :
    ((displayMode === 'step_slice_or_line' || displayMode === 'hover') && displayPercentage === 100) ? 'currentColor' :
    darkerMutedGray; // UPDATED to darker gray

  let verticalLineStroke = darkerMutedGray; // UPDATED to darker gray as default
  if (displayMode === 'over_limit') {
    verticalLineStroke = errorRedColor;
  } else if ((displayMode === 'step_slice_or_line' || displayMode === 'hover') && (displayPercentage === 0 || displayPercentage === 100)) {
    // For 100%, it's currentColor (white). For 0%, it remains darkerMutedGray.
    verticalLineStroke = displayPercentage === 100 ? 'currentColor' : darkerMutedGray;
  }
  
  const mainPathStroke = displayMode === 'over_limit' ? errorRedColor : 'currentColor';
  const displayOpacity = 1;

  // Determine if the manual arc should be rendered as a pie slice
  const shouldManualArcBePieSlice =
    displayMode === 'manual_arc' &&
    clampedActualPercentageForDisplay > 20 &&
    clampedActualPercentageForDisplay < 80;

  return (
    <svg width={size} height={size} viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" className={className}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={baseCircleStroke} strokeWidth={strokeWidth} strokeOpacity={displayOpacity} />

      {displayMode === 'manual_arc' ? (
        shouldManualArcBePieSlice ? (
          // Render manual arc as a pie slice if condition met
          clampedActualPercentageForDisplay > 0 && clampedActualPercentageForDisplay < 100 && // Guard for getPieSlicePath
          <path
            d={getPieSlicePath(clampedActualPercentageForDisplay)}
            fill="none"
            stroke={mainPathStroke} // Use mainPathStroke for consistency
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            opacity={displayOpacity}
          />
        ) : (
          // Original manual arc rendering (open arc)
          manualArcPathData && <path d={manualArcPathData} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" opacity={displayOpacity} />
        )
      ) : (displayMode === 'step_slice_or_line' || displayMode === 'hover' || displayMode === 'over_limit') ? (
        <>
          {(displayPercentage === 0 || displayPercentage === 100) ? (
            <path 
              key={`${displayMode}-line-${displayPercentage}`} // Updated key
              d={verticalLinePath} 
              stroke={verticalLineStroke} // CORRECTED: Use new variable
              fill="none" 
              strokeWidth={strokeWidth} 
              strokeLinecap="round" 
              opacity={displayOpacity} 
            />
          ) : (
            displayPercentage > 0 && ( // CORRECTED: Use displayPercentage
              <path 
                key={`${displayMode}-slice-${displayPercentage}`} // Updated key
                d={getPieSlicePath(displayPercentage)} 
                fill="none" 
                stroke={mainPathStroke} // CORRECTED: Use new variable (though often currentColor)
                strokeWidth={strokeWidth} 
                strokeLinejoin="round" 
                opacity={displayOpacity} 
              />
            )
          )}
        </>
      ) : null}
    </svg>
  );
}

// NEW: Define props for SwapInterface
export interface SwapInterfaceProps {
  currentRoute: SwapRoute | null;
  setCurrentRoute: React.Dispatch<React.SetStateAction<SwapRoute | null>>;
  selectedPoolIndexForChart: number;
  setSelectedPoolIndexForChart: React.Dispatch<React.SetStateAction<number>>;
  handleSelectPoolForChart: (poolIndex: number) => void;
}

export function SwapInterface({ currentRoute, setCurrentRoute, selectedPoolIndexForChart, setSelectedPoolIndexForChart, handleSelectPoolForChart }: SwapInterfaceProps) {
  // Mobile check for responsive behaviors
  const isMobile = useIsMobile();
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);
  // Removed route-row hover logic; arrows only show on preview hover
  
  const [swapState, setSwapState] = useState<SwapState>("input");
  const [swapProgressState, setSwapProgressState] = useState<SwapProgressState>("init");
  const [isSwapping, setIsSwapping] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<SwapProgressState[]>([]);
  const [isAttemptingSwitch, setIsAttemptingSwitch] = useState(false);
  const [isWrongNetworkToastActive, setIsWrongNetworkToastActive] = useState(false);
  const wrongNetworkToastIdRef = useRef<string | number | undefined>(undefined);
  const swapTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [isSellInputFocused, setIsSellInputFocused] = useState(false);
  
  // V4 Quoter states
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [routeInfo, setRouteInfo] = useState<{
    path: string[];
    hops: number;
    isDirectRoute: boolean;
    pools: string[];
  } | null>(null);

  // Initialize tokens dynamically - will update with real prices later
  const initialTokenData = getInitialTokens();

  // Tokens for swap (with token data stored in state)
  const [fromToken, setFromToken] = useState<Token>(initialTokenData.defaultFrom);
  const [toToken, setToToken] = useState<Token>(initialTokenData.defaultTo);
  const [tokenList, setTokenList] = useState<Token[]>(initialTokenData.availableTokens);
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");

  const [swapTxInfo, setSwapTxInfo] = useState<SwapTxInfo | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);

  // State for historical fee data
  const [feeHistoryData, setFeeHistoryData] = useState<FeeHistoryPoint[]>([]);
  const [isFeeHistoryLoading, setIsFeeHistoryLoading] = useState(false);
  const [feeHistoryError, setFeeHistoryError] = useState<string | null>(null);
  const [isFeeChartModalOpen, setIsFeeChartModalOpen] = useState(false); // New state for modal
  const isFetchingFeeHistoryRef = useRef(false); // Prevent duplicate API calls
  // Chart stability tracking no longer needed with simple rect approach

  const [currentPermitDetailsForSign, setCurrentPermitDetailsForSign] = useState<any | null>(null);
  const [obtainedSignature, setObtainedSignature] = useState<Hex | null>(null);

  const [selectedPercentageIndex, setSelectedPercentageIndex] = useState(-1);
  const cyclePercentages = [25, 50, 75, 100];
  const [hoveredArcPercentage, setHoveredArcPercentage] = useState<number | null>(null);

  const { address: accountAddress, isConnected, chainId: currentChainId } = useAccount();

  // Add state for dynamic fee
  const [dynamicFeeBps, setDynamicFeeBps] = useState<number | null>(null);
  const [dynamicFeeLoading, setDynamicFeeLoading] = useState<boolean>(false);
  const [dynamicFeeError, setDynamicFeeError] = useState<string | null>(null);
  const isFetchingDynamicFeeRef = useRef(false);
  
  // REMOVED: State for multi-hop routing and fees (now passed as props)
  // const [currentRoute, setCurrentRoute] = useState<SwapRoute | null>(null);
  const [routeFees, setRouteFees] = useState<Array<{ poolName: string; fee: number }>>([]);
  const [routeFeesLoading, setRouteFeesLoading] = useState<boolean>(false);
  // REMOVED: const [selectedPoolIndexForChart, setSelectedPoolIndexForChart] = useState<number>(0); // Track which pool's chart to show

  // REMOVED: Handler for selecting which pool's fee chart to display (now passed as prop)
  // const handleSelectPoolForChart = useCallback((poolIndex: number) => {
  //   if (currentRoute && poolIndex >= 0 && poolIndex < currentRoute.pools.length) {
  //     setSelectedPoolIndexForChart(poolIndex);
  //   }
  // }, [currentRoute]);

  // Add necessary hooks for swap execution
  const { signTypedDataAsync } = useSignTypedData();
  const { data: swapTxHash, writeContractAsync: sendSwapTx, isPending: isSwapTxPending, error: swapTxError } = useWriteContract();
  const { data: approvalTxHash, writeContractAsync: sendApprovalTx, isPending: isApprovalTxPending, error: approvalTxError } = useWriteContract();
  
  const { isLoading: isConfirmingSwap, isSuccess: isSwapConfirmed, error: swapConfirmError } = 
    useWaitForTransactionReceipt({ hash: swapTxHash });
  const { isLoading: isConfirmingApproval, isSuccess: isApprovalConfirmed, error: approvalConfirmError } = 
    useWaitForTransactionReceipt({ hash: approvalTxHash });

  // Simplified calculatedValues - primarily for display consistency
  const [calculatedValues, setCalculatedValues] = useState<{
    fromTokenAmount: string;
    fromTokenValue: string;
    toTokenAmount: string;
    toTokenValue: string;
    fees: FeeDetail[]; // UPDATED to use FeeDetail[]
    slippage: string;
    minimumReceived: string;
  }>({
    fromTokenAmount: "0",
    fromTokenValue: "$0.00",
    toTokenAmount: "0",
    toTokenValue: "$0.00",
    fees: [
      { name: "Fee", value: "N/A", type: "percentage" }, // Initial value updated
    ],
    slippage: "0.5%",
    minimumReceived: "0",
  });

  const [slippage, setSlippage] = useState(0.5); // New state for slippage percentage

  // Mock data generation removed - using real API data instead

  // New function for route calculation that can be called independently
  const calculateRoute = useCallback(async (fromTokenSymbol: string, toTokenSymbol: string) => {
    if (!isConnected || currentChainId !== TARGET_CHAIN_ID) {
      return null;
    }

    try {
      // Find the best route for this token pair
      const routeResult = findBestRoute(fromTokenSymbol, toTokenSymbol);
      
      if (!routeResult.bestRoute) {
        console.warn(`No route found for token pair ${fromTokenSymbol}/${toTokenSymbol}`);
        return null;
      }

      const route = routeResult.bestRoute;
      
      // Update the route if it has actually changed
      if (JSON.stringify(route) !== JSON.stringify(currentRoute)) {
        setCurrentRoute(route);
        setSelectedPoolIndexForChart(0);
      }

      // Update routeInfo for display
      const routeInfoForDisplay = {
        path: route.path,
        hops: route.hops,
        isDirectRoute: route.isDirectRoute,
        pools: route.pools.map(pool => pool.poolName)
      };
      setRouteInfo(routeInfoForDisplay);

      return route;
    } catch (error) {
      console.error("[calculateRoute] Error calculating route:", error);
      return null;
    }
  }, [isConnected, currentChainId, setCurrentRoute, setSelectedPoolIndexForChart]);

  // Fetch route fees; returns the computed fees and updates state
  const fetchRouteFees = useCallback(async (route: SwapRoute): Promise<Array<{ poolName: string; fee: number }>> => {
    if (!route || route.pools.length === 0) {
      setRouteFees([]);
      return [];
    }

    setRouteFeesLoading(true);
    const fees: Array<{ poolName: string; fee: number }> = [];
    
    try {
      for (const pool of route.pools) {
        const cacheKey = getPoolDynamicFeeCacheKey(pool.token0 as TokenSymbol, pool.token1 as TokenSymbol, TARGET_CHAIN_ID);
        let poolFee: number;

        // Check cache first
        const cachedFee = getFromCache<{ dynamicFee: string }>(cacheKey);
        
        if (cachedFee) {
          poolFee = Number(cachedFee.dynamicFee);
        } else {
          const response = await fetch('/api/swap/get-dynamic-fee', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromTokenSymbol: pool.token0,
              toTokenSymbol: pool.token1,
              chainId: TARGET_CHAIN_ID,
            }),
          });
          
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.message || data.errorDetails || `Failed to fetch dynamic fee for ${pool.poolName}`);
          }
          
          poolFee = Number(data.dynamicFee);
          if (isNaN(poolFee)) {
            throw new Error(`Dynamic fee received is not a number for ${pool.poolName}: ${data.dynamicFee}`);
          }
          
          // Cache the result
          setToCache(cacheKey, { dynamicFee: data.dynamicFee });
        }

        fees.push({ poolName: pool.poolName, fee: poolFee });
      }

      setRouteFees(fees);
      return fees;
    } catch (error) {
      console.error("[fetchRouteFees] Error fetching route fees:", error);
      setRouteFees([]);
      return [];
    } finally {
      setRouteFeesLoading(false);
    }
  }, [TARGET_CHAIN_ID]);

  // Effect to fetch dynamic fee for display (updated to handle multi-hop)
  const fetchFee = useCallback(async () => {
    if (
      !isConnected ||
      currentChainId !== TARGET_CHAIN_ID ||
      !fromToken ||
      !toToken
    ) {
      setDynamicFeeBps(null);
      setDynamicFeeLoading(false);
      setDynamicFeeError(null);
      setCurrentRoute(null); // Use prop setter
      setRouteFees([]);
      setRouteFeesLoading(false);
      return;
    }

    const fromTokenSymbolForCache = Object.keys(TOKEN_DEFINITIONS).find(
      (key) => TOKEN_DEFINITIONS[key as TokenSymbol].address === fromToken.address
    ) as TokenSymbol | undefined;
    const toTokenSymbolForCache = Object.keys(TOKEN_DEFINITIONS).find(
      (key) => TOKEN_DEFINITIONS[key as TokenSymbol].address === toToken.address
    ) as TokenSymbol | undefined;

    if (!fromTokenSymbolForCache || !toTokenSymbolForCache) {
      console.error("[fetchFee] Could not determine token symbols for cache key.");
      setDynamicFeeError("Token configuration error for fee.");
      setDynamicFeeLoading(false);
      setRouteFeesLoading(false);
      return;
    }

    if (isFetchingDynamicFeeRef.current) return;

    isFetchingDynamicFeeRef.current = true;
    setDynamicFeeLoading(true);
    setRouteFeesLoading(true);
    setDynamicFeeError(null);

    try {
      // Use the new route calculation function
      const route = await calculateRoute(fromTokenSymbolForCache, toTokenSymbolForCache);
      
      if (!route) {
        throw new Error(`No route found for token pair ${fromTokenSymbolForCache}/${toTokenSymbolForCache}`);
      }

      // Fetch fees and use the result directly (avoid coupling to routeFees state updates)
      const fees = await fetchRouteFees(route);
      if (fees.length > 0) {
        setDynamicFeeBps(fees[0].fee);
      } else {
        setDynamicFeeBps(null);
      }

      setDynamicFeeLoading(false);
      setRouteFeesLoading(false);
      
    } catch (error: any) {
      console.error("[fetchFee] Error fetching dynamic fee:", error.message);
      setDynamicFeeBps(null);
      setCurrentRoute(null); // Use prop setter
      setRouteFees([]);
      setDynamicFeeLoading(false);
      setRouteFeesLoading(false);
      setDynamicFeeError(error.message || "Error fetching fee.");
    } finally {
      isFetchingDynamicFeeRef.current = false;
    }
  }, [isConnected, currentChainId, fromToken?.address, toToken?.address, TARGET_CHAIN_ID, calculateRoute, fetchRouteFees]);

  useEffect(() => {
    fetchFee(); // Fetch once on mount / relevant dep change

    return () => {
      isFetchingDynamicFeeRef.current = false; // Reset ref on cleanup
    };
  }, [fetchFee]);

  // Effect for initial route calculation on component mount and token changes
  // Remove overlapping initial fetch (fetchFee() already handles route+fees)
  useEffect(() => {
    if (!isConnected || currentChainId !== TARGET_CHAIN_ID || !fromToken || !toToken) {
      return;
    }
    // No-op: prevent duplicate initial calls
  }, [isConnected, currentChainId, fromToken?.address, toToken?.address]);

  // First, create a completely new function for the Change button
  const handleChangeButton = () => {
    // Force a full state reset by unmounting and remounting
    // Use a two-step approach
    
    // First, clear any variables that might persist
    window.swapBuildData = undefined;
    
    // Force reset of completedSteps (most important for visual feedback)
    setCompletedSteps([]);
    
    // Then force back to input state immediately
    setSwapState("input");
    
    // Reset all other states as well EXCEPT permit data
    setSwapProgressState("init");
    setSwapError(null);
    setIsSwapping(false);
    
    // Note: We're NOT clearing existingPermitData
  };

  // Effect for handling wrong network notification
  useEffect(() => {
    if (isMounted && isConnected && currentChainId !== TARGET_CHAIN_ID && !isAttemptingSwitch) {
      const newToastId = toast("Wrong Network", {
        description: "Please switch to Base Sepolia.",
        icon: <WarningToastIcon />,
        duration: 5000, 
      });
      wrongNetworkToastIdRef.current = newToastId; 
      setIsWrongNetworkToastActive(true); 

    } else {
      if (wrongNetworkToastIdRef.current && isWrongNetworkToastActive) {
        toast.dismiss(wrongNetworkToastIdRef.current);
      }
    };
  }, [isMounted, isConnected, currentChainId, isAttemptingSwitch]);

  // Effect for Success Notification
  useEffect(() => {
    if (swapState === "success") {
      toast("Swap Successful", {
        icon: <SuccessToastIcon />,
        duration: 4000
      });
    }
  }, [swapState]);

  // Helper function for formatting balance display
  const getFormattedDisplayBalance = (numericBalance: number | undefined): string => {
    if (numericBalance === undefined || isNaN(numericBalance)) {
      numericBalance = 0;
    }
    if (numericBalance === 0) {
      return "0.000";
    } else if (numericBalance > 0 && numericBalance < 0.001) {
      return "< 0.001";
    } else {
      return numericBalance.toFixed(3);
    }
  };

  // --- Dynamic Balance Fetching for current tokens ---
  const { data: fromTokenBalanceData, isLoading: isLoadingFromTokenBalance, error: fromTokenBalanceError } = useBalance({
    address: accountAddress,
    token: fromToken.address === "0x0000000000000000000000000000000000000000" ? undefined : fromToken.address,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!accountAddress && !!fromToken.address }
  });

  const { data: toTokenBalanceData, isLoading: isLoadingToTokenBalance, error: toTokenBalanceError } = useBalance({
    address: accountAddress,
    token: toToken.address === "0x0000000000000000000000000000000000000000" ? undefined : toToken.address,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!accountAddress && !!toToken.address }
  });

  // Update fromToken balance
  useEffect(() => {
    const numericBalance = fromTokenBalanceData ? parseFloat(fromTokenBalanceData.formatted) : 0;
    const displayBalance = getFormattedDisplayBalance(numericBalance);

    setFromToken(prevToken => {
      // Only create a new object if the balance or value has actually changed
      if (
        fromTokenBalanceData && isConnected && currentChainId === TARGET_CHAIN_ID &&
        (prevToken.balance !== displayBalance || prevToken.value !== `~$${(numericBalance * prevToken.usdPrice).toFixed(2)}`)
      ) {
        return { ...prevToken, balance: displayBalance, value: `~$${(numericBalance * prevToken.usdPrice).toFixed(2)}` };
      }
      
      // Handle other states if they result in a change
      if (fromTokenBalanceError && isConnected && currentChainId === TARGET_CHAIN_ID && prevToken.balance !== "Error") {
        console.error("Error fetching fromToken balance:", fromTokenBalanceError);
        return { ...prevToken, balance: "Error", value: "$0.00" };
      }
      
      if (isConnected && currentChainId !== TARGET_CHAIN_ID && prevToken.balance !== "~") {
        return { ...prevToken, balance: "~", value: "$0.00" };
      }
      
      if (!isLoadingFromTokenBalance && isConnected && prevToken.balance !== displayBalance) {
        return { ...prevToken, balance: displayBalance, value: "$0.00" };
      }
      
      if (!isConnected && prevToken.balance !== "~") {
        return { ...prevToken, balance: "~", value: "$0.00" }; 
      }

      // If no changes, return the existing token object to prevent re-renders
      return prevToken;
    });
  }, [fromTokenBalanceData, fromTokenBalanceError, isLoadingFromTokenBalance, currentChainId, isConnected, getFormattedDisplayBalance]);

  // Update toToken balance
  useEffect(() => {
    const numericBalance = toTokenBalanceData ? parseFloat(toTokenBalanceData.formatted) : 0;
    const displayBalance = getFormattedDisplayBalance(numericBalance);

    setToToken(prevToken => {
      // Only create a new object if the balance or value has actually changed
      if (
        toTokenBalanceData && isConnected && currentChainId === TARGET_CHAIN_ID &&
        (prevToken.balance !== displayBalance || prevToken.value !== `~$${(numericBalance * prevToken.usdPrice).toFixed(2)}`)
      ) {
        return { ...prevToken, balance: displayBalance, value: `~$${(numericBalance * prevToken.usdPrice).toFixed(2)}` };
      }
      
      if (toTokenBalanceError && isConnected && currentChainId === TARGET_CHAIN_ID && prevToken.balance !== "Error") {
        console.error("Error fetching toToken balance:", toTokenBalanceError);
        return { ...prevToken, balance: "Error", value: "$0.00" };
      }
      
      if (isConnected && currentChainId !== TARGET_CHAIN_ID && prevToken.balance !== "~") {
        return { ...prevToken, balance: "~", value: "$0.00" };
      }
      
      if (!isLoadingToTokenBalance && isConnected && prevToken.balance !== displayBalance) {
        return { ...prevToken, balance: displayBalance, value: "$0.00" };
      }
      
      if (!isConnected && prevToken.balance !== "~") {
        return { ...prevToken, balance: "~", value: "$0.00" };
      }
      
      return prevToken;
    });
  }, [toTokenBalanceData, toTokenBalanceError, isLoadingToTokenBalance, currentChainId, isConnected, getFormattedDisplayBalance]);

  // Helper function to format currency
  const formatCurrency = useCallback((valueString: string): string => {
    // Remove '$' or '~$' and any existing commas for robust parsing
    const cleanedString = valueString.replace(/[$,~]/g, ''); 
    const numberValue = parseFloat(cleanedString);
    if (isNaN(numberValue)) {
      return "$0.00"; // Default to $0.00 if not a valid number
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numberValue);
  }, []); // Added useCallback with empty dependency array

  // Helper function to format token amount for display (Review, Success, Balances)
  // Uses the token's actual displayDecimals from configuration and special < 0.001 display.
  const formatTokenAmountDisplay = useCallback((amountString: string, token: Token): string => {
    try {
      const amount = parseFloat(amountString);

      if (isNaN(amount) || amount === 0) return "0"; // Return "0" for invalid or zero input or exact zero

      // Handle very small positive numbers with special string FIRST
      if (amount > 0 && amount < 0.001) return "< 0.001";

      // Use the token's actual displayDecimals from configuration
      const displayDecimals = token.displayDecimals;

      // Format with the token's configured decimals
      return amount.toFixed(displayDecimals);

    } catch (error) {
      console.error("Error formatting token amount display:", error);
      return amountString; // Return original string on error
    }
  }, []); // Dependency on useCallback - no external dependencies needed here typically

  // OLD QUOTE EFFECT - COMMENTED OUT TO BE REPLACED
  /*
  useEffect(() => {
    const fromValue = parseFloat(fromAmount);
    
    // If invalid input or tokens, clear the output
    if (isNaN(fromValue) || fromValue <= 0 || !fromToken || !toToken) {
      setToAmount("");
      setRouteInfo(null);
      return;
    }
    
    // Set a debounce timer to prevent too many API calls during fast typing
    const timer = setTimeout(async () => {
      // Only call the API if we're connected and on the right network
      if (isConnected && currentChainId === TARGET_CHAIN_ID) {
        try {
          // Show subtle loading state
          setQuoteLoading(true);
          
          const response = await fetch('/api/swap/get-quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromTokenSymbol: fromToken.symbol,
              toTokenSymbol: toToken.symbol,
              amountDecimalsStr: fromAmount,
              chainId: currentChainId,
              debug: true // Use debug mode to avoid contract call errors
            }),
          });

          const data = await response.json();
          
          if (response.ok && data.success) {
            // Set the quoted amount in the UI
            setToAmount(data.toAmount);
            setQuoteError(null);
            
            // Store route information if available
            if (data.route) {
              setRouteInfo(data.route);
            } else {
              setRouteInfo(null);
            }
          } else {
            console.error('❌ V4 Quoter Error:', data.error);
            
            // Show a toast with the error
            toast.error(`Quote Error: ${data.error || 'Failed to get quote'}`);
            
            setQuoteError(data.error || 'Failed to get quote');
            setRouteInfo(null); // Clear route info on error
            
            // Fallback to the calculation using current prices
            const calculatedTo = (fromValue * fromToken.usdPrice) / toToken.usdPrice;
            setToAmount(calculatedTo.toFixed(toToken.decimals));
          }
        } catch (error: any) {
          console.error('❌ V4 Quoter Exception:', error);
          
          // Show a toast with the error
          toast.error(`Quote Error: ${error.message || 'Failed to fetch quote'}`);
          
          setQuoteError('Failed to fetch quote');
          setRouteInfo(null); // Clear route info on exception
          
          // Fallback to the calculation using current prices
          const calculatedTo = (fromValue * fromToken.usdPrice) / toToken.usdPrice;
          setToAmount(calculatedTo.toFixed(toToken.decimals));
        } finally {
          // Clear loading state
          setQuoteLoading(false);
        }
      } else {
        // Fallback to the calculation using current prices
        const calculatedTo = (fromValue * fromToken.usdPrice) / toToken.usdPrice;
        setToAmount(calculatedTo.toFixed(toToken.decimals));
        setRouteInfo(null); // No route info for calculated prices
      }
    }, 500); // 500ms debounce
    
    return () => clearTimeout(timer);
  }, [fromAmount, fromToken?.symbol, toToken?.symbol, fromToken?.decimals, toToken?.decimals, fromToken?.usdPrice, toToken?.usdPrice, isConnected, currentChainId, TARGET_CHAIN_ID]);
  */

  // NEW: Function to fetch quote
  const fetchQuote = useCallback(async (amountStr: string) => {
    if (!fromToken || !toToken || !isConnected || currentChainId !== TARGET_CHAIN_ID) {
      setToAmount("");
      setRouteInfo(null);
      setQuoteLoading(false);
      setQuoteError(null);
      return;
    }

    const fromValue = parseFloat(amountStr);
    if (isNaN(fromValue) || fromValue <= 0) {
      setToAmount("0"); // Display 0 if input is invalid or zero
      setRouteInfo(null);
      setQuoteLoading(false);
      setQuoteError(null);
      return;
    }

    setQuoteLoading(true);
    setQuoteError(null);

    try {
      const response = await fetch('/api/swap/get-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromTokenSymbol: fromToken.symbol,
          toTokenSymbol: toToken.symbol,
          amountDecimalsStr: amountStr,
          chainId: currentChainId,
          debug: true
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setToAmount(data.toAmount);
        setRouteInfo(data.route || null);
        setQuoteError(null);
      } else {
        console.error('❌ V4 Quoter Error:', data.error);
        toast.error(`Quote Error: ${data.error || 'Failed to get quote'}`);
        setQuoteError(data.error || 'Failed to get quote');
        setRouteInfo(null);
        // Fallback to client-side calculation if API fails
        const calculatedTo = (fromValue * fromToken.usdPrice) / toToken.usdPrice;
        setToAmount(calculatedTo.toFixed(toToken.decimals));
      }
    } catch (error: any) {
      console.error('❌ V4 Quoter Exception:', error);
      toast.error(`Quote Error: ${error.message || 'Failed to fetch quote'}`);
      setQuoteError('Failed to fetch quote');
      setRouteInfo(null);
      // Fallback to client-side calculation on exception
      const calculatedTo = (fromValue * fromToken.usdPrice) / toToken.usdPrice;
      setToAmount(calculatedTo.toFixed(toToken.decimals));
    } finally {
      setQuoteLoading(false);
    }
  }, [fromToken?.symbol, toToken?.symbol, currentChainId, isConnected, fromToken?.usdPrice, toToken?.usdPrice, fromToken?.decimals, toToken?.decimals, TARGET_CHAIN_ID]);

  // NEW: Effect to trigger quote fetching
  useEffect(() => {
    const handler = setTimeout(() => {
      if (fromAmount === "" || parseFloat(fromAmount) === 0) {
        setToAmount("0"); // Display "0" instead of empty string for better UX
        setQuoteLoading(false);
        setQuoteError(null);
      } else {
        fetchQuote(fromAmount); // Fetch quote for the user's entered amount
      }
    }, 300); // Debounce for 300ms

    return () => {
      clearTimeout(handler);
    };
  }, [fromAmount, fromToken, toToken, isConnected, currentChainId, fetchQuote]);

  // Update calculatedValues for UI display
  useEffect(() => {
    const fromValueNum = parseFloat(fromAmount || "0");
    const fromTokenUsdPrice = fromToken.usdPrice || 0; // Ensure usdPrice is a number

    const updatedFeesArray: FeeDetail[] = [];

    // Multi-hop Fee Display
    if (isConnected && currentChainId === TARGET_CHAIN_ID) {
      if (routeFeesLoading || dynamicFeeLoading) {
        if (routeFees.length > 0) {
          // If loading but we have previous fees, show them statically
          routeFees.forEach((routeFee, index) => {
            const feeDisplayName = routeFees.length > 1 ? `Fee ${index + 1} (${routeFee.poolName})` : "Fee";
            updatedFeesArray.push({ 
              name: feeDisplayName, 
              value: `${(routeFee.fee / 10000).toFixed(2)}%`, 
              type: "percentage" 
            });
          });
        } else {
          // If loading and no previous fees (initial load), show placeholder
          updatedFeesArray.push({ name: "Fee", value: "N/A", type: "percentage" });
        }
      } else if (dynamicFeeError) {
        // Check if it's a "no route" error for multi-hop
        if (dynamicFeeError.includes("No route found")) {
          updatedFeesArray.push({ name: "Fee", value: "No Route Available", type: "percentage" });
        } else {
          updatedFeesArray.push({ name: "Fee", value: "Fee N/A", type: "percentage" });
        }
      } else if (routeFees.length > 0) {
        // Show individual fees for each hop
        routeFees.forEach((routeFee, index) => {
          const feeDisplayName = routeFees.length > 1 ? `Fee ${index + 1} (${routeFee.poolName})` : "Fee";
          updatedFeesArray.push({ 
            name: feeDisplayName, 
            value: `${(routeFee.fee / 10000).toFixed(2)}%`, 
            type: "percentage" 
          });
        });
      } else if (dynamicFeeBps !== null) {
        // Fallback to single fee display for backward compatibility
        updatedFeesArray.push({ 
          name: "Fee", 
          value: `${(dynamicFeeBps / 10000).toFixed(2)}%`, 
          type: "percentage" 
        });
      } else {
        // If not loading, no error, but no fees available (initial state)
        updatedFeesArray.push({ name: "Fee", value: "N/A", type: "percentage" });
      }
    } else {
      // Not connected or wrong chain
      updatedFeesArray.push({ name: "Fee", value: "N/A", type: "percentage" });
    }

    // Fee Value (USD) - calculate total fee for multi-hop routes
    if (fromValueNum > 0 && isConnected && currentChainId === TARGET_CHAIN_ID && routeFees.length > 0 && !routeFeesLoading && !dynamicFeeError) {
      // Calculate total fee percentage for multi-hop
      const totalFeeRate = routeFees.reduce((total, routeFee) => total + (routeFee.fee / 10000), 0);
      const totalFeeInUsd = (fromValueNum * fromTokenUsdPrice) * (totalFeeRate / 100);
      
      let feeValueDisplay: string;
      if (totalFeeInUsd > 0 && totalFeeInUsd < 0.01) {
        feeValueDisplay = "< $0.01";
      } else {
        feeValueDisplay = formatCurrency(totalFeeInUsd.toString());
      }
      
      const feeValueName = routeFees.length > 1 ? "Total Fee Value (USD)" : "Fee Value (USD)";
      updatedFeesArray.push({ name: feeValueName, value: feeValueDisplay, type: "usd" });
    }
    
    const newFromTokenValue = (!isNaN(fromValueNum) && fromValueNum >= 0 && fromToken.usdPrice)
                              ? (fromValueNum * fromToken.usdPrice)
                              : 0;
    const toValueNum = parseFloat(toAmount);
    const newToTokenValue = (!isNaN(toValueNum) && toValueNum >= 0 && toToken.usdPrice)
                            ? (toValueNum * toToken.usdPrice)
                            : 0;
    
    // Calculate minimum received based on quote (new method)
    const quotedAmount = parseFloat(toAmount || "0");
    const minReceivedAmount = quotedAmount > 0 ? quotedAmount * (1 - slippage / 100) : 0;
    const formattedMinimumReceived = formatTokenAmountDisplay(minReceivedAmount.toString(), toToken);
    
    setCalculatedValues(prev => ({
      ...prev,
      fromTokenAmount: formatTokenAmountDisplay(fromAmount, fromToken),
      fromTokenValue: formatCurrency(newFromTokenValue.toString()),
      toTokenAmount: formatTokenAmountDisplay(toAmount, toToken),
      toTokenValue: formatCurrency(newToTokenValue.toString()),
      fees: updatedFeesArray, 
      slippage: `${slippage}%`, // Pass slippage as string for display
      minimumReceived: formattedMinimumReceived,
    }));

  }, [fromAmount, toAmount, fromToken?.symbol, fromToken?.usdPrice, fromToken?.displayDecimals, toToken?.symbol, toToken?.usdPrice, toToken?.displayDecimals, formatCurrency, isConnected, currentChainId, dynamicFeeLoading, dynamicFeeError, dynamicFeeBps, routeFees, routeFeesLoading, formatTokenAmountDisplay, slippage]);

  const handleFromAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^\d*\.?\d*$/.test(value)) {
        setFromAmount(value);
        setSelectedPercentageIndex(-1);
    } else if (value === "") {
        setFromAmount("");
        setSelectedPercentageIndex(-1);
    }
  };

  const handleSwapTokens = () => {
    const tempLogicalToken = fromToken; // This is just swapping our state for YUSD/BTCRL
    const tempDisplayAmount = fromAmount;

    setFromToken(toToken); // e.g. aUSDC becomes aUSDT
    setToToken(tempLogicalToken); // e.g. aUSDT becomes aUSDC
    
    setFromAmount(toAmount); // Old toAmount becomes new fromAmount for input field
    // toAmount will be recalculated by useEffect based on the new fromAmount and swapped tokens
  };

  // Token selection handlers
  const handleFromTokenSelect = (token: Token) => {
    if (token.address !== fromToken.address) {
      setFromToken(token);
      setFromAmount("");
      setToAmount("");
      // Let the centralized fetchFee() effect handle route + fee fetching to avoid duplicate API calls
    }
  };

  const handleToTokenSelect = (token: Token) => {
    if (token.address !== toToken.address) {
      setToToken(token);
      setFromAmount("");
      setToAmount("");
      // Let the centralized fetchFee() effect handle route + fee fetching to avoid duplicate API calls
    }
  };

  useEffect(() => {
    return () => { if (swapTimerRef.current) clearTimeout(swapTimerRef.current); };
  }, []);

  const handleNetworkSwitch = async () => {
    setIsAttemptingSwitch(true);
    if (wrongNetworkToastIdRef.current && isWrongNetworkToastActive) { 
      toast.dismiss(wrongNetworkToastIdRef.current);
      wrongNetworkToastIdRef.current = undefined;
      setIsWrongNetworkToastActive(false);
    }
    try {
      await switchChain(config, { chainId: TARGET_CHAIN_ID });
    } catch (error) {
      if (currentChainId !== TARGET_CHAIN_ID) {
        if (!isWrongNetworkToastActive) { 
            wrongNetworkToastIdRef.current = toast("Wrong Network", {
                description: "Failed to switch. Please try again.",
                icon: <WarningToastIcon />,
                duration: Infinity,
            });
            setIsWrongNetworkToastActive(true);
        }
      }
    } finally {
      setIsAttemptingSwitch(false);
    }
  };

  const handleSwap = async () => {
    const fromAmountNum = parseFloat(fromAmount || "0");
    const fromBalanceNum = parseFloat(fromToken.balance || "0"); // Use state balance

    // 1. Pre-checks (connected, network, amount > 0, sufficient balance)
    const insufficientBalance = isNaN(fromBalanceNum) || fromBalanceNum < fromAmountNum;
    if (!isConnected || currentChainId !== TARGET_CHAIN_ID || fromAmountNum <= 0) { // REMOVED insufficientBalance check here
      return;
    }

    setSwapState("review"); // Move to review UI
    setCompletedSteps([]); // Reset steps for this new review attempt
    setIsSwapping(true); // Disable confirm button during checks
    setSwapProgressState("checking_allowance"); // Show checks are in progress

    // Check if this is a native ETH swap
    if (fromToken.symbol === 'ETH') {
      console.log("DEBUG: Taking ETH swap path for token:", fromToken.symbol);
      setCompletedSteps(["approval_complete", "signature_complete"]); // Mark both steps complete for ETH
      setSwapProgressState("ready_to_swap");
      setIsSwapping(false); // Ready for user action (Confirm)
      return;
    }

    // --- Helper to fetch permit data (can be extracted if used elsewhere) ---
    const fetchPermitData = async (): Promise<any> => {
      try {
        const requestBody = {
          userAddress: accountAddress,
          fromTokenAddress: fromToken.address,
          fromTokenSymbol: fromToken.symbol,
          toTokenSymbol: toToken.symbol,
          chainId: currentChainId,
          checkExisting: true,
        };
        
        console.log("DEBUG: fetchPermitData request body:", requestBody);
        console.log("DEBUG: Individual values:", {
          accountAddress,
          fromTokenAddress: fromToken.address,
          fromTokenSymbol: fromToken.symbol,
          toTokenSymbol: toToken.symbol,
          currentChainId
        });
        
        const response = await fetch('/api/swap/prepare-permit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to fetch permit data');
        return data;
      } catch (fetchError: any) {
        console.error("[fetchPermitData] Error:", fetchError);
        throw new Error("Could not retrieve permit information.");
      }
    };
    // --- End Helper ---

    try {
      const parsedAmount = safeParseUnits(fromAmount, fromToken.decimals);

      // 2. Check ERC20 Allowance
      const allowance = await publicClient.readContract({
        address: fromToken.address,
        abi: Erc20AbiDefinition,
        functionName: 'allowance',
        args: [accountAddress as Address, PERMIT2_ADDRESS as Address]
      }) as bigint;

      // 3. Handle ERC20 Result
      if (allowance < parsedAmount) {
        setSwapProgressState("needs_approval");
        setIsSwapping(false); // Checks done, ready for user action (Approve)
        return; // Stop here, wait for user to click "Approve"
      }

      // 4. ERC20 OK -> Check Permit2 Immediately
      setCompletedSteps(["approval_complete"]); // Mark step 1 complete
      setSwapProgressState("checking_allowance"); // Indicate checking permit

      const permitData = await fetchPermitData();
      setCurrentPermitDetailsForSign(permitData); // Store fetched permit data
      setObtainedSignature(null); // Clear any previous signature

      const needsSignature = permitData.needsPermit === true;

      // 5. Handle Permit2 Result
      if (needsSignature) {
        setSwapProgressState("needs_signature");
        // Notification effect will show toast
      } else {
        setCompletedSteps(["approval_complete", "signature_complete"]); // Mark step 2 complete
        setSwapProgressState("ready_to_swap");
      }
      setIsSwapping(false); // Checks done, ready for user action (Sign or Confirm)

    } catch (error: any) {
      // 6. Handle Errors during initial checks
      console.error("Error during initial swap checks:", error);
      setIsSwapping(false); // Re-enable buttons
      setSwapProgressState("error"); // Set a general error state for checks
      toast("Error preparing swap", {
        description: error.message || "Could not verify token allowances.",
        icon: <WarningToastIcon />
      });
    }
  };

  const handleUsePercentage = (percentage: number) => {
    try {
      // Use the dynamic fromToken balance data
      if (fromTokenBalanceData && fromTokenBalanceData.formatted) {
        // Parse the exact blockchain value
        const exactBalance = fromTokenBalanceData.formatted;
        const exactNumericBalance = parseFloat(exactBalance);
        
        if (isNaN(exactNumericBalance) || exactNumericBalance <= 0) {
          console.warn(`Invalid or zero balance for ${fromToken.symbol}`);
          return;
        }

        // Calculate the exact percentage amount
        const exactAmount = exactNumericBalance * (percentage / 100);
        
        // Set the amount directly using the formatted string to preserve precision
        // This matches the logic in handleUseFullBalance for consistency
        if (percentage === 100) {
          // For 100%, use the exact blockchain value directly
          setFromAmount(exactBalance);
        } else {
          // For other percentages, calculate and format to the token's decimals
          setFromAmount(exactAmount.toFixed(fromToken.decimals));
        }
      } else {
        console.warn(`No valid balance data for ${fromToken.symbol}`);
      }
    } catch (error) {
      console.error("Error using exact balance for percentage calculation:", error);
    }
  };
  
  const handleUseFullBalance = (token: Token, isFrom: boolean) => {
    try {
      // Use the appropriate dynamic balance data based on which token is being used
      const balanceData = isFrom ? fromTokenBalanceData : toTokenBalanceData;
      
      // Use the exact formatted value from the blockchain if available
      if (balanceData && balanceData.formatted) {
        if (isFrom) {
          // Set EXACTLY what the blockchain reports - no parsing/formatting that might round
          setFromAmount(balanceData.formatted);
        } else {
          console.warn("Setting 'toAmount' based on 'toToken' balance is not directly supported");
        }
      } else {
        console.warn(`No valid balance data for ${token.symbol}`);
      }
    } catch (error) {
      console.error(`Error using exact balance for ${token.symbol}:`, error);
    }
  };

  // This function is no longer needed as the preview is always visible.
  // Its previous logic (toggling isFeeChartPreviewVisible) has been removed.
  const handleFeePercentageClick = () => {};

  // This function opens the MODAL
  const handlePreviewChartClick = useCallback(() => {
    if (isMobile) {
      toast("Not available on mobile (Alpha)", { 
        duration: 4000
      });
    } else {
      setIsFeeChartModalOpen(true);
    }
  }, [isMobile]);

  const handleConfirmSwap = async () => {
    // 1. Guard & Initial Setup
    if (isSwapping) {
      return;
    }
    setIsSwapping(true); // Disable button immediately
    const stateBeforeAction = swapProgressState; // Store state before this action attempt

    // --- Helper Function Placeholder for fetching permit data ---
    // In a real scenario, this would likely call the '/api/swap/prepare-permit' endpoint
    const fetchPermitData = async (): Promise<any> => {
        try {
            const response = await fetch('/api/swap/prepare-permit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userAddress: accountAddress,
                    fromTokenAddress: fromToken.address,
                    fromTokenSymbol: fromToken.symbol,
                    toTokenSymbol: toToken.symbol,
                    chainId: currentChainId,
                    checkExisting: true, // Always check validity when fetching
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Failed to fetch permit data');
            }
            return data;
        } catch (fetchError) {
            console.error("[fetchPermitData] Error:", fetchError);
            throw new Error("Could not retrieve permit information from the server."); // Re-throw a user-friendly error
        }
    };
    // --- End Helper Placeholder ---

    try {
        // 2. Determine Action based on CURRENT progress state
        const parsedAmount = safeParseUnits(fromAmount, fromToken.decimals); // Needed in multiple branches

        // ACTION: Need to Approve
        if (stateBeforeAction === "needs_approval") {
            setSwapProgressState("approving");
            const approveTxHash = await sendApprovalTx({
                address: fromToken.address,
                abi: Erc20AbiDefinition,
                functionName: 'approve',
                args: [PERMIT2_ADDRESS, safeParseUnits("1000000", fromToken.decimals)], // Consistent large approval
            });
            if (!approveTxHash) throw new Error("Failed to send approval transaction");

            setSwapProgressState("waiting_approval");
            const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTxHash as Hex });
            if (!approvalReceipt || approvalReceipt.status !== 'success') throw new Error("Approval transaction failed on-chain");

            setCompletedSteps(prev => [...prev, "approval_complete"]);

            // --- CRITICAL: Re-fetch Permit Data AFTER approval ---
            const freshPermitData = await fetchPermitData();
            setCurrentPermitDetailsForSign(freshPermitData); // Store fresh permit data
            setObtainedSignature(null); // Clear any previous signature

            const needsSigAfterApproval = !freshPermitData.hasValidPermit || BigInt(freshPermitData.currentPermitInfo.amount) < MaxUint160;

            if (needsSigAfterApproval) {
                setSwapProgressState("needs_signature");
            } else {
                setSwapProgressState("ready_to_swap");
                setCompletedSteps(prev => prev.includes("signature_complete") ? prev : [...prev, "signature_complete"]);
            }
            setIsSwapping(false); // Re-enable button for next distinct step
            return; // Wait for next user click
        }

        // ACTION: Need to Sign
        else if (stateBeforeAction === "needs_signature") {

            // --- CRITICAL: Use the stored permit data for signing ---
            if (!currentPermitDetailsForSign) {
              // This should not happen if logic is correct, but as a safeguard:
              console.error("[handleConfirmSwap] Error: currentPermitDetailsForSign is null before signing.");
              toast.error("Error preparing signature. Please try again.", {
                icon: <WarningToastIcon /> // ENSURED ICON
              });
              setIsSwapping(false);
              setSwapProgressState("error");
              return;
            }
            const permitDataForSigning = currentPermitDetailsForSign;

            const reallyNeedsSig = permitDataForSigning.needsPermit === true;

            if (!reallyNeedsSig) {
                 setCompletedSteps(prev => prev.includes("signature_complete") ? prev : [...prev, "signature_complete"]);
                 setSwapProgressState("ready_to_swap");
                 setIsSwapping(false); 
                 return; 
            }

            setSwapProgressState("signing_permit");

            console.log("DEBUG: permitDataForSigning structure:", permitDataForSigning);
            
            // Check if permitData exists (only present when needsPermit is true)
            if (!permitDataForSigning.permitData) {
                throw new Error("Permit data is missing when signature is required");
            }
            
            // Use the permitData structure from the new API response
            const permitMessage = permitDataForSigning.permitData.message;
            const messageToSign = {
                details: {
                    token: getAddress(fromToken.address),
                    amount: MaxUint160, 
                    expiration: permitMessage.details.expiration,
                    nonce: permitMessage.details.nonce,
                },
                spender: getAddress(permitDataForSigning.permitData.message.spender),
                sigDeadline: BigInt(permitMessage.sigDeadline), // Convert string back to BigInt
            };

            const signatureFromSigning = await signTypedDataAsync({
                domain: permitDataForSigning.permitData.domain,
                types: permitDataForSigning.permitData.types,
                primaryType: 'PermitSingle',
                message: messageToSign,
            });
            
            if (!signatureFromSigning) throw new Error("Signature process did not return a valid signature.");
            setObtainedSignature(signatureFromSigning); // Store the obtained signature


            setCompletedSteps(prev => [...prev, "signature_complete"]);
            setSwapProgressState("ready_to_swap"); 
            setIsSwapping(false); 
            return; 
        }

        // ACTION: Ready to Swap
        else if (stateBeforeAction === "ready_to_swap") {

            // For native ETH swaps, skip permit checks and use dummy permit data
            if (fromToken.symbol === 'ETH') {
                console.log("DEBUG: Taking ETH swap path for token:", fromToken.symbol);
                // --- Sanity Check for balance (can remain) ---
                const currentBalanceBigInt = safeParseUnits(fromToken.balance || "0", fromToken.decimals);
                const parsedAmountForSwap = safeParseUnits(fromAmount, fromToken.decimals);
                if (currentBalanceBigInt < parsedAmountForSwap) {
                     throw new Error(`Insufficient balance. Required: ${fromAmount}, Available: ${fromToken.balance}`);
                }
                // --- End Sanity Check ---

                setSwapProgressState("building_tx");

                // >>> FETCH ROUTE AND DYNAMIC FEES <<<
                // For multihop support, we need to get the route first, then fetch fees for each pool
                const routeResult = findBestRoute(fromToken.symbol, toToken.symbol);
                
                if (!routeResult.bestRoute) {
                    throw new Error(`No route found for token pair: ${fromToken.symbol} -> ${toToken.symbol}`);
                }

                const route = routeResult.bestRoute;

                // Fetch dynamic fees for each pool in the route
                let fetchedDynamicFee: number | null = null;
                try {
                    if (route.isDirectRoute) {
                        // Single hop - fetch fee for the direct pool
                        const feeResponse = await fetch('/api/swap/get-dynamic-fee', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                fromTokenSymbol: fromToken.symbol,
                                toTokenSymbol: toToken.symbol,
                                chainId: TARGET_CHAIN_ID,
                            }),
                        });
                        const feeData = await feeResponse.json();
                        if (!feeResponse.ok) {
                            throw new Error(feeData.message || feeData.errorDetails || 'Failed to fetch dynamic fee');
                        }
                        fetchedDynamicFee = Number(feeData.dynamicFee);
                        if (isNaN(fetchedDynamicFee)) {
                            throw new Error('Dynamic fee received is not a number: ' + feeData.dynamicFee);
                        }
                    } else {
                        // Multihop - fetch fees for each pool in the route
                        
                        // For multihop, we'll use the first pool's fee as the primary fee
                        // In a more sophisticated implementation, this could be weighted average or other logic
                        const firstPool = route.pools[0];
                        const feeResponse = await fetch('/api/swap/get-dynamic-fee', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                fromTokenSymbol: firstPool.token0,
                                toTokenSymbol: firstPool.token1,
                                chainId: TARGET_CHAIN_ID,
                            }),
                        });
                        const feeData = await feeResponse.json();
                        if (!feeResponse.ok) {
                            throw new Error(feeData.message || feeData.errorDetails || 'Failed to fetch dynamic fee for multihop route');
                        }
                        fetchedDynamicFee = Number(feeData.dynamicFee);
                        if (isNaN(fetchedDynamicFee)) {
                            throw new Error('Dynamic fee received is not a number: ' + feeData.dynamicFee);
                        }
                    }

                } catch (feeError: any) {
                    console.error("[handleConfirmSwap] Error fetching dynamic fee:", feeError);
                    toast.error("Could not fetch swap fee. Please try again.", {
                      icon: <WarningToastIcon />
                    });
                    setIsSwapping(false);
                    setSwapProgressState("error");
                    return;
                }
                // >>> END FETCH ROUTE AND DYNAMIC FEES <<<

                const effectiveTimestamp = BigInt(Math.floor(Date.now() / 1000));
                const effectiveFallbackSigDeadline = effectiveTimestamp + BigInt(30 * 60); // 30 min fallback

                // Calculate minimum received amount using quote-based calculation (same as UI display)
                const quotedAmount = parseFloat(toAmount || "0");
                const minimumReceivedAmount = quotedAmount > 0 ? quotedAmount * (1 - slippage / 100) : 0;
                const minimumReceivedStr = minimumReceivedAmount.toString();

                // Use dummy permit data for native ETH
                const bodyForSwapTx = {
                     userAddress: accountAddress,
                     fromTokenSymbol: fromToken.symbol,
                     toTokenSymbol: toToken.symbol,
                     swapType: 'ExactIn',
                     amountDecimalsStr: fromAmount,
                     limitAmountDecimalsStr: minimumReceivedStr, // Pass the slippage-adjusted minimum amount
                     
                     permitSignature: "0x", // No permit signature needed for ETH
                     permitTokenAddress: fromToken.address,
                     permitAmount: "0", // No permit amount for ETH
                     permitNonce: 0,
                     permitExpiration: 0,
                     permitSigDeadline: effectiveFallbackSigDeadline.toString(),
                     chainId: currentChainId,
                     dynamicSwapFee: fetchedDynamicFee,
                };

                // --- Call Build TX API ---
                const buildTxApiResponse = await fetch('/api/swap/build-tx', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyForSwapTx),
                });
                const buildTxApiData = await buildTxApiResponse.json();

                if (!buildTxApiResponse.ok) {
                     const errorInfo = buildTxApiData.message || 'Failed to build transaction';
                     const cause = buildTxApiData.errorDetails || buildTxApiData.error;
                     throw new Error(errorInfo, { cause: cause });
                }

                window.swapBuildData = buildTxApiData; 
                setSwapProgressState("executing_swap");

                const txHash = await sendSwapTx({
                    address: getAddress(buildTxApiData.to),
                    abi: UniversalRouterAbi,
                    functionName: 'execute',
                    args: [buildTxApiData.commands as Hex, buildTxApiData.inputs as Hex[], BigInt(buildTxApiData.deadline)],
                    value: BigInt(buildTxApiData.value),
                });
                if (!txHash) throw new Error("Failed to send swap transaction (no hash received)");

                console.log("ETH Swap - Transaction Hash received:", txHash);
                setSwapTxInfo({ 
                    hash: txHash as string,
                    fromAmount: fromAmount,
                    fromSymbol: fromToken.symbol,
                    toAmount: toAmount,
                    toSymbol: toToken.symbol,
                    explorerUrl: `https://sepolia.basescan.org/tx/${txHash}`
                });
                console.log("ETH Swap - setSwapTxInfo called with hash:", txHash);

                setSwapProgressState("waiting_confirmation");
                console.log("ETH Swap - Waiting for confirmation of hash:", txHash);
                const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex });

                if (!receipt || receipt.status !== 'success') throw new Error("Swap transaction failed on-chain");

                console.log("ETH Swap - Transaction confirmed! Hash:", txHash, "Receipt:", receipt);
                setSwapProgressState("complete");
                setIsSwapping(false);
                
                // Only show success view after transaction is confirmed
                console.log("ETH Swap - Setting success state for hash:", txHash);
                setSwapState("success");
                return;
            }

            // Check if we have the necessary permit details and signature if one was required
            const needsSignatureCheck = currentPermitDetailsForSign?.needsPermit === true;
            
            if (!currentPermitDetailsForSign || (needsSignatureCheck && !obtainedSignature)) {
                 console.error("[handleConfirmSwap] Error: Permit details missing, or signature was required but not obtained.");
                 toast.error("Critical error in swap preparation. Please start over.", {
                  icon: <WarningToastIcon /> // ENSURED ICON
                 });
                 setIsSwapping(false);
                 setSwapProgressState("error"); 
                 // Consider a full reset: handleChangeButton();
                 return;
            }
            
            // Use the stored permit details and signature for building TX
            const permitDetailsToUse = currentPermitDetailsForSign; 
            const signatureToUse = obtainedSignature; // This can be null/"0x" if no signature was needed/obtained


            // --- Sanity Check for balance (can remain) ---
            const currentBalanceBigInt = safeParseUnits(fromToken.balance || "0", fromToken.decimals);
            const parsedAmountForSwap = safeParseUnits(fromAmount, fromToken.decimals);
            if (currentBalanceBigInt < parsedAmountForSwap) {
                 throw new Error(`Insufficient balance. Required: ${fromAmount}, Available: ${fromToken.balance}`);
            }
            // --- End Sanity Check ---

            setSwapProgressState("building_tx");

            // >>> FETCH ROUTE AND DYNAMIC FEES <<<
            // For multihop support, we need to get the route first, then fetch fees for each pool
            const routeResult = findBestRoute(fromToken.symbol, toToken.symbol);
            
            if (!routeResult.bestRoute) {
                throw new Error(`No route found for token pair: ${fromToken.symbol} -> ${toToken.symbol}`);
            }

            const route = routeResult.bestRoute;

            // Fetch dynamic fees for each pool in the route
            let fetchedDynamicFee: number | null = null;
            try {
                if (route.isDirectRoute) {
                    // Single hop - fetch fee for the direct pool
                    const feeResponse = await fetch('/api/swap/get-dynamic-fee', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            fromTokenSymbol: fromToken.symbol,
                            toTokenSymbol: toToken.symbol,
                            chainId: TARGET_CHAIN_ID,
                        }),
                    });
                    const feeData = await feeResponse.json();
                    if (!feeResponse.ok) {
                        throw new Error(feeData.message || feeData.errorDetails || 'Failed to fetch dynamic fee');
                    }
                    fetchedDynamicFee = Number(feeData.dynamicFee);
                    if (isNaN(fetchedDynamicFee)) {
                        throw new Error('Dynamic fee received is not a number: ' + feeData.dynamicFee);
                    }
                } else {
                    // Multihop - fetch fees for each pool in the route
                    
                    // For multihop, we'll use the first pool's fee as the primary fee
                    // In a more sophisticated implementation, this could be weighted average or other logic
                    const firstPool = route.pools[0];
                    const feeResponse = await fetch('/api/swap/get-dynamic-fee', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            fromTokenSymbol: firstPool.token0,
                            toTokenSymbol: firstPool.token1,
                            chainId: TARGET_CHAIN_ID,
                        }),
                    });
                    const feeData = await feeResponse.json();
                    if (!feeResponse.ok) {
                        throw new Error(feeData.message || feeData.errorDetails || 'Failed to fetch dynamic fee for multihop route');
                    }
                    fetchedDynamicFee = Number(feeData.dynamicFee);
                    if (isNaN(fetchedDynamicFee)) {
                        throw new Error('Dynamic fee received is not a number: ' + feeData.dynamicFee);
                    }
                    

                }

            } catch (feeError: any) {
                console.error("[handleConfirmSwap] Error fetching dynamic fee:", feeError);
                toast.error("Could not fetch swap fee. Please try again.", {
                  icon: <WarningToastIcon /> // ENSURED ICON
                });
                setIsSwapping(false);
                setSwapProgressState("error"); // Or back to "ready_to_swap" to allow retry
                return;
            }
            // >>> END FETCH ROUTE AND DYNAMIC FEES <<<

            const effectiveTimestamp = BigInt(Math.floor(Date.now() / 1000));
            const effectiveFallbackSigDeadline = effectiveTimestamp + BigInt(30 * 60); // 30 min fallback

            // Calculate minimum received amount using quote-based calculation (same as UI display)
            const quotedAmount = parseFloat(toAmount || "0");
            const minimumReceivedAmount = quotedAmount > 0 ? quotedAmount * (1 - slippage / 100) : 0;
            const minimumReceivedStr = minimumReceivedAmount.toString();

            // Extract permit information based on the new API structure
            let permitNonce, permitExpiration, permitSigDeadline;
            if (permitDetailsToUse.needsPermit === false && permitDetailsToUse.existingPermit) {
                // Use existing permit data
                permitNonce = permitDetailsToUse.existingPermit.nonce;
                permitExpiration = permitDetailsToUse.existingPermit.expiration;
                permitSigDeadline = effectiveFallbackSigDeadline.toString(); // Use fallback for existing permits
            } else if (permitDetailsToUse.needsPermit === true && permitDetailsToUse.permitData) {
                // Use new permit data
                permitNonce = permitDetailsToUse.permitData.message.details.nonce;
                permitExpiration = permitDetailsToUse.permitData.message.details.expiration;
                permitSigDeadline = permitDetailsToUse.permitData.message.sigDeadline.toString();
            } else {
                throw new Error("Invalid permit data structure");
            }

            const bodyForSwapTx = {
                 userAddress: accountAddress,
                 fromTokenSymbol: fromToken.symbol,
                 toTokenSymbol: toToken.symbol,
                 swapType: 'ExactIn', // Assuming ExactIn, adjust if dynamic
                 amountDecimalsStr: fromAmount, // The actual amount user wants to swap
                 limitAmountDecimalsStr: minimumReceivedStr, // Pass the slippage-adjusted minimum amount
                 
                 permitSignature: signatureToUse || "0x", 
                 permitTokenAddress: fromToken.address, // Token that was permitted (fromToken)
                 permitAmount: MaxUint160.toString(),   // The amount specified in the signed permit (always MaxUint160)
                 permitNonce: permitNonce, 
                 permitExpiration: permitExpiration, 
                 permitSigDeadline: permitSigDeadline,
                 chainId: currentChainId,
                 dynamicSwapFee: fetchedDynamicFee, // <<< PASS THE FETCHED FEE
            };

            // --- Call Build TX API ---
            const buildTxApiResponse = await fetch('/api/swap/build-tx', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyForSwapTx),
            });
            const buildTxApiData = await buildTxApiResponse.json();

            if (!buildTxApiResponse.ok) {
                 // Throw an error that includes details from the API response if possible
                 const errorInfo = buildTxApiData.message || 'Failed to build transaction';
                 const cause = buildTxApiData.errorDetails || buildTxApiData.error;
                 throw new Error(errorInfo, { cause: cause });
            }

            window.swapBuildData = buildTxApiData; 
            setSwapProgressState("executing_swap");
            const txHash = await sendSwapTx({
                address: getAddress(buildTxApiData.to),
                abi: UniversalRouterAbi,
                functionName: 'execute',
                args: [buildTxApiData.commands as Hex, buildTxApiData.inputs as Hex[], BigInt(buildTxApiData.deadline)],
                value: BigInt(buildTxApiData.value),
            });
            if (!txHash) throw new Error("Failed to send swap transaction (no hash received)");

            console.log("ETH Swap - Transaction Hash received:", txHash);
            setSwapTxInfo({ 
                hash: txHash as string,
                fromAmount: fromAmount,
                fromSymbol: fromToken.symbol,
                toAmount: toAmount,
                toSymbol: toToken.symbol,
                explorerUrl: `https://sepolia.basescan.org/tx/${txHash}`
            });
            console.log("ETH Swap - setSwapTxInfo called with hash:", txHash);

            setSwapProgressState("waiting_confirmation");
            console.log("ETH Swap - Waiting for confirmation of hash:", txHash);
            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex });

            if (!receipt || receipt.status !== 'success') throw new Error("Swap transaction failed on-chain");

            console.log("ETH Swap - Transaction confirmed! Hash:", txHash, "Receipt:", receipt);
            setSwapProgressState("complete");
            setIsSwapping(false);
            
            // Only show success view after transaction is confirmed
            console.log("ETH Swap - Setting success state for hash:", txHash);
            setSwapState("success");
            return;
        }

        // ACTION: Unexpected State (Safety net)
        else {
            console.warn("[handleConfirmSwap] Called in unexpected state:", stateBeforeAction);
            setIsSwapping(false); // Ensure button is re-enabled
        }

    } catch (err: any) {
        // 3. Centralized Error Handling
        console.error("[handleConfirmSwap] Error during action:", err);
        setIsSwapping(false); // Always re-enable button on error

        // Check for specific slippage error first
        let isSlippageError = false;
        if (err instanceof Error) {
            const errorMessage = err.message;
            // Check for V4TooLittleReceived error (0x8b063d73)
            if (errorMessage.includes("0x8b063d73") || 
                errorMessage.toLowerCase().includes("v4toolittlereceived") ||
                errorMessage.toLowerCase().includes("too little received")) {
                isSlippageError = true;
            }
        }

        if (isSlippageError) {
            toast.error("Slippage Too Large", {
                description: "The swap would receive less than your minimum. Try increasing slippage tolerance or reducing trade size.",
                icon: <WarningToastIcon />,
                duration: 5000,
            });
            setSwapProgressState("error");
            window.swapBuildData = undefined;
            return;
        }

        // Basic error parsing (adapt your existing logic if more sophisticated)
        let displayError = "An unknown error occurred";
        let isUserRejection = false;
        if (err instanceof Error) {
            displayError = err.message;
            // Check for common rejection patterns (adjust as needed for specific wallet errors)
            if (displayError.toLowerCase().includes("user rejected") ||
                displayError.toLowerCase().includes("request rejected") ||
                displayError.toLowerCase().includes("action rejected") || // Add other common phrases
                 (err as any).code === 4001 // Standard EIP-1193 user rejection code
                ) {
                isUserRejection = true;
            }
        } else if (typeof err === 'string') {
            displayError = err;
        }

        if (isUserRejection) {
            toast("Transaction Rejected", {
                 description: "The request was rejected in your wallet.",
                 icon: <WarningToastIcon />, duration: 4000,
            });
            // Reset state to before the rejected action, allowing a clean retry of that specific step
            setSwapProgressState(stateBeforeAction);
        } else {
            toast("Swap Failed", {
                 description: displayError, // Show the specific error message
                 icon: <WarningToastIcon />, duration: 5000,
            });
            // For other errors, go to a general error state to avoid infinite loops if the error is persistent
            setSwapProgressState("error");
        }

        window.swapBuildData = undefined; // Clear potentially stale build data on any error
    }
  };

  // This function now opens the MODAL
  // No changes needed here, as it's correctly linked to setIsFeeChartModalOpen
  // The logic for handling isMobile is already in place.

  // --- RENDER LOGIC --- 
        // Determine which token is aUSDC and which is aUSDT for display purposes, regardless of from/to state
  const displayFromToken = fromToken; // This is what's in the 'Sell' slot
  const displayToToken = toToken;   // This is what's in the 'Buy' slot

  // isLoading for balances - now using dynamic loading states
  const isLoadingCurrentFromTokenBalance = isLoadingFromTokenBalance;
  const isLoadingCurrentToTokenBalance = isLoadingToTokenBalance;
  
  // Action button text logic - RESTORED
  let actionButtonText = "Connect Wallet";
  let actionButtonDisabled = false;

  if (!isMounted) {
    actionButtonText = "Loading...";
    actionButtonDisabled = true;
  } else if (isConnected) {
    if (currentChainId !== TARGET_CHAIN_ID) {
      actionButtonText = isAttemptingSwitch ? "Switching..." : `Switch to Base Sepolia`; 
      actionButtonDisabled = isAttemptingSwitch;
    } else if (isLoadingCurrentFromTokenBalance || isLoadingCurrentToTokenBalance) {
      actionButtonText = "Loading Balances...";
      actionButtonDisabled = true;
    } else {
      actionButtonText = "Swap";
      // Ensure fromAmount is treated as a number for comparison, default to 0 if undefined/empty
      actionButtonDisabled = parseFloat(fromAmount || "0") <= 0;
    }
  } else {
    // Wallet not connected, button should show "Connect Wallet"
    // The actual connection is handled by <appkit-button>
    actionButtonText = "Connect Wallet"; 
    actionButtonDisabled = false; // <appkit-button> handles its own state
  }
  // END RESTORED BLOCK

  const userIsOnTargetChain = isConnected && currentChainId === TARGET_CHAIN_ID;

  // Add a new helper function to render the step indicator
  const renderStepIndicator = (step: string, currentStep: SwapProgressState, completed: SwapProgressState[]) => {
    const isActive = 
      (step === "approval" && ["needs_approval", "approving", "waiting_approval"].includes(currentStep)) ||
      (step === "signature" && ["needs_signature", "signing_permit"].includes(currentStep)) ||
      (step === "transaction" && ["building_tx", "executing_swap", "waiting_confirmation"].includes(currentStep));
    
    // Be very specific about what counts as completed
    const isCompleted = 
      (step === "approval" && completed.includes("approval_complete")) ||
      (step === "signature" && completed.includes("signature_complete")) ||
      (step === "transaction" && completed.includes("complete"));

    return (
      <div className="flex items-center justify-between">
        <span className={isActive ? "font-medium" : isCompleted ? "text-foreground" : "text-muted-foreground"}>
          {step === "approval" && "Token Approval"}
          {step === "signature" && "Sign Token Allowance"}
          {step === "transaction" && "Send Swap Transaction"}
        </span>
        <span>
          {isCompleted ? (
            <CheckIcon className="h-4 w-4 text-foreground" />
          ) : isActive ? (
            <ActivityIcon className="h-4 w-4 animate-pulse" />
          ) : (
            <MinusIcon className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
      </div>
    );
  };

  // Now, let's update the handleSwapAgain function to use the same reset logic
  const getStepIcon = () => {
    if (isSwapping) {
      return <RefreshCwIcon className="h-8 w-8 text-slate-50 dark:text-black animate-spin" />;
    }
    
    // Explicitly check each state
    switch(swapProgressState) {
      case "needs_approval":
      case "approving":
      case "waiting_approval":
        return <CoinsIcon className="h-8 w-8 text-slate-50 dark:text-black" />;
        
      case "needs_signature":
      case "signing_permit":
      case "signature_complete":
        return <FileTextIcon className="h-8 w-8 text-slate-50 dark:text-black" />;
        
      case "building_tx":
      case "executing_swap":
      case "waiting_confirmation":
        return <WalletIcon className="h-8 w-8 text-slate-50 dark:text-black" />;
        
      default:
        // Default to file text icon if we can't determine
        return <FileTextIcon className="h-8 w-8 text-slate-50 dark:text-black" />;
    }
  };

  // Add back handleEditTokens, handleSwapAgain, and handleCyclePercentage functions that were accidentally removed
  const handleEditTokens = () => {
    // Use our working reset function
    handleChangeButton();
  };

  const handleSwapAgain = () => {
    // Use our working reset function
    handleChangeButton();
    
    // Additionally reset amounts since this is for a new swap
    setFromAmount("0");
    setToAmount("");
  };

  // Calculate actual percentage based on fromAmount and balance
  const fromTokenBalance = parseFloat(fromToken.balance || "0"); // Use current fromToken state
  const fromAmountNum = parseFloat(fromAmount || "0");
  let actualNumericPercentage = 0;
  if (fromTokenBalance > 0 && fromAmountNum > 0) {
    actualNumericPercentage = (fromAmountNum / fromTokenBalance) * 100; // Can be > 100 or < 0 if input is wild
    
    // Special case: If we're using the exact balance from the blockchain, force it to 100%
    // This ensures the vertical line UI shows up when using handleUseFullBalance
    if (fromTokenBalanceData && fromAmount === fromTokenBalanceData.formatted) {
      actualNumericPercentage = 100;
    }
  }
  // Do not clamp actualNumericPercentage here, let OutlineArcIcon handle visual clamping / over_limit

  // Determine the stepped percentage for the icon (current selection)
  const currentSteppedPercentage = selectedPercentageIndex === -1 ? 0 : cyclePercentages[selectedPercentageIndex];

  const handleCyclePercentage = () => {
    const currentActualIsOverLimit = actualNumericPercentage > 100;

    if (currentActualIsOverLimit) {
      // Use handleUseFullBalance directly which now uses exact blockchain data
      handleUseFullBalance(fromToken, true);
      setSelectedPercentageIndex(cyclePercentages.indexOf(100)); // Sets selected step to 100%
    } else {
      let nextIndex = selectedPercentageIndex + 1;
      if (nextIndex >= cyclePercentages.length) nextIndex = -1; // Cycle back to 0% (manual/reset state)
      setSelectedPercentageIndex(nextIndex);
      if (nextIndex !== -1) {
        handleUsePercentage(cyclePercentages[nextIndex]);
      } else {
        setFromAmount("0"); // Reset amount if cycling back to -1 index for 0%
      }
    }
    setHoveredArcPercentage(null); // Clear hover preview on any click
  };

  const handleMouseEnterArc = () => {
    let nextIndexPreview = selectedPercentageIndex + 1;
    if (nextIndexPreview >= cyclePercentages.length) nextIndexPreview = -1;
    const nextPercentagePreview = nextIndexPreview === -1 ? 0 : cyclePercentages[nextIndexPreview];
    setHoveredArcPercentage(nextPercentagePreview);
  };

  const handleMouseLeaveArc = () => {
    setHoveredArcPercentage(null);
  };

  const handleSlippageChange = (newSlippage: number) => {
    setSlippage(newSlippage);
  };

  const strokeWidth = 2; // Define strokeWidth for the SVG rect elements

  // Memoize poolInfo to prevent unnecessary chart re-renders
  const poolInfo = useMemo(() => {
    if (!currentRoute || currentRoute.pools.length === 0) {
      return undefined;
    }
    
    const poolIndex = Math.min(selectedPoolIndexForChart, currentRoute.pools.length - 1);
    const selectedPool = currentRoute.pools[poolIndex];
    
    return {
      token0Symbol: selectedPool.token0,
      token1Symbol: selectedPool.token1,
      poolName: selectedPool.poolName
    };
  }, [currentRoute, selectedPoolIndexForChart]);

  // Create a stable key for fee history to prevent unnecessary reloads
  const feeHistoryKey = useMemo(() => {
    if (!isMounted) {
      return null;
    }
    if (!isConnected || currentChainId !== TARGET_CHAIN_ID || !currentRoute) {
      return null;
    }
    
    let poolIdForHistory: string | undefined;
    if (currentRoute.pools.length > 0) {
      const poolIndex = Math.min(selectedPoolIndexForChart, currentRoute.pools.length - 1);
      poolIdForHistory = currentRoute.pools[poolIndex].subgraphId;
    }
    
    return poolIdForHistory ? `${poolIdForHistory}_${selectedPoolIndexForChart}` : null;
  }, [isMounted, isConnected, currentChainId, TARGET_CHAIN_ID, currentRoute, selectedPoolIndexForChart]);

  // Effect to fetch historical fee data - with session caching and optimized loading
  useEffect(() => {
    const fetchHistoricalFeeData = async () => {
      if (!feeHistoryKey || !currentRoute) {
        setFeeHistoryData([]);
        return; // Preview is always mounted, just no data
      }

      // Get the selected pool's subgraph ID
      const poolIndex = Math.min(selectedPoolIndexForChart, currentRoute.pools.length - 1);
      const poolIdForFeeHistory = currentRoute.pools[poolIndex].subgraphId;
      const selectedPool = currentRoute.pools[poolIndex];

      const cacheKey = `feeHistory_${poolIdForFeeHistory}_30days`;
      
      // Check if we already have data in sessionStorage with expiration
      try {
        const cachedItem = sessionStorage.getItem(cacheKey);
        if (cachedItem) {
          const cached = JSON.parse(cachedItem);
          const now = Date.now();
          
          // Cache expires after 10 minutes (600,000 ms)
          if (cached.timestamp && (now - cached.timestamp) < 600000 && cached.data) {

            setFeeHistoryData(cached.data);
            setIsFeeHistoryLoading(false);
            setFeeHistoryError(null);
            return;
          } else {

            sessionStorage.removeItem(cacheKey); // Clean up expired cache
          }
        }
      } catch (error) {
        console.warn('Failed to load cached fee history data:', error);
        sessionStorage.removeItem(cacheKey); // Clean up corrupted cache
      }

      // Prevent duplicate API calls
      isFetchingFeeHistoryRef.current = true;
      setIsFeeHistoryLoading(true);
      setFeeHistoryError(null);
      // No explicit hide/show here, AnimatePresence handles visibility via 'animate' prop

      try {
        const response = await fetch(`/api/liquidity/get-historical-dynamic-fees?poolId=${poolIdForFeeHistory}&days=30`);
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || `Failed to fetch historical fee data: ${response.statusText}`);
        }
        const data: FeeHistoryPoint[] = await response.json();
        
        if (data && data.length > 0) {
            // Cache the data in sessionStorage with timestamp
            try {
              const cacheData = {
                data: data,
                timestamp: Date.now()
              };
              sessionStorage.setItem(cacheKey, JSON.stringify(cacheData));
            } catch (error) {
              console.warn('Failed to cache fee history data:', error);
            }
            
            setFeeHistoryData(data);

        } else {
            setFeeHistoryData([]);
        }

      } catch (error: any) {
        console.error("Failed to fetch historical fee data:", error);
        setFeeHistoryError(error.message || "Could not load fee history.");
        setFeeHistoryData([]);
      } finally {
        setIsFeeHistoryLoading(false);
        isFetchingFeeHistoryRef.current = false;
      }
    };

    // Fire immediately to avoid double render flash; rely on stable key deps for throttling
    fetchHistoricalFeeData();
    return () => {};
  }, [feeHistoryKey, currentRoute, selectedPoolIndexForChart]); // Optimized dependencies

  // Helper functions for action button text and disabled state
  const getActionButtonText = (): string => {
    if (!isMounted) {
      return "Loading...";
    } else if (isConnected) {
      if (currentChainId !== TARGET_CHAIN_ID) {
        return isAttemptingSwitch ? "Switching..." : "Switch to Base Sepolia";
      } else if (isLoadingCurrentFromTokenBalance || isLoadingCurrentToTokenBalance) {
        return "Loading Balances...";
      } else {
        return "Swap";
      }
    } else {
      return "Connect Wallet";
    }
  };

  const getActionButtonDisabled = (): boolean => {
    if (!isMounted) {
      return true;
    } else if (isConnected) {
      if (currentChainId !== TARGET_CHAIN_ID) {
        return isAttemptingSwitch;
      } else if (isLoadingCurrentFromTokenBalance || isLoadingCurrentToTokenBalance) {
        return true;
      } else {
        return parseFloat(fromAmount || "0") <= 0;
      }
    } else {
      return false; // <appkit-button> handles its own state
    }
  };

  // Add state for token prices
  const [tokenPrices, setTokenPrices] = useState<{
    BTC: number;
    USDC: number;
    ETH: number;
    timestamp?: number;
  }>({
    BTC: 77000, // Default fallback price
    USDC: 1,    // Default fallback price
    ETH: 3500,  // Default fallback price
  });
  
  // Effect to fetch token prices periodically
  useEffect(() => {
    if (!isMounted) return;
    
    // Function to fetch prices using the simplified API
    const fetchPrices = async () => {
      try {
        const response = await fetch('/api/prices/get-token-prices');
        if (!response.ok) {
          throw new Error(`Error fetching prices: ${response.status}`);
        }
        
        const data = await response.json();

        
        setTokenPrices(data);
      } catch (error) {
        console.error('Error fetching token prices:', error);
        // Keep using existing prices as fallback
      }
    };
    
    // Fetch prices immediately
    fetchPrices();
    
    // Set up periodic refresh (every 5 minutes to match cache duration)
    const priceRefreshInterval = setInterval(fetchPrices, 5 * 60 * 1000);
    
    return () => {
      clearInterval(priceRefreshInterval);
    };
  }, [isMounted]);
  
  // Update token prices when tokenPrices changes
  useEffect(() => {
    if (!tokenPrices) return;
    
    // Update fromToken price, only if it changes
    setFromToken(prev => {
      const priceType = getTokenPriceMapping(prev.symbol);
      const newPrice = tokenPrices[priceType] || prev.usdPrice;
      if (prev.usdPrice === newPrice) return prev;
      return { ...prev, usdPrice: newPrice };
    });
    
    // Update toToken price, only if it changes
    setToToken(prev => {
      const priceType = getTokenPriceMapping(prev.symbol);
      const newPrice = tokenPrices[priceType] || prev.usdPrice;
      if (prev.usdPrice === newPrice) return prev;
      return { ...prev, usdPrice: newPrice };
    });
    
    // Update all available tokens in the list with fresh prices
    setTokenList(prevList => 
      prevList.map(token => {
        const priceType = getTokenPriceMapping(token.symbol);
        return {
          ...token,
          usdPrice: tokenPrices[priceType] || token.usdPrice
        };
      })
    );
    
  }, [tokenPrices]);

  const containerRef = useRef<HTMLDivElement>(null); // Ref for the entire swap container (card + chart)
  const [combinedRect, setCombinedRect] = useState({
    top: 0, left: 0, width: 0, height: 0
  });

  // Ultra-simple rect calculation using the entire container
  const getContainerRect = useCallback(() => {
    if (!containerRef.current) {
      return { top: 0, left: 0, width: 0, height: 0 };
    }

    const rect = containerRef.current.getBoundingClientRect();
    
    return {
      top: rect.top,
      left: rect.left, 
      width: rect.width,
      height: rect.height
    };
  }, []);

  useEffect(() => {
    // Update rect calculation with a small delay to ensure DOM has updated
    const updateRect = () => {
      // Immediate update
      setCombinedRect(getContainerRect());
      
      // Delayed update to catch any async DOM changes
      setTimeout(() => {
        setCombinedRect(getContainerRect());
      }, 10);
    };

    updateRect(); 

    // Add listeners for dynamic changes
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect);

    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect);
    };
  }, [
    isMounted, // Ensures window is available
    getContainerRect,
    // Add dependencies that affect SwapInputView height
    fromAmount, // When amount changes, fee info appears/disappears
    toAmount, // When quote changes, it might affect height
    routeInfo, // When route changes, route info appears/disappears
    routeFees, // When route fees load, fee info changes
    routeFeesLoading, // When fees are loading, content changes
    isConnected, // Connection state affects what's shown
    currentChainId, // Chain affects what's shown
    quoteLoading, // When quote is loading, content might change
    calculatedValues, // When calculated values change, minimum received changes
  ]);
  
  // NEW: Add navigation handlers for chart preview
  const handleNextPool = useCallback(() => {
    if (currentRoute && selectedPoolIndexForChart < currentRoute.pools.length - 1) {
      setSelectedPoolIndexForChart(prevIndex => prevIndex + 1);
    }
  }, [currentRoute, selectedPoolIndexForChart]);

  const handlePreviousPool = useCallback(() => {
    if (currentRoute && selectedPoolIndexForChart > 0) {
      setSelectedPoolIndexForChart(prevIndex => prevIndex - 1);
    }
  }, [currentRoute, selectedPoolIndexForChart]);

  // NEW: Determine if chart preview should be shown at all (always show; content decides skeleton vs data)
  const showChartPreviewRegardlessOfData = isMounted;

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
    
    return parseUnits(finalString, decimals);
  };

  return (
    <div className="flex flex-col" ref={containerRef}> {/* Container ref wraps everything */}
      {/* Main Swap Interface Card */}
      <Card className="w-full max-w-md card-gradient z-10 mx-auto rounded-lg bg-[var(--swap-background)] border-[var(--swap-border)]"> {/* Applied styling here */} 
        {/* <CardHeader className="pt-6 pb-2">
            <CardTitle className="text-center">Swap Tokens</CardTitle>
        </CardHeader> */}
        <CardContent className="p-6 pt-6"> {/* Removed border and background styling */}
          <AnimatePresence mode="wait">
            {swapState === "input" && (
              <SwapInputView
                displayFromToken={displayFromToken}
                displayToToken={displayToToken}
                fromAmount={fromAmount}
                toAmount={toAmount}
                handleFromAmountChange={handleFromAmountChange}
                handleSwapTokens={handleSwapTokens}
                handleUseFullBalance={handleUseFullBalance}
                availableTokens={tokenList}
                onFromTokenSelect={handleFromTokenSelect}
                onToTokenSelect={handleToTokenSelect}
                handleCyclePercentage={handleCyclePercentage}
                routeInfo={routeInfo}
                routeFees={routeFees}
                routeFeesLoading={routeFeesLoading}
                selectedPoolIndexForChart={selectedPoolIndexForChart}
                onSelectPoolForChart={handleSelectPoolForChart}
                handleMouseEnterArc={handleMouseEnterArc}
                handleMouseLeaveArc={handleMouseLeaveArc}
                actualNumericPercentage={actualNumericPercentage}
                currentSteppedPercentage={currentSteppedPercentage}
                hoveredArcPercentage={hoveredArcPercentage}
                isSellInputFocused={isSellInputFocused}
                setIsSellInputFocused={setIsSellInputFocused}
                onRouteHoverChange={undefined}
                formatCurrency={formatCurrency}
                isConnected={isConnected}
                isAttemptingSwitch={isAttemptingSwitch}
                isLoadingCurrentFromTokenBalance={isLoadingCurrentFromTokenBalance}
                isLoadingCurrentToTokenBalance={isLoadingCurrentToTokenBalance}
                calculatedValues={calculatedValues}
                dynamicFeeLoading={dynamicFeeLoading}
                quoteLoading={quoteLoading}
                quoteError={quoteError}
                actionButtonText={getActionButtonText()}
                actionButtonDisabled={getActionButtonDisabled()}
                handleSwap={handleSwap}
                isMounted={isMounted}
                currentChainId={currentChainId}
                TARGET_CHAIN_ID={TARGET_CHAIN_ID}
                strokeWidth={2}
                swapContainerRect={combinedRect} // Pass the new combined rect
                slippage={slippage}
                onSlippageChange={handleSlippageChange}
              />
            )}

            {/* Swapping State UI (largely preserved, uses calculatedValues) */}
            {swapState === "review" && (
              <SwapReviewView
                displayFromToken={displayFromToken}
                displayToToken={displayToToken}
                calculatedValues={calculatedValues}
                handleChangeButton={handleChangeButton}
                handleConfirmSwap={handleConfirmSwap}
                swapProgressState={swapProgressState}
                completedSteps={completedSteps}
                isSwapping={isSwapping}
              />
            )}

            {/* Success State UI (largely preserved, uses calculatedValues) */}
            {swapState === "success" && (
              <SwapSuccessView
                displayFromToken={displayFromToken}
                displayToToken={displayToToken}
                calculatedValues={calculatedValues} // Pass the whole object, child will pick what it needs
                swapTxInfo={swapTxInfo}
                handleChangeButton={handleChangeButton} // Ensure this is the correct handler for "Swap Again"
                formatTokenAmountDisplay={formatTokenAmountDisplay}
              />
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Preview Chart Row with external nav arrows */}
      <div className="w-full relative">
        <div className="w-full max-w-md mx-auto relative group">
          {/* Hover buffer extends horizontally so arrows remain clickable while visible */}
          <div className="absolute inset-y-0 left-[-2.75rem] right-[-2.75rem]"></div>
          <div className="relative">
          <AnimatePresence>
            {/* The motion.div is now always mounted, and its animation controls its visibility/size. */}
            <motion.div
              key="dynamic-fee-preview-auto"
              className="w-full"
              initial={{ y: -10, opacity: 0.5, height: '80px', marginTop: '24px' }}
              animate={showChartPreviewRegardlessOfData ? { y: 0, opacity: 1, height: 'auto', marginTop: '16px' } : { y: -10, opacity: 0, height: '0px', marginTop: '0px' }}
              transition={{ type: "spring", stiffness: 300, damping: 30, duration: 0.2 }}
              onAnimationComplete={() => {
                setCombinedRect(getContainerRect());
              }}
            >
              <DynamicFeeChartPreview 
                data={(!isConnected || !currentRoute || isFeeHistoryLoading) ? [] : feeHistoryData} 
                onClick={handlePreviewChartClick}
                poolInfo={poolInfo}
                isLoading={isFeeHistoryLoading}
                alwaysShowSkeleton={!isConnected || !currentRoute || isFeeHistoryLoading}
                totalPools={currentRoute?.pools?.length}
                activePoolIndex={selectedPoolIndexForChart}
              />
            </motion.div>
          </AnimatePresence>

          {/* External nav arrows - positioned outside the preview container by 1rem (16px) */}
          {currentRoute && currentRoute.pools.length > 1 && (
            <>
              {selectedPoolIndexForChart > 0 && (
                <button
                  type="button"
                  aria-label="Previous pool"
                  onClick={handlePreviousPool}
                  className="absolute left-[-2.5rem] top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-white opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-150"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
              )}
              {selectedPoolIndexForChart < currentRoute.pools.length - 1 && (
                <button
                  type="button"
                  aria-label="Next pool"
                  onClick={handleNextPool}
                  className="absolute right-[-2.5rem] top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-white opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-150"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              )}
            </>
          )}
          {/* Dots below container for multihop */}
          {currentRoute && currentRoute.pools.length > 1 && (
            <div className="w-full flex justify-center gap-1.5 mt-2">
              {currentRoute.pools.map((_, i) => (
                <span
                  key={i}
                  className={`h-[5px] w-[5px] rounded-full ${i === selectedPoolIndexForChart ? 'bg-muted-foreground/60' : 'bg-[var(--sidebar-border)]'}`}
                />
              ))}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Full Chart Modal - Controlled by isFeeChartModalOpen - Moved outside the mapping */}
      <Dialog open={isFeeChartModalOpen} onOpenChange={setIsFeeChartModalOpen}>
        {/* No DialogTrigger here, it's opened programmatically via the preview click */}
        <DialogContent className="sm:max-w-3xl p-0 outline-none ring-0 border-0 shadow-2xl rounded-lg">
          <DialogTitle className="sr-only">Dynamic Fee Chart</DialogTitle>
          <DynamicFeeChart data={feeHistoryData} />
          {/* Default Dialog close button will be used */}
        </DialogContent>
      </Dialog>
    </div> /* Ensure this closing div is correct */
  );
}

