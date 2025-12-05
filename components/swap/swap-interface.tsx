"use client"

import * as Sentry from "@sentry/nextjs"
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
  OctagonX,
  BadgeCheck,
} from "lucide-react"
import Image from "next/image"
import { useAccount, useBalance, useSignTypedData, useWriteContract, useWaitForTransactionReceipt } from "wagmi"
import { useQueryClient } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import React from "react"
import { switchChain } from '@wagmi/core'
import { config, baseSepolia, activeChain, activeChainId, isMainnet, getExplorerTxUrl } from "../../lib/wagmiConfig";
import { toast } from "sonner";
import { getAddress, parseUnits, formatUnits, maxUint256, type Address, type Hex } from "viem"
import { publicClient } from "../../lib/viemClient";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSwapPercentageInput } from "@/hooks/usePercentageInput";
import { useUserSlippageTolerance } from "@/hooks/useSlippage";
import { getAutoSlippage } from "@/lib/slippage-api";
import { isInfiniteApprovalEnabled } from "@/hooks/useUserSettings";
import { useTokenUSDPrice } from "@/hooks/useTokenUSDPrice";

import {
  getAllTokens,
  getToken,
  createTokenSDK,
  TokenSymbol,
  getTokenDefinitions,
  CHAIN_ID
} from "@/lib/pools-config"
import { useNetwork } from "@/lib/network-context"
import { useChainMismatch } from "@/hooks/useChainMismatch"
import {
  PERMIT2_ADDRESS,
  UniversalRouterAbi,
  Erc20AbiDefinition,
  PERMIT_TYPES,
  getPermit2Domain,
} from "@/lib/swap-constants"
import { invalidateAfterTx } from "@/lib/invalidation"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { cn, formatTokenDisplayAmount } from "@/lib/utils"

// Modal Imports
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";

// Chart Import
import { DynamicFeeChart, generateMockFeeHistory } from "../dynamic-fee-chart";
import { DynamicFeeChartPreview } from "../dynamic-fee-chart-preview";
// Deprecated cache functions removed - dynamic fee fetching happens directly via API
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

const TARGET_CHAIN_ID = activeChainId;

const getTokenPriceMapping = (tokenSymbol: string): 'BTC' | 'USDC' | 'ETH' | 'DAI' => {
  switch (tokenSymbol) {
    case 'aBTC':
      return 'BTC';
    case 'aUSDC':
    case 'aUSDT':
      return 'USDC'; // Using USDC price for all USD stablecoins
    case 'aDAI':
    case 'DAI':
      return 'DAI';
    case 'aETH':
    case 'ETH':
      return 'ETH';
    default:
      return 'USDC'; // Default fallback
  }
};

/**
 * Helper function to invalidate cache after swap
 * Consolidates duplicate invalidation logic from native and permit2 swap paths
 */
const invalidateSwapCache = async (
  queryClient: any,
  accountAddress: string,
  chainId: number,
  touchedPools: Array<{ poolId: string }>,
  swapVolumeUSD: number,
  blockNumber: bigint
) => {
  if (!touchedPools?.length) {
    return;
  }

  const volumePerPool = swapVolumeUSD / touchedPools.length;

  for (const pool of touchedPools) {
    invalidateAfterTx(queryClient, {
      owner: accountAddress,
      chainId,
      poolId: pool.poolId,
      reason: 'swap_complete',
      awaitSubgraphSync: false, // Don't block UX
      blockNumber,
      optimisticUpdates: { volumeDelta: volumePerPool }
    }).catch(err => {
      console.error(`[Swap] Cache invalidation failed for pool ${pool.poolId}:`, err);
    });
  }
};

// Helper function to create Token instances from pools config
const createTokenFromConfig = (tokenSymbol: string, prices: { BTC: number; USDC: number; ETH?: number; DAI?: number } = { BTC: 77000, USDC: 1, ETH: 3500, DAI: 1 }): Token | null => {
  const tokenConfig = getToken(tokenSymbol);
  if (!tokenConfig) return null;
  
  const priceType = getTokenPriceMapping(tokenSymbol);
  const usdPrice = prices[priceType] || 1;

  return {
    address: tokenConfig.address as Address,
    symbol: tokenConfig.symbol,
    name: tokenConfig.name,
    decimals: tokenConfig.decimals,
    balance: "0.000",
    value: "$0.00",
    icon: tokenConfig.icon,
    usdPrice: usdPrice,
  };
};

