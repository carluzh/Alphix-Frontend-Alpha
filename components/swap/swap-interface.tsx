"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import {
  ArrowDownIcon,
  ChevronDownIcon,
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
  TOKEN_DEFINITIONS,
  TokenSymbol,
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
const YUSD_ADDRESS = TOKEN_DEFINITIONS.YUSDC.addressRaw as Address; // UPDATED - Use YUSDC from constants
const BTCRL_ADDRESS = TOKEN_DEFINITIONS.BTCRL.addressRaw as Address; // UPDATED - Use BTCRL from constants
const MaxUint160 = BigInt('0xffffffffffffffffffffffffffffffffffffffff'); // 2**160 - 1

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

// Define our two specific tokens with initial empty balance/value
const initialYUSD: Token = {
  address: YUSD_ADDRESS, // Will use the updated YUSD_ADDRESS
  symbol: "YUSDC", // Update to match TOKEN_DEFINITIONS
  name: "Yama USD", // Consider "Yama USDC" for clarity if TOKEN_DEFINITIONS.YUSDC.name exists
  decimals: TOKEN_DEFINITIONS.YUSDC.decimals, // UPDATED - Use YUSDC decimals from constants
  balance: "0.000",
  value: "$0.00",
  icon: "/YUSD.png", // Placeholder icon
  usdPrice: 1, // Will be updated dynamically
};

