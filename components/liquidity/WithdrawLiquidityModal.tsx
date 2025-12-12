"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { useChainMismatch } from "@/hooks/useChainMismatch";
import { formatUnits } from "viem";
import Image from "next/image";
import { motion, useAnimation, AnimatePresence } from "framer-motion";
import { PlusIcon, RefreshCwIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, SearchIcon, XIcon, OctagonX, ActivityIcon, MinusIcon, CircleCheck, Info as InfoIcon } from "lucide-react";
import { readContract, getBalance } from '@wagmi/core';
import { erc20Abi } from 'viem';
import { config, getExplorerTxUrl, getExplorerUrl } from '@/lib/wagmiConfig';
import { parseUnits as viemParseUnits } from "viem";

import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import type { DecreasePositionData } from "./useDecreaseLiquidity";
import { getTokenDefinitions, type TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { useDecreaseLiquidity } from "./useDecreaseLiquidity";
import { formatTokenDisplayAmount, getTokenIcon, sanitizeDecimalInput, debounce, getTokenSymbolByAddress, formatUncollectedFee, cn } from "@/lib/utils";
import { useAllPrices } from "@/components/data/hooks";
import { formatUSD } from "@/lib/format";
import { calculatePercentageFromString } from "@/hooks/usePercentageInput";


interface WithdrawLiquidityModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  position: ProcessedPosition | null;
  feesForWithdraw?: { amount0: string; amount1: string; } | null;
  onLiquidityWithdrawn?: () => void;
  // Optional: pass parent's hook to connect to existing refetching flow
  decreaseLiquidity?: (data: DecreasePositionData, percentage: number) => void;
  isWorking?: boolean;
  isDecreaseSuccess?: boolean;
  decreaseTxHash?: `0x${string}`;
}