// Get available tokens for swap
const getAvailableTokens = (prices?: { BTC: number; USDC: number; ETH?: number; DAI?: number }): Token[] => {
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
  // Optional: list of pools touched by the executed route (single or multi-hop)
  // Each entry should include the friendly route id (poolId) and its subgraphId if available
  touchedPools?: Array<{ poolId: string; subgraphId?: string }>;
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

  // Network context for dynamic token definitions
  const { networkMode } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  // Query client for cache invalidation
  const queryClient = useQueryClient();
  // Removed route-row hover logic; arrows only show on preview hover
  
  const [swapState, setSwapState] = useState<SwapState>("input");
  const [swapProgressState, setSwapProgressState] = useState<SwapProgressState>("init");
  const [isSwapping, setIsSwapping] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<SwapProgressState[]>([]);
  const [isAttemptingSwitch, setIsAttemptingSwitch] = useState(false);
  const swapTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Chain mismatch handling - hook manages the toast globally
  const { isMismatched: isChainMismatched, switchToExpectedChain } = useChainMismatch();

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

  // Use the new slippage hook with persistence and auto-slippage
  const {
    currentSlippage,
    isAuto: isAutoSlippage,
    autoSlippage: autoSlippageValue,
    setSlippage,
    setAutoMode,
    setCustomMode,
    updateAutoSlippage,
  } = useUserSlippageTolerance();

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
        // Fetch dynamic fee directly from API (no client-side caching - handled by React Query)
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

        const poolFee = Number(data.dynamicFee);
        if (isNaN(poolFee)) {
          throw new Error(`Dynamic fee received is not a number for ${pool.poolName}: ${data.dynamicFee}`);
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

    const fromTokenSymbolForCache = Object.keys(tokenDefinitions).find(
      (key) => tokenDefinitions[key as TokenSymbol].address === fromToken.address
    ) as TokenSymbol | undefined;
    const toTokenSymbolForCache = Object.keys(tokenDefinitions).find(
      (key) => tokenDefinitions[key as TokenSymbol].address === toToken.address
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

    // CRITICAL FIX: Don't re-fetch quote when returning from review
    // The existing quote data (fromAmount, toAmount, routeInfo) is already correct
    // Re-fetching would cause:
    // 1. Rounding issues for ExactOut (user wants EXACT output preserved)
    // 2. Potential failures for complex multihop routes
    // The amounts and route remain unchanged from what was displayed in review

    // Reset lastEditedSideRef to 'from' for any future edits after returning
    lastEditedSideRef.current = 'from';

    // Note: We're NOT clearing existingPermitData or re-fetching quotes
  };

  // Chain mismatch toast is now handled by useChainMismatch hook globally

  // Effect for Success Notification
  useEffect(() => {
    if (swapState === "success" && swapTxInfo?.hash) {
      const swapDescription = `Swapped ${swapTxInfo.fromAmount} ${swapTxInfo.fromSymbol} to ${swapTxInfo.toAmount} ${swapTxInfo.toSymbol} successfully`;

      toast.success("Swap Successful", {
        icon: <BadgeCheck className="h-4 w-4 text-green-500" />,
        description: swapDescription,
        duration: 4000,
        action: {
          label: "View Transaction",
          onClick: () => window.open(swapTxInfo.explorerUrl, '_blank')
        }
      });
    }
  }, [swapState, swapTxInfo]);

  // --- Dynamic Balance Fetching for current tokens ---
  const { data: fromTokenBalanceData, isLoading: isLoadingFromTokenBalance, error: fromTokenBalanceError, refetch: refetchFromTokenBalance } = useBalance({
    address: accountAddress,
    token: fromToken.address === "0x0000000000000000000000000000000000000000" ? undefined : fromToken.address,
    chainId: TARGET_CHAIN_ID,
    query: {
      enabled: !!accountAddress && !!fromToken.address,
      staleTime: 30000,
      refetchOnWindowFocus: false,
    }
  });

  const { data: toTokenBalanceData, isLoading: isLoadingToTokenBalance, error: toTokenBalanceError, refetch: refetchToTokenBalance } = useBalance({
    address: accountAddress,
    token: toToken.address === "0x0000000000000000000000000000000000000000" ? undefined : toToken.address,
    chainId: TARGET_CHAIN_ID,
    query: {
      enabled: !!accountAddress && !!toToken.address,
      staleTime: 30000,
      refetchOnWindowFocus: false,
    }
  });

  // Use shared percentage input hook for both tokens
  const { handleFromPercentage, handleToPercentage } = useSwapPercentageInput(
    fromTokenBalanceData,
    toTokenBalanceData,
    fromToken,
    toToken,
    setFromAmount,
    setToAmount
  );

  // Listen for faucet claim to refresh balances
  useEffect(() => {
    if (!accountAddress) return;

    const onRefresh = () => {
      Promise.all([refetchFromTokenBalance?.(), refetchToTokenBalance?.()])
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['balance'] })
      }, 2000)
    }

    const onStorage = (e: StorageEvent) => {
      if (!e.key || !accountAddress) return;
      if (e.key === `walletBalancesRefreshAt_${accountAddress}`) onRefresh();
    };

    window.addEventListener('walletBalancesRefresh', onRefresh as EventListener);
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('walletBalancesRefresh', onRefresh as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [accountAddress, refetchFromTokenBalance, refetchToTokenBalance, queryClient]);

  // Update fromToken balance
  useEffect(() => {
    const numericBalance = fromTokenBalanceData ? parseFloat(fromTokenBalanceData.formatted) : 0;
    const displayBalance = formatTokenDisplayAmount(numericBalance.toString(), fromToken.symbol as TokenSymbol);

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
        return { ...prevToken, balance: displayBalance, value: `~$${(numericBalance * prevToken.usdPrice).toFixed(2)}` };
      }
      
      if (!isConnected && prevToken.balance !== "~") {
        return { ...prevToken, balance: "~", value: "$0.00" }; 
      }

      // If no changes, return the existing token object to prevent re-renders
      return prevToken;
    });
  }, [fromTokenBalanceData, fromTokenBalanceError, isLoadingFromTokenBalance, currentChainId, isConnected, fromToken.symbol, fromToken.usdPrice]);

  // Update toToken balance
  useEffect(() => {
    const numericBalance = toTokenBalanceData ? parseFloat(toTokenBalanceData.formatted) : 0;
    const displayBalance = formatTokenDisplayAmount(numericBalance.toString(), toToken.symbol as TokenSymbol);

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
        return { ...prevToken, balance: displayBalance, value: `~$${(numericBalance * prevToken.usdPrice).toFixed(2)}` };
      }
      
      if (!isConnected && prevToken.balance !== "~") {
        return { ...prevToken, balance: "~", value: "$0.00" };
      }
      
      return prevToken;
    });
  }, [toTokenBalanceData, toTokenBalanceError, isLoadingToTokenBalance, currentChainId, isConnected, toToken.symbol, toToken.usdPrice]);

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
  // Uses a 6-decimal cap for shortened display
  const formatTokenAmountDisplay = useCallback((amountString: string, token: Token): string => {
    try {
      const amount = parseFloat(amountString);

      if (isNaN(amount) || amount === 0) return "0"; // Return "0" for invalid or zero input or exact zero

      // Handle very small positive numbers with special string FIRST
      if (amount > 0 && amount < 0.001) return "< 0.001";

      // Use 6-decimal cap for all tokens
      return amount.toFixed(6);

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
            // Set the quoted amount in the UI (use raw value for full precision)
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
            setToAmount(calculatedTo.toString());
          }
        } catch (error: any) {
          console.error('❌ V4 Quoter Exception:', error);
          
          // Show a toast with the error
          toast.error(`Quote Error: ${error.message || 'Failed to fetch quote'}`);
          
          setQuoteError('Failed to fetch quote');
          setRouteInfo(null); // Clear route info on exception

          // Fallback to the calculation using current prices
          const calculatedTo = (fromValue * fromToken.usdPrice) / toToken.usdPrice;
          setToAmount(calculatedTo.toString());
        } finally {
          // Clear loading state
          setQuoteLoading(false);
        }
      } else {
        // Fallback to the calculation using current prices
        const calculatedTo = (fromValue * fromToken.usdPrice) / toToken.usdPrice;
        setToAmount(calculatedTo.toString());
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
      setQuoteLoading(false);
      setQuoteError(null);
      return;
    }

    const parsed = parseFloat(amountStr);
    const isZeroOrInvalid = isNaN(parsed) || parsed <= 0;
    if (isZeroOrInvalid) {
      setToAmount("0");
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
          swapType: lastEditedSideRef.current === 'to' ? 'ExactOut' : 'ExactIn',
          chainId: currentChainId,
          debug: true
        }),
      });

      let data: any = null;
      try {
        data = await response.json();
      } catch (e) {
        // Non-JSON (e.g., HTML error page). Normalize to a structured error.
        const text = await response.text().catch(() => '');
        console.error('❌ V4 Quoter Non-JSON response:', text?.slice(0, 200));
        data = { success: false, error: 'Failed to get quote' };
      }

      if (response.ok && data.success) {
        if (data.swapType === 'ExactOut') {
          // When editing Buy, backfill Sell only;
          // never mutate Buy to preserve user typing (incl. trailing dot)
          setFromAmount(String(data.fromAmount ?? ""));
        } else {
          // ExactIn flow: update Buy value from quote
          setToAmount(String(data.toAmount ?? ""));
        }
        setRouteInfo(data.route || null);
        // Set price impact from quote response
        if (data.priceImpact !== undefined) {
          const impactValue = parseFloat(data.priceImpact);
          setPriceImpact(impactValue);
        } else {
          setPriceImpact(null);
        }
        setQuoteError(null);
      } else {
        console.error('❌ V4 Quoter Error:', data.error);
        
        // Handle specific error types with appropriate toasts
        const errorMsg = data.error || 'Failed to get quote';
        if (errorMsg === 'Route not available for this amount') {
          toast.error('Quote Error', {
            icon: <OctagonX className="h-4 w-4 text-red-500" />,
            description: 'Route not available. Please refer to our documentation for supported tokens.',
            action: {
              label: "Open Ticket",
              onClick: () => window.open('https://discord.gg/alphix', '_blank')
            }
          });
        } else if (errorMsg === 'Cannot fulfill exact output amount') {
          toast.error('Quote Error', {
            icon: <OctagonX className="h-4 w-4 text-red-500" />,
            description: 'Exact Output failed. Reduce the amount or use exact input instead.',
            action: {
              label: "Open Ticket",
              onClick: () => window.open('https://discord.gg/alphix', '_blank')
            }
          });
        } else {
          toast.error('Quote Error', {
            icon: <OctagonX className="h-4 w-4 text-red-500" />,
            description: 'No Quote received. Input a smaller amount and try again.',
            action: {
              label: "Open Ticket",
              onClick: () => window.open('https://discord.gg/alphix', '_blank')
            }
          });
        }
        
        setQuoteError(errorMsg);
        setPriceImpact(null); // Reset price impact on error
        // Do not infer on error; clear the side we tried to compute
        // Leave the user's actively edited field untouched on error
      }
    } catch (error: any) {
      console.error('❌ V4 Quoter Exception:', error);
      
      // Handle network/connection errors with appropriate messaging
      let errorMsg = 'Failed to fetch quote';
      let toastDescription = 'No Quote received. Input a smaller amount and try again.';
      
      if (error instanceof Error) {
        const errorStr = error.message.toLowerCase();
        
        // Check for smart contract call exceptions (common in ExactOut multihop)
        if (errorStr.includes('call_exception') || 
            errorStr.includes('call revert exception') ||
            (errorStr.includes('0x6190b2b0') || errorStr.includes('0x486aa307'))) {
          if (lastEditedSideRef.current === 'to') {
            errorMsg = 'Route not available for this amount';
            toastDescription = 'Route not available. Please refer to our documentation for supported tokens.';
          } else {
            errorMsg = 'Not enough liquidity';
            toastDescription = 'No Quote received. Input a smaller amount and try again.';
          }
        }
        // Check for network/connection errors
        else if (errorStr.includes('network') || errorStr.includes('connection') || errorStr.includes('timeout')) {
          errorMsg = 'Network error - please try again';
          toastDescription = 'Network error while fetching quote. Please try again.';
        }
        // Check for fetch/HTTP errors
        else if (errorStr.includes('fetch') || errorStr.includes('http')) {
          errorMsg = 'Connection error - please try again';
          toastDescription = 'Network error while fetching quote. Please try again.';
        }
      }
      
      toast.error('Quote Error', {
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description: toastDescription,
        action: {
          label: "Open Ticket",
          onClick: () => window.open('https://discord.gg/alphix', '_blank')
        }
      });
      setQuoteError(errorMsg);
      setPriceImpact(null); // Reset price impact on exception
      // Leave the user's actively edited field untouched on exception
    } finally {
      setQuoteLoading(false);
    }
  }, [fromToken?.symbol, toToken?.symbol, currentChainId, isConnected, fromToken?.usdPrice, toToken?.usdPrice, fromToken?.decimals, toToken?.decimals, TARGET_CHAIN_ID]);

  // Debounced auto-quote for Sell edits (ExactIn)
  const lastEditedSideRef = useRef<'from' | 'to'>('from');
  useEffect(() => {
    if (lastEditedSideRef.current !== 'from') return;
    const handler = setTimeout(() => {
      if (fromAmount === "" || parseFloat(fromAmount) === 0) {
        setToAmount(""); // Keep Buy empty when no Sell amount
        setQuoteLoading(false);
        setQuoteError(null);
        return;
      }
      fetchQuote(fromAmount);
    }, 300);
    return () => clearTimeout(handler);
  }, [fromAmount, fromToken, toToken, isConnected, currentChainId, fetchQuote]);

  // Debounced auto-quote for Buy edits (ExactOut)
  useEffect(() => {
    if (lastEditedSideRef.current !== 'to') return;
    const handler = setTimeout(() => {
      if (toAmount === "" || parseFloat(toAmount) === 0) {
        setQuoteLoading(false);
        setQuoteError(null);
        return;
      }
      fetchQuote(toAmount);
    }, 300);
    return () => clearTimeout(handler);
  }, [toAmount, fromToken, toToken, isConnected, currentChainId, fetchQuote]);

  // Update calculatedValues for UI display
  useEffect(() => {
    const fromValueNum = parseFloat(fromAmount || "0");
    const fromTokenUsdPrice = fromToken.usdPrice || 0; // Ensure usdPrice is a number

    const updatedFeesArray: FeeDetail[] = [];

    // If we have a quote error, skip fee/slippage calcs and show placeholders
    if (quoteError) {
      setPriceImpact(null); // Reset price impact on error
      setCalculatedValues(prev => ({
        ...prev,
        fromTokenAmount: formatTokenAmountDisplay(fromAmount, fromToken),
        fromTokenValue: formatCurrency(((!isNaN(fromValueNum) && fromValueNum >= 0 && fromTokenUsdPrice) ? (fromValueNum * fromTokenUsdPrice) : 0).toString()),
        toTokenAmount: formatTokenAmountDisplay(toAmount, toToken),
        toTokenValue: formatCurrency("0"),
        fees: [{ name: "Fee", value: "-", type: "percentage" }],
        slippage: "-",
        minimumReceived: "-",
      }));
      return;
    }

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
    const minReceivedAmount = quotedAmount > 0 ? quotedAmount * (1 - currentSlippage / 100) : 0;
    const formattedMinimumReceived = formatTokenAmountDisplay(minReceivedAmount.toString(), toToken);

    // Reset price impact when there's no valid quote (same logic as minimumReceived)
    if (!fromAmount || !toAmount || quotedAmount === 0) {
      setPriceImpact(null);
    }

    // Update auto-slippage when quote is received (if in auto mode)
    if (isAutoSlippage && fromAmount && toAmount && fromToken && toToken) {
      // Fetch auto-slippage asynchronously (API with fallback)
      getAutoSlippage({
        sellToken: fromToken.address,
        buyToken: toToken.address,
        chainId: currentChainId || TARGET_CHAIN_ID,
        fromAmount,
        toAmount,
        fromTokenSymbol: fromToken.symbol,
        toTokenSymbol: toToken.symbol,
        routeHops: routeInfo?.hops || 1,
      }).then((calculatedSlippage) => {
        updateAutoSlippage(calculatedSlippage);
      }).catch((error) => {
        console.error('[SwapInterface] Failed to fetch auto-slippage:', error);
      });
    }

    setCalculatedValues(prev => ({
      ...prev,
      fromTokenAmount: formatTokenAmountDisplay(fromAmount, fromToken),
      fromTokenValue: formatCurrency(newFromTokenValue.toString()),
      toTokenAmount: formatTokenAmountDisplay(toAmount, toToken),
      toTokenValue: formatCurrency(newToTokenValue.toString()),
      fees: updatedFeesArray,
      slippage: `${currentSlippage}%`, // Pass slippage as string for display
      minimumReceived: formattedMinimumReceived,
    }));

  }, [fromAmount, toAmount, fromToken?.symbol, fromToken?.usdPrice, toToken?.symbol, toToken?.usdPrice, formatCurrency, isConnected, currentChainId, dynamicFeeLoading, dynamicFeeError, dynamicFeeBps, routeFees, routeFeesLoading, formatTokenAmountDisplay, currentSlippage, isAutoSlippage, routeInfo?.hops, updateAutoSlippage]);

  const handleFromAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^\d*\.?\d*$/.test(value)) {
        setFromAmount(value);
        setSelectedPercentageIndex(-1);
        lastEditedSideRef.current = 'from';
    } else if (value === "") {
        setFromAmount("");
        setSelectedPercentageIndex(-1);
        lastEditedSideRef.current = 'from';
    }
  };

  // Allow editing Buy (toAmount) directly for ExactOut flow
  const handleToAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^\d*\.?\d*$/.test(value)) {
      setToAmount(value);
      lastEditedSideRef.current = 'to';
    } else if (value === "") {
      setToAmount("");
      lastEditedSideRef.current = 'to';
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
    try {
      // Use the hook's switch function - it handles toast feedback
      await switchToExpectedChain();
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
      setCompletedSteps(["approval_complete", "signature_complete"]); // Mark both steps complete for ETH
      setSwapProgressState("ready_to_swap");
      setIsSwapping(false); // Ready for user action (Confirm)
      return;
    }

    const fetchPermitData = async (): Promise<any> => {
      try {
        const parsedAmount = safeParseUnits(fromAmount, fromToken.decimals);
        const response = await fetch('/api/swap/prepare-permit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: accountAddress,
            fromTokenAddress: fromToken.address,
            fromTokenSymbol: fromToken.symbol,
            toTokenSymbol: toToken.symbol,
            chainId: currentChainId,
            amountIn: parsedAmount.toString(),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to fetch permit data');
        return data;
      } catch (fetchError: any) {
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

      // Only clear signature if permit data has changed (different nonce means new permit needed)
      // This preserves signatures when user clicks "Change" and comes back
      setCurrentPermitDetailsForSign((prevPermitData) => {
        const previousNonce = prevPermitData?.permitData?.message?.details?.nonce;
        const newNonce = permitData?.permitData?.message?.details?.nonce;

        // If nonce changed or no previous permit, clear the signature
        if (previousNonce !== newNonce || !prevPermitData) {
          setObtainedSignature(null);
        }

        return permitData;
      });

      const needsSignature = permitData.needsPermit === true;

      // 5. Handle Permit2 Result
      // Check if we already have a valid signature (preserved from previous review attempt)
      if (needsSignature && !obtainedSignature) {
        setSwapProgressState("needs_signature");
        // Notification effect will show toast
      } else {
        // Either no signature needed OR we already have one cached
        setCompletedSteps(["approval_complete", "signature_complete"]); // Mark step 2 complete
        setSwapProgressState("ready_to_swap");
      }
      setIsSwapping(false); // Checks done, ready for user action (Sign or Confirm)

    } catch (error: any) {
      // 6. Handle Errors during initial checks
      console.error("Error during initial swap checks:", error);
      Sentry.captureException(error, {
        tags: { operation: 'swap_checks' },
        extra: { fromToken: fromToken?.symbol, toToken: toToken?.symbol, fromAmount }
      });
      setIsSwapping(false); // Re-enable buttons
      setSwapProgressState("error"); // Set a general error state for checks
      const errorCode = error.message || "Could not verify token allowances.";
      toast.error("Backend Error", {
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description: "Something went wrong on our end. The team has been notified.",
        action: {
          label: "Copy Error",
          onClick: () => navigator.clipboard.writeText(errorCode)
        }
      });
    }
  };

  // Wrapper function to handle percentage selection for both tokens
  // For 100%, uses exact formatted balance from blockchain (via the hook)
  const handleUsePercentage = (percentage: number, isFrom: boolean = true) => {
    if (isFrom) {
      handleFromPercentage(percentage);
      lastEditedSideRef.current = 'from';
    } else {
      handleToPercentage(percentage);
      lastEditedSideRef.current = 'to';
    }
  };

  // This function is no longer needed as the preview is always visible.
  // Its previous logic (toggling isFeeChartPreviewVisible) has been removed.
  const handleFeePercentageClick = () => {};

  // This function opens the MODAL
  const handlePreviewChartClick = useCallback(() => {
    if (isMobile) {
      toast.error("Unsupported Device", {
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description: "This feature is unavailable on mobile (Alpha). Please use a desktop browser.",
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
    const parsedAmount = safeParseUnits(fromAmount, fromToken.decimals); // Needed in multiple branches
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
                    amountIn: parsedAmount.toString(),
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

        // ACTION: Need to Approve
        if (stateBeforeAction === "needs_approval") {
            setSwapProgressState("approving");

            // Inform user about approval request
            toast("Confirm in Wallet", {
                icon: <InfoIcon className="h-4 w-4" />
            });

            const isInfinite = isInfiniteApprovalEnabled();
            const approvalAmount = isInfinite ? maxUint256 : parsedAmount + 1n; // +1 wei buffer

            const approveTxHash = await sendApprovalTx({
                address: fromToken.address,
                abi: Erc20AbiDefinition,
                functionName: 'approve',
                args: [PERMIT2_ADDRESS, approvalAmount],
            });
            if (!approveTxHash) throw new Error("Failed to send approval transaction");

            setSwapProgressState("waiting_approval");
            const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTxHash as Hex });
            if (!approvalReceipt || approvalReceipt.status !== 'success') throw new Error("Approval transaction failed on-chain");

            toast.success(`${fromToken.symbol} Approved`, {
                icon: <BadgeCheck className="h-4 w-4 text-green-500" />,
                description: isInfinite
                    ? `Approved infinite ${fromToken.symbol} for swapping`
                    : `Approved ${fromAmount} ${fromToken.symbol} for this swap`,
                action: {
                    label: "View Transaction",
                    onClick: () => window.open(getExplorerTxUrl(approveTxHash), '_blank')
                }
            });

            setCompletedSteps(prev => [...prev, "approval_complete"]);

            const freshPermitData = await fetchPermitData();

            // Only clear signature if permit data has changed (different nonce means new permit needed)
            setCurrentPermitDetailsForSign((prevPermitData) => {
              const previousNonce = prevPermitData?.permitData?.message?.details?.nonce;
              const newNonce = freshPermitData?.permitData?.message?.details?.nonce;

              // If nonce changed or no previous permit, clear the signature
              if (previousNonce !== newNonce || !prevPermitData) {
                setObtainedSignature(null);
              }

              return freshPermitData;
            });

            // Check if we already have a valid signature (preserved from previous review attempt)
            if (freshPermitData.needsPermit && !obtainedSignature) {
                setSwapProgressState("needs_signature");
            } else {
                setSwapProgressState("ready_to_swap");
                setCompletedSteps(prev => prev.includes("signature_complete") ? prev : [...prev, "signature_complete"]);
            }
            setIsSwapping(false);
            return;
        }

        // ACTION: Need to Sign
        else if (stateBeforeAction === "needs_signature") {

            // --- CRITICAL: Use the stored permit data for signing ---
            if (!currentPermitDetailsForSign) {
              // This should not happen if logic is correct, but as a safeguard:
              console.error("[handleConfirmSwap] Error: currentPermitDetailsForSign is null before signing.");
              const errorCode = "currentPermitDetailsForSign is null before signing";
              toast.error("Backend Error", {
                icon: <OctagonX className="h-4 w-4 text-red-500" />,
                description: "We encountered an internal issue. Please start over. If the issue persists reach out below.",
                action: {
                  label: "Copy Error",
                  onClick: () => navigator.clipboard.writeText(errorCode)
                }
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

            if (!permitDataForSigning.permitData) {
                throw new Error("Permit data is missing when signature is required");
            }

            const permitMessage = permitDataForSigning.permitData.message;
            const messageToSign = {
                details: {
                    token: getAddress(fromToken.address),
                    amount: BigInt(permitMessage.details.amount),
                    expiration: permitMessage.details.expiration,
                    nonce: permitMessage.details.nonce,
                },
                spender: getAddress(permitMessage.spender),
                sigDeadline: BigInt(permitMessage.sigDeadline),
            };

            toast("Sign in Wallet", {
                icon: <InfoIcon className="h-4 w-4" />
            });

            const signatureFromSigning = await signTypedDataAsync({
                domain: permitDataForSigning.permitData.domain,
                types: permitDataForSigning.permitData.types,
                primaryType: 'PermitSingle',
                message: messageToSign,
            });

            if (!signatureFromSigning) throw new Error("Signature process did not return a valid signature.");
            setObtainedSignature(signatureFromSigning);

            const now = Math.floor(Date.now() / 1000);
            const durationSeconds = Number(messageToSign.sigDeadline) - now;
            const minutes = Math.ceil(durationSeconds / 60);

            toast.success("Signature Complete", {
                icon: <BadgeCheck className="h-4 w-4 text-green-500" />,
                description: `${fromToken.symbol} permit signed for ${minutes} minute${minutes > 1 ? 's' : ''}`
            });

            setCompletedSteps(prev => [...prev, "signature_complete"]);
            setSwapProgressState("ready_to_swap");
            setIsSwapping(false);
            return; 
        }

        // ACTION: Ready to Swap
        else if (stateBeforeAction === "ready_to_swap") {

            // For native ETH swaps, skip permit checks and use dummy permit data
            if (fromToken.symbol === 'ETH') {
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
                    toast.error("Backend Error", {
                      icon: <OctagonX className="h-4 w-4 text-red-500" />,
                      description: "Could not fetch swap fee. Please try again.",
                      action: {
                        label: "Open Ticket",
                        onClick: () => window.open('https://discord.gg/alphix', '_blank')
                      }
                    });
                    setIsSwapping(false);
                    setSwapProgressState("error");
                    return;
                }
                // >>> END FETCH ROUTE AND DYNAMIC FEES <<<

                const effectiveTimestamp = BigInt(Math.floor(Date.now() / 1000));
                const effectiveFallbackSigDeadline = effectiveTimestamp + BigInt(30 * 60); // 30 min fallback

                // Prepare limits based on swap type using BigInt to avoid precision issues
                const isExactOut = lastEditedSideRef.current === 'to';
                const toDecimals = toToken.decimals;
                const fromDecimals = fromToken.decimals;
                
                // Calculate slippage using BigInt math to avoid floating point precision issues
                let minimumReceivedStr: string;
                let maximumInputStr: string;
                
                try {
                    // Parse the quoted amounts to BigInt (smallest units)
                    const quotedOutBigInt = safeParseUnits(toAmount || "0", toDecimals);
                    const quotedInBigInt = safeParseUnits(fromAmount || "0", fromDecimals);
                    
                    // Calculate min/max using BigInt arithmetic
                    // minOut = quotedOut * (100 - currentSlippage) / 100
                    const minOutBigInt = (quotedOutBigInt * BigInt(Math.floor((100 - currentSlippage) * 100))) / BigInt(10000);
                    // maxIn = quotedIn * (100 + currentSlippage) / 100
                    const maxInBigInt = (quotedInBigInt * BigInt(Math.floor((100 + currentSlippage) * 100))) / BigInt(10000);

                    // Format back to decimal strings
                    minimumReceivedStr = formatUnits(minOutBigInt, toDecimals);
                    maximumInputStr = formatUnits(maxInBigInt, fromDecimals);
                } catch (err) {
                    // Fallback to floating point calculation if BigInt fails
                    const quotedOutNum = parseFloat(toAmount || "0");
                    const quotedInNum = parseFloat(fromAmount || "0");
                    const minOutNum = quotedOutNum > 0 ? quotedOutNum * (1 - currentSlippage / 100) : 0;
                    const maxInNum = quotedInNum > 0 ? quotedInNum * (1 + currentSlippage / 100) : 0;
                    minimumReceivedStr = minOutNum.toFixed(toDecimals);
                    maximumInputStr = maxInNum.toFixed(fromDecimals);
                }

                // Use dummy permit data for native ETH
                const bodyForSwapTx = {
                     userAddress: accountAddress,
                     fromTokenSymbol: fromToken.symbol,
                     toTokenSymbol: toToken.symbol,
                     swapType: isExactOut ? 'ExactOut' : 'ExactIn',
                     amountDecimalsStr: isExactOut ? toAmount : fromAmount,
                     limitAmountDecimalsStr: isExactOut ? maximumInputStr : minimumReceivedStr,
                     
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

                // Inform user about swap transaction request
                toast("Confirm Swap", {
                    icon: <InfoIcon className="h-4 w-4" />
                });

                const txHash = await sendSwapTx({
                    address: getAddress(buildTxApiData.to),
                    abi: UniversalRouterAbi,
                    functionName: 'execute',
                    args: [buildTxApiData.commands as Hex, buildTxApiData.inputs as Hex[], BigInt(buildTxApiData.deadline)],
                    value: BigInt(buildTxApiData.value),
                });
                if (!txHash) throw new Error("Failed to send swap transaction (no hash received)");

                setSwapTxInfo({
                    hash: txHash as string,
                    fromAmount: fromAmount,
                    fromSymbol: fromToken.symbol,
                    toAmount: toAmount,
                    toSymbol: toToken.symbol,
                    explorerUrl: getExplorerTxUrl(txHash as string),
                    touchedPools: Array.isArray(buildTxApiData?.touchedPools) ? buildTxApiData.touchedPools : undefined
                });

                setSwapProgressState("waiting_confirmation");
                const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex });

                if (!receipt || receipt.status !== 'success') throw new Error("Swap transaction failed on-chain");

                setSwapProgressState("complete");
                setIsSwapping(false);

                // Calculate swap volume in USD and invalidate cache for all touched pools
                const swapVolumeUSD = parseFloat(fromAmount) * (fromTokenUSDPrice.price || 0);
                await invalidateSwapCache(
                  queryClient,
                  accountAddress!,
                  currentChainId!,
                  buildTxApiData.touchedPools,
                  swapVolumeUSD,
                  receipt.blockNumber
                );

                // Trigger balance refresh & show success view after confirmed
                setSwapState("success");
                if (accountAddress) localStorage.setItem(`walletBalancesRefreshAt_${accountAddress}`, String(Date.now()));
                window.dispatchEvent(new Event('walletBalancesRefresh'));
                return;
            }

            // Check if we have the necessary permit details and signature if one was required
            const needsSignatureCheck = currentPermitDetailsForSign?.needsPermit === true;
            
            if (!currentPermitDetailsForSign || (needsSignatureCheck && !obtainedSignature)) {
                 console.error("[handleConfirmSwap] Error: Permit details missing, or signature was required but not obtained.");
                 const errorCode = "Permit details missing or signature not obtained";
                 toast.error("Backend Error", {
                   icon: <OctagonX className="h-4 w-4 text-red-500" />,
                   description: "We encountered an internal issue. Please start over. If the issue persists reach out below.",
                   action: {
                     label: "Copy Error",
                     onClick: () => navigator.clipboard.writeText(errorCode)
                   }
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
                toast.error("Backend Error", {
                  icon: <OctagonX className="h-4 w-4 text-red-500" />,
                  description: "Could not fetch swap fee. Please try again.",
                  action: {
                    label: "Open Ticket",
                    onClick: () => window.open('https://discord.gg/alphix', '_blank')
                  }
                });
                setIsSwapping(false);
                setSwapProgressState("error"); // Or back to "ready_to_swap" to allow retry
                return;
            }
            // >>> END FETCH ROUTE AND DYNAMIC FEES <<<

            const effectiveTimestamp = BigInt(Math.floor(Date.now() / 1000));
            const effectiveFallbackSigDeadline = effectiveTimestamp + BigInt(30 * 60); // 30 min fallback

            // Prepare limits based on swap type using BigInt to avoid precision issues
            const isExactOut2 = lastEditedSideRef.current === 'to';
            const toDecimals2 = toToken.decimals;
            const fromDecimals2 = fromToken.decimals;
            
            // Calculate slippage using BigInt math to avoid floating point precision issues
            let minimumReceivedStr: string;
            let maximumInputStr: string;
            
            try {
                // Parse the quoted amounts to BigInt (smallest units)
                const quotedOutBigInt = safeParseUnits(toAmount || "0", toDecimals2);
                const quotedInBigInt = safeParseUnits(fromAmount || "0", fromDecimals2);
                
                // Calculate min/max using BigInt arithmetic
                // minOut = quotedOut * (100 - currentSlippage) / 100
                const minOutBigInt = (quotedOutBigInt * BigInt(Math.floor((100 - currentSlippage) * 100))) / BigInt(10000);
                // maxIn = quotedIn * (100 + currentSlippage) / 100
                const maxInBigInt = (quotedInBigInt * BigInt(Math.floor((100 + currentSlippage) * 100))) / BigInt(10000);

                // Format back to decimal strings
                minimumReceivedStr = formatUnits(minOutBigInt, toDecimals2);
                maximumInputStr = formatUnits(maxInBigInt, fromDecimals2);
            } catch (err) {
                // Fallback to floating point calculation if BigInt fails
                const quotedOutNum2 = parseFloat(toAmount || "0");
                const quotedInNum2 = parseFloat(fromAmount || "0");
                const minOutNum2 = quotedOutNum2 > 0 ? quotedOutNum2 * (1 - currentSlippage / 100) : 0;
                const maxInNum2 = quotedInNum2 > 0 ? quotedInNum2 * (1 + currentSlippage / 100) : 0;
                minimumReceivedStr = minOutNum2.toFixed(toDecimals2);
                maximumInputStr = maxInNum2.toFixed(fromDecimals2);
            }

            let permitNonce, permitExpiration, permitSigDeadline, permitAmount;
            if (permitDetailsToUse.needsPermit === true && permitDetailsToUse.permitData) {
                permitNonce = permitDetailsToUse.permitData.message.details.nonce;
                permitExpiration = permitDetailsToUse.permitData.message.details.expiration;
                permitSigDeadline = permitDetailsToUse.permitData.message.sigDeadline.toString();
                permitAmount = permitDetailsToUse.permitData.message.details.amount;
            } else if (permitDetailsToUse.needsPermit === false && permitDetailsToUse.existingPermit) {
                permitNonce = permitDetailsToUse.existingPermit.nonce;
                permitExpiration = permitDetailsToUse.existingPermit.expiration;
                permitSigDeadline = permitExpiration.toString();
                permitAmount = permitDetailsToUse.existingPermit.amount;
            } else {
                throw new Error("Invalid permit data structure - fresh signature required");
            }

            const bodyForSwapTx = {
                 userAddress: accountAddress,
                 fromTokenSymbol: fromToken.symbol,
                 toTokenSymbol: toToken.symbol,
                 swapType: isExactOut2 ? 'ExactOut' : 'ExactIn',
                 amountDecimalsStr: isExactOut2 ? toAmount : fromAmount,
                 limitAmountDecimalsStr: isExactOut2 ? maximumInputStr : minimumReceivedStr,

                 permitSignature: signatureToUse || "0x",
                 permitTokenAddress: fromToken.address,
                 permitAmount: permitAmount,
                 permitNonce: permitNonce,
                 permitExpiration: permitExpiration,
                 permitSigDeadline: permitSigDeadline,
                 chainId: currentChainId,
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

            // Inform user about swap transaction request
            toast("Confirm Swap", {
                icon: <InfoIcon className="h-4 w-4" />
            });

            const txHash = await sendSwapTx({
                address: getAddress(buildTxApiData.to),
                abi: UniversalRouterAbi,
                functionName: 'execute',
                args: [buildTxApiData.commands as Hex, buildTxApiData.inputs as Hex[], BigInt(buildTxApiData.deadline)],
                value: BigInt(buildTxApiData.value),
            });
            if (!txHash) throw new Error("Failed to send swap transaction (no hash received)");

            setSwapTxInfo({
                hash: txHash as string,
                fromAmount: fromAmount,
                fromSymbol: fromToken.symbol,
                toAmount: toAmount,
                toSymbol: toToken.symbol,
                explorerUrl: getExplorerTxUrl(txHash as string),
                touchedPools: Array.isArray(buildTxApiData?.touchedPools) ? buildTxApiData.touchedPools : undefined
            });

            setSwapProgressState("waiting_confirmation");
            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex });

            if (!receipt || receipt.status !== 'success') throw new Error("Swap transaction failed on-chain");

            setSwapProgressState("complete");
            setIsSwapping(false);

            // Calculate swap volume in USD and invalidate cache for all touched pools
            const swapVolumeUSD = parseFloat(fromAmount) * (fromTokenUSDPrice.price || 0);
            await invalidateSwapCache(
              queryClient,
              accountAddress!,
              currentChainId!,
              buildTxApiData.touchedPools,
              swapVolumeUSD,
              receipt.blockNumber
            );

            // Trigger balance refresh & show success view after confirmed
            setSwapState("success");
            if (accountAddress) localStorage.setItem(`walletBalancesRefreshAt_${accountAddress}`, String(Date.now()));
            window.dispatchEvent(new Event('walletBalancesRefresh'));
            return;
        }

        // ACTION: Unexpected State (Safety net)
        else {
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
            toast.error("Slippage Error", {
                icon: <OctagonX className="h-4 w-4 text-red-500" />,
                duration: 5000,
                description: "Reduce your amount or increase slippage, then try again.",
                action: {
                  label: "Open Ticket",
                  onClick: () => window.open('https://discord.gg/alphix', '_blank')
                }
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
            toast.error("Transaction Rejected", {
                 icon: <OctagonX className="h-4 w-4 text-red-500" />,
                 description: "The request was rejected in your wallet.",
                 duration: 4000
            });
            // Reset state to before the rejected action, allowing a clean retry of that specific step
            setSwapProgressState(stateBeforeAction);
        } else {
            toast.error("Transaction Error", {
                 icon: <OctagonX className="h-4 w-4 text-red-500" />,
                 description: "The transaction failed.",
                 duration: 5000,
                 action: {
                   label: "Copy Error",
                   onClick: () => navigator.clipboard.writeText(displayError)
                 }
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
    // Full reset for a brand new swap
    window.swapBuildData = undefined;
    setCompletedSteps([]);
    setSwapTxInfo(null);
    setQuoteError(null);
    setSwapState("input");
    setSwapProgressState("init");
    setSwapError(null);
    setIsSwapping(false);
    setFromAmount("");
    setToAmount("");
    setRouteInfo(null);
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
      // Use 100% which now uses exact blockchain data
      handleUsePercentage(100, true);
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

  // Slippage handlers
  const handleSlippageChange = (newSlippage: number) => {
    setSlippage(newSlippage);
  };

  const handleAutoSlippageToggle = () => {
    setAutoMode();
  };

  const handleCustomSlippageToggle = () => {
    setCustomMode();
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

  // Stable fallback pool info when no route/connection (e.g., default chart on load)
  const fallbackPoolInfo = useMemo(() => {
    const fallback = getPoolByTokens('aUSDC', 'aUSDT');
    if (!fallback) return undefined;
    return {
      token0Symbol: fallback.currency0.symbol,
      token1Symbol: fallback.currency1.symbol,
      poolName: fallback.name,
    };
  }, []);

  // Create a stable key for fee history to prevent unnecessary reloads
  const feeHistoryKey = useMemo(() => {
    if (!isMounted) return null;
    // When not connected, fallback to aUSDC/aUSDT pool
    if (!isConnected) {
      const fallback = getPoolByTokens('aUSDC', 'aUSDT');
      return fallback ? `${fallback.subgraphId}_fallback` : null;
    }
    if (!currentRoute) return null;
    const poolIndex = Math.min(selectedPoolIndexForChart, currentRoute.pools.length - 1);
    const poolIdForHistory = currentRoute.pools[poolIndex]?.subgraphId;
    return poolIdForHistory ? `${poolIdForHistory}_${selectedPoolIndexForChart}` : null;
  }, [isMounted, isConnected, currentRoute, selectedPoolIndexForChart]);

  // Effect to fetch historical fee data - with session caching and optimized loading
  useEffect(() => {
    const fetchHistoricalFeeData = async () => {
      if (!feeHistoryKey) {
        setFeeHistoryData([]);
        return; // Preview is always mounted, just no data
      }

      // Get the selected pool's subgraph ID
      let poolIdForFeeHistory: string | undefined;
      let selectedPool: any = null;
      if (currentRoute) {
        const poolIndex = Math.min(selectedPoolIndexForChart, currentRoute.pools.length - 1);
        poolIdForFeeHistory = currentRoute.pools[poolIndex]?.subgraphId;
        selectedPool = currentRoute.pools[poolIndex];
      } else {
        const fallback = getPoolByTokens('aUSDC', 'aUSDT');
        poolIdForFeeHistory = fallback?.subgraphId;
        selectedPool = fallback ? { token0: fallback.currency0.symbol, token1: fallback.currency1.symbol, poolName: fallback.name } : null;
      }

      const cacheKey = `feeHistory_${poolIdForFeeHistory}_30days`;
      
      // Check if we already have data in sessionStorage with expiration
      try {
        const cachedItem = sessionStorage.getItem(cacheKey);
        if (cachedItem) {
          const cached = JSON.parse(cachedItem);
          const now = Date.now();
          
          // Cache expires after 30 minutes (1,800,000 ms)
          if (cached.timestamp && (now - cached.timestamp) < 1800000 && cached.data) {

            setFeeHistoryData(cached.data);
            setIsFeeHistoryLoading(false);
            setFeeHistoryError(null);
            return;
          } else {

            sessionStorage.removeItem(cacheKey); // Clean up expired cache
          }
        }
      } catch (error) {
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
      return "Connect Wallet";
    } else if (isConnected) {
      if (currentChainId !== TARGET_CHAIN_ID) {
        return isMainnet ? "Switch to Base" : "Switch to Base Sepolia";
      } else if (isLoadingCurrentFromTokenBalance || isLoadingCurrentToTokenBalance) {
        return "Swap";
      } else {
        // Check for insufficient balance
        const fromAmountNum = parseFloat(fromAmount || "0");
        const fromBalanceNum = parseFloat(fromToken.balance || "0");
        if (fromAmountNum > 0 && fromBalanceNum < fromAmountNum) {
          return "Insufficient Balance";
        }
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

  // Get USD prices using mid-price quotes (replaces CoinGecko)
  const fromTokenUSDPrice = useTokenUSDPrice(fromToken?.symbol);
  const toTokenUSDPrice = useTokenUSDPrice(toToken?.symbol);
  
  // Update token prices when USD prices change
  useEffect(() => {
    if (fromTokenUSDPrice.price !== null) {
      setFromToken(prev => {
        if (prev.usdPrice === fromTokenUSDPrice.price) return prev;
        return { ...prev, usdPrice: fromTokenUSDPrice.price || prev.usdPrice };
      });
    }
  }, [fromTokenUSDPrice.price]);
  
  useEffect(() => {
    if (toTokenUSDPrice.price !== null) {
      setToToken(prev => {
        if (prev.usdPrice === toTokenUSDPrice.price) return prev;
        return { ...prev, usdPrice: toTokenUSDPrice.price || prev.usdPrice };
      });
    }
  }, [toTokenUSDPrice.price]);
  
  // Price impact from quote response
  const [priceImpact, setPriceImpact] = useState<number | null>(null);
  
  // Price impact warning thresholds (matching Uniswap)
  const PRICE_IMPACT_MEDIUM = 3; // 3%
  const PRICE_IMPACT_HIGH = 5; // 5%
  
  const priceImpactWarning = useMemo(() => {
    if (priceImpact === null) return null;
    if (priceImpact >= PRICE_IMPACT_HIGH) {
      return { severity: 'high' as const, message: `Very high price impact: ${priceImpact.toFixed(2)}%` };
    }
    if (priceImpact >= PRICE_IMPACT_MEDIUM) {
      return { severity: 'medium' as const, message: `High price impact: ${priceImpact.toFixed(2)}%` };
    }
    return null;
  }, [priceImpact]);

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
  // Force show preview container even when not mounted/connected; content will skeletonize as needed
  const showChartPreviewRegardlessOfData = true;

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
    <div className="flex flex-col">
      <div ref={containerRef} className="w-full max-w-lg mx-auto">
      {/* Main Swap Interface Card */}
      <Card className="w-full card-gradient z-10 rounded-lg bg-[var(--swap-background)] border-[var(--swap-border)]"> {/* Applied styling here */}
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
                onToAmountChange={handleToAmountChange}
                activelyEditedSide={lastEditedSideRef.current}
                handleSwapTokens={handleSwapTokens}
                handleUsePercentage={handleUsePercentage}
                availableTokens={tokenList}
                onFromTokenSelect={handleFromTokenSelect}
                onToTokenSelect={handleToTokenSelect}
                routeInfo={routeInfo}
                routeFees={routeFees}
                routeFeesLoading={routeFeesLoading}
                selectedPoolIndexForChart={selectedPoolIndexForChart}
                onSelectPoolForChart={handleSelectPoolForChart}
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
                swapContainerRect={combinedRect}
                slippage={currentSlippage}
                isAutoSlippage={isAutoSlippage}
                autoSlippageValue={autoSlippageValue}
                onSlippageChange={handleSlippageChange}
                onAutoSlippageToggle={handleAutoSlippageToggle}
                onCustomSlippageToggle={handleCustomSlippageToggle}
                priceImpactWarning={priceImpactWarning}
                onNetworkSwitch={handleNetworkSwitch}
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
                handleChangeButton={handleSwapAgain} // Use full reset for "Swap again"
                formatTokenAmountDisplay={formatTokenAmountDisplay}
              />
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Preview Chart Row with external nav arrows */}
      <div className="w-full relative">
        <div className="w-full relative group">
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
                data={isFeeHistoryLoading ? [] : feeHistoryData} 
                onClick={handlePreviewChartClick}
                poolInfo={poolInfo || fallbackPoolInfo}
                isLoading={isFeeHistoryLoading}
                alwaysShowSkeleton={false}
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