const initialBTCRL: Token = {
  address: BTCRL_ADDRESS, // Will use the updated BTCRL_ADDRESS
  symbol: "BTCRL",
  name: "Bitcoin RL", // Consider TOKEN_DEFINITIONS.BTCRL.name if exists
  decimals: TOKEN_DEFINITIONS.BTCRL.decimals, // UPDATED - Use BTCRL decimals from constants
  balance: "0.000",
  value: "$0.00",
  icon: "/BTCRL.png", // Placeholder icon
  usdPrice: 77000, // Will be updated dynamically
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

export function SwapInterface() {
  // Mobile check for responsive behaviors
  const isMobile = useIsMobile();
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);
  
  const [swapState, setSwapState] = useState<SwapState>("input");
  const [swapProgressState, setSwapProgressState] = useState<SwapProgressState>("init");
  const [isSwapping, setIsSwapping] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<SwapProgressState[]>([]);
  const [isAttemptingSwitch, setIsAttemptingSwitch] = useState(false);
  const [isWrongNetworkToastActive, setIsWrongNetworkToastActive] = useState(false);
  const wrongNetworkToastIdRef = useRef<string | number | undefined>(undefined);
  const swapTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reviewNotificationsShown = useRef({ needs_approval: false, needs_signature: false, approval_complete: false, signature_complete: false });
  const [isSellInputFocused, setIsSellInputFocused] = useState(false);
  
  // V4 Quoter states
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Tokens for swap (with token data stored in state)
  const [fromToken, setFromToken] = useState<Token>(initialYUSD);
  const [toToken, setToToken] = useState<Token>(initialBTCRL);
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");

  const [swapTxInfo, setSwapTxInfo] = useState<SwapTxInfo | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);

  // State for historical fee data
  const [feeHistoryData, setFeeHistoryData] = useState<FeeHistoryPoint[]>([]);
  const [isFeeHistoryLoading, setIsFeeHistoryLoading] = useState(false);
  const [feeHistoryError, setFeeHistoryError] = useState<string | null>(null);
  const [isFeeChartPreviewVisible, setIsFeeChartPreviewVisible] = useState(false); // Renamed for clarity
  const [isFeeChartModalOpen, setIsFeeChartModalOpen] = useState(false); // New state for modal
  const isFetchingFeeHistoryRef = useRef(false); // Prevent duplicate API calls

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
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null); // This will be removed
  const intervalTimerRef = useRef<NodeJS.Timeout | null>(null);

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
  }>({
    fromTokenAmount: "0",
    fromTokenValue: "$0.00",
    toTokenAmount: "0",
    toTokenValue: "$0.00",
    fees: [
      { name: "Fee", value: "N/A", type: "percentage" }, // Initial value updated
    ],
    slippage: "0.5%",
  });

  // Mock data generation removed - using real API data instead

  // Effect to fetch dynamic fee for display
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
      return;
    }

    const fromTokenSymbolForCache = Object.keys(TOKEN_DEFINITIONS).find(
      (key) => TOKEN_DEFINITIONS[key as TokenSymbol].addressRaw === fromToken.address
    ) as TokenSymbol | undefined;
    const toTokenSymbolForCache = Object.keys(TOKEN_DEFINITIONS).find(
      (key) => TOKEN_DEFINITIONS[key as TokenSymbol].addressRaw === toToken.address
    ) as TokenSymbol | undefined;

    if (!fromTokenSymbolForCache || !toTokenSymbolForCache) {
      console.error("[fetchFee] Could not determine token symbols for cache key.");
      setDynamicFeeError("Token configuration error for fee.");
      setDynamicFeeLoading(false);
      return;
    }

    const cacheKey = getPoolDynamicFeeCacheKey(fromTokenSymbolForCache, toTokenSymbolForCache, TARGET_CHAIN_ID);
    const cachedFee = getFromCache<{ dynamicFee: string }>(cacheKey);

    if (cachedFee) {
      console.log(`[Cache HIT] Using cached dynamic fee for ${fromTokenSymbolForCache}-${toTokenSymbolForCache}:`, cachedFee.dynamicFee);
      const fee = Number(cachedFee.dynamicFee);
      if (!isNaN(fee)) {
        setDynamicFeeBps(fee);
      }
      setDynamicFeeLoading(false);
      setDynamicFeeError(null);
      return;
    }

    if (isFetchingDynamicFeeRef.current) return;

    isFetchingDynamicFeeRef.current = true;
    setDynamicFeeLoading(true);
    setDynamicFeeError(null);
    console.log(`[Cache MISS] Fetching dynamic fee from API for ${fromTokenSymbolForCache}-${toTokenSymbolForCache}`);

    try {
      const response = await fetch('/api/swap/get-dynamic-fee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromTokenSymbol: fromTokenSymbolForCache, // Use determined symbol
          toTokenSymbol: toTokenSymbolForCache,   // Use determined symbol
          chainId: TARGET_CHAIN_ID,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.errorDetails || 'Failed to fetch dynamic fee');
      }
      const fee = Number(data.dynamicFee);
      if (isNaN(fee)) {
        throw new Error('Dynamic fee received is not a number: ' + data.dynamicFee);
      }
      setDynamicFeeBps(fee);
      setToCache(cacheKey, { dynamicFee: data.dynamicFee }); // Cache the raw string from API
      console.log(`[Cache SET] Cached dynamic fee for ${fromTokenSymbolForCache}-${toTokenSymbolForCache}:`, data.dynamicFee);
      setDynamicFeeLoading(false);
    } catch (error: any) {
      console.error("[fetchFee] Error fetching dynamic fee:", error.message);
      setDynamicFeeBps(null);
      setDynamicFeeLoading(false);
      setDynamicFeeError(error.message || "Error fetching fee.");
    } finally {
      isFetchingDynamicFeeRef.current = false;
    }
  }, [isConnected, currentChainId, fromToken, toToken, TARGET_CHAIN_ID]);

  useEffect(() => {
    fetchFee(); // Fetch once on mount / relevant dep change

    intervalTimerRef.current = setInterval(fetchFee, 60000); // Fetch every 60 seconds

    return () => {
      if (intervalTimerRef.current) {
        clearInterval(intervalTimerRef.current);
      }
      isFetchingDynamicFeeRef.current = false; // Reset ref on cleanup
    };
  }, [fetchFee]);

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

  // Effect for Review State Notifications
  useEffect(() => {
    console.log(`[Effect Notifications] Running. swapState: ${swapState}, swapProgressState: ${swapProgressState}, shown:`, JSON.stringify(reviewNotificationsShown.current));
    if (swapState === "review") {
      console.log("[Effect Notifications] In review state.");
      // Handle Warning Toasts
      if (swapProgressState === "needs_approval" && !reviewNotificationsShown.current.needs_approval) {
        console.log("%%% TOASTING: Approval Required %%%");
        toast("Approval Required", { description: `Permit2 needs approval to spend your ${fromToken.symbol}.`, duration: 4000 }); // Removed InfoToastIcon
        reviewNotificationsShown.current.needs_approval = true;
      } else if (swapProgressState === "needs_signature" && !reviewNotificationsShown.current.needs_signature) {
        console.log("%%% TOASTING: Signature Required %%%");
        toast("Signature Required", { description: `Permit2 allowance needs to be granted or renewed via signature.`, duration: 4000 }); // Removed InfoToastIcon
        reviewNotificationsShown.current.needs_signature = true;
      // Handle Positive Toasts
      } else if (swapProgressState === "approval_complete" && !reviewNotificationsShown.current.approval_complete) {
        console.log("%%% TOASTING: Token Approved %%%");
        toast("Token Approved", {
          duration: 2500
        });
        reviewNotificationsShown.current.approval_complete = true;
      } else if (swapProgressState === "signature_complete" && !reviewNotificationsShown.current.signature_complete) {
        console.log("%%% TOASTING: Permit Active %%%");
        toast("Permission Active", {
          duration: 2500
        });
        reviewNotificationsShown.current.signature_complete = true;
      }
    } else {
      // Only reset if NOT in review state and if flags are currently true
      if (reviewNotificationsShown.current.needs_approval || reviewNotificationsShown.current.needs_signature || reviewNotificationsShown.current.approval_complete || reviewNotificationsShown.current.signature_complete) {
         console.log("[Effect Notifications] Not in review state, resetting shown flags.");
         reviewNotificationsShown.current = { needs_approval: false, needs_signature: false, approval_complete: false, signature_complete: false };
      }
    }
  }, [swapState, swapProgressState, fromToken.symbol]); // Dependencies are correct

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

  // --- Balance Fetching --- 
  const { data: yusdBalanceData, isLoading: isLoadingYUSDBalance, error: yusdBalanceError } = useBalance({
    address: accountAddress,
    token: YUSD_ADDRESS,
    chainId: TARGET_CHAIN_ID,
  });

  const { data: btcrlBalanceData, isLoading: isLoadingBTCRLBalance, error: btcrlBalanceError } = useBalance({
    address: accountAddress,
    token: BTCRL_ADDRESS,
    chainId: TARGET_CHAIN_ID,
  });

  // Update YUSD balance in whichever state (fromToken or toToken) holds YUSD
  useEffect(() => {
    const applyUpdate = (prevTokenState: Token): Token => {
      if (prevTokenState.address !== YUSD_ADDRESS) return prevTokenState;

      const numericBalance = yusdBalanceData ? parseFloat(yusdBalanceData.formatted) : 0;
      const displayBalance = getFormattedDisplayBalance(numericBalance);

      if (yusdBalanceData && isConnected && currentChainId === TARGET_CHAIN_ID) {
        return {
          ...prevTokenState,
          balance: displayBalance,
          value: `~$${(numericBalance * prevTokenState.usdPrice).toFixed(2)}`,
        };
      } else if (yusdBalanceError && isConnected && currentChainId === TARGET_CHAIN_ID) {
        console.error("Error fetching YUSD balance:", yusdBalanceError);
        return { ...prevTokenState, balance: "Error", value: "$0.00" };
      } else if (isConnected && currentChainId !== TARGET_CHAIN_ID) {
        return { ...prevTokenState, balance: "~", value: "$0.00" };
      } else if (!isLoadingYUSDBalance && isConnected) {
        return { ...prevTokenState, balance: displayBalance, value: "$0.00" };
      } else if (!isConnected) {
        return initialYUSD; 
      }
      return prevTokenState;
    };

    setFromToken(applyUpdate);
    setToToken(applyUpdate);

  }, [yusdBalanceData, yusdBalanceError, isLoadingYUSDBalance, currentChainId, isConnected]);

  // Update BTCRL balance in whichever state (fromToken or toToken) holds BTCRL
  useEffect(() => {
    const applyUpdate = (prevTokenState: Token): Token => {
      if (prevTokenState.address !== BTCRL_ADDRESS) return prevTokenState;

      const numericBalance = btcrlBalanceData ? parseFloat(btcrlBalanceData.formatted) : 0;
      const displayBalance = getFormattedDisplayBalance(numericBalance);

      if (btcrlBalanceData && isConnected && currentChainId === TARGET_CHAIN_ID) {
        return {
          ...prevTokenState,
          balance: displayBalance,
          value: `~$${(numericBalance * prevTokenState.usdPrice).toFixed(2)}`,
        };
      } else if (btcrlBalanceError && isConnected && currentChainId === TARGET_CHAIN_ID) {
        console.error("Error fetching BTCRL balance:", btcrlBalanceError);
        return { ...prevTokenState, balance: "Error", value: "$0.00" };
      } else if (isConnected && currentChainId !== TARGET_CHAIN_ID) {
        return { ...prevTokenState, balance: "~", value: "$0.00" };
      } else if (!isLoadingBTCRLBalance && isConnected) {
        return { ...prevTokenState, balance: displayBalance, value: "$0.00" };
      } else if (!isConnected) {
        return initialBTCRL;
      }
      return prevTokenState;
    };

    setFromToken(applyUpdate);
    setToToken(applyUpdate);
    
  }, [btcrlBalanceData, btcrlBalanceError, isLoadingBTCRLBalance, currentChainId, isConnected]);

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
  // Uses hardcoded decimals (8 for BTCRL, 2 for YUSDC) and special < 0.001 display.
  const formatTokenAmountDisplay = useCallback((amountString: string, tokenSymbol: string): string => {
    try {
      const amount = parseFloat(amountString);

      if (isNaN(amount) || amount === 0) return "0"; // Return "0" for invalid or zero input or exact zero

      // Handle very small positive numbers with special string FIRST
      if (amount > 0 && amount < 0.001) return "< 0.001";

      // Determine decimals for display based on symbol
      const displayDecimals = tokenSymbol === 'BTCRL' ? 8 : 2; // Hardcoded decimals for YUSDC (assuming others use 2)

      // Format with determined decimals
      return amount.toFixed(displayDecimals);

    } catch (error) {
      console.error("Error formatting token amount display:", error);
      return amountString; // Return original string on error
    }
  }, []); // Dependency on useCallback - no external dependencies needed here typically

  // Replace the useEffect that calculates toAmount with V4 Quoter
  useEffect(() => {
    const fromValue = parseFloat(fromAmount);
    
    // If invalid input or tokens, clear the output
    if (isNaN(fromValue) || fromValue <= 0 || !fromToken || !toToken) {
      setToAmount("");
      return;
    }
    
    // Set a debounce timer to prevent too many API calls during fast typing
    const timer = setTimeout(async () => {
      // Only call the API if we're connected and on the right network
      if (isConnected && currentChainId === TARGET_CHAIN_ID) {
        try {
          // Show subtle loading state
          setQuoteLoading(true);
          console.log('🔍 V4 Quoter: Fetching quote for', fromAmount, fromToken.symbol, '→', toToken.symbol);
          
          const response = await fetch('/api/swap/get-quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromTokenSymbol: fromToken.symbol === 'YUSDC' ? 'YUSDC' : 'BTCRL', // Always use valid TOKEN_DEFINITIONS keys
              toTokenSymbol: toToken.symbol === 'YUSDC' ? 'YUSDC' : 'BTCRL', // Always use valid TOKEN_DEFINITIONS keys
              amountDecimalsStr: fromAmount,
              chainId: currentChainId,
              debug: true // Use debug mode to avoid contract call errors
            }),
          });

          const data = await response.json();
          console.log('📊 V4 Quoter Response:', data);
          
          if (response.ok && data.success) {
            // Set the quoted amount in the UI
            setToAmount(data.toAmount);
            setQuoteError(null);
            console.log('✅ V4 Quoter: Quote successful -', fromAmount, fromToken.symbol, '→', data.toAmount, toToken.symbol);
          } else {
            console.error('❌ V4 Quoter Error:', data.error);
            
            // Show a toast with the error
            toast.error(`Quote Error: ${data.error || 'Failed to get quote'}`);
            
            setQuoteError(data.error || 'Failed to get quote');
            
            // Fallback to the calculation using current prices
            const calculatedTo = (fromValue * fromToken.usdPrice) / toToken.usdPrice;
            setToAmount(calculatedTo.toFixed(toToken.decimals));
            console.log('⚠️ V4 Quoter: Falling back to calculated price. From: $' + fromToken.usdPrice + ', To: $' + toToken.usdPrice);
          }
        } catch (error: any) {
          console.error('❌ V4 Quoter Exception:', error);
          
          // Show a toast with the error
          toast.error(`Quote Error: ${error.message || 'Failed to fetch quote'}`);
          
          setQuoteError('Failed to fetch quote');
          
          // Fallback to the calculation using current prices
          const calculatedTo = (fromValue * fromToken.usdPrice) / toToken.usdPrice;
          setToAmount(calculatedTo.toFixed(toToken.decimals));
          console.log('⚠️ V4 Quoter: Falling back to calculated price. From: $' + fromToken.usdPrice + ', To: $' + toToken.usdPrice);
        } finally {
          // Clear loading state
          setQuoteLoading(false);
        }
      } else {
        // Fallback to the calculation using current prices
        const calculatedTo = (fromValue * fromToken.usdPrice) / toToken.usdPrice;
        setToAmount(calculatedTo.toFixed(toToken.decimals));
        console.log('ℹ️ V4 Quoter: Using calculated price (not connected or wrong network). From: $' + fromToken.usdPrice + ', To: $' + toToken.usdPrice);
      }
    }, 500); // 500ms debounce
    
    return () => clearTimeout(timer);
  }, [fromAmount, fromToken, toToken, isConnected, currentChainId, TARGET_CHAIN_ID]);

  // Update calculatedValues for UI display
  useEffect(() => {
    const fromValueNum = parseFloat(fromAmount || "0");
    const fromTokenUsdPrice = fromToken.usdPrice || 0; // Ensure usdPrice is a number

    const updatedFeesArray: FeeDetail[] = [];

    // Fee Percentage
    let feePercentageString: string;
    if (isConnected && currentChainId === TARGET_CHAIN_ID) {
      if (dynamicFeeLoading) {
        if (dynamicFeeBps !== null) {
          // If loading but a previous fee exists, just show the previous fee statically.
          feePercentageString = `${(dynamicFeeBps / 10000).toFixed(2)}%`;
        } else {
          // If loading and no previous fee (initial load), set to "N/A".
          // The animated icon will be displayed by the render logic due to dynamicFeeLoading being true.
          feePercentageString = "N/A";
        }
      } else if (dynamicFeeError) {
        feePercentageString = "Fee N/A";
      } else if (dynamicFeeBps !== null) { // Covers amount > 0 and amount === 0 cases if fee is available
        feePercentageString = `${(dynamicFeeBps / 10000).toFixed(2)}%`;
      } else {
        // If not loading, no error, but dynamicFeeBps is null (e.g. initial state before any fetch attempt)
        feePercentageString = "N/A";
      }
    } else {
      // Not connected or wrong chain
      feePercentageString = "N/A";
    }
    updatedFeesArray.push({ name: "Fee", value: feePercentageString, type: "percentage" });

    // Fee Value (USD) - only if amount > 0, connected, on chain, and fee is available
    if (fromValueNum > 0 && isConnected && currentChainId === TARGET_CHAIN_ID && dynamicFeeBps !== null && !dynamicFeeLoading && !dynamicFeeError) {
      const feeInUsd = (fromValueNum * fromTokenUsdPrice) * (dynamicFeeBps / 10000 / 100);
      let feeValueDisplay: string;
      if (feeInUsd > 0 && feeInUsd < 0.01) {
        feeValueDisplay = "< $0.01";
      } else {
        feeValueDisplay = formatCurrency(feeInUsd.toString());
      }
      updatedFeesArray.push({ name: "Fee Value (USD)", value: feeValueDisplay, type: "usd" });
    }
    
    const newFromTokenValue = (!isNaN(fromValueNum) && fromValueNum >= 0 && fromToken.usdPrice)
                              ? (fromValueNum * fromToken.usdPrice)
                              : 0;
    const toValueNum = parseFloat(toAmount);
    const newToTokenValue = (!isNaN(toValueNum) && toValueNum >= 0 && toToken.usdPrice)
                            ? (toValueNum * toToken.usdPrice)
                            : 0;
    
    // const currentToAmount = parseFloat(toAmount) || 0; // This line can be removed or kept if used elsewhere, not directly for fees now
    // const minimumReceivedDisplay = showFeeDetails ? formatTokenAmount(currentToAmount.toString(), toToken.decimals) : "0.00"; // This line can be removed

    setCalculatedValues(prev => ({
      ...prev,
      fromTokenAmount: formatTokenAmountDisplay(fromAmount, fromToken.symbol),
      fromTokenValue: formatCurrency(newFromTokenValue.toString()),
      toTokenAmount: formatTokenAmountDisplay(toAmount, toToken.symbol),
      toTokenValue: formatCurrency(newToTokenValue.toString()),
      fees: updatedFeesArray, 
      slippage: prev.slippage, 
    }));

  }, [fromAmount, toAmount, fromToken, toToken, formatCurrency, isConnected, currentChainId, dynamicFeeLoading, dynamicFeeError, dynamicFeeBps, formatTokenAmountDisplay]); // Added formatTokenAmountDisplay dependency

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

    setFromToken(toToken); // e.g. YUSD becomes BTCRL
    setToToken(tempLogicalToken); // e.g. BTCRL becomes YUSD
    
    setFromAmount(toAmount); // Old toAmount becomes new fromAmount for input field
    // toAmount will be recalculated by useEffect based on the new fromAmount and swapped tokens
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
      console.log("[handleSwap] Pre-checks failed.", { isConnected, currentChainId, fromAmountNum, fromBalanceNum, insufficientBalance });
      // Removed the "Insufficient Balance" toast here as per user request
      return;
    }

    console.log("[handleSwap] Initiating swap review & checks.");
    setSwapState("review"); // Move to review UI
    reviewNotificationsShown.current = { needs_approval: false, needs_signature: false, approval_complete: false, signature_complete: false }; // Reset notifications
    setCompletedSteps([]); // Reset steps for this new review attempt
    setIsSwapping(true); // Disable confirm button during checks
    setSwapProgressState("checking_allowance"); // Show checks are in progress

    // --- Helper to fetch permit data (can be extracted if used elsewhere) ---
    const fetchPermitData = async (): Promise<any> => {
      console.log("[fetchPermitData] Fetching fresh permit data...");
      try {
        const response = await fetch('/api/swap/prepare-permit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userAddress: accountAddress,
            tokenAddress: fromToken.address,
            chainId: currentChainId,
            checkExisting: true,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Failed to fetch permit data');
        console.log("[fetchPermitData] Fetched data:", data);
        return data;
      } catch (fetchError: any) {
        console.error("[fetchPermitData] Error:", fetchError);
        throw new Error("Could not retrieve permit information.");
      }
    };
    // --- End Helper ---

    try {
      const parsedAmount = parseUnits(fromAmount, fromToken.decimals);

      // 2. Check ERC20 Allowance
      console.log("[handleSwap] Checking ERC20 allowance...");
      const allowance = await publicClient.readContract({
        address: fromToken.address,
        abi: Erc20AbiDefinition,
        functionName: 'allowance',
        args: [accountAddress as Address, PERMIT2_ADDRESS as Address]
      }) as bigint;

      // 3. Handle ERC20 Result
      if (allowance < parsedAmount) {
        console.log("[handleSwap] ERC20 insufficient. Setting state: needs_approval");
        setSwapProgressState("needs_approval");
        setIsSwapping(false); // Checks done, ready for user action (Approve)
        // Notification effect will show toast
        return; // Stop here, wait for user to click "Approve"
      }

      // 4. ERC20 OK -> Check Permit2 Immediately
      console.log("[handleSwap] ERC20 sufficient. Marking complete & checking Permit2...");
      toast("Token Approved", {
        duration: 2500,
      });
      setCompletedSteps(["approval_complete"]); // Mark step 1 complete
      setSwapProgressState("checking_allowance"); // Indicate checking permit

      const permitData = await fetchPermitData();
      setCurrentPermitDetailsForSign(permitData); // Store fetched permit data
      setObtainedSignature(null); // Clear any previous signature

      const needsSignature = !permitData.hasValidPermit || BigInt(permitData.currentPermitInfo.amount) < MaxUint160;

      // 5. Handle Permit2 Result
      if (needsSignature) {
        console.log("[handleSwap] Permit2 check complete. Setting state: needs_signature");
        setSwapProgressState("needs_signature");
        // Notification effect will show toast
      } else {
        console.log("[handleSwap] Permit2 check complete. Setting state: ready_to_swap");
        toast("Permission Granted", {
          duration: 2500,
          icon: <SuccessToastIcon />
        });
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
        icon: <WarningToastIcon />,
        duration: 4000,
      });
      // Keep user on review screen, they can click "Change" to go back
    }
  };

  const handleUsePercentage = (percentage: number) => {
    try {
      // Get the exact balance data directly from the balance hooks
      let exactBalanceData;
      if (fromToken.address === YUSD_ADDRESS) {
        exactBalanceData = yusdBalanceData;
      } else if (fromToken.address === BTCRL_ADDRESS) {
        exactBalanceData = btcrlBalanceData;
      } else {
        // For any other tokens in the future, we'd need to add their balance data here
        console.warn(`No direct balance data source found for token ${fromToken.symbol}`);
        return;
      }

      // Use the exact formatted value from the blockchain if available
      if (exactBalanceData && exactBalanceData.formatted) {
        // Parse the exact blockchain value
        const exactBalance = exactBalanceData.formatted;
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
          console.log(`Setting 100% exact balance for ${fromToken.symbol}: ${exactBalance}`);
        } else {
          // For other percentages, calculate and format to the token's decimals
          setFromAmount(exactAmount.toFixed(fromToken.decimals));
          console.log(`Setting ${percentage}% of exact balance for ${fromToken.symbol}: ${exactAmount.toFixed(fromToken.decimals)}`);
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
      // Get the exact balance data directly from the balance hooks
      let exactBalanceData;
      if (token.address === YUSD_ADDRESS) {
        exactBalanceData = yusdBalanceData;
      } else if (token.address === BTCRL_ADDRESS) {
        exactBalanceData = btcrlBalanceData;
      } else {
        // For any other tokens in the future, we'd need to add their balance data here
        console.warn(`No direct balance data source found for token ${token.symbol}`);
        return;
      }

      // Use the exact formatted value from the blockchain if available
      if (exactBalanceData && exactBalanceData.formatted) {
        if (isFrom) {
          // Set EXACTLY what the blockchain reports - no parsing/formatting that might round
          setFromAmount(exactBalanceData.formatted);
          console.log(`Setting exact balance for ${token.symbol}: ${exactBalanceData.formatted}`);
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

  const handleConfirmSwap = async () => {
    // 1. Guard & Initial Setup
    if (isSwapping) {
      console.log("[handleConfirmSwap] Already swapping, preventing re-entrancy.");
      return;
    }
    setIsSwapping(true); // Disable button immediately
    const stateBeforeAction = swapProgressState; // Store state before this action attempt
    console.log(`[handleConfirmSwap] Starting action from state: ${stateBeforeAction}`);

    // --- Helper Function Placeholder for fetching permit data ---
    // In a real scenario, this would likely call the '/api/swap/prepare-permit' endpoint
    const fetchPermitData = async (): Promise<any> => {
        console.log("[fetchPermitData] Fetching fresh permit data...");
        try {
            const response = await fetch('/api/swap/prepare-permit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userAddress: accountAddress,
                    tokenAddress: fromToken.address,
                    chainId: currentChainId,
                    checkExisting: true, // Always check validity when fetching
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.message || 'Failed to fetch permit data');
            }
            console.log("[fetchPermitData] Fetched data:", data);
            return data;
        } catch (fetchError) {
            console.error("[fetchPermitData] Error:", fetchError);
            throw new Error("Could not retrieve permit information from the server."); // Re-throw a user-friendly error
        }
    };
    // --- End Helper Placeholder ---

    try {
        // 2. Determine Action based on CURRENT progress state
        const parsedAmount = parseUnits(fromAmount, fromToken.decimals); // Needed in multiple branches

        // ACTION: Need to Approve
        if (stateBeforeAction === "needs_approval") {
            console.log("[handleConfirmSwap] Action: Approving ERC20");
            setSwapProgressState("approving");
            toast("Approving tokens for Permit2...");

            const approveTxHash = await sendApprovalTx({
                address: fromToken.address,
                abi: Erc20AbiDefinition,
                functionName: 'approve',
                args: [PERMIT2_ADDRESS, parseUnits("1000000", fromToken.decimals)], // Consistent large approval
            });
            if (!approveTxHash) throw new Error("Failed to send approval transaction");

            toast("Approval Submitted", { description: "Waiting for confirmation..." });
            setSwapProgressState("waiting_approval");
            const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTxHash as Hex });
            if (!approvalReceipt || approvalReceipt.status !== 'success') throw new Error("Approval transaction failed on-chain");

            toast("Approval Confirmed", { 
              duration: 2500
            });
            setCompletedSteps(prev => [...prev, "approval_complete"]);

            // --- CRITICAL: Re-fetch Permit Data AFTER approval ---
            const freshPermitData = await fetchPermitData();
            setCurrentPermitDetailsForSign(freshPermitData); // Store fresh permit data
            setObtainedSignature(null); // Clear any previous signature

            const needsSigAfterApproval = !freshPermitData.hasValidPermit || BigInt(freshPermitData.currentPermitInfo.amount) < MaxUint160;

            if (needsSigAfterApproval) {
                console.log("[handleConfirmSwap] Approval done, signature needed.");
                setSwapProgressState("needs_signature");
            } else {
                console.log("[handleConfirmSwap] Approval done, signature NOT needed.");
                setSwapProgressState("ready_to_swap");
                setCompletedSteps(prev => prev.includes("signature_complete") ? prev : [...prev, "signature_complete"]);
            }
            setIsSwapping(false); // Re-enable button for next distinct step
            return; // Wait for next user click
        }

        // ACTION: Need to Sign
        else if (stateBeforeAction === "needs_signature") {
            console.log("[handleConfirmSwap] Action: Signing Permit2");

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

            const reallyNeedsSig = !permitDataForSigning.hasValidPermit || BigInt(permitDataForSigning.currentPermitInfo.amount) < MaxUint160;

            if (!reallyNeedsSig) {
                 console.log("[handleConfirmSwap] Fresh check (using stored data) shows signature no longer needed. Moving to ready_to_swap.");
                 setCompletedSteps(prev => prev.includes("signature_complete") ? prev : [...prev, "signature_complete"]);
                 setSwapProgressState("ready_to_swap");
                 setIsSwapping(false); 
                 return; 
            }

            setSwapProgressState("signing_permit");
            toast("Please sign the permit message...");

            const messageToSign = {
                details: {
                    token: getAddress(fromToken.address), // Should match permitDataForSigning.details.token if it existed
                    amount: MaxUint160, 
                    expiration: permitDataForSigning.permitExpiration, // Use stored expiration
                    nonce: permitDataForSigning.nonce, // Use stored nonce
                },
                spender: getAddress(permitDataForSigning.spender), // Use stored spender
                sigDeadline: BigInt(permitDataForSigning.sigDeadline), // Use stored sigDeadline
            };

            const signatureFromSigning = await signTypedDataAsync({
                domain: permitDataForSigning.domain, // Use stored domain
                types: permitDataForSigning.types, // Use stored types
                primaryType: 'PermitSingle',
                message: messageToSign,
            });
            
            if (!signatureFromSigning) throw new Error("Signature process did not return a valid signature.");
            setObtainedSignature(signatureFromSigning); // Store the obtained signature

            toast.success("Permit signature received!");
            setCompletedSteps(prev => [...prev, "signature_complete"]);
            setSwapProgressState("ready_to_swap"); 
            setIsSwapping(false); 
            return; 
        }

        // ACTION: Ready to Swap
        else if (stateBeforeAction === "ready_to_swap") {
            console.log("[handleConfirmSwap] Action: Building and Executing Swap");

            // Check if we have the necessary permit details and signature if one was required
            const needsSignatureCheck = !currentPermitDetailsForSign?.hasValidPermit || 
                                    BigInt(currentPermitDetailsForSign?.currentPermitInfo?.amount || '0') < MaxUint160;
            
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
            const currentBalanceBigInt = parseUnits(fromToken.balance || "0", fromToken.decimals);
            const parsedAmountForSwap = parseUnits(fromAmount, fromToken.decimals);
            if (currentBalanceBigInt < parsedAmountForSwap) {
                 throw new Error(`Insufficient balance. Required: ${fromAmount}, Available: ${fromToken.balance}`);
            }
            // --- End Sanity Check ---

            setSwapProgressState("building_tx");
            toast("Building swap transaction...");

            // >>> FETCH DYNAMIC FEE FIRST <<<
            let fetchedDynamicFee: number | null = null;
            try {
                const feeResponse = await fetch('/api/swap/get-dynamic-fee', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fromTokenSymbol: Object.keys(TOKEN_DEFINITIONS).find(key => 
                            TOKEN_DEFINITIONS[key as TokenSymbol].addressRaw === fromToken.address
                        ) as TokenSymbol,
                        toTokenSymbol: Object.keys(TOKEN_DEFINITIONS).find(key => 
                            TOKEN_DEFINITIONS[key as TokenSymbol].addressRaw === toToken.address
                        ) as TokenSymbol,
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
                console.log("[handleConfirmSwap] Dynamic fee fetched:", fetchedDynamicFee);

            } catch (feeError: any) {
                console.error("[handleConfirmSwap] Error fetching dynamic fee:", feeError);
                toast.error("Could not fetch swap fee. Please try again.", {
                  icon: <WarningToastIcon /> // ENSURED ICON
                });
                setIsSwapping(false);
                setSwapProgressState("error"); // Or back to "ready_to_swap" to allow retry
                return;
            }
            // >>> END FETCH DYNAMIC FEE <<<

            const effectiveTimestamp = BigInt(Math.floor(Date.now() / 1000));
            const effectiveFallbackSigDeadline = effectiveTimestamp + BigInt(30 * 60); // 30 min fallback

            const bodyForSwapTx = {
                 userAddress: accountAddress,
                 fromTokenSymbol: fromToken.symbol === 'YUSDC' ? 'YUSDC' : 'BTCRL', // Always use valid TOKEN_DEFINITIONS keys
                 toTokenSymbol: toToken.symbol === 'YUSDC' ? 'YUSDC' : 'BTCRL', // Always use valid TOKEN_DEFINITIONS keys
                 swapType: 'ExactIn', // Assuming ExactIn, adjust if dynamic
                 amountDecimalsStr: fromAmount, // The actual amount user wants to swap
                 limitAmountDecimalsStr: "0", // Placeholder for min received, API might calculate or take this
                 
                 permitSignature: signatureToUse || "0x", 
                 permitTokenAddress: fromToken.address, // Token that was permitted (fromToken)
                 permitAmount: MaxUint160.toString(),   // The amount specified in the signed permit (always MaxUint160)
                 permitNonce: permitDetailsToUse.nonce, 
                 permitExpiration: permitDetailsToUse.permitExpiration, 
                 permitSigDeadline: permitDetailsToUse.sigDeadline ? permitDetailsToUse.sigDeadline.toString() : effectiveFallbackSigDeadline.toString(),
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
            toast("Sending swap transaction...");

            const txHash = await sendSwapTx({
                address: getAddress(buildTxApiData.to),
                abi: UniversalRouterAbi,
                functionName: 'execute',
                args: [buildTxApiData.commands as Hex, buildTxApiData.inputs as Hex[], BigInt(buildTxApiData.deadline)],
                value: BigInt(buildTxApiData.value),
            });
            if (!txHash) throw new Error("Failed to send swap transaction (no hash received)");

            setSwapTxInfo({ 
                 hash: txHash as string, fromAmount, fromSymbol: fromToken.symbol, toAmount, toSymbol: toToken.symbol,
                 explorerUrl: `${baseSepolia.blockExplorers.default.url}/tx/${txHash}`,
            });
            setSwapProgressState("waiting_confirmation");
            toast("Swap submitted", { description: "Waiting for confirmation..." });

            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex });
            if (!receipt || receipt.status !== 'success') throw new Error("Swap transaction failed on-chain");

            setIsSwapping(false); 
            setSwapState("success");
            setCompletedSteps(prev => [...prev, "complete"]);


            toast("Swap Successful", {
                 icon: <SuccessToastIcon />, duration: 5000,
            });
            window.swapBuildData = undefined;
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
            console.log(`[handleConfirmSwap] User rejection detected. Resetting state to: ${stateBeforeAction}`);
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

  // This function now toggles the PREVIEW
  const handleFeePercentageClick = () => {
    setIsFeeChartPreviewVisible(!isFeeChartPreviewVisible);
  };

  // This function opens the MODAL
  const handlePreviewChartClick = () => {
    if (isMobile) {
      toast("Not available on mobile (Alpha)", { 
        duration: 4000
      });
    } else {
      setIsFeeChartModalOpen(true);
    }
  };

  // --- RENDER LOGIC --- 
  // Determine which token is YUSD and which is BTCRL for display purposes, regardless of from/to state
  const displayFromToken = fromToken; // This is what's in the 'Sell' slot
  const displayToToken = toToken;   // This is what's in the 'Buy' slot

  // isLoading for balances
  const isLoadingCurrentFromTokenBalance = fromToken.address === YUSD_ADDRESS ? isLoadingYUSDBalance : isLoadingBTCRLBalance;
  const isLoadingCurrentToTokenBalance = toToken.address === YUSD_ADDRESS ? isLoadingYUSDBalance : isLoadingBTCRLBalance;
  
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
    if (fromToken.address === YUSD_ADDRESS && yusdBalanceData && 
        fromAmount === yusdBalanceData.formatted) {
      actualNumericPercentage = 100;
    } else if (fromToken.address === BTCRL_ADDRESS && btcrlBalanceData && 
              fromAmount === btcrlBalanceData.formatted) {
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

  const strokeWidth = 2; // Define strokeWidth for the SVG rect elements

  // Effect to fetch historical fee data
  useEffect(() => {
    const fetchHistoricalFeeData = async () => {
      console.log('🔄 fetchHistoricalFeeData triggered', {
        isConnected,
        currentChainId,
        TARGET_CHAIN_ID,
        fromTokenSymbol: fromToken?.symbol,
        toTokenSymbol: toToken?.symbol
      });
      
      if (!isConnected || currentChainId !== TARGET_CHAIN_ID || !fromToken || !toToken) {
        setFeeHistoryData([]); // Clear data if not connected or tokens not set
        setIsFeeChartPreviewVisible(false);
        return;
      }

      // Prevent duplicate API calls
      if (isFetchingFeeHistoryRef.current) {
        console.log('🚫 Skipping duplicate fee history fetch request');
        return;
      }

      // --- IMPORTANT: Pool ID Derivation Placeholder ---
      // The following poolId is a placeholder based on your example.
      // You MUST replace this with actual logic to determine the correct poolId
      // for the selected fromToken and toToken pair. This might involve:
      // 1. A lookup in TOKEN_DEFINITIONS or a similar constants file if pools are predefined for pairs.
      // 2. A call to another utility/API that can resolve a token pair to a pool address.
      // 3. Modifying the get-historical-dynamic-fees API to accept token symbols and resolve poolId internally.
      const poolIdForFeeHistory = "0xbcc20db9b797e211e508500469e553111c6fa8d80f7896e6db60167bcf18ce13"; // EXAMPLE Placeholder
      // --- End Placeholder ---

      if (!poolIdForFeeHistory) {
          console.warn("SwapInterface: poolIdForFeeHistory could not be determined. Skipping historical fee fetch.");
          setFeeHistoryData([]);
          setIsFeeChartPreviewVisible(false);
          return;
      }

      isFetchingFeeHistoryRef.current = true;
      setIsFeeHistoryLoading(true);
      setFeeHistoryError(null);
      setIsFeeChartPreviewVisible(false); // Hide while loading new data

      try {
        // Default to 30 days for the preview chart
        const response = await fetch(`/api/liquidity/get-historical-dynamic-fees?poolId=${poolIdForFeeHistory}&days=30`);
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || `Failed to fetch historical fee data: ${response.statusText}`);
        }
        const data: FeeHistoryPoint[] = await response.json();
        
        if (data && data.length > 0) {
            setFeeHistoryData(data);
            setIsFeeChartPreviewVisible(true); // Show preview if data is successfully loaded
        } else {
            setFeeHistoryData([]);
            setIsFeeChartPreviewVisible(false); // Keep hidden if no data
        }

      } catch (error: any) {
        console.error("Failed to fetch historical fee data:", error);
        setFeeHistoryError(error.message || "Could not load fee history.");
        setFeeHistoryData([]);
        setIsFeeChartPreviewVisible(false);
      } finally {
        setIsFeeHistoryLoading(false);
        isFetchingFeeHistoryRef.current = false;
      }
    };

    fetchHistoricalFeeData();
  }, [fromToken?.symbol, toToken?.symbol, isConnected, currentChainId, TARGET_CHAIN_ID]); // Dependencies: only token symbols, not full objects

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
    timestamp?: number;
  }>({
    BTC: 77000, // Default fallback price
    USDC: 1,    // Default fallback price
  });
  
  // Effect to fetch token prices periodically
  useEffect(() => {
    if (!isMounted) return;
    
    // Function to fetch prices
    const fetchPrices = async () => {
      try {
        const response = await fetch('/api/prices/get-token-prices');
        if (!response.ok) {
          throw new Error(`Error fetching prices: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📈 Token prices fetched:', data);
        
        setTokenPrices(data);
      } catch (error) {
        console.error('Error fetching token prices:', error);
        // Keep using existing prices as fallback
      }
    };
    
    // Fetch prices immediately
    fetchPrices();
    
    // Set up periodic refresh (every 5 minutes)
    const priceRefreshInterval = setInterval(fetchPrices, 5 * 60 * 1000);
    
    return () => {
      clearInterval(priceRefreshInterval);
    };
  }, [isMounted]);
  
  // Update token price when tokenPrices changes
  useEffect(() => {
    if (!tokenPrices) return;
    
    setFromToken(prev => ({
      ...prev,
      usdPrice: prev.symbol === 'BTCRL' ? tokenPrices.BTC : tokenPrices.USDC
    }));
    
    setToToken(prev => ({
      ...prev,
      usdPrice: prev.symbol === 'BTCRL' ? tokenPrices.BTC : tokenPrices.USDC
    }));
    
  }, [tokenPrices]);

  return (
    <div className="flex flex-col gap-4"> {/* Removed items-center */}
      {/* Main Swap Interface Card */}
      <Card className="w-full max-w-md card-gradient z-10 mx-auto"> {/* Added mx-auto */}
        {/* <CardHeader className="pt-6 pb-2">
            <CardTitle className="text-center">Swap Tokens</CardTitle>
        </CardHeader> */}
        <CardContent className="p-6 pt-6">
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
                handleCyclePercentage={handleCyclePercentage}
                handleMouseEnterArc={handleMouseEnterArc}
                handleMouseLeaveArc={handleMouseLeaveArc}
                actualNumericPercentage={actualNumericPercentage}
                currentSteppedPercentage={currentSteppedPercentage}
                hoveredArcPercentage={hoveredArcPercentage}
                isSellInputFocused={isSellInputFocused}
                setIsSellInputFocused={setIsSellInputFocused}
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

      {/* Preview Chart - Conditionally rendered below the main card */}
      <AnimatePresence>
        {/* 
          Show preview if:
          - Not loading dynamic fee (for current fee)
          - No error with dynamic fee (for current fee)
          - Dynamic fee bps is available (successfully fetched for current fee)
          - Historical Fee history data is available AND not loading AND no error
          - User is connected and on the target chain
        */}
        {!dynamicFeeLoading && !dynamicFeeError && dynamicFeeBps !== null && 
         !isFeeHistoryLoading && !feeHistoryError && feeHistoryData.length > 0 && // Check historical data state
         isConnected && currentChainId === TARGET_CHAIN_ID && isFeeChartPreviewVisible && (
          <motion.div
            key="dynamic-fee-preview-auto" // New key for AnimatePresence
            className="w-full max-w-md mx-auto" // Preview matches main card width
            initial={{ y: -10, opacity: 0, height: 0 }}    
            animate={{ y: 0, opacity: 1, height: 'auto' }}       
            exit={{ y: -10, opacity: 0, height: 0 }}       
            transition={{ type: "spring", stiffness: 300, damping: 30, duration: 0.2 }}
          >
            <DynamicFeeChartPreview data={feeHistoryData} onClick={handlePreviewChartClick} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full Chart Modal - Controlled by isFeeChartModalOpen - Moved outside the mapping */}
      <Dialog open={isFeeChartModalOpen} onOpenChange={setIsFeeChartModalOpen}>
        {/* No DialogTrigger here, it's opened programmatically via the preview click */}
        <DialogContent className="sm:max-w-3xl p-0 outline-none ring-0 border-0 shadow-2xl rounded-lg">
          <DialogTitle className="sr-only">Dynamic Fee Chart</DialogTitle>
          <DynamicFeeChart data={feeHistoryData} />
          {/* Default Dialog close button will be used */}
        </DialogContent>
      </Dialog>
    </div> // Ensure this closing div is correct
  );
}

