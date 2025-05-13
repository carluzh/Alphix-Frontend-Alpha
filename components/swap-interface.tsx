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

// --- Moved Global Declarations to Top ---
// declare global {
//   namespace JSX {
//     interface IntrinsicElements {
//       'appkit-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
//     }
//   }
//   interface Window {
//       swapBuildData?: any; 
//   }
// }
// --- End Global Declarations ---

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
type SwapProgressState = "init" | "checking_allowance" | "needs_approval" | "approving" | "waiting_approval" | "approval_complete" | "needs_signature" | "signing_permit" | "signature_complete" | "building_tx" | "executing_swap" | "waiting_confirmation" | "complete" | "error" | "ready_to_swap";

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

  const [currentPermitDetailsForSign, setCurrentPermitDetailsForSign] = useState<any | null>(null);
  const [obtainedSignature, setObtainedSignature] = useState<Hex | null>(null);

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
    const fromAmountNum = parseFloat(fromAmount || "0");
    const fromBalanceNum = parseFloat(fromToken.balance || "0"); // Use state balance

    // 1. Pre-checks (connected, network, amount > 0, sufficient balance)
    const insufficientBalance = isNaN(fromBalanceNum) || fromBalanceNum < fromAmountNum;
    if (!isConnected || currentChainId !== TARGET_CHAIN_ID || fromAmountNum <= 0 || insufficientBalance) {
      console.log("[handleSwap] Pre-checks failed.", { isConnected, currentChainId, fromAmountNum, fromBalanceNum, insufficientBalance });
      if (insufficientBalance && fromAmountNum > 0) {
         toast("Insufficient Balance", {
            description: `You don't have enough ${fromToken.symbol} to perform this swap.`,
            icon: <WarningToastIcon />,
            duration: 4000,
         });
      }
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
        duration: 2500 
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
        toast("Permission Active", {
          duration: 2500 
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

            toast("Approval Confirmed", { duration: 2500 });
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
              toast.error("Error preparing signature. Please try again.");
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

            toast.success("Permit signature obtained!");
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
                 toast.error("Critical error in swap preparation. Please start over.");
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

            const effectiveTimestamp = BigInt(Math.floor(Date.now() / 1000));
            const effectiveFallbackSigDeadline = effectiveTimestamp + BigInt(30 * 60); // 30 min fallback

            const bodyForSwapTx = {
                 userAddress: accountAddress,
                 fromTokenSymbol: fromToken.symbol === 'YUSD' ? 'YUSDC' : 'BTCRL', 
                 toTokenSymbol: toToken.symbol === 'YUSD' ? 'YUSDC' : 'BTCRL',
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
                 explorerUrl: `https://unichain-sepolia.blockscout.com/tx/${txHash}`,
            });
            setSwapProgressState("waiting_confirmation");
            toast("Swap submitted", { description: "Waiting for confirmation..." });

            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex });
            if (!receipt || receipt.status !== 'success') throw new Error("Swap transaction failed on-chain");

            setIsSwapping(false); 
            setSwapState("success");
            setCompletedSteps(prev => [...prev, "complete"]);
            toast("Swap Successful", {
                 description: `Swapped ${fromAmount} ${fromToken.symbol} for ${toAmount} ${toToken.symbol}`,
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
                    disabled={actionButtonDisabled || 
                               (
                                 parseFloat(fromAmount || "0") > 0 && // Only check balance if amount is entered
                                 (
                                   isNaN(parseFloat(fromToken.balance || "0")) || // Balance is not a number (e.g. "Loading...", "Error", "~")
                                   parseFloat(fromToken.balance || "0") < parseFloat(fromAmount || "0") // Insufficient balance
                                 )
                                )
                              }
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
                  disabled={isSwapping || swapProgressState === "init" || swapProgressState === "checking_allowance"}
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
                    // Updated text logic to handle ready_to_swap explicitly
                    swapProgressState === "needs_approval" ? "Approve" :
                    swapProgressState === "needs_signature" ? "Sign" :
                    swapProgressState === "ready_to_swap" ? "Confirm Swap" :
                    "Confirm Swap" // Default/Fallback (e.g., for approval_complete before Sign is determined)
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

