"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  FileTextIcon,
  ActivityIcon,
  WalletIcon,
} from "lucide-react"
import { IconMinus, IconBadgeCheck2, IconCoins, IconRefreshClockwise } from "nucleo-micro-bold-essential"
import { useAccount, useBalance } from "wagmi"
import { motion, AnimatePresence } from "framer-motion"
import React from "react"
import { activeChainId, isMainnet } from "../../lib/wagmiConfig";
import { toast } from "sonner";
import type { Address } from "viem"
import { useIsMobile } from "@/hooks/use-mobile";
import { useSwapPercentageInput } from "@/hooks/usePercentageInput";
import { useUserSlippageTolerance } from "@/hooks/useSlippage";
import { getAutoSlippage } from "@/lib/slippage/slippage-api";
import { useTokenUSDPrice } from "@/hooks/useTokenUSDPrice";

import {
  getAllTokens,
  getToken,
  TokenSymbol,
  getTokenDefinitions,
} from "@/lib/pools-config"
import { useNetwork } from "@/lib/network-context"
import { useChainMismatch } from "@/hooks/useChainMismatch"
import { useSwapExecution, type SwapProgressState } from "./useSwapExecution"
import { useSwapTrade } from "./useSwapTrade"
import { useFeeHistory, type FeeHistoryPoint } from "./useFeeHistory"
import { swapStore, useSwapStore } from "./swapStore"

import { Card, CardContent } from "@/components/ui/card"
import { formatTokenDisplayAmount } from "@/lib/utils"

// Chart Import
import { DynamicFeeChartPreview } from "../dynamic-fee-chart-preview";
// Deprecated cache functions removed - dynamic fee fetching happens directly via API
import { SwapRoute } from "@/lib/swap/routing-engine";

// Import the new view components
import { SwapInputView } from './SwapInputView';
import { SwapReviewView } from './SwapReviewView';
import { SwapSuccessView } from './SwapSuccessView';

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

export type { SwapProgressState } from "./useSwapExecution";

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

// Swap progress state machine lives in `useSwapExecution` (re-exported above).

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

