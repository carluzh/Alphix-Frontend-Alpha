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
} from "lucide-react"
import Image from "next/image"
import { useAccount, useBalance, useSignTypedData, useWriteContract, useWaitForTransactionReceipt } from "wagmi"
import { motion, AnimatePresence } from "framer-motion"
import React from "react"
import { switchChain } from '@wagmi/core'
import { config, unichainSepolia } from "../lib/wagmiConfig";
import { toast } from "sonner";
import { getAddress, parseUnits, type Address, type Hex } from "viem"
import { http } from 'wagmi'
import { createPublicClient } from 'viem'

import {
  TOKEN_DEFINITIONS,
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

const TARGET_CHAIN_ID = 1301; // Unichain Sepolia
const YUSD_ADDRESS = "0x4A8595C45DCBe80Da0e0952E97E6F86a020182d7" as `0x${string}`;
const BTCRL_ADDRESS = "0x68CD619F8732B294BD23aff270ec8E0F4c22331C" as `0x${string}`;
const MaxUint160 = BigInt('0xffffffffffffffffffffffffffffffffffffffff'); // 2**160 - 1

// Enhanced Token interface
interface Token {
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
  address: YUSD_ADDRESS,
  symbol: "YUSD",
  name: "Yama USD",
  decimals: 6,
  balance: "0.000",
  value: "$0.00",
  icon: "/placeholder.svg?height=32&width=32", // Placeholder icon
  usdPrice: 1,
};

const initialBTCRL: Token = {
  address: BTCRL_ADDRESS,
  symbol: "BTCRL",
  name: "Bitcoin RL",
  decimals: 8,
  balance: "0.000",
  value: "$0.00",
  icon: "/placeholder.svg?height=32&width=32", // Placeholder icon
  usdPrice: 77000,
};

// Enhanced swap flow states
type SwapState = "input" | "review" | "swapping" | "success" | "error";

// Detailed swap progress states
type SwapProgressState = "init" | "checking_allowance" | "needs_approval" | "approving" | "waiting_approval" | "approval_complete" | "needs_signature" | "signing_permit" | "signature_complete" | "building_tx" | "executing_swap" | "waiting_confirmation" | "complete" | "error";

// Transaction information for success state
interface SwapTxInfo {
  hash: string;
  fromAmount: string;
  fromSymbol: string;
  toAmount: string;
  toSymbol: string;
  explorerUrl: string;
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

// Create a public client from the chain directly
const publicClient = createPublicClient({
  chain: unichainSepolia,
  transport: http(),
});

export function SwapInterface() {
  const [swapState, setSwapState] = useState<SwapState>("input")
  // Add new states for real swap execution
  const [swapProgressState, setSwapProgressState] = useState<SwapProgressState>("init")
  const [swapTxInfo, setSwapTxInfo] = useState<SwapTxInfo | null>(null)
  const [swapError, setSwapError] = useState<string | null>(null)

  const [fromToken, setFromToken] = useState<Token>(initialYUSD);
  const [toToken, setToToken] = useState<Token>(initialBTCRL);

  const [fromAmount, setFromAmount] = useState("0");
  const [toAmount, setToAmount] = useState("");

  const [isSwapping, setIsSwapping] = useState(false) // For swap simulation UI

  // Simplified calculatedValues - primarily for display consistency
  const [calculatedValues, setCalculatedValues] = useState({
    fromTokenAmount: "0", 
    fromTokenValue: "$0.00",
    toTokenAmount: "0", 
    toTokenValue: "$0.00",
    // Original fee/slippage structure, to be zeroed out or placeholders
    priceImpact: "0.00%",
    minimumReceived: "0.00",
    fees: [
      { name: "Protocol", value: "0.00%" },
      { name: "LP", value: "0.00%" },
      { name: "Network", value: "0.00%" },
    ],
    slippage: "0%",
  });

  const swapTimerRef = useRef<number | null>(null)
  const [selectedPercentageIndex, setSelectedPercentageIndex] = useState(-1);
  const cyclePercentages = [25, 50, 75, 100];

  const { address: accountAddress, isConnected, chainId: currentChainId } = useAccount()
  const [isAttemptingSwitch, setIsAttemptingSwitch] = useState(false);
  const [isSellInputFocused, setIsSellInputFocused] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  // State to explicitly trigger the permit check after approval state is set
  const [triggerPermitCheck, setTriggerPermitCheck] = useState(false);

  // Ref to track if review state notifications have been shown
  const reviewNotificationsShown = useRef({
     needs_approval: false, 
     needs_signature: false, 
     approval_complete: false, 
     signature_complete: false 
     // NO permit_check_triggered flag needed here
  });

  // Add necessary hooks for swap execution
  const { signTypedDataAsync } = useSignTypedData()
  const { data: swapTxHash, writeContractAsync: sendSwapTx, isPending: isSwapTxPending, error: swapTxError } = useWriteContract()
  const { data: approvalTxHash, writeContractAsync: sendApprovalTx, isPending: isApprovalTxPending, error: approvalTxError } = useWriteContract()
  
  const { isLoading: isConfirmingSwap, isSuccess: isSwapConfirmed, error: swapConfirmError } = 
    useWaitForTransactionReceipt({ hash: swapTxHash })
  const { isLoading: isConfirmingApproval, isSuccess: isApprovalConfirmed, error: approvalConfirmError } = 
    useWaitForTransactionReceipt({ hash: approvalTxHash })

  const wrongNetworkToastIdRef = useRef<string | number | undefined>(undefined);
  const [isWrongNetworkToastActive, setIsWrongNetworkToastActive] = useState(false);

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

  // First, add state to track completed steps
  const [completedSteps, setCompletedSteps] = useState<SwapProgressState[]>([]);

  // Effect for handling wrong network notification
  useEffect(() => {
    if (isMounted && isConnected && currentChainId !== TARGET_CHAIN_ID && !isAttemptingSwitch) {
      const newToastId = toast("Wrong Network", {
        description: "Please switch to Unichain Sepolia.",
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

  // Function to perform Permit2 Check (called from useEffect)
  const checkPermit2Allowance = useCallback(async () => {
    if (!accountAddress || !fromToken || !currentChainId) {
      console.warn("[checkPermit2Allowance] Missing data, skipping check.");
      return; 
    }
    console.log("[checkPermit2Allowance] Running Permit2 check.");
    setSwapProgressState("checking_allowance"); // Indicate checking
    try {
      const permitApiResponse = await fetch('/api/swap/prepare-permit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: accountAddress,
          tokenAddress: fromToken.address,
          chainId: currentChainId,
          checkExisting: true,
        }),
      });
      const permitApiData = await permitApiResponse.json();
      if (!permitApiResponse.ok) throw new Error(permitApiData.message || 'Failed to prepare permit data');
      
      if (permitApiData.hasValidPermit && BigInt(permitApiData.currentPermitInfo.amount) >= MaxUint160) {
        console.log("[checkPermit2Allowance] Permit2 sufficient. Setting state: signature_complete");
        setSwapProgressState("signature_complete");
        setCompletedSteps(prev => prev.includes("signature_complete") ? prev : [...prev, "signature_complete"]); 
      } else {
        console.log("[checkPermit2Allowance] Permit2 insufficient/invalid. Setting state: needs_signature");
        setSwapProgressState("needs_signature");
      }
    } catch (error) {
      console.error("Error checking permit data:", error);
      console.log("[checkPermit2Allowance] Error checking permit. Setting state: needs_signature");
      setSwapProgressState("needs_signature");
    }
  }, [accountAddress, fromToken, currentChainId, setSwapProgressState, setCompletedSteps]);

  // Effect to Trigger Permit Check
  useEffect(() => {
    if (triggerPermitCheck) {
      console.log("[Effect Trigger] triggerPermitCheck is true, calling checkPermit2Allowance.");
      checkPermit2Allowance();
      setTriggerPermitCheck(false); // Reset trigger immediately
    }
  }, [triggerPermitCheck, checkPermit2Allowance]);

  // Effect for Review State Notifications
  useEffect(() => {
    console.log(`[Effect Notifications] Running. swapState: ${swapState}, swapProgressState: ${swapProgressState}, shown:`, JSON.stringify(reviewNotificationsShown.current));
    if (swapState === "review") {
      console.log("[Effect Notifications] In review state.");
      // Handle Warning Toasts
      if (swapProgressState === "needs_approval" && !reviewNotificationsShown.current.needs_approval) {
        console.log("%%% TOASTING: Approval Required %%%");
        toast("Approval Required", { description: `Permit2 needs approval to spend your ${fromToken.symbol}.`, icon: <WarningToastIcon />, duration: 4000 });
        reviewNotificationsShown.current.needs_approval = true;
      } else if (swapProgressState === "needs_signature" && !reviewNotificationsShown.current.needs_signature) {
        console.log("%%% TOASTING: Signature Required %%%");
        toast("Signature Required", { description: `Permit2 allowance needs to be granted or renewed via signature.`, icon: <WarningToastIcon />, duration: 4000 });
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
  const formatCurrency = (valueString: string): string => {
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
  };

  // Helper function to format token amount
  const formatTokenAmount = useCallback((amountString: string, tokenDecimals: number): string => {
    try {
      const amount = parseFloat(amountString);
      if (isNaN(amount) || amount === 0) return "0"; // Return "0" for invalid or zero input
      // Show significant digits based on token decimals, capping at 3 for these views
      return amount.toFixed(Math.min(tokenDecimals, 3)); // Changed from 6 to 3
    } catch (error) {
      console.error("Error formatting token amount:", error);
      return amountString;
    }
  }, []);

  // Effect to calculate toAmount
  useEffect(() => {
    const fromValue = parseFloat(fromAmount);
    if (!isNaN(fromValue) && fromValue > 0 && fromToken.usdPrice > 0 && toToken.usdPrice > 0) {
      const calculatedTo = (fromValue * fromToken.usdPrice) / toToken.usdPrice;
      setToAmount(calculatedTo.toFixed(toToken.decimals)); // Format to target token's decimals
    } else {
      setToAmount(""); // Clear toAmount if fromAmount is invalid or zero
    }
  }, [fromAmount, fromToken.usdPrice, toToken.usdPrice, toToken.decimals]);

  // Update calculatedValues for UI display
  useEffect(() => {
    const fromValueNum = parseFloat(fromAmount);
    const toValueNum = parseFloat(toAmount);

    const newFromTokenValue = (!isNaN(fromValueNum) && fromValueNum >= 0 && fromToken.usdPrice)
                              ? (fromValueNum * fromToken.usdPrice)
                              : 0;
                              
    const newToTokenValue = (!isNaN(toValueNum) && toValueNum >= 0 && toToken.usdPrice)
                            ? (toValueNum * toToken.usdPrice)
                            : 0;
    
    // For fee display - if fromAmount is 0, show 0 or placeholders, otherwise keep original structure but with 0 values.
    const showFeeDetails = fromValueNum > 0;

    setCalculatedValues(prev => ({
      ...prev,
      fromTokenAmount: formatTokenAmount(fromAmount, fromToken.decimals),
      fromTokenValue: formatCurrency(newFromTokenValue.toString()),
      toTokenAmount: formatTokenAmount(toAmount, toToken.decimals),
      toTokenValue: formatCurrency(newToTokenValue.toString()),
      // Show 0 for these if not calculating real swap, or hide them via conditional render later
      priceImpact: showFeeDetails ? prev.priceImpact : "0.00%", 
      minimumReceived: showFeeDetails ? formatTokenAmount(toAmount, toToken.decimals) : "0.00", // Or some other placeholder
      fees: showFeeDetails ? prev.fees.map(f => ({...f, value: "0.00%"})) : prev.fees.map(f => ({...f, value: "0.00%"})), // Placeholder fees
      slippage: showFeeDetails ? prev.slippage : "0%",
    }));

  }, [fromAmount, toAmount, fromToken, toToken, formatTokenAmount]);

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
    if (!isConnected || currentChainId !== TARGET_CHAIN_ID || !fromAmount || parseFloat(fromAmount) <= 0) {
      // Handle these initial errors appropriately (e.g., connect wallet button, switch network button, toast)
      console.log("[handleSwap] Pre-checks failed."); 
      return; 
    }

    console.log("[handleSwap] Initiating swap review.");
    setSwapState("review");
    // Reset shown flags when entering review state
    reviewNotificationsShown.current = { needs_approval: false, needs_signature: false, approval_complete: false, signature_complete: false };
    
    try {
      console.log("[handleSwap] Setting progress state: checking_allowance (ERC20)");
      setSwapProgressState("checking_allowance"); // Start check
      const parsedAmount = parseUnits(fromAmount, fromToken.decimals);
      const allowance = await publicClient.readContract({ address: fromToken.address, abi: Erc20AbiDefinition, functionName: 'allowance', args: [accountAddress as Address, PERMIT2_ADDRESS as Address] }) as bigint;
      
      if (allowance < parsedAmount) {
        console.log("[handleSwap] ERC20 insufficient. Setting progress state: needs_approval");
        setSwapProgressState("needs_approval"); // Let notification effect handle toast
      } else {
        console.log("[handleSwap] ERC20 sufficient. Setting progress state: approval_complete & triggering permit check.");
        setSwapProgressState("approval_complete"); // Set state first
        setCompletedSteps(prev => prev.includes("approval_complete") ? prev : [...prev, "approval_complete"]);
        setTriggerPermitCheck(true); // Trigger the separate useEffect to run checkPermit2Allowance
      }
    } catch (error) {
      console.error("Error checking ERC20 allowance:", error);
      console.log("[handleSwap] Error checking ERC20. Setting progress state: needs_approval");
      setSwapProgressState("needs_approval"); // Let notification effect handle toast
    }
    console.log("[handleSwap] Finished initial checks.");
  };

  const handleUsePercentage = (percentage: number) => {
    try {
      // Use the live fetched balance from the *current* fromToken state
      const balance = Number.parseFloat(fromToken.balance);
      if (isNaN(balance) || balance <= 0) return;
      const amount = balance * (percentage / 100);
      // Format to a reasonable number of decimals, respecting token's own decimals
      setFromAmount(amount.toFixed(Math.min(fromToken.decimals, 6))); 
      setSelectedPercentageIndex(cyclePercentages.indexOf(percentage));
    } catch (error) {
      console.error("Error parsing fromToken balance for percentage:", error);
    }
  };
  
  const handleUseFullBalance = (token: Token, isFrom: boolean) => {
    try {
      const balanceToUse = token.balance; // Use the already fetched and formatted balance string
      const numericBalance = Number.parseFloat(balanceToUse);
      if (isNaN(numericBalance) || numericBalance <= 0) return;

      if (isFrom) {
        setFromAmount(balanceToUse); // Set the full balance string
        setSelectedPercentageIndex(cyclePercentages.indexOf(100));
      } else {
        // This case might not be used if toToken input is always calculated
        console.warn("Setting 'toAmount' based on 'toToken' balance is not directly supported by this UI logic.");
      }
    } catch (error) {
      console.error(`Error parsing balance for ${token.symbol}:`, error);
    }
  };

  const handleConfirmSwap = async () => {
    try {
      // --- Keep API call here for FRESH data (nonce!) before acting --- 
      // setSwapProgressState("checking_allowance"); // Remove redundant state/toast
      // toast("Checking permit status..."); // Remove redundant toast
      
      const parsedAmount = parseUnits(fromAmount, fromToken.decimals);
      let signature: Hex | null = null; // Initialize signature
      let permitApiData: any = null; // To store API response

      const permitApiResponse = await fetch('/api/swap/prepare-permit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: accountAddress,
          tokenAddress: fromToken.address,
          chainId: currentChainId,
          checkExisting: true, // Always check existing when confirming
        }),
      });
      
      permitApiData = await permitApiResponse.json();
      if (!permitApiResponse.ok) {
        throw new Error(permitApiData.message || 'Failed to prepare permit data');
      }

      // --- Determine if signing is needed based on FRESH API data --- 
      const needsSignature = !permitApiData.hasValidPermit || BigInt(permitApiData.currentPermitInfo.amount) < MaxUint160;
      // We check against MaxUint160 because we always SIGN for unlimited. 
      // If the existing permit isn't unlimited (or expired), we need a new signature.

      // If we need approval (standard ERC20), handle that first
      if (swapProgressState === "needs_approval") {
        setSwapProgressState("approving");
        setIsSwapping(true);
        toast("Approving tokens for Permit2...");
        
        const approveTxHash = await sendApprovalTx({
          address: fromToken.address,
          abi: Erc20AbiDefinition,
          functionName: 'approve',
          args: [PERMIT2_ADDRESS, parseUnits("1000000", fromToken.decimals)],
        });
        
        if (!approveTxHash) {
          throw new Error("Failed to send approval transaction");
        }
        
        toast("Approval Submitted", {
          description: "Please wait for confirmation...",
        });
        
        setSwapProgressState("waiting_approval");
        
        const approvalReceipt = await publicClient.waitForTransactionReceipt({
          hash: approveTxHash as Hex,
        });
        
        if (!approvalReceipt || approvalReceipt.status !== 'success') {
          throw new Error("Approval transaction failed");
        }
        
        toast("Approval Confirmed");
        setCompletedSteps(prev => [...prev, "approval_complete"]);
        // AFTER approval, decide if signature is needed based on the check above
        if (needsSignature) {
           setSwapProgressState("needs_signature");
        } else {
           setSwapProgressState("signature_complete"); // Already approved and has valid permit
           setCompletedSteps(prev => prev.includes("signature_complete") ? prev : [...prev, "signature_complete"]);
        }
        setIsSwapping(false);
        return; // Wait for next user action (Sign or Confirm)
      }

      // If we determined a signature is needed (and approval is done)
      if (needsSignature && swapProgressState !== "approving" && swapProgressState !== "waiting_approval") { // Ensure approval step is finished
        setSwapProgressState("signing_permit");
        setIsSwapping(true);
        toast("Preparing permit signature...");
        
        // Use the permitApiData fetched earlier
        const messageToSign = {
          details: {
            token: getAddress(fromToken.address),
            amount: MaxUint160, // Use MaxUint160 for the signed amount
            expiration: permitApiData.permitExpiration, // Use the 1-day expiration from API
            nonce: permitApiData.nonce,
          },
          spender: getAddress(permitApiData.spender),
          sigDeadline: BigInt(permitApiData.sigDeadline),
        };
        
        signature = await signTypedDataAsync({
          domain: permitApiData.domain,
          types: permitApiData.types,
          primaryType: 'PermitSingle',
          message: messageToSign,
        });
        
        toast.success("Permit signature obtained!");
        setSwapProgressState("signature_complete");
        setCompletedSteps(prev => prev.includes("signature_complete") ? prev : [...prev, "signature_complete"]);
        // No need to save existingPermitData state anymore
        setIsSwapping(false); // Ready for final build/execute step
        // Fall through to build transaction logic
      }

      // --- Build Transaction Logic --- 
      if (swapProgressState === "signature_complete" || !needsSignature) {
         // Ensure we have permitApiData (should always have it from the top call)
         if (!permitApiData) {
            throw new Error("Missing permit data for building transaction.");
         }

         setSwapProgressState("building_tx");
         setIsSwapping(true);
         toast("Building swap transaction...");

         // Use existing permit data directly from API call results
         const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
         const fallbackSigDeadline = currentTimestamp + BigInt(30 * 60); // Example: 30 min fallback

         const bodyForBuildTx = {
           userAddress: accountAddress,
           fromTokenSymbol: fromToken.address === YUSD_ADDRESS ? 'YUSDC' : 'BTCRL',
           toTokenSymbol: toToken.address === YUSD_ADDRESS ? 'YUSDC' : 'BTCRL',
           swapType: 'ExactIn',
           amountDecimalsStr: fromAmount,
           limitAmountDecimalsStr: "0", 
           // Use obtained signature OR "0x" if reusing existing permit
           permitSignature: signature ? signature : "0x", 
           permitTokenAddress: fromToken.address,
           permitAmount: parsedAmount.toString(), // Actual swap amount
           permitNonce: permitApiData.nonce, // Use nonce from the fresh API call
           permitExpiration: permitApiData.permitExpiration, // Use expiration from the fresh API call
           permitSigDeadline: signature ? permitApiData.sigDeadline.toString() : fallbackSigDeadline.toString(), // Use real deadline if signing
           chainId: currentChainId,
         };
         
         const buildTxApiResponse = await fetch('/api/swap/build-tx', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify(bodyForBuildTx),
         });
         
         const buildTxApiData = await buildTxApiResponse.json();
         if (!buildTxApiResponse.ok) {
           // Throw error using the message & details from the backend response
           throw new Error(buildTxApiData.message || 'Failed to build transaction', { cause: buildTxApiData.errorDetails || 'Unknown build error' });
         }

         // --- Execute Transaction --- 
         window.swapBuildData = buildTxApiData; // Store build data
         setSwapProgressState("executing_swap");
         toast("Sending swap transaction...");

         const txHash = await sendSwapTx({
           address: getAddress(buildTxApiData.to),
           abi: UniversalRouterAbi,
           functionName: 'execute',
           args: [
             buildTxApiData.commands as Hex,
             buildTxApiData.inputs as Hex[],
             BigInt(buildTxApiData.deadline)
           ],
           value: BigInt(buildTxApiData.value),
         });
         
         if (!txHash) {
           throw new Error("Failed to send swap transaction");
         }
         
         setSwapTxInfo({
           hash: txHash as string,
           fromAmount,
           fromSymbol: fromToken.symbol,
           toAmount,
           toSymbol: toToken.symbol,
           explorerUrl: `https://unichain-sepolia.blockscout.com/tx/${txHash}`,
         });
         
         setSwapProgressState("waiting_confirmation");
         
         const receipt = await publicClient.waitForTransactionReceipt({
           hash: txHash as Hex,
         });
         
         if (!receipt || receipt.status !== 'success') {
           throw new Error("Swap transaction failed");
         }
         
         setIsSwapping(false);
         setSwapState("success");
         setCompletedSteps(prev => [...prev, "complete"]);
         
         toast("Swap Successful", {
           description: `Successfully swapped ${fromAmount} ${fromToken.symbol} for ${toAmount} ${toToken.symbol}`,
           icon: <SuccessToastIcon />,
           duration: 5000,
         });
         
         window.swapBuildData = undefined; // Clear build data on success
      }
    } catch (err: any) { // Use a different variable name like 'err'
      console.error("Swap execution failed:", err);
      setIsSwapping(false);
      setSwapProgressState("error");
      
      // Display more informative error from backend if available
      let displayError = "Unknown error occurred";
      if (err instanceof Error) {
          // Try to get a more specific message from the error or its cause
          const cause = err.cause as any; // Cast cause for easier access
          let causeMessage = '';
          if (cause) {
            causeMessage = cause.shortMessage || cause.message || (typeof cause === 'string' ? cause : '');
          }
          // Safely access shortMessage if it exists on the error object
          const shortMsg = (err as any).shortMessage;
          displayError = shortMsg || err.message; // Prefer shortMessage from main error
          if (causeMessage) {
              displayError += `: ${causeMessage}`; // Append cause message if found
          }
      } else if (typeof err === 'string') {
          displayError = err;
      }
      
      if (displayError && displayError.toLowerCase().includes("user rejected the request")) {
        toast("Transaction Rejected", {
          description: "The transaction request was rejected in your wallet.",
          icon: <WarningToastIcon />,
          duration: 5000,
        });
      } else {
        toast("Swap Failed", {
          description: displayError,
          icon: <WarningToastIcon />,
          duration: 5000,
        });
      }
      
      // Clear build data on error
      window.swapBuildData = undefined;
    }
  };

  // --- RENDER LOGIC --- 
  // Determine which token is YUSD and which is BTCRL for display purposes, regardless of from/to state
  const displayFromToken = fromToken; // This is what's in the 'Sell' slot
  const displayToToken = toToken;   // This is what's in the 'Buy' slot

  // isLoading for balances
  const isLoadingCurrentFromTokenBalance = fromToken.address === YUSD_ADDRESS ? isLoadingYUSDBalance : isLoadingBTCRLBalance;
  const isLoadingCurrentToTokenBalance = toToken.address === YUSD_ADDRESS ? isLoadingYUSDBalance : isLoadingBTCRLBalance;

  // Action button text logic
  let actionButtonText = "Connect Wallet";
  let actionButtonDisabled = false;

  if (!isMounted) {
    actionButtonText = "Loading...";
    actionButtonDisabled = true;
  } else if (isConnected) {
    if (currentChainId !== TARGET_CHAIN_ID) {
      actionButtonText = isAttemptingSwitch ? "Switching..." : `Switch to Unichain Sepolia`; 
      actionButtonDisabled = isAttemptingSwitch;
    } else if (isLoadingCurrentFromTokenBalance || isLoadingCurrentToTokenBalance) {
      actionButtonText = "Loading Balances...";
      actionButtonDisabled = true;
    } else {
      actionButtonText = "Swap";
      actionButtonDisabled = parseFloat(fromAmount || "0") <= 0; 
    }
  } else {
    // Wallet not connected, button should show "Connect Wallet"
    // The actual connection is handled by <appkit-button>
    actionButtonText = "Connect Wallet"; 
    actionButtonDisabled = false; // <appkit-button> handles its own state
  }
  
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

  const handleCyclePercentage = () => {
    let nextIndex = selectedPercentageIndex + 1;
    if (nextIndex >= cyclePercentages.length) nextIndex = -1;
    setSelectedPercentageIndex(nextIndex);
    if (nextIndex !== -1) handleUsePercentage(cyclePercentages[nextIndex]);
    else setFromAmount("0"); // If cycling back to no percentage, reset amount
  };

  const currentPercentage = selectedPercentageIndex === -1 ? 0 : cyclePercentages[selectedPercentageIndex];

  return (
    <Card className="mx-auto max-w-md">
      {/* <CardHeader className="pt-6 pb-2">
          <CardTitle className="text-center">Swap Tokens</CardTitle>
      </CardHeader> */}
      <CardContent className="p-6 pt-6">
        <AnimatePresence mode="wait">
          {swapState === "input" && (
            <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.2 }}>
              {/* Sell Section - Uses `displayFromToken` */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium">Sell</Label>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" onClick={() => handleUseFullBalance(displayFromToken, true)} disabled={!isConnected}>
                       Balance: { (isConnected ? (isLoadingCurrentFromTokenBalance ? "Loading..." : displayFromToken.balance) : "~")} {displayFromToken.symbol}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-5 w-5 rounded-full hover:bg-muted/40" onClick={handleCyclePercentage} disabled={!isConnected}>
                      <OutlineArcIcon percentage={currentPercentage} className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className={cn("rounded-lg bg-muted/30 p-4 hover:outline hover:outline-1 hover:outline-muted", { "outline outline-1 outline-muted": isSellInputFocused })}>
                  <div className="flex items-center gap-2">
                    {/* Token Display for FromToken - Non-interactive, shows current fromToken */}
                    <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                      <div className="flex items-center justify-center h-5 w-5 rounded-full bg-zinc-700">
                        <Image src={displayFromToken.icon} alt={displayFromToken.symbol} width={10} height={10} className="rounded-full"/> 
                      </div>
                      <span className="text-sm">{displayFromToken.symbol}</span>
                       {/* No ChevronDownIcon, as it's not a dropdown for selection now */}
                    </div>
                    <div className="flex-1">
                      {/* Sell input is now enabled if wallet is connected */}
                      <Input value={fromAmount} onChange={handleFromAmountChange} onFocus={() => setIsSellInputFocused(true)} onBlur={() => setIsSellInputFocused(false)} className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto" placeholder="0" disabled={!isConnected || isAttemptingSwitch} />
                      <div className="text-right text-xs text-muted-foreground">{formatCurrency((parseFloat(fromAmount || "0") * displayFromToken.usdPrice).toString())}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center">
                <Button variant="ghost" size="icon" className="rounded-full bg-muted/30 z-10 h-8 w-8" onClick={handleSwapTokens} disabled={!isConnected || isAttemptingSwitch}>
                  <ArrowDownIcon className="h-4 w-4" />
                  <span className="sr-only">Swap tokens</span>
                </Button>
              </div>

              {/* Buy Section - Uses `displayToToken` */}
              <div className="mb-6 mt-2">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium">Buy</Label>
                  {/* Balance display for toToken - added for consistency */}
                   <span className={cn("text-xs text-muted-foreground", { "opacity-50": !isConnected })}>
                      Balance: { (isConnected ? (isLoadingCurrentToTokenBalance ? "Loading..." : displayToToken.balance) : "~")} {displayToToken.symbol}
                    </span>
                </div>
                <div className="rounded-lg bg-muted/30 p-4">
                  <div className="flex items-center gap-2">
                     {/* Token Display for ToToken - Non-interactive */}
                    <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                      <div className="flex items-center justify-center h-5 w-5 rounded-full bg-zinc-700">
                         <Image src={displayToToken.icon} alt={displayToToken.symbol} width={10} height={10} className="rounded-full"/>
                      </div>
                      <span className="text-sm">{displayToToken.symbol}</span>
                    </div>
                    <div className="flex-1">
                      <Input
                        value={parseFloat(toAmount || "0") === 0 ? "0" : formatTokenAmount(toAmount, displayToToken.decimals)} // Show "0" if empty/zero
                        readOnly
                        disabled={!isConnected || isAttemptingSwitch}
                        className="border-0 bg-transparent text-right text-xl md:text-xl font-medium text-muted-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                        placeholder="0"
                      />
                      <div className="text-right text-xs text-muted-foreground">
                        {formatCurrency((parseFloat(toAmount || "0") * displayToToken.usdPrice).toString())}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Fee Information - Conditionally Rendered or shows placeholders */}
              {(parseFloat(fromAmount || "0") > 0 || calculatedValues.priceImpact !== "0.00%") && (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Fees</span>
                    <span>{calculatedValues.fees.reduce((sum, fee) => sum + parseFloat(fee.value.replace('%','')),0).toFixed(2)}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Price Impact</span>
                    <span>{calculatedValues.priceImpact}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Minimum Received</span>
                    <span>{calculatedValues.minimumReceived} {displayToToken.symbol}</span>
                  </div>
                </div>
              )}

              <div className="mt-6 h-10">
                {!isMounted ? null : isConnected ? (
                  <Button 
                    className="w-full 
                               bg-slate-900 text-slate-50 hover:bg-slate-900/90 
                               dark:bg-white dark:text-black dark:hover:bg-white/90
                               disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100
                               dark:disabled:bg-neutral-700 dark:disabled:text-neutral-500 dark:disabled:opacity-100"
                    onClick={handleSwap} 
                    disabled={actionButtonDisabled}
                  >
                    {actionButtonText}
                  </Button>
                ) : (
                  <div className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                    <appkit-button className="absolute inset-0 z-10 block h-full w-full cursor-pointer p-0 opacity-0" />
                    <span className="relative z-0 pointer-events-none">{actionButtonText}</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Swapping State UI (largely preserved, uses calculatedValues) */}
          {swapState === "review" && (
            <motion.div key="review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <div className="mb-6 flex items-center justify-between bg-muted/10 rounded-lg p-4 hover:bg-muted/20 transition-colors">
                <Button variant="ghost" className="flex items-center gap-3 p-0 h-auto hover:bg-transparent" onClick={handleChangeButton}>
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-zinc-700">
                    <Image src={displayFromToken.icon} alt={displayFromToken.symbol} width={20} height={20} className="rounded-full"/>
                  </div>
                  <div className="text-left">
                    <div className="font-medium">{calculatedValues.fromTokenAmount} {displayFromToken.symbol}</div>
                    <div className="text-xs text-muted-foreground">{calculatedValues.fromTokenValue}</div>
                  </div>
                </Button>
                <ArrowRightIcon className="h-5 w-5 text-muted-foreground mx-2" />
                <Button variant="ghost" className="flex items-center gap-3 p-0 h-auto hover:bg-transparent" onClick={handleChangeButton}>
                  <div className="text-right">
                    <div className="font-medium">{calculatedValues.toTokenAmount} {displayToToken.symbol}</div>
                    <div className="text-xs text-muted-foreground">{calculatedValues.toTokenValue}</div>
                  </div>
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-zinc-700">
                    <Image src={displayToToken.icon} alt={displayToToken.symbol} width={20} height={20} className="rounded-full"/>
                  </div>
                </Button>
              </div>
              <div className="rounded-lg border border-slate-300 dark:border-zinc-800 p-4 mb-6 space-y-3 text-sm">
                {renderStepIndicator("approval", swapProgressState, completedSteps)}
                {renderStepIndicator("signature", swapProgressState, completedSteps)}
                {renderStepIndicator("transaction", swapProgressState, completedSteps)}
              </div>
              <div className="my-8 flex flex-col items-center justify-center">
                <motion.div 
                  className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 dark:bg-white"
                  initial={{ scale: 0.8 }} 
                  animate={{ scale: 1 }} 
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                >
                  {getStepIcon()}
                </motion.div>
                <div className="text-center">
                  <h3 className="text-lg font-medium">
                    {isSwapping ? (
                      swapProgressState === "approving" || swapProgressState === "waiting_approval" ? "Approving" :
                      swapProgressState === "signing_permit" ? "Signing" :
                      swapProgressState === "executing_swap" || swapProgressState === "waiting_confirmation" ? "Swapping" :
                      "Processing"
                    ) : (
                      "Confirm Swap"
                    )}
                  </h3>
                  <p className="text-muted-foreground mt-1">{displayFromToken.symbol} for {displayToToken.symbol}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button 
                  variant="outline" 
                  className="border-slate-300 bg-slate-100 hover:bg-slate-200 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 disabled:opacity-50"
                  onClick={handleChangeButton} 
                  disabled={isSwapping}
                >
                  Change
                </Button>
                <Button 
                  className="bg-slate-900 text-slate-50 hover:bg-slate-900/80 
                             dark:bg-white dark:text-black dark:hover:bg-white/90 
                             disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100
                             dark:disabled:bg-neutral-700 dark:disabled:text-neutral-500 dark:disabled:opacity-100"
                  onClick={handleConfirmSwap} 
                  disabled={isSwapping}
                >
                  {isSwapping ? (
                    <span className="flex items-center gap-2">
                      <RefreshCwIcon className="h-4 w-4 animate-spin" />
                      {swapProgressState === "approving" || swapProgressState === "waiting_approval" ? "Approving..." :
                       swapProgressState === "signing_permit" ? "Signing..." :
                       swapProgressState === "executing_swap" || swapProgressState === "waiting_confirmation" ? "Swapping..." :
                       "Processing..."}
                    </span>
                  ) : (
                    swapProgressState === "needs_approval" ? "Approve" :
                    swapProgressState === "approval_complete" || swapProgressState === "needs_signature" ? "Sign" :
                    "Confirm Swap"
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {/* Success State UI (largely preserved, uses calculatedValues) */}
          {swapState === "success" && (
            <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
               <div className="mb-6 flex items-center justify-between bg-muted/10 rounded-lg p-4 hover:bg-muted/20 transition-colors">
                <Button variant="ghost" className="flex items-center gap-3 p-0 h-auto hover:bg-transparent" onClick={handleChangeButton}>
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-zinc-700">
                    <Image src={displayFromToken.icon} alt={displayFromToken.symbol} width={20} height={20} className="rounded-full"/>
                  </div>
                  <div className="text-left">
                    <div className="font-medium">{swapTxInfo?.fromAmount || calculatedValues.fromTokenAmount} {swapTxInfo?.fromSymbol || displayFromToken.symbol}</div>
                    <div className="text-xs text-muted-foreground">{calculatedValues.fromTokenValue}</div>
                  </div>
                </Button>
                <ArrowRightIcon className="h-5 w-5 text-muted-foreground mx-2" />
                <Button variant="ghost" className="flex items-center gap-3 p-0 h-auto hover:bg-transparent" onClick={handleChangeButton}> 
                  <div className="text-right">
                    <div className="font-medium">{swapTxInfo?.toAmount || calculatedValues.toTokenAmount} {swapTxInfo?.toSymbol || displayToToken.symbol}</div>
                    <div className="text-xs text-muted-foreground">{calculatedValues.toTokenValue}</div>
                  </div>
                  <div className="flex items-center justify-center h-10 w-10 rounded-full bg-zinc-700">
                    <Image src={displayToToken.icon} alt={displayToToken.symbol} width={20} height={20} className="rounded-full"/>
                  </div>
                </Button>
              </div>
              <div className="my-8 flex flex-col items-center justify-center">
                <motion.div 
                  className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 dark:bg-white"
                  initial={{ scale: 0.8 }} 
                  animate={{ scale: 1 }} 
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                >
                  <CheckIcon className="h-8 w-8 text-slate-50 dark:text-black" />
                </motion.div>
                <div className="text-center">
                   {/* Text color here should adapt by default (e.g. text-foreground) */}
                  <h3 className="text-lg font-medium">Swapped</h3>
                  <p className="text-muted-foreground mt-1">{swapTxInfo?.fromSymbol || displayFromToken.symbol} for {swapTxInfo?.toSymbol || displayToToken.symbol}</p>
                </div>
              </div>
              <div className="mb-6 flex items-center justify-center">
                <Button 
                  variant="link" 
                  className="text-primary dark:text-white hover:text-primary/80 dark:hover:text-white/80" 
                  onClick={() => window.open(swapTxInfo?.explorerUrl || `https://unichain-sepolia.blockscout.com/`, "_blank")}
                >
                  View on Explorer
                  <ExternalLinkIcon className="h-3 w-3 ml-1" />
                </Button>
              </div>
              <Button 
                className="w-full bg-slate-900 text-slate-50 hover:bg-slate-900/80 
                           dark:bg-white dark:text-black dark:hover:bg-white/90"
                onClick={handleChangeButton}
              >
                Swap again
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  )
}

// OutlineArcIcon (original, unchanged)
interface OutlineArcIconProps { percentage: number; size?: number; className?: string; }
function OutlineArcIcon({ percentage, size = 16, className }: OutlineArcIconProps) {
  const r = 6; const cx = 8; const cy = 8; const strokeWidth = 2;
  const clampedPercentage = Math.max(0, Math.min(100, percentage));
  let pathData = "";
  if (clampedPercentage > 0 && clampedPercentage < 100) {
    const angleStart = -Math.PI / 2;
    const angleEnd = angleStart + (clampedPercentage / 100) * (2 * Math.PI);
    const startX = cx + r * Math.cos(angleStart); const startY = cy + r * Math.sin(angleStart);
    const endX = cx + r * Math.cos(angleEnd); const endY = cy + r * Math.sin(angleEnd);
    const largeArcFlag = clampedPercentage >= 50 ? 1 : 0;
    pathData = `M ${cx},${cy} L ${startX},${startY} A ${r},${r} 0 ${largeArcFlag} 1 ${endX},${endY} Z`;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {clampedPercentage === 0 && (
        <path d={`M ${cx},${cy - r} L ${cx},${cy + r} M ${cx},${cy - r} A ${r},${r} 0 0 0 ${cx},${cy + r} M ${cx},${cy - r} A ${r},${r} 0 0 1 ${cx},${cy + r}`} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" className="opacity-30" />
      )}
      {clampedPercentage === 100 && (
        <path d={`M ${cx},${cy - r} L ${cx},${cy + r} M ${cx},${cy - r} A ${r},${r} 0 0 0 ${cx},${cy + r} M ${cx},${cy - r} A ${r},${r} 0 0 1 ${cx},${cy + r}`} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" className="opacity-100" />
      )}
      {pathData && (
        <path d={pathData} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" className="opacity-100" />
      )}
    </svg>
  );
}

// Ensure this global definition exists for appkit-button
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'appkit-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
  interface Window {
      swapBuildData?: any; 
  }
}