// Reusable fee display component with error boundary
const FeeDisplay = ({ feeAmount, tokenSymbol }: { feeAmount: string; tokenSymbol: TokenSymbol }) => {
  try {
    const formattedFee = formatUncollectedFee(feeAmount, tokenSymbol);
    
    if (!formattedFee) return null;
    
    return (
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="text-right text-xs text-muted-foreground">{`+ ${formattedFee}`}</div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="bg-popover border border-border text-popover-foreground">
            <p className="text-xs">Uncollected fees</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  } catch (error) {
    console.error("Error displaying fee:", error);
    return null;
  }
};

export function WithdrawLiquidityModal({
  isOpen,
  onOpenChange,
  position,
  feesForWithdraw,
  onLiquidityWithdrawn,
  decreaseLiquidity: parentDecreaseLiquidity,
  isWorking: parentIsWorking,
  isDecreaseSuccess: parentIsDecreaseSuccess,
  decreaseTxHash: parentDecreaseTxHash
}: WithdrawLiquidityModalProps) {
  const { address: accountAddress } = useAccount();
  const { chainId, networkMode } = useNetwork();
  // Always use network context chainId for queries (not wallet chainId)
  const { isMismatched: isChainMismatched } = useChainMismatch();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const { data: allPrices } = useAllPrices();


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

  // Map any token symbol to a USD price
  const getUSDPriceForSymbol = useCallback((symbol?: string): number => {
    if (!symbol) return 0;
    const s = symbol.toUpperCase();
    if (s.includes('BTC')) return allPrices?.BTC?.usd ?? 0;
    if (s.includes('ETH')) return allPrices?.ETH?.usd ?? 0;
    if (s.includes('USDC')) return allPrices?.USDC?.usd ?? 1;
    if (s.includes('USDT')) return allPrices?.USDT?.usd ?? 1;
    return 0;
  }, [allPrices]);

  // Format calculated amounts with max 9 decimals and ellipsis for overflow
  const formatCalculatedAmount = useCallback((value: number): React.ReactNode => {
    if (!Number.isFinite(value) || value <= 0) return formatUSD(0);
    
    const formatted = formatUSD(value);
    
    // Extract the numeric part and check decimal places
    const match = formatted.match(/\$([0-9,]+\.?[0-9]*)/);
    if (!match) return formatted;
    
    const [, numericPart] = match;
    const [integerPart, decimalPart] = numericPart.split('.');
    
    if (!decimalPart || decimalPart.length <= 9) {
      return formatted;
    }
    
    // Truncate to 9 decimals and add ellipsis
    const truncatedDecimal = decimalPart.substring(0, 9);
    const truncatedFormatted = `$${integerPart}.${truncatedDecimal}`;
    
    return (
      <span>
        {truncatedFormatted}
        <span className="text-muted-foreground">...</span>
      </span>
    );
  }, []);

  // Format calculated input values (non-USD) with max 9 decimals and ellipsis
  const formatCalculatedInput = useCallback((value: string): string => {
    if (!value) return value;
    
    const [integerPart, decimalPart] = value.split('.');
    
    if (!decimalPart || decimalPart.length <= 9) {
      return value;
    }
    
    // Truncate to 9 decimals (no ellipsis for input fields)
    return `${integerPart}.${decimalPart.substring(0, 9)}`;
  }, []);


  // State for withdraw amounts and controls
  const [withdrawAmount0, setWithdrawAmount0] = useState<string>("");
  const [withdrawAmount1, setWithdrawAmount1] = useState<string>("");
  const [withdrawActiveInputSide, setWithdrawActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isWithdrawCalculating, setIsWithdrawCalculating] = useState(false);
  const [isFullWithdraw, setIsFullWithdraw] = useState(false);
  
  // State for multi-step flow
  const [showYouWillReceive, setShowYouWillReceive] = useState(false);
  const [showTransactionOverview, setShowTransactionOverview] = useState(false);
  const [showSuccessView, setShowSuccessView] = useState(false);
  const [txStarted, setTxStarted] = useState(false);
  const [wasDecreasingLiquidity, setWasDecreasingLiquidity] = useState(false);
  
  // State for tracking allowances - removed since withdraw doesn't need approval steps
  
  // Track the transaction hash when we actually start the transaction in this session
  const [currentSessionTxHash, setCurrentSessionTxHash] = useState<string | null>(null);
  
  // Animation states for balance wiggle
  const [balanceWiggleCount0, setBalanceWiggleCount0] = useState(0);
  const [balanceWiggleCount1, setBalanceWiggleCount1] = useState(0);
  const wiggleControls0 = useAnimation();
  const wiggleControls1 = useAnimation();


  // Calculate which side is productive for out-of-range positions
  let withdrawProductiveSide: null | 'amount0' | 'amount1' = null;
  try {
    if (position && !position.isInRange) {
      // Prefer actual balances to determine productive side when out of range
      const amt0 = Number.parseFloat(position.token0?.amount || '0');
      const amt1 = Number.parseFloat(position.token1?.amount || '0');
      if (amt0 > 0 && (!Number.isFinite(amt1) || amt1 <= 0)) withdrawProductiveSide = 'amount0';
      else if (amt1 > 0 && (!Number.isFinite(amt0) || amt0 <= 0)) withdrawProductiveSide = 'amount1';
      // If both sides have amounts, return null to show both
    }
  } catch (error) {
    console.error("Error calculating productive side:", error);
  }

  // Versioning for calculation debounce
  const withdrawCalcVersionRef = useRef(0);

  // Internal hook for fallback when no parent hook provided
  const shouldUseInternalHook = !parentDecreaseLiquidity;
  
  const internalHookResult = useDecreaseLiquidity({
    onLiquidityDecreased: () => {
      // Don't set success view here - let the useEffect handle it based on confirmed state
      // This prevents premature success view before transaction confirmation
    }
  });

  // Use parent's function if provided, otherwise use internal
  const decreaseLiquidity = shouldUseInternalHook ? internalHookResult.decreaseLiquidity : parentDecreaseLiquidity!;
  const isWorking = shouldUseInternalHook ? internalHookResult.isLoading : parentIsWorking ?? false;
  const txHash = shouldUseInternalHook ? internalHookResult.hash : parentDecreaseTxHash;
  const isTransactionSuccess = shouldUseInternalHook ? internalHookResult.isSuccess : parentIsDecreaseSuccess ?? false;

  // Wiggle animation effect
  useEffect(() => {
    if (balanceWiggleCount0 > 0) {
      wiggleControls0.start({
        x: [0, -3, 3, -2, 2, 0],
        transition: { duration: 0.22, ease: 'easeOut' },
      }).catch(() => {});
    }
  }, [balanceWiggleCount0, wiggleControls0]);

  useEffect(() => {
    if (balanceWiggleCount1 > 0) {
      wiggleControls1.start({
        x: [0, -3, 3, -2, 2, 0],
        transition: { duration: 0.22, ease: 'easeOut' },
      }).catch(() => {});
    }
  }, [balanceWiggleCount1, wiggleControls1]);


  // Reset transaction state when modal opens
  useEffect(() => {
    if (isOpen) {
      setTxStarted(false);
      setWasDecreasingLiquidity(false);
      setCurrentSessionTxHash(null);
      // Hard reset user inputs and step flags to avoid carrying over prior session state
      setShowYouWillReceive(false);
      setShowTransactionOverview(false);
      setShowSuccessView(false);
      // Reset withdrawal amounts to prevent showing old data
      setWithdrawAmount0("");
      setWithdrawAmount1("");
      setWithdrawActiveInputSide(null);
      setIsFullWithdraw(false);
      
      // Force reset of parent transaction states if using parent hook
      if (!shouldUseInternalHook) {
        // The parent should reset its transaction states when modal opens
        // This will be handled by the parent component
      }
    }
  }, [isOpen, shouldUseInternalHook]);

  // Reset all modal state when modal is closed
  useEffect(() => {
    if (!isOpen) {
      // Reset all step flags
      setShowYouWillReceive(false);
      setShowTransactionOverview(false);
      setShowSuccessView(false);
      
      // Reset all input amounts and states
      setWithdrawAmount0("");
      setWithdrawAmount1("");
      setWithdrawActiveInputSide(null);
      setIsFullWithdraw(false);
      
      // Reset animation states
      setBalanceWiggleCount0(0);
      setBalanceWiggleCount1(0);
      
      // Reset transaction tracking
      setTxStarted(false);
      setWasDecreasingLiquidity(false);
      setCurrentSessionTxHash(null);
    }
  }, [isOpen]);

  // Track when liquidity decrease starts
  useEffect(() => {
    if (isWorking) {
      setWasDecreasingLiquidity(true);
    }
  }, [isWorking]);

  // Track when transaction hash becomes available in the current session
  useEffect(() => {
    if (txHash && txStarted && !currentSessionTxHash) {
      setCurrentSessionTxHash(txHash);
    }
  }, [txHash, txStarted, currentSessionTxHash]);

  // Show success view ONLY when transaction is confirmed with hash AND was started in current session
  useEffect(() => {
    // Only run this effect if we actually have transaction data
    if (!txHash && !isTransactionSuccess) {
      return; // Exit early if no transaction data
    }

    // Only show success if we have a confirmed transaction hash that matches our current session
    if (txHash && isTransactionSuccess && showTransactionOverview && txStarted && currentSessionTxHash === txHash) {
      setShowSuccessView(true);
      
      // Call the success callback to notify parent component (but don't let it close the modal)
      // The parent should handle data refresh but not close the modal
      if (onLiquidityWithdrawn) {
        onLiquidityWithdrawn();
      }
    }
  }, [txHash, isTransactionSuccess, showTransactionOverview, txStarted, currentSessionTxHash, onLiquidityWithdrawn]);


  // Allowance checking removed - withdraw operations don't require approval steps

  // Calculate withdraw amounts based on percentage
  const calculateWithdrawAmount = useCallback(
    debounce(async (inputAmount: string, inputSide: 'amount0' | 'amount1') => {
      const version = ++withdrawCalcVersionRef.current;
      
      if (!position || !inputAmount || parseFloat(inputAmount) <= 0) {
        if (inputSide === 'amount0') setWithdrawAmount1("");
        else setWithdrawAmount0("");
        return;
      }

      setIsWithdrawCalculating(true);
      
      try {
        // For out-of-range positions, use single-token approach
        if (!position.isInRange) {
          if (inputSide === 'amount0') {
            setWithdrawAmount1("0");
          } else {
            setWithdrawAmount0("0");
          }
          setIsWithdrawCalculating(false);
          return;
        }

        // For in-range positions, use proper liquidity calculation API
        const token0Symbol = getTokenSymbolByAddress(position.token0.address, networkMode);
        const token1Symbol = getTokenSymbolByAddress(position.token1.address, networkMode);
        
        if (!token0Symbol || !token1Symbol) {
          // Fallback to simple ratio if token mapping fails
          const amount0Total = parseFloat(position.token0.amount);
          const amount1Total = parseFloat(position.token1.amount);
          const inputAmountNum = parseFloat(inputAmount);

          if (inputSide === 'amount0') {
            const ratio = inputAmountNum / amount0Total;
            const calculatedAmount1 = amount1Total * ratio;
            if (version === withdrawCalcVersionRef.current) {
              setWithdrawAmount1(calculatedAmount1.toString());
            }
          } else {
            const ratio = inputAmountNum / amount1Total;
            const calculatedAmount0 = amount0Total * ratio;
            if (version === withdrawCalcVersionRef.current) {
              setWithdrawAmount0(calculatedAmount0.toString());
            }
          }
          return;
        }

        const { calculateLiquidityParameters } = await import('@/lib/liquidity-math');
        const result = await calculateLiquidityParameters({
          token0Symbol,
          token1Symbol,
          inputAmount,
          inputTokenSymbol: inputSide === 'amount0' ? token0Symbol : token1Symbol,
          userTickLower: position.tickLower,
          userTickUpper: position.tickUpper,
          chainId,
        });
        
        if (version === withdrawCalcVersionRef.current) {
          if (inputSide === 'amount0') {
            // Convert from raw units to display units for token1 - keep full precision
            const token1Symbol = getTokenSymbolByAddress(position.token1.address, networkMode);
            const token1Decimals = token1Symbol ? tokenDefinitions[token1Symbol]?.decimals || 18 : 18;
            const amount1Display = formatUnits(BigInt(result.amount1 || '0'), token1Decimals);
            setWithdrawAmount1(formatCalculatedInput(amount1Display));
          } else {
            // Convert from raw units to display units for token0 - keep full precision
            const token0Symbol = getTokenSymbolByAddress(position.token0.address, networkMode);
            const token0Decimals = token0Symbol ? tokenDefinitions[token0Symbol]?.decimals || 18 : 18;
            const amount0Display = formatUnits(BigInt(result.amount0 || '0'), token0Decimals);
            setWithdrawAmount0(formatCalculatedInput(amount0Display));
          }
        }
      } catch (error) {
        console.error("Error calculating withdraw amount:", error);
        
        // Fallback to simple ratio calculation on API error
        try {
          const amount0Total = parseFloat(position.token0.amount);
          const amount1Total = parseFloat(position.token1.amount);
          const inputAmountNum = parseFloat(inputAmount);

          if (version === withdrawCalcVersionRef.current) {
            if (inputSide === 'amount0') {
              const ratio = inputAmountNum / amount0Total;
              const calculatedAmount1 = amount1Total * ratio;
              setWithdrawAmount1(calculatedAmount1.toString());
            } else {
              const ratio = inputAmountNum / amount1Total;
              const calculatedAmount0 = amount0Total * ratio;
              setWithdrawAmount0(calculatedAmount0.toString());
            }
          }
        } catch (fallbackError) {
          console.error("Fallback calculation also failed:", fallbackError);
        }
      } finally {
        if (version === withdrawCalcVersionRef.current) {
          setIsWithdrawCalculating(false);
        }
      }
    }, 300),
    [position]
  );


  // Handle amount input change with wiggle animation (no capping)
  const handleWithdrawAmountChangeWithWiggle = useCallback((e: React.ChangeEvent<HTMLInputElement>, tokenSide: 'amount0' | 'amount1') => {
    const newAmount = sanitizeDecimalInput(e.target.value);

    if (!position) return;

    const maxAmount = tokenSide === 'amount0'
      ? parseFloat(position.token0.amount)
      : parseFloat(position.token1.amount);

    const inputAmount = parseFloat(newAmount || "0");
    const prevAmount = tokenSide === 'amount0'
      ? parseFloat(withdrawAmount0 || "0")
      : parseFloat(withdrawAmount1 || "0");

    // Check if going over balance to trigger wiggle
    const wasOver = Number.isFinite(prevAmount) && Number.isFinite(maxAmount) ? prevAmount > maxAmount : false;
    const isOver = Number.isFinite(inputAmount) && Number.isFinite(maxAmount) ? inputAmount > maxAmount : false;

    if (isOver && !wasOver) {
      if (tokenSide === 'amount0') {
        setBalanceWiggleCount0(c => c + 1);
      } else {
        setBalanceWiggleCount1(c => c + 1);
      }
    }

    // No capping - allow input to exceed balance
    if (tokenSide === 'amount0') {
      setWithdrawAmount0(newAmount);
    } else {
      setWithdrawAmount1(newAmount);
    }

    // Check if this is a full withdraw
    if (position && newAmount && parseFloat(newAmount) > 0) {
      const percentage = Math.min(100, (parseFloat(newAmount) / maxAmount) * 100);
      setIsFullWithdraw(percentage >= 99);
    }
  }, [position, withdrawAmount0, withdrawAmount1]);

  // Handle amount input change (non-wiggle version for programmatic changes)
  const handleWithdrawAmountChange = useCallback((newAmount: string, tokenSide: 'amount0' | 'amount1') => {
    if (tokenSide === 'amount0') {
      setWithdrawAmount0(newAmount);
    } else {
      setWithdrawAmount1(newAmount);
    }

    // Check if this is a full withdraw
    if (position && newAmount && parseFloat(newAmount) > 0) {
      const totalAmount = tokenSide === 'amount0' 
        ? parseFloat(position.token0.amount)
        : parseFloat(position.token1.amount);
      
      const percentage = Math.min(100, (parseFloat(newAmount) / totalAmount) * 100);
      setIsFullWithdraw(percentage >= 99);
    }
  }, [position]);

  // Handle max withdraw for specific token
  const handleMaxWithdraw = useCallback((tokenSide: 'amount0' | 'amount1') => {
    if (!position) return;
    
    if (tokenSide === 'amount0') {
      setWithdrawAmount0(position.token0.amount);
      setWithdrawActiveInputSide('amount0');
      // Always trigger calculation to ensure quote fetching
        calculateWithdrawAmount(position.token0.amount, 'amount0');
    } else {
      setWithdrawAmount1(position.token1.amount);
      setWithdrawActiveInputSide('amount1');
      // Always trigger calculation to ensure quote fetching
        calculateWithdrawAmount(position.token1.amount, 'amount1');
    }
    setIsFullWithdraw(true);
  }, [position, calculateWithdrawAmount]);

  const handlePartialWithdraw = useCallback((tokenSide: 'amount0' | 'amount1', percentage: number) => {
    if (!position) return;
    
    if (tokenSide === 'amount0') {
      const maxAmount = parseFloat(position.token0.amount);
      const partialAmount = (maxAmount * percentage).toString();
      setWithdrawAmount0(partialAmount);
      setWithdrawActiveInputSide('amount0');
      calculateWithdrawAmount(partialAmount, 'amount0');
    } else {
      const maxAmount = parseFloat(position.token1.amount);
      const partialAmount = (maxAmount * percentage).toString();
      setWithdrawAmount1(partialAmount);
      setWithdrawActiveInputSide('amount1');
      calculateWithdrawAmount(partialAmount, 'amount1');
    }
    setIsFullWithdraw(percentage === 1);
  }, [position, calculateWithdrawAmount]);

  // Check if user has insufficient balance for withdrawal
  const isAmount0OverBalance = useCallback(() => {
    if (!position) return false;
    const max0 = parseFloat(position.token0.amount || '0');
    const in0 = parseFloat(withdrawAmount0 || '0');
    return in0 > max0 && in0 > 0;
  }, [position, withdrawAmount0]);

  const isAmount1OverBalance = useCallback(() => {
    if (!position) return false;
    const max1 = parseFloat(position.token1.amount || '0');
    const in1 = parseFloat(withdrawAmount1 || '0');
    return in1 > max1 && in1 > 0;
  }, [position, withdrawAmount1]);

  const checkInsufficientBalanceWithdraw = useCallback(() => {
    return isAmount0OverBalance() || isAmount1OverBalance();
  }, [isAmount0OverBalance, isAmount1OverBalance]);

  // Get button text based on state
  const getWithdrawButtonText = useCallback(() => {
    // Check for chain mismatch first
    if (isChainMismatched) {
      return 'Wrong Network';
    }
    // Show Withdraw All only if both sides are >= 99% of position amounts (in-range)
    if (position?.isInRange) {
      const max0 = parseFloat(position.token0.amount || '0');
      const max1 = parseFloat(position.token1.amount || '0');
      const in0 = parseFloat(withdrawAmount0 || '0');
      const in1 = parseFloat(withdrawAmount1 || '0');
      const near0 = max0 > 0 ? in0 >= max0 * 0.99 : in0 === 0;
      const near1 = max1 > 0 ? in1 >= max1 * 0.99 : in1 === 0;
      return (near0 && near1) ? 'Withdraw All' : 'Withdraw';
    }
    // Out of range: check if single productive side is near 100%
    const max0 = parseFloat(position?.token0.amount || '0');
    const max1 = parseFloat(position?.token1.amount || '0');
    const in0 = parseFloat(withdrawAmount0 || '0');
    const in1 = parseFloat(withdrawAmount1 || '0');
    const near0 = max0 > 0 ? in0 >= max0 * 0.99 : false;
    const near1 = max1 > 0 ? in1 >= max1 * 0.99 : false;
    return (near0 || near1) ? 'Withdraw All' : 'Withdraw';
  }, [position, withdrawAmount0, withdrawAmount1, isChainMismatched]);

  // Handle confirm withdraw - show "You Will Receive" first
  const handleConfirmWithdraw = useCallback(() => {
    if (!position || (!withdrawAmount0 && !withdrawAmount1)) {
      toast.error("Invalid Amount", {
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description: "Please enter an amount to withdraw.",
        duration: 4000
      });
      return;
    }

    // Balance check is handled by button disabled state, no need for toast
    
    // For out-of-range positions, ensure at least one amount is greater than 0
    if (!position.isInRange) {
      const amount0Num = parseFloat(withdrawAmount0 || "0");
      const amount1Num = parseFloat(withdrawAmount1 || "0");
      if (amount0Num <= 0 && amount1Num <= 0) {
        toast.error("Invalid Amount", { 
          icon: <OctagonX className="h-4 w-4 text-red-500" />,
          description: "Please enter an amount to withdraw.",
          duration: 4000
        });
        return;
      }
    }

    // Show "You Will Receive" section first
    setShowYouWillReceive(true);
  }, [position, withdrawAmount0, withdrawAmount1]);

  const handleFinalConfirmWithdraw = useCallback(() => {
    if (!position) return;
    
    // Show transaction overview first
    setShowTransactionOverview(true);
  }, [position]);

  const handleExecuteTransaction = useCallback(() => {
    if (!position) return;
    

    // Map position token addresses to correct token symbols from our configuration
    const token0Symbol = getTokenSymbolByAddress(position.token0.address, networkMode);
    const token1Symbol = getTokenSymbolByAddress(position.token1.address, networkMode);
    
    if (!token0Symbol || !token1Symbol) {
      toast.error("Configuration Error", { 
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description: "Token configuration is invalid.",
        action: {
          label: "Open Ticket",
          onClick: () => window.open('https://discord.com/invite/NTXRarFbTr', '_blank')
        }
      });
      return;
    }

    // Compute effective percentage and full-burn intent from current inputs
    const amt0 = parseFloat(withdrawAmount0 || '0');
    const amt1 = parseFloat(withdrawAmount1 || '0');
    const max0Eff = parseFloat(position.token0.amount || '0');
    const max1Eff = parseFloat(position.token1.amount || '0');
    const pct0 = max0Eff > 0 ? amt0 / max0Eff : 0;
    const pct1 = max1Eff > 0 ? amt1 / max1Eff : 0;
    const effectivePct = Math.max(pct0, pct1) * 100;
    const nearFull0 = max0Eff > 0 ? pct0 >= 0.99 : true;
    const nearFull1 = max1Eff > 0 ? pct1 >= 0.99 : true;
    const isBurnAllEffective = position.isInRange ? (nearFull0 && nearFull1) : (pct0 >= 0.99 || pct1 >= 0.99);

    // Use decreaseLiquidity for both full and partial withdraw
    const decreaseData: DecreasePositionData = {
      tokenId: position.positionId,
      token0Symbol: token0Symbol,
      token1Symbol: token1Symbol,
      decreaseAmount0: withdrawAmount0 || '0',
      decreaseAmount1: withdrawAmount1 || '0',
      isFullBurn: isBurnAllEffective,
      poolId: position.poolId,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      enteredSide: withdrawActiveInputSide === 'amount0' ? 'token0' : withdrawActiveInputSide === 'amount1' ? 'token1' : undefined,
    };

    // Show default toast
    toast("Confirm Withdraw", {
      icon: <InfoIcon className="h-4 w-4" />
    });

    // In-range: use percentage flow (SDK), OOR: amounts mode
    if (position.isInRange) {
      const pctRounded = isBurnAllEffective ? 100 : Math.max(0, Math.min(100, Math.round(effectivePct)));
      decreaseLiquidity(decreaseData, pctRounded);
    } else {
      decreaseLiquidity(decreaseData, 0);
    }
    
    setTxStarted(true);
  }, [position, withdrawAmount0, withdrawAmount1, withdrawActiveInputSide, decreaseLiquidity, shouldUseInternalHook]);

  if (!position) return null;

  const hasValidAmount = (withdrawAmount0 && parseFloat(withdrawAmount0) > 0) || 
                        (withdrawAmount1 && parseFloat(withdrawAmount1) > 0);

  try {
    return (
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="p-0 border-0 bg-transparent shadow-none max-w-lg w-[calc(100%-2rem)] sm:w-full [&>button]:hidden">
          {!showSuccessView ? (
            <div className="space-y-6">
              <style dangerouslySetInnerHTML={{__html: `
                @keyframes inputGradientFlow {
                  from { background-position: 0% 0%; }
                  to { background-position: 300% 0%; }
                }
                .input-gradient-hover {
                  position: relative;
                  border-radius: 8px;
                }
                .input-gradient-hover::before {
                  content: '';
                  position: absolute;
                  inset: -1px;
                  border-radius: 9px;
                  background: linear-gradient(
                    45deg,
                    #f94706,
                    #ff7919 25%,
                    #f94706 50%,
                    #ff7919 75%,
                    #f94706 100%
                  );
                  background-size: 300% 100%;
                  opacity: 0;
                  transition: opacity 0.3s ease;
                  pointer-events: none;
                  z-index: 0;
                  animation: inputGradientFlow 10s linear infinite;
                }
                .input-gradient-hover:hover::before,
                .input-gradient-hover:focus-within::before {
                  opacity: 1;
                }
              `}} />
              {/* Withdrawal Logic Container */}
              <div className="border rounded-lg p-6 space-y-4" style={{ backgroundColor: 'var(--modal-background)' }}>
                {/* Step 1: Input Form */}
                {!showYouWillReceive ? (
                  <>

                    {/* Withdraw Amounts - only show in Step 1 */}
                    <div className="space-y-3">
            {position.isInRange ? (
              <>
                          {/* In-range: Both token inputs */}
                 <div>
                   <div className="flex items-center justify-between mb-2">
                              <Label htmlFor="withdraw-amount0" className="text-sm font-medium">Withdraw</Label>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-0"
                        onClick={() => handleMaxWithdraw('amount0')}
                                disabled={isWorking}
                      >
                                Balance: {formatTokenDisplayAmount(position.token0.amount, position.token0.symbol as TokenSymbol)} {position.token0.symbol}
                      </button>
                   </div>
                   <div className="input-gradient-hover">
                    <motion.div
                      className="relative z-[1] group rounded-lg bg-surface border border-sidebar-border/60 p-4"
                      animate={wiggleControls0}
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-[var(--token-selector-background)] border border-sidebar-border/60 rounded-lg h-11 px-3">
                                  <Image src={getTokenIcon(position.token0.symbol)} alt={position.token0.symbol} width={20} height={20} className="rounded-full" />
                          <span className="text-sm font-medium">{position.token0.symbol}</span>
                        </div>
                      <div className="flex-1">
                        <Input
                          id="withdraw-amount0"
                          placeholder="0.0"
                          value={withdrawAmount0}
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          inputMode="decimal"
                          enterKeyHint="done"
                          onChange={(e) => {
                            handleWithdrawAmountChangeWithWiggle(e, 'amount0');
                            setWithdrawActiveInputSide('amount0');
                            const newAmount = sanitizeDecimalInput(e.target.value);
                            if (newAmount && parseFloat(newAmount) > 0) {
                              calculateWithdrawAmount(newAmount, 'amount0');
                            } else {
                              setWithdrawAmount1("");
                              setIsFullWithdraw(false);
                            }
                          }}
                          disabled={isWorking}
                                    className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                          />
                            <div className="relative text-right text-xs min-h-5">
                              <div className={cn("text-muted-foreground transition-opacity duration-100", {
                                "group-hover:opacity-0": parseFloat(position.token0.amount) > 0
                              })}>
                                {(() => {
                                  const usdPrice = getUSDPriceForSymbol(position.token0.symbol);
                                  const numeric = parseFloat(withdrawAmount0 || "0");
                                  return formatCalculatedAmount(numeric * usdPrice);
                                })()}
                              </div>
                              {parseFloat(position.token0.amount) > 0 && (
                                <div className="absolute right-0 top-[3px] flex gap-1 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100">
                                  {[25, 50, 75, 100].map((percentage, index) => (
                                    <motion.div
                                      key={percentage}
                                      className="opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0"
                                      style={{
                                        transitionDelay: `${index * 40}ms`,
                                        transitionDuration: '200ms',
                                        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
                                      }}
                                    >
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-5 px-2 text-[10px] font-medium rounded-md border-sidebar-border bg-muted/20 hover:bg-muted/40 transition-colors"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const token0Decimals = tokenDefinitions[getTokenSymbolByAddress(position.token0.address, networkMode) as TokenSymbol]?.decimals || 18;
                                          const amount = calculatePercentageFromString(position.token0.amount, percentage, token0Decimals);
                                          const syntheticEvent = {
                                            target: { value: amount }
                                          } as React.ChangeEvent<HTMLInputElement>;
                                          handleWithdrawAmountChangeWithWiggle(syntheticEvent, 'amount0');
                                          setWithdrawActiveInputSide('amount0');
                                          if (amount && parseFloat(amount) > 0) {
                                            calculateWithdrawAmount(amount, 'amount0');
                                          }
                                        }}
                                      >
                                        {percentage === 100 ? 'MAX' : `${percentage}%`}
                                      </Button>
                                    </motion.div>
                                  ))}
                                </div>
                              )}
                            </div>
                      </div>
                    </div>
                    </motion.div>
                   </div>
                 </div>

                          <div className="flex justify-center items-center my-2">
                   <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
                              <PlusIcon className="h-4 w-4 text-muted-foreground" />
                   </div>
                 </div>

                 <div>
                            <div className="flex items-center justify-between mb-2">
                              <Label htmlFor="withdraw-amount1" className="text-sm font-medium">Withdraw</Label>
                              <button
                                type="button"
                                className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-0"
                                onClick={() => handleMaxWithdraw('amount1')}
                                disabled={isWorking}
                              >
                                Balance: {formatTokenDisplayAmount(position.token1.amount, position.token1.symbol as TokenSymbol)} {position.token1.symbol}
                              </button>
                   </div>
                   <div className="input-gradient-hover">
                    <motion.div
                      className="relative z-[1] group rounded-lg bg-surface border border-sidebar-border/60 p-4"
                      animate={wiggleControls1}
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-[var(--token-selector-background)] border border-sidebar-border/60 rounded-lg h-11 px-3">
                                  <Image src={getTokenIcon(position.token1.symbol)} alt={position.token1.symbol} width={20} height={20} className="rounded-full" />
                          <span className="text-sm font-medium">{position.token1.symbol}</span>
                        </div>
                      <div className="flex-1">
                        <Input
                          id="withdraw-amount1"
                          placeholder="0.0"
                          value={withdrawAmount1}
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          inputMode="decimal"
                          enterKeyHint="done"
                          onChange={(e) => {
                            handleWithdrawAmountChangeWithWiggle(e, 'amount1');
                            setWithdrawActiveInputSide('amount1');
                            const newAmount = sanitizeDecimalInput(e.target.value);
                            if (newAmount && parseFloat(newAmount) > 0) {
                              calculateWithdrawAmount(newAmount, 'amount1');
                            } else {
                              setWithdrawAmount0("");
                              setIsFullWithdraw(false);
                            }
                          }}
                          disabled={isWorking}
                                    className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                          />
                            <div className="relative text-right text-xs min-h-5">
                              <div className={cn("text-muted-foreground transition-opacity duration-100", {
                                "group-hover:opacity-0": parseFloat(position.token1.amount) > 0
                              })}>
                                {(() => {
                                  const usdPrice = getUSDPriceForSymbol(position.token1.symbol);
                                  const numeric = parseFloat(withdrawAmount1 || "0");
                                  return formatCalculatedAmount(numeric * usdPrice);
                                })()}
                              </div>
                              {parseFloat(position.token1.amount) > 0 && (
                                <div className="absolute right-0 top-[3px] flex gap-1 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100">
                                  {[25, 50, 75, 100].map((percentage, index) => (
                                    <motion.div
                                      key={percentage}
                                      className="opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0"
                                      style={{
                                        transitionDelay: `${index * 40}ms`,
                                        transitionDuration: '200ms',
                                        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
                                      }}
                                    >
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-5 px-2 text-[10px] font-medium rounded-md border-sidebar-border bg-muted/20 hover:bg-muted/40 transition-colors"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const token1Decimals = tokenDefinitions[getTokenSymbolByAddress(position.token1.address, networkMode) as TokenSymbol]?.decimals || 18;
                                          const amount = calculatePercentageFromString(position.token1.amount, percentage, token1Decimals);
                                          const syntheticEvent = {
                                            target: { value: amount }
                                          } as React.ChangeEvent<HTMLInputElement>;
                                          handleWithdrawAmountChangeWithWiggle(syntheticEvent, 'amount1');
                                          setWithdrawActiveInputSide('amount1');
                                          if (amount && parseFloat(amount) > 0) {
                                            calculateWithdrawAmount(amount, 'amount1');
                                          }
                                        }}
                                      >
                                        {percentage === 100 ? 'MAX' : `${percentage}%`}
                                      </Button>
                                    </motion.div>
                                  ))}
                                </div>
                              )}
                            </div>
                      </div>
                    </div>
                    </motion.div>
                   </div>
                </div>
              </>
            ) : (
               <>
                          {/* Out-of-range: Single-sided inputs based on available liquidity */}
                          {(!withdrawProductiveSide || withdrawProductiveSide === 'amount0') && parseFloat(position.token0.amount) >= 0 && (
                  <div>
                     <div className="flex items-center justify-between mb-2">
                       <Label htmlFor="withdraw-amount0-oor" className="text-sm font-medium">
                         Withdraw {position.token0.symbol}
                       </Label>
                       <button
                         type="button"
                         className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-0"
                         onClick={() => handleMaxWithdraw('amount0')}
                         disabled={isWorking}
                       >
                                  Balance: {formatTokenDisplayAmount(position.token0.amount, position.token0.symbol as TokenSymbol)} {position.token0.symbol}
                       </button>
                     </div>
                     <div className="input-gradient-hover">
                      <motion.div
                        className="relative z-[1] rounded-lg bg-surface border border-sidebar-border/60 p-4"
                        animate={wiggleControls0}
                      >
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 bg-[var(--token-selector-background)] border border-sidebar-border/60 rounded-lg h-11 px-3">
                                    <Image src={getTokenIcon(position.token0.symbol)} alt={position.token0.symbol} width={20} height={20} className="rounded-full" />
                            <span className="text-sm font-medium">{position.token0.symbol}</span>
                          </div>
                        <div className="flex-1">
                          <Input
                            id="withdraw-amount0-oor"
                            placeholder="0.0"
                            value={withdrawAmount0}
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                            inputMode="decimal"
                            enterKeyHint="done"
                            onChange={(e) => {
                              const cappedAmount = handleWithdrawAmountChangeWithWiggle(e, 'amount0');
                              setWithdrawActiveInputSide('amount0');
                                        // No calculation needed for OOR positions
                            }}
                            disabled={isWorking}
                                      className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                          />
                          <div className="text-right text-xs text-muted-foreground">
                            {(() => {
                              const usdPrice = getUSDPriceForSymbol(position.token0.symbol);
                                        const numeric = parseFloat(withdrawAmount0 || "0");
                              return formatCalculatedAmount(numeric * usdPrice);
                            })()}
                          </div>
                        </div>
                      </div>
                      </motion.div>
                     </div>
                  </div>
                )}

                          {(!withdrawProductiveSide || withdrawProductiveSide === 'amount1') && parseFloat(position.token1.amount) >= 0 && (
                  <div>
                     <div className="flex items-center justify-between mb-2">
                       <Label htmlFor="withdraw-amount1-oor" className="text-sm font-medium">
                         Withdraw {position.token1.symbol}
                       </Label>
                       <button
                         type="button"
                         className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-0"
                         onClick={() => handleMaxWithdraw('amount1')}
                         disabled={isWorking}
                       >
                                  Balance: {formatTokenDisplayAmount(position.token1.amount, position.token1.symbol as TokenSymbol)} {position.token1.symbol}
                       </button>
                     </div>
                     <div className="input-gradient-hover">
                      <motion.div
                        className="relative z-[1] rounded-lg bg-surface border border-sidebar-border/60 p-4"
                        animate={wiggleControls1}
                      >
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 bg-[var(--token-selector-background)] border border-sidebar-border/60 rounded-lg h-11 px-3">
                                    <Image src={getTokenIcon(position.token1.symbol)} alt={position.token1.symbol} width={20} height={20} className="rounded-full" />
                            <span className="text-sm font-medium">{position.token1.symbol}</span>
                          </div>
                          <div className="flex-1">
                            <Input
                              id="withdraw-amount1-oor"
                              placeholder="0.0"
                              value={withdrawAmount1}
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                              inputMode="decimal"
                              enterKeyHint="done"
                              onChange={(e) => {
                                const cappedAmount = handleWithdrawAmountChangeWithWiggle(e, 'amount1');
                                setWithdrawActiveInputSide('amount1');
                                        // No calculation needed for OOR positions
                              }}
                              disabled={isWorking}
                                      className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                            />
                            <div className="text-right text-xs text-muted-foreground">
                              {(() => {
                                const usdPrice = getUSDPriceForSymbol(position.token1.symbol);
                                        const numeric = parseFloat(withdrawAmount1 || "0");
                                return formatCalculatedAmount(numeric * usdPrice);
                              })()}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                     </div>
                  </div>
                )}
              </>
            )}
        </div>

                    {/* Buttons for Step 1 */}
                    <div className="grid grid-cols-2 gap-3 pt-2">
          <Button 
            variant="outline" 
            className="relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50" 
            onClick={() => onOpenChange(false)} 
            disabled={isWorking}
            style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            Cancel
          </Button>

          <Button
            className={(isChainMismatched || checkInsufficientBalanceWithdraw()) ?
              "relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75" :
              "text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
            }
            onClick={handleConfirmWithdraw}
            disabled={isChainMismatched || isWorking || !hasValidAmount || checkInsufficientBalanceWithdraw()}
            style={checkInsufficientBalanceWithdraw() ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
          >
            <span className={isWorking ? "animate-pulse" : ""}>
              {getWithdrawButtonText()}
            </span>
          </Button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* You Will Receive Section */}
                    <div className="space-y-4">
                      {/* Header with Chevron Left */}
                      <div className="flex items-center gap-2">
                        <ChevronLeftIcon className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-white transition-colors" onClick={() => setShowYouWillReceive(false)} />
                        <span className="text-sm font-medium">You Will Receive</span>
                      </div>

                      {/* Main Position Section */}
                      <div className="rounded-lg bg-container p-4 border border-sidebar-border/60">
                        {/* Token Amounts with Large Icons - 2 Column Layout */}
                        <div className="space-y-4">
                          <div className="flex justify-between items-start">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <div className="text-xl font-medium">
                                  {(() => {
                                    const baseAmount = parseFloat(withdrawAmount0 || "0");
                                    if (!feesForWithdraw) return formatTokenDisplayAmount(baseAmount.toString());
                                    
                                    const decimals = getTokenSymbolByAddress(position.token0.address, networkMode) ? tokenDefinitions[getTokenSymbolByAddress(position.token0.address, networkMode)!]?.decimals || 18 : 18;
                                    const feeAmount = parseFloat(formatUnits(BigInt(feesForWithdraw.amount0 || '0'), decimals));
                                    const totalAmount = baseAmount + feeAmount;
                                    return formatTokenDisplayAmount(totalAmount.toString());
                                  })()}
                                </div>
                                <span className="text-sm text-muted-foreground">{position.token0.symbol}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {(() => {
                                  const baseAmount = parseFloat(withdrawAmount0 || "0");
                                  if (!feesForWithdraw) return formatUSD(baseAmount * getUSDPriceForSymbol(position.token0.symbol));
                                  
                                  const decimals = getTokenSymbolByAddress(position.token0.address, networkMode) ? tokenDefinitions[getTokenSymbolByAddress(position.token0.address, networkMode)!]?.decimals || 18 : 18;
                                  const feeAmount = parseFloat(formatUnits(BigInt(feesForWithdraw.amount0 || '0'), decimals));
                                  const totalAmount = baseAmount + feeAmount;
                                  return formatUSD(totalAmount * getUSDPriceForSymbol(position.token0.symbol));
                                })()}
                              </div>
                            </div>
                            <Image src={getTokenIcon(position.token0.symbol)} alt={position.token0.symbol} width={40} height={40} className="rounded-full" />
                          </div>

                          <div className="flex justify-between items-start">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <div className="text-xl font-medium">
                                  {(() => {
                                    const baseAmount = parseFloat(withdrawAmount1 || "0");
                                    if (!feesForWithdraw) return formatTokenDisplayAmount(baseAmount.toString());
                                    
                                    const decimals = getTokenSymbolByAddress(position.token1.address, networkMode) ? tokenDefinitions[getTokenSymbolByAddress(position.token1.address, networkMode)!]?.decimals || 18 : 18;
                                    const feeAmount = parseFloat(formatUnits(BigInt(feesForWithdraw.amount1 || '0'), decimals));
                                    const totalAmount = baseAmount + feeAmount;
                                    return formatTokenDisplayAmount(totalAmount.toString());
                                  })()}
                                </div>
                                <span className="text-sm text-muted-foreground">{position.token1.symbol}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {(() => {
                                  const baseAmount = parseFloat(withdrawAmount1 || "0");
                                  if (!feesForWithdraw) return formatUSD(baseAmount * getUSDPriceForSymbol(position.token1.symbol));
                                  
                                  const decimals = getTokenSymbolByAddress(position.token1.address, networkMode) ? tokenDefinitions[getTokenSymbolByAddress(position.token1.address, networkMode)!]?.decimals || 18 : 18;
                                  const feeAmount = parseFloat(formatUnits(BigInt(feesForWithdraw.amount1 || '0'), decimals));
                                  const totalAmount = baseAmount + feeAmount;
                                  return formatUSD(totalAmount * getUSDPriceForSymbol(position.token1.symbol));
                                })()}
                              </div>
                            </div>
                            <Image src={getTokenIcon(position.token1.symbol)} alt={position.token1.symbol} width={40} height={40} className="rounded-full" />
                          </div>
                        </div>
                      </div>

                      {/* Fees Section with Striped Border - Only show if there are actual fees */}
                      {(() => {
                        // Check if there are any non-zero fees
                        const token0Symbol = getTokenSymbolByAddress(position.token0.address, networkMode);
                        const token1Symbol = getTokenSymbolByAddress(position.token1.address, networkMode);
                        const token0Decimals = token0Symbol ? tokenDefinitions[token0Symbol]?.decimals || 18 : 18;
                        const token1Decimals = token1Symbol ? tokenDefinitions[token1Symbol]?.decimals || 18 : 18;

                        const fee0Amount = parseFloat(formatUnits(BigInt(feesForWithdraw?.amount0 || '0'), token0Decimals));
                        const fee1Amount = parseFloat(formatUnits(BigInt(feesForWithdraw?.amount1 || '0'), token1Decimals));

                        // Only show if at least one fee is greater than 0
                        if (fee0Amount <= 0 && fee1Amount <= 0) return null;

                        return (
                          <div className="p-3 border border-dashed rounded-md bg-muted/10 space-y-2">
                            <div className="text-xs font-medium text-muted-foreground mb-2">Includes uncollected fees:</div>
                          
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <Image src={getTokenIcon(position.token0.symbol)} alt={position.token0.symbol} width={16} height={16} className="rounded-full" />
                              <span className="text-xs text-muted-foreground">{position.token0.symbol} Fees</span>
                            </div>
                            <div className="text-right">
                              <div className="text-xs font-medium">
                                {(() => {
                                  const feeAmountDisplay = formatUnits(BigInt(feesForWithdraw?.amount0 || '0'), token0Decimals);
                                  const feeNumber = parseFloat(feeAmountDisplay);

                                  if (feeNumber === 0) return '0';

                                  const formattedFee = feeNumber > 0 && feeNumber < 0.0001
                                    ? '< 0.0001'
                                    : feeNumber.toFixed(6).replace(/\.?0+$/, '');

                                  return `+${formattedFee}`;
                                })()}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {(() => {
                                  const feeAmount = parseFloat(formatUnits(BigInt(feesForWithdraw?.amount0 || '0'), token0Decimals));
                                  return formatUSD(feeAmount * getUSDPriceForSymbol(position.token0.symbol));
                                })()}
                              </div>
                            </div>
                          </div>

                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <Image src={getTokenIcon(position.token1.symbol)} alt={position.token1.symbol} width={16} height={16} className="rounded-full" />
                              <span className="text-xs text-muted-foreground">{position.token1.symbol} Fees</span>
                            </div>
                            <div className="text-right">
                              <div className="text-xs font-medium">
                                {(() => {
                                  const feeAmountDisplay = formatUnits(BigInt(feesForWithdraw?.amount1 || '0'), token1Decimals);
                                  const feeNumber = parseFloat(feeAmountDisplay);

                                  if (feeNumber === 0) return '0';

                                  const formattedFee = feeNumber > 0 && feeNumber < 0.0001
                                    ? '< 0.0001'
                                    : feeNumber.toFixed(6).replace(/\.?0+$/, '');

                                  return `+${formattedFee}`;
                                })()}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {(() => {
                                  const feeAmount = parseFloat(formatUnits(BigInt(feesForWithdraw?.amount1 || '0'), token1Decimals));
                                  return formatUSD(feeAmount * getUSDPriceForSymbol(position.token1.symbol));
                                })()}
                              </div>
                            </div>
                          </div>
                          </div>
                        );
                      })()}

                      {/* Additional Info Rows */}
                      {!showTransactionOverview && (
                        <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Current Price:</span>
                          <span className="text-xs text-muted-foreground">
                            {(() => {
                              const price0 = getUSDPriceForSymbol(position.token0.symbol);
                              const price1 = getUSDPriceForSymbol(position.token1.symbol);
                              if (price0 === 0 || price1 === 0) return "N/A";
                              const ratio = price0 / price1;
                              const decimals = ratio < 0.1 ? 3 : 2;
                              return `1 ${position.token0.symbol} = ${ratio.toFixed(decimals)} ${position.token1.symbol}`;
                            })()}
                          </span>
                        </div>
                          
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>New {position.token0.symbol} position:</span>
                          <div className="flex items-center gap-2">
                            <span className="text-foreground/80 font-medium">
                              {formatTokenDisplayAmount((() => {
                                // Calculate new position: original - (withdraw + fees)
                                const originalAmount = parseFloat(position.token0.amount);
                                const withdrawAmount = parseFloat(withdrawAmount0 || "0");
                                let totalWithdraw = withdrawAmount;

                                if (feesForWithdraw) {
                                  const decimals = getTokenSymbolByAddress(position.token0.address, networkMode) ? tokenDefinitions[getTokenSymbolByAddress(position.token0.address, networkMode)!]?.decimals || 18 : 18;
                                  const feeAmount = parseFloat(formatUnits(BigInt(feesForWithdraw.amount0 || '0'), decimals));
                                  totalWithdraw += feeAmount;
                                }

                                return (originalAmount - totalWithdraw).toString();
                              })())}
                            </span>
                            <Image src={getTokenIcon(position.token0.symbol)} alt={position.token0.symbol} width={12} height={12} className="rounded-full" />
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>New {position.token1.symbol} position:</span>
                          <div className="flex items-center gap-2">
                            <span className="text-foreground/80 font-medium">
                              {formatTokenDisplayAmount((() => {
                                // Calculate new position: original - (withdraw + fees)
                                const originalAmount = parseFloat(position.token1.amount);
                                const withdrawAmount = parseFloat(withdrawAmount1 || "0");
                                let totalWithdraw = withdrawAmount;

                                if (feesForWithdraw) {
                                  const decimals = getTokenSymbolByAddress(position.token1.address, networkMode) ? tokenDefinitions[getTokenSymbolByAddress(position.token1.address, networkMode)!]?.decimals || 18 : 18;
                                  const feeAmount = parseFloat(formatUnits(BigInt(feesForWithdraw.amount1 || '0'), decimals));
                                  totalWithdraw += feeAmount;
                                }

                                return (originalAmount - totalWithdraw).toString();
                              })())}
                            </span>
                            <Image src={getTokenIcon(position.token1.symbol)} alt={position.token1.symbol} width={12} height={12} className="rounded-full" />
                          </div>
                        </div>
                        </div>
                      )}

                      {/* Final Action Buttons */}
                      <div className="grid grid-cols-2 gap-3 pt-2">
                        <Button 
                          variant="outline" 
                          className="relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50" 
                          onClick={() => {
                            if (showTransactionOverview) {
                              setShowTransactionOverview(false);
                              setTxStarted(false);
                            } else {
                              setShowYouWillReceive(false);
                            }
                          }} 
                          disabled={isWorking}
                          style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                        >
                          Back
                        </Button>

                        <Button
                          className={isChainMismatched ? "relative border border-sidebar-border bg-button px-3 text-sm font-medium text-white/75" : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"}
                          onClick={showTransactionOverview ? handleExecuteTransaction : handleFinalConfirmWithdraw}
                          disabled={isChainMismatched || isWorking || isWithdrawCalculating}
                        >
                          <span className={isWorking ? "animate-pulse" : ""}>
                            {isChainMismatched ? 'Wrong Network' : 'Confirm'}
                          </span>
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : null}

        {/* Success View */}
        {showSuccessView && (
          <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--modal-background)' }}>
            {/* Transaction Summary */}
            <div 
              className="mb-6 flex items-center justify-between rounded-lg border border-sidebar-border p-4 hover:bg-muted/30 transition-colors cursor-pointer" 
              onClick={() => {
                // Don't call onLiquidityWithdrawn here to prevent auto-close
                // The callback was already called when transaction confirmed
                onOpenChange(false);
              }}
            >
              <div className="flex items-center gap-3">
                <Image src={getTokenIcon(position?.token0.symbol || '')} alt={position?.token0.symbol || ''} width={32} height={32} className="rounded-full"/>
                <div className="text-left flex flex-col">
                  <div className="font-medium flex items-baseline">
                    <span className="text-sm">{formatTokenDisplayAmount((() => {
                      // Calculate amount with fees added
                      const currentWithdraw = withdrawAmount0 || "0";
                      if (!feesForWithdraw) return currentWithdraw;
                      const decimals = getTokenSymbolByAddress(position?.token0.address || '', networkMode) ? tokenDefinitions[getTokenSymbolByAddress(position?.token0.address || '', networkMode)!]?.decimals || 18 : 18;
                      const feeAmount = formatUnits(BigInt(feesForWithdraw.amount0 || '0'), decimals);
                      const totalAmount = parseFloat(currentWithdraw) + parseFloat(feeAmount);
                      return totalAmount.toString();
                    })())}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{position?.token0.symbol}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatUSD((() => {
                      // Calculate USD value with fees added
                      const currentWithdraw = withdrawAmount0 || "0";
                      if (!feesForWithdraw) return parseFloat(currentWithdraw) * getUSDPriceForSymbol(position?.token0.symbol || '');
                      const decimals = getTokenSymbolByAddress(position?.token0.address || '', networkMode) ? tokenDefinitions[getTokenSymbolByAddress(position?.token0.address || '', networkMode)!]?.decimals || 18 : 18;
                      const feeAmount = formatUnits(BigInt(feesForWithdraw.amount0 || '0'), decimals);
                      const totalAmount = parseFloat(currentWithdraw) + parseFloat(feeAmount);
                      return totalAmount * getUSDPriceForSymbol(position?.token0.symbol || '');
                    })())}
                  </div>
                </div>
              </div>
              <div className="flex justify-center items-center mx-2">
                <PlusIcon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right flex flex-col">
                  <div className="font-medium flex items-baseline">
                    <span className="text-sm">{formatTokenDisplayAmount((() => {
                      // Calculate amount with fees added
                      const currentWithdraw = withdrawAmount1 || "0";
                      if (!feesForWithdraw) return currentWithdraw;
                      const decimals = getTokenSymbolByAddress(position?.token1.address || '', networkMode) ? tokenDefinitions[getTokenSymbolByAddress(position?.token1.address || '', networkMode)!]?.decimals || 18 : 18;
                      const feeAmount = formatUnits(BigInt(feesForWithdraw.amount1 || '0'), decimals);
                      const totalAmount = parseFloat(currentWithdraw) + parseFloat(feeAmount);
                      return totalAmount.toString();
                    })())}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{position?.token1.symbol}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatUSD((() => {
                      // Calculate USD value with fees added
                      const currentWithdraw = withdrawAmount1 || "0";
                      if (!feesForWithdraw) return parseFloat(currentWithdraw) * getUSDPriceForSymbol(position?.token1.symbol || '');
                      const decimals = getTokenSymbolByAddress(position?.token1.address || '', networkMode) ? tokenDefinitions[getTokenSymbolByAddress(position?.token1.address || '', networkMode)!]?.decimals || 18 : 18;
                      const feeAmount = formatUnits(BigInt(feesForWithdraw.amount1 || '0'), decimals);
                      const totalAmount = parseFloat(currentWithdraw) + parseFloat(feeAmount);
                      return totalAmount * getUSDPriceForSymbol(position?.token1.symbol || '');
                    })())}
                  </div>
                </div>
                <Image src={getTokenIcon(position?.token1.symbol || '')} alt={position?.token1.symbol || ''} width={32} height={32} className="rounded-full"/>
              </div>
            </div>

            {/* Success Icon and Message */}
            <div className="my-8 flex flex-col items-center justify-center">
              <div
                className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-button border border-sidebar-border overflow-hidden"
                style={{
                  backgroundImage: 'url(/pattern_wide.svg)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center'
                }}
              >
                <CircleCheck className="h-8 w-8 text-sidebar-primary" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-medium">Liquidity Withdrawn</h3>
                <p className="text-muted-foreground mt-1">
                  {formatTokenDisplayAmount((() => {
                    // Calculate amount with fees added for token0
                    const currentWithdraw = withdrawAmount0 || "0";
                    if (!feesForWithdraw) return currentWithdraw;
                    const decimals = getTokenSymbolByAddress(position?.token0.address || '', networkMode) ? tokenDefinitions[getTokenSymbolByAddress(position?.token0.address || '', networkMode)!]?.decimals || 18 : 18;
                    const feeAmount = formatUnits(BigInt(feesForWithdraw.amount0 || '0'), decimals);
                    const totalAmount = parseFloat(currentWithdraw) + parseFloat(feeAmount);
                    return totalAmount.toString();
                  })())} {position?.token0.symbol} and {formatTokenDisplayAmount((() => {
                    // Calculate amount with fees added for token1
                    const currentWithdraw = withdrawAmount1 || "0";
                    if (!feesForWithdraw) return currentWithdraw;
                    const decimals = getTokenSymbolByAddress(position?.token1.address || '', networkMode) ? tokenDefinitions[getTokenSymbolByAddress(position?.token1.address || '', networkMode)!]?.decimals || 18 : 18;
                    const feeAmount = formatUnits(BigInt(feesForWithdraw.amount1 || '0'), decimals);
                    const totalAmount = parseFloat(currentWithdraw) + parseFloat(feeAmount);
                    return totalAmount.toString();
                  })())} {position?.token1.symbol}
                </p>
              </div>
            </div>

            {/* View on Explorer Link */}
            <div className="mb-1 flex items-center justify-center">
              <Button
                variant="link"
                className="text-xs font-normal text-muted-foreground hover:text-muted-foreground/80"
                onClick={() => window.open(txHash ? getExplorerTxUrl(txHash) : getExplorerUrl(), "_blank")}
              >
                View on Explorer
              </Button>
            </div>

            {/* Action Button */}
            <Button
              variant="outline"
              className="w-full relative border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 text-white/75"
              onClick={() => {
                // Don't call onLiquidityWithdrawn here to prevent auto-close
                // The callback was already called when transaction confirmed
                onOpenChange(false);
              }}
              style={{ backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
            >
              Close
            </Button>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
  } catch (error) {
    console.error("Critical error in WithdrawLiquidityModal:", error);
    
    // Fallback UI for critical errors
    return (
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-lg shadow-lg">
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
          </DialogHeader>
          <div className="p-4 text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Unable to load withdraw interface. Please refresh the page and try again.
            </p>
            <Button onClick={() => onOpenChange(false)} variant="outline">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
}