// FeeDetail type comes from the trade model hook
export type { FeeDetail } from "./useSwapTrade"

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

  // Removed route-row hover logic; arrows only show on preview hover
  const [isAttemptingSwitch, setIsAttemptingSwitch] = useState(false);

  // Chain mismatch handling - hook manages the toast globally
  const { isMismatched: isChainMismatched, switchToExpectedChain } = useChainMismatch();

  const [isSellInputFocused, setIsSellInputFocused] = useState(false);
  
  // V4 Quoter / route info now managed by hooks

  // Initialize tokens dynamically - will update with real prices later
  const initialTokenData = getInitialTokens();

  // Tokens for swap (with token data stored in state)
  const [fromToken, setFromToken] = useState<Token>(initialTokenData.defaultFrom);
  const [toToken, setToToken] = useState<Token>(initialTokenData.defaultTo);
  const [tokenList, setTokenList] = useState<Token[]>(initialTokenData.availableTokens);
  const fromAmount = useSwapStore((s) => s.fromAmount)
  const toAmount = useSwapStore((s) => s.toAmount)
  const independentField = useSwapStore((s) => s.independentField)

  const { address: accountAddress, isConnected, chainId: currentChainId } = useAccount();

  // State for historical fee data
  // Chart stability tracking no longer needed with simple rect approach


  const [selectedPercentageIndex, setSelectedPercentageIndex] = useState(-1);
  const cyclePercentages = [25, 50, 75, 100];
  const [hoveredArcPercentage, setHoveredArcPercentage] = useState<number | null>(null);

  // Dynamic fee + route fees managed by hooks
  // REMOVED: const [selectedPoolIndexForChart, setSelectedPoolIndexForChart] = useState<number>(0); // Track which pool's chart to show

  // REMOVED: Handler for selecting which pool's fee chart to display (now passed as prop)
  // const handleSelectPoolForChart = useCallback((poolIndex: number) => {
  //   if (currentRoute && poolIndex >= 0 && poolIndex < currentRoute.pools.length) {
  //     setSelectedPoolIndexForChart(poolIndex);
  //   }
  // }, [currentRoute]);

  // Swap execution state machine is extracted into `useSwapExecution`.

  // Trade model (Uniswap-style single source of truth for quote+route+fees+derived amounts)

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

  // First, create a completely new function for the Change button
  const handleChangeButton = () => {
    // Execution reset only (keep quote + amounts stable when returning from review)
    swapActions.resetForChange();
    lastEditedSideRef.current = "from";
  };

  // Chain mismatch toast is now handled by useChainMismatch hook globally

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
    swapStore.actions.setFromAmount,
    swapStore.actions.setToAmount
  );

  // Listen for faucet claim to refresh balances
  useEffect(() => {
    if (!accountAddress) return;

    const onRefresh = () => {
      // Refetch balances via wagmi hooks
      Promise.all([refetchFromTokenBalance?.(), refetchToTokenBalance?.()])
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
  }, [accountAddress, refetchFromTokenBalance, refetchToTokenBalance]);

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

  // formatCurrency + formatTokenAmountDisplay moved into `useSwapTrade`

  // Old quote effect removed; quoting lives in `useSwapQuote`

  const lastEditedSideRef = useRef<'from' | 'to'>(independentField);
  useEffect(() => {
    lastEditedSideRef.current = independentField
  }, [independentField])

  const trade = useSwapTrade({
    fromToken,
    toToken,
    fromAmount,
    toAmount,
    setFromAmount: swapStore.actions.setFromAmount,
    setToAmount: swapStore.actions.setToAmount,
    lastEditedSideRef,
    tokenDefinitions,
    targetChainId: TARGET_CHAIN_ID,
    isConnected,
    currentChainId,
    currentRoute,
    setCurrentRoute,
    setSelectedPoolIndexForChart,
    currentSlippage,
    isAutoSlippage,
    updateAutoSlippage,
  });

  const {
    swapState,
    swapProgressState,
    isSwapping,
    completedSteps,
    swapTxInfo,
    actions: swapActions,
  } = useSwapExecution({
    queryClient: null,
    fromToken,
    toToken,
    fromAmount,
    toAmount,
    lastEditedSideRef,
    trade: trade.execution,
    tradeState: trade.tradeState,
    currentSlippage,
    fromTokenUsdPrice: fromToken.usdPrice,
    refetchFromTokenBalance,
    refetchToTokenBalance,
  });

  // Effect for Success Notification
  useEffect(() => {
    if (swapState === "success" && swapTxInfo?.hash) {
      const swapDescription = `Swapped ${swapTxInfo.fromAmount} ${swapTxInfo.fromSymbol} to ${swapTxInfo.toAmount} ${swapTxInfo.toSymbol} successfully`;
      toast.success("Swap Successful", {
        icon: <IconBadgeCheck2 className="h-4 w-4 text-green-500" />,
        description: swapDescription,
        duration: 4000,
            action: {
          label: "View Transaction",
          onClick: () => window.open(swapTxInfo.explorerUrl, "_blank"),
        },
      });
    }
  }, [swapState, swapTxInfo]);
  // calculatedValues + auto-slippage moved into `useSwapTrade`

  const handleFromAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^\d*\.?\d*$/.test(value)) {
        swapStore.actions.setFromAmount(value);
        setSelectedPercentageIndex(-1);
        swapStore.actions.setIndependentField('from');
    } else if (value === "") {
        swapStore.actions.setFromAmount("");
        setSelectedPercentageIndex(-1);
        swapStore.actions.setIndependentField('from');
    }
  };

  // Allow editing Buy (toAmount) directly for ExactOut flow
  const handleToAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^\d*\.?\d*$/.test(value)) {
      swapStore.actions.setToAmount(value);
      swapStore.actions.setIndependentField('to');
    } else if (value === "") {
      swapStore.actions.setToAmount("");
      swapStore.actions.setIndependentField('to');
    }
  };

  const handleSwapTokens = () => {
    const tempLogicalToken = fromToken; // This is just swapping our state for YUSD/BTCRL
    const tempDisplayAmount = fromAmount;

    setFromToken(toToken); // e.g. aUSDC becomes aUSDT
    setToToken(tempLogicalToken); // e.g. aUSDT becomes aUSDC
    
    swapStore.actions.setFromAmount(toAmount); // Old toAmount becomes new fromAmount for input field
    // toAmount will be recalculated by useEffect based on the new fromAmount and swapped tokens
  };

  // Token selection handlers
  const handleFromTokenSelect = (token: Token) => {
    if (token.address !== fromToken.address) {
      setFromToken(token);
      swapStore.actions.setAmounts("", "")
      // Let the centralized fetchFee() effect handle route + fee fetching to avoid duplicate API calls
    }
  };

  const handleToTokenSelect = (token: Token) => {
    if (token.address !== toToken.address) {
      setToToken(token);
      swapStore.actions.setAmounts("", "")
      // Let the centralized fetchFee() effect handle route + fee fetching to avoid duplicate API calls
    }
  };

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
    // Uniswap-style: perform a fresh "binding" quote at review time.
    const ok = await trade.refreshBindingQuote().catch(() => false)
    if (!ok) return
    swapActions.handleSwap()
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


  const handleConfirmSwap = () => swapActions.handleConfirmSwap();


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
            <IconMinus className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
      </div>
    );
  };

  // Now, let's update the handleSwapAgain function to use the same reset logic
  const getStepIcon = () => {
    if (isSwapping) {
      return <IconRefreshClockwise className="h-8 w-8 text-slate-50 dark:text-black animate-spin" />;
    }
    
    // Explicitly check each state
    switch(swapProgressState) {
      case "needs_approval":
      case "approving":
      case "waiting_approval":
        return <IconCoins className="h-8 w-8 text-slate-50 dark:text-black" />;
        
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
    trade.clearQuote();
    swapActions.resetForSwapAgain();
    swapStore.actions.setAmounts("", "")
    trade.setRouteInfo(null);
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
  // Do not clamp actualNumericPercentage here; UI handles visual clamping / over_limit

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
        swapStore.actions.setFromAmount("0"); // Reset amount if cycling back to -1 index for 0%
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

  const { feeHistoryData, isFeeHistoryLoading, poolInfo, fallbackPoolInfo } = useFeeHistory({
    isMounted,
    isConnected,
    currentRoute,
    selectedPoolIndexForChart,
  });

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
        const fromAmountNum = parseFloat(fromAmount || "0");
        if (fromAmountNum <= 0) return true;
        return trade.tradeState !== "ready";
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
  
  // priceImpactWarning is derived inside `useSwapTrade`

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

  const rectRafRef = useRef<number | null>(null)
  const scheduleRectUpdate = useCallback(() => {
    if (rectRafRef.current !== null) return
    rectRafRef.current = requestAnimationFrame(() => {
      rectRafRef.current = null
      setCombinedRect(getContainerRect())
    })
  }, [getContainerRect])

  useEffect(() => {
    if (!isMounted) return

    scheduleRectUpdate()

    const onScroll = () => scheduleRectUpdate()
    window.addEventListener("scroll", onScroll, { passive: true })

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      ro = new ResizeObserver(() => scheduleRectUpdate())
      ro.observe(containerRef.current)
    } else {
      window.addEventListener("resize", scheduleRectUpdate)
    }

    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", scheduleRectUpdate)
      ro?.disconnect()
      if (rectRafRef.current !== null) cancelAnimationFrame(rectRafRef.current)
      rectRafRef.current = null
    }
  }, [isMounted, scheduleRectUpdate])

  // If swap UI content changes height, schedule a rect refresh (no listener rebind)
  useEffect(() => {
    scheduleRectUpdate()
  }, [
    scheduleRectUpdate,
    fromAmount,
    toAmount,
    trade.routeInfo,
    isConnected,
    currentChainId,
    trade.quoteLoading,
    trade.calculatedValues,
  ])
  
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

  // Mobile: swipe left/right on the preview to navigate multihop pools without losing click navigation.
  const swipeStartRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const handlePreviewTouchStart = (e: React.TouchEvent) => {
    if (!isMobile) return
    if (!currentRoute || currentRoute.pools.length <= 1) return
    const t = e.touches?.[0]
    if (!t) return
    swipeStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }
  }
  const handlePreviewTouchEnd = (e: React.TouchEvent) => {
    if (!isMobile) return
    if (!currentRoute || currentRoute.pools.length <= 1) return
    const start = swipeStartRef.current
    swipeStartRef.current = null
    if (!start) return

    const t = e.changedTouches?.[0]
    if (!t) return

    const dx = t.clientX - start.x
    const dy = t.clientY - start.y

    // Require a deliberate horizontal swipe; ignore vertical scroll gestures.
    if (Math.abs(dx) < 48) return
    if (Math.abs(dx) < Math.abs(dy) * 1.2) return


    if (dx < 0) handleNextPool()
    else handlePreviousPool()
  }

  // NEW: Determine if chart preview should be shown at all (always show; content decides skeleton vs data)
  // Force show preview container even when not mounted/connected; content will skeletonize as needed
  const showChartPreviewRegardlessOfData = true;

  return (
    <div className="flex flex-col">
      <div ref={containerRef} className="w-full max-w-lg mx-auto">
      {/* Main Swap Interface Card */}
      <Card className="w-full card-gradient z-10 rounded-lg bg-[var(--swap-background)] border-[var(--swap-border)]"> {/* Applied styling here */}
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
                trade={trade}
                selectedPoolIndexForChart={selectedPoolIndexForChart}
                onSelectPoolForChart={handleSelectPoolForChart}
                onRouteHoverChange={undefined}
                isConnected={isConnected}
                isAttemptingSwitch={isAttemptingSwitch}
                isLoadingCurrentFromTokenBalance={isLoadingCurrentFromTokenBalance}
                isLoadingCurrentToTokenBalance={isLoadingCurrentToTokenBalance}
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
                onNetworkSwitch={handleNetworkSwitch}
                onClearFromAmount={() => {
                  swapStore.actions.setAmounts("", "")
                }}
              />
            )}

            {/* Swapping State UI (largely preserved, uses calculatedValues) */}
            {swapState === "review" && (
              <SwapReviewView
                displayFromToken={displayFromToken}
                displayToToken={displayToToken}
                trade={trade}
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
                trade={trade}
                swapTxInfo={swapTxInfo}
                handleChangeButton={handleSwapAgain} // Use full reset for "Swap again"
                formatTokenAmountDisplay={trade.formatTokenAmountDisplay}
              />
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Preview Chart Row with external nav arrows */}
      <div className="w-full relative">
        <div className="w-full relative group overflow-x-hidden overflow-y-visible sm:overflow-visible">
          {/* Hover buffer extends horizontally so arrows remain clickable while visible */}
          <div className="absolute inset-y-0 left-0 right-0 sm:left-[-2.75rem] sm:right-[-2.75rem]"></div>
          <div className="relative touch-pan-y" onTouchStart={handlePreviewTouchStart} onTouchEnd={handlePreviewTouchEnd}>
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
              {isMobile ? (
                <DynamicFeeChartPreview 
                  data={isFeeHistoryLoading ? [] : feeHistoryData} 
                  poolInfo={poolInfo || fallbackPoolInfo}
                  isLoading={isFeeHistoryLoading}
                  alwaysShowSkeleton={false}
                  totalPools={currentRoute?.pools?.length}
                  activePoolIndex={selectedPoolIndexForChart}
                />
              ) : (
                <DynamicFeeChartPreview 
                  data={isFeeHistoryLoading ? [] : feeHistoryData} 
                  poolInfo={poolInfo || fallbackPoolInfo}
                  isLoading={isFeeHistoryLoading}
                  alwaysShowSkeleton={false}
                  totalPools={currentRoute?.pools?.length}
                  activePoolIndex={selectedPoolIndexForChart}
                />
              )}
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
                  className="absolute left-0 sm:left-[-2.5rem] top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-white opacity-100 pointer-events-auto sm:opacity-0 sm:pointer-events-none sm:group-hover:opacity-100 sm:group-hover:pointer-events-auto transition-opacity duration-150"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
              )}
              {selectedPoolIndexForChart < currentRoute.pools.length - 1 && (
                <button
                  type="button"
                  aria-label="Next pool"
                  onClick={handleNextPool}
                  className="absolute right-0 sm:right-[-2.5rem] top-1/2 -translate-y-1/2 h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-white opacity-100 pointer-events-auto sm:opacity-0 sm:pointer-events-none sm:group-hover:opacity-100 sm:group-hover:pointer-events-auto transition-opacity duration-150"
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

    </div> /* Ensure this closing div is correct */
  );
}

