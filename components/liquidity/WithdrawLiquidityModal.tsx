"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import Image from "next/image";
import { motion, useAnimation } from "framer-motion";

import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import type { DecreasePositionData } from "./useDecreaseLiquidity";
import { TOKEN_DEFINITIONS, type TokenSymbol } from "@/lib/pools-config";
import { useDecreaseLiquidity } from "./useDecreaseLiquidity";
import { formatTokenDisplayAmount, getTokenIcon, sanitizeDecimalInput, debounce, getTokenSymbolByAddress, formatUncollectedFee } from "@/lib/utils";
import { useAllPrices } from "@/components/data/hooks";
import { formatUSD } from "@/lib/format";


interface WithdrawLiquidityModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  position: ProcessedPosition | null;
  feesForWithdraw?: { amount0: string; amount1: string; } | null;
  onLiquidityWithdrawn?: () => void;
  // Optional: pass parent's hook to connect to existing refetching flow
  decreaseLiquidity?: (data: DecreasePositionData, percentage: number) => void;
  isWorking?: boolean;
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
  isWorking: parentIsWorking
}: WithdrawLiquidityModalProps) {
  const { address: accountAddress } = useAccount();
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
  const { 
    decreaseLiquidity: internalDecreaseLiquidity, 
    isLoading: internalIsWorking
  } = useDecreaseLiquidity({
    onLiquidityDecreased: () => {
      // Handle modal closure and callback for internal transactions
      onLiquidityWithdrawn?.();
      onOpenChange(false);
      toast({
        title: "Position Updated"
      });
    }
  });

  // Use parent's function if provided, otherwise use internal
  const decreaseLiquidity = parentDecreaseLiquidity || internalDecreaseLiquidity;
  const isWorking = parentIsWorking ?? internalIsWorking;

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

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setWithdrawAmount0("");
      setWithdrawAmount1("");
      setWithdrawActiveInputSide(null);
      setIsFullWithdraw(false);
      setBalanceWiggleCount0(0);
      setBalanceWiggleCount1(0);
    }
  }, [isOpen]);

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
        const token0Symbol = getTokenSymbolByAddress(position.token0.address);
        const token1Symbol = getTokenSymbolByAddress(position.token1.address);
        
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

        // Use proper API calculation for in-range positions
        const response = await fetch('/api/liquidity/calculate-liquidity-parameters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token0Symbol: token0Symbol,
            token1Symbol: token1Symbol,
            inputAmount: inputAmount,
            inputTokenSymbol: inputSide === 'amount0' ? token0Symbol : token1Symbol,
            userTickLower: position.tickLower,
            userTickUpper: position.tickUpper,
            chainId: 8453, // Base chain
          }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const result = await response.json();
        
        if (version === withdrawCalcVersionRef.current) {
          if (inputSide === 'amount0') {
            // Convert from raw units to display units for token1 - keep full precision
            const token1Symbol = getTokenSymbolByAddress(position.token1.address);
            const token1Decimals = token1Symbol ? TOKEN_DEFINITIONS[token1Symbol]?.decimals || 18 : 18;
            const amount1Display = formatUnits(BigInt(result.amount1 || '0'), token1Decimals);
            setWithdrawAmount1(formatCalculatedInput(amount1Display));
          } else {
            // Convert from raw units to display units for token0 - keep full precision
            const token0Symbol = getTokenSymbolByAddress(position.token0.address);
            const token0Decimals = token0Symbol ? TOKEN_DEFINITIONS[token0Symbol]?.decimals || 18 : 18;
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


  // Handle amount input change with balance capping and wiggle animation
  const handleWithdrawAmountChangeWithWiggle = useCallback((e: React.ChangeEvent<HTMLInputElement>, tokenSide: 'amount0' | 'amount1'): string => {
    const newAmount = sanitizeDecimalInput(e.target.value);
    
    if (!position) return newAmount;
    
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
    
    // Cap the amount to max balance if exceeded
    const finalAmount = isOver ? maxAmount.toString() : newAmount;
    
    if (tokenSide === 'amount0') {
      setWithdrawAmount0(finalAmount);
    } else {
      setWithdrawAmount1(finalAmount);
    }

    // Check if this is a full withdraw
    if (position && finalAmount && parseFloat(finalAmount) > 0) {
      const percentage = Math.min(100, (parseFloat(finalAmount) / maxAmount) * 100);
      setIsFullWithdraw(percentage >= 99);
    }
    
    return finalAmount;
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
      // For in-range positions, set both amounts to exact position amounts to avoid rounding issues
      if (position.isInRange) {
        setWithdrawAmount1(position.token1.amount);
      } else {
        // For out-of-range positions, still use API calculation
        calculateWithdrawAmount(position.token0.amount, 'amount0');
      }
    } else {
      setWithdrawAmount1(position.token1.amount);
      setWithdrawActiveInputSide('amount1');
      // For in-range positions, set both amounts to exact position amounts to avoid rounding issues
      if (position.isInRange) {
        setWithdrawAmount0(position.token0.amount);
      } else {
        // For out-of-range positions, still use API calculation
        calculateWithdrawAmount(position.token1.amount, 'amount1');
      }
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

  // Handle confirm withdraw
  const handleConfirmWithdraw = useCallback(() => {
    if (!position || (!withdrawAmount0 && !withdrawAmount1)) {
      toast({
        title: "Enter withdrawal amount",
        variant: "destructive"
      });
      return;
    }

    // Prevent over-withdraw relative to position balances
    const max0 = parseFloat(position.token0.amount || '0');
    const max1 = parseFloat(position.token1.amount || '0');
    const in0 = parseFloat(withdrawAmount0 || '0');
    const in1 = parseFloat(withdrawAmount1 || '0');
    if ((in0 > max0 + 1e-12) || (in1 > max1 + 1e-12)) {
      toast({
        title: "Amount exceeds balance",
        variant: "destructive"
      });
      return;
    }
    
    // For out-of-range positions, ensure at least one amount is greater than 0
    if (!position.isInRange) {
      const amount0Num = parseFloat(withdrawAmount0 || "0");
      const amount1Num = parseFloat(withdrawAmount1 || "0");
      if (amount0Num <= 0 && amount1Num <= 0) {
        toast({
          title: "Enter amount to withdraw",
          variant: "destructive"
        });
        return;
      }
    }

    // Map position token addresses to correct token symbols from our configuration
    const token0Symbol = getTokenSymbolByAddress(position.token0.address);
    const token1Symbol = getTokenSymbolByAddress(position.token1.address);
    
    if (!token0Symbol || !token1Symbol) {
      toast({
        title: "Token configuration error",
        variant: "destructive"
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

    // In-range: use percentage flow (SDK), OOR: amounts mode
    if (position.isInRange) {
      const pctRounded = isBurnAllEffective ? 100 : Math.max(0, Math.min(100, Math.round(effectivePct)));
      decreaseLiquidity(decreaseData, pctRounded);
    } else {
      decreaseLiquidity(decreaseData, 0);
    }
  }, [position, withdrawAmount0, withdrawAmount1, withdrawActiveInputSide, decreaseLiquidity]);

  if (!position) return null;

  const hasValidAmount = (withdrawAmount0 && parseFloat(withdrawAmount0) > 0) || 
                        (withdrawAmount1 && parseFloat(withdrawAmount1) > 0);

  try {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => {
        if (!isWorking) {
          onOpenChange(open);
        }
      }}>
        <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-lg shadow-lg [&>button]:hidden" style={{ backgroundColor: 'var(--modal-background)' }}>
         <div>
           {/* Current Position */}
           <div className="flex items-center justify-between mb-4">
             <span className="text-sm font-medium">Current Position</span>
             <div className="flex items-center gap-2">
               {position.isInRange ? (
                 <div className="px-2 py-1 bg-green-500/20 text-green-500 text-xs rounded-md cursor-default">
                   In Range
                 </div>
               ) : (
                 <TooltipProvider delayDuration={0}>
                   <Tooltip>
                     <TooltipTrigger asChild>
                       <div className="px-2 py-1 bg-red-500/20 text-red-500 text-xs rounded-md cursor-default">
                         Out of Range
                       </div>
                     </TooltipTrigger>
                     <TooltipContent side="top" className="bg-popover border border-border text-popover-foreground">
                       <p className="text-xs">Position is not earning fees.</p>
                     </TooltipContent>
                   </Tooltip>
                 </TooltipProvider>
               )}
             </div>
           </div>
          
           <div className="p-3 border border-dashed rounded-md bg-muted/10 space-y-2 mb-6">
             <div className="flex justify-between items-center">
               <div className="flex items-center gap-2">
                 <Image 
                   src={getTokenIcon(position.token0.symbol)} 
                   alt={position.token0.symbol} 
                   width={20} 
                   height={20} 
                   className="rounded-full"
                 />
                 <span className="text-sm font-medium">{position.token0.symbol}</span>
               </div>
               <div className="flex items-center gap-2">
                 <button 
                   onClick={() => {
                     if (parseFloat(position.token0.amount) > 0 && (position.isInRange || (!withdrawProductiveSide || withdrawProductiveSide === 'amount0'))) {
                       handleMaxWithdraw('amount0');
                     }
                   }}
                   className="text-sm font-medium text-muted-foreground hover:text-white transition-colors cursor-pointer focus:outline-none focus:ring-0"
                   disabled={isWorking}
                 >
                   {formatTokenDisplayAmount(position.token0.amount)}
                 </button>
                 {feesForWithdraw?.amount0 && (
                   <TooltipProvider delayDuration={0}>
                     <Tooltip>
                       <TooltipTrigger asChild>
                         <span 
                           className="text-[10px] text-muted-foreground cursor-default"
                         >
                           <span className="select-none">
                             {(() => {
                               // Convert from raw units to display units
                               const token0Symbol = getTokenSymbolByAddress(position.token0.address);
                               const token0Decimals = token0Symbol ? TOKEN_DEFINITIONS[token0Symbol]?.decimals || 18 : 18;
                               const feeAmountDisplay = parseFloat(formatUnits(BigInt(feesForWithdraw.amount0 || '0'), token0Decimals));
                               const usdPrice = getUSDPriceForSymbol(position.token0.symbol);
                               const feeUSD = feeAmountDisplay * usdPrice;
                               const showAmount = feeUSD >= 0.01;
                               
                               return showAmount ? `+ ${formatUSD(feeUSD)}` : '+ Fees';
                             })()}
                           </span>
                         </span>
                       </TooltipTrigger>
                       <TooltipContent 
                         side="right" 
                         sideOffset={6} 
                         className="px-2 py-1 text-xs pointer-events-none"
                         onPointerOverCapture={() => false}
                       >
                         Fees Automatically Withdrawn
                       </TooltipContent>
                     </Tooltip>
                   </TooltipProvider>
                 )}
               </div>
             </div>
             <div className="flex justify-between items-center">
               <div className="flex items-center gap-2">
                 <Image 
                   src={getTokenIcon(position.token1.symbol)} 
                   alt={position.token1.symbol} 
                   width={20} 
                   height={20} 
                   className="rounded-full"
                 />
                 <span className="text-sm font-medium">{position.token1.symbol}</span>
               </div>
               <div className="flex items-center gap-2">
                 <button 
                   onClick={() => {
                     if (parseFloat(position.token1.amount) > 0 && (position.isInRange || (!withdrawProductiveSide || withdrawProductiveSide === 'amount1'))) {
                       handleMaxWithdraw('amount1');
                     }
                   }}
                   className="text-sm font-medium text-muted-foreground hover:text-white transition-colors cursor-pointer focus:outline-none focus:ring-0"
                   disabled={isWorking}
                 >
                   {formatTokenDisplayAmount(position.token1.amount)}
                 </button>
                 {feesForWithdraw?.amount1 && (
                   <TooltipProvider delayDuration={0}>
                     <Tooltip>
                       <TooltipTrigger asChild>
                         <span 
                           className="text-[10px] text-muted-foreground cursor-default"
                         >
                           <span className="select-none">
                             {(() => {
                               // Convert from raw units to display units
                               const token1Symbol = getTokenSymbolByAddress(position.token1.address);
                               const token1Decimals = token1Symbol ? TOKEN_DEFINITIONS[token1Symbol]?.decimals || 18 : 18;
                               const feeAmountDisplay = parseFloat(formatUnits(BigInt(feesForWithdraw.amount1 || '0'), token1Decimals));
                               const usdPrice = getUSDPriceForSymbol(position.token1.symbol);
                               const feeUSD = feeAmountDisplay * usdPrice;
                               const showAmount = feeUSD >= 0.01;
                               
                               return showAmount ? `+ ${formatUSD(feeUSD)}` : '+ Fees';
                             })()}
                           </span>
                         </span>
                       </TooltipTrigger>
                       <TooltipContent 
                         side="right" 
                         sideOffset={6} 
                         className="px-2 py-1 text-xs pointer-events-none"
                         onPointerOverCapture={() => false}
                       >
                         Fees Automatically Withdrawn
                       </TooltipContent>
                     </Tooltip>
                   </TooltipProvider>
                 )}
               </div>
             </div>
           </div>


          {/* Withdraw Amounts */}
          <div className="space-y-3 mt-6">
            {position.isInRange ? (
              <>
                 {/* Token 0 Input */}
                 <div>
                   <div className="flex items-center justify-between mb-2">
                     <Label htmlFor="withdraw-amount0" className="text-sm font-medium">
                       Withdraw
                     </Label>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => handleMaxWithdraw('amount0')}
                        disabled={isWorking || withdrawProductiveSide === 'amount1'}
                      >
                        Max
                      </button>
                   </div>
                  <motion.div 
                    className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4"
                    animate={wiggleControls0}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                        <Image 
                          src={getTokenIcon(position.token0.symbol)} 
                          alt={position.token0.symbol} 
                          width={20} 
                          height={20} 
                          className="rounded-full"
                        />
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
                            const cappedAmount = handleWithdrawAmountChangeWithWiggle(e, 'amount0');
                            setWithdrawActiveInputSide('amount0');
                            if (cappedAmount && parseFloat(cappedAmount) > 0) {
                              calculateWithdrawAmount(cappedAmount, 'amount0');
                            } else {
                              setWithdrawAmount1("");
                              setIsFullWithdraw(false);
                            }
                          }}
                          disabled={isWorking}
                            className="border-0 bg-transparent text-right text-lg md:text-lg font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
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

                 {/* Plus Icon */}
                 <div className="flex justify-center items-center my-3">
                   <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
                     <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                     </svg>
                   </div>
                 </div>
 
                 {/* Token 1 Input */}
                 <div>
                   <div className="flex items-center justify-between">
                     <Label htmlFor="withdraw-amount1" className="text-sm font-medium">
                     </Label>
                   </div>
                  <motion.div 
                    className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4"
                    animate={wiggleControls1}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                        <Image 
                          src={getTokenIcon(position.token1.symbol)} 
                          alt={position.token1.symbol} 
                          width={20} 
                          height={20} 
                          className="rounded-full"
                        />
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
                            const cappedAmount = handleWithdrawAmountChangeWithWiggle(e, 'amount1');
                            setWithdrawActiveInputSide('amount1');
                            if (cappedAmount && parseFloat(cappedAmount) > 0) {
                              calculateWithdrawAmount(cappedAmount, 'amount1');
                            } else {
                              setWithdrawAmount0("");
                              setIsFullWithdraw(false);
                            }
                          }}
                          disabled={isWorking}
                            className="border-0 bg-transparent text-right text-lg md:text-lg font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
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
              </>
            ) : (
               /* Single-sided withdrawal for out-of-range positions */
               <>
                 {/* Show inputs for available tokens */}
                {(!withdrawProductiveSide || withdrawProductiveSide === 'amount0') && parseFloat(position.token0.amount) > 0 && (
                  <div>
                     <div className="flex items-center justify-between mb-2">
                       <Label htmlFor="withdraw-amount0-oor" className="text-sm font-medium">
                         Withdraw {position.token0.symbol}
                       </Label>
                       <button
                         type="button"
                         className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                         onClick={() => handleMaxWithdraw('amount0')}
                         disabled={isWorking}
                       >
                         Max
                       </button>
                     </div>
                    <motion.div 
                      className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4"
                      animate={wiggleControls0}
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                          <Image 
                            src={getTokenIcon(position.token0.symbol)} 
                            alt={position.token0.symbol} 
                            width={20} 
                            height={20} 
                            className="rounded-full"
                          />
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
                              if (cappedAmount && parseFloat(cappedAmount) > 0) {
                                calculateWithdrawAmount(cappedAmount, 'amount0');
                              } else {
                                setIsFullWithdraw(false);
                              }
                            }}
                            disabled={isWorking}
                            className="border-0 bg-transparent text-right text-lg md:text-lg font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                          />
                          <div className="text-right text-xs text-muted-foreground">
                            {(() => {
                              const usdPrice = getUSDPriceForSymbol(position.token0.symbol);
                              const numeric = parseDisplayAmount(withdrawAmount0);
                              return formatCalculatedAmount(numeric * usdPrice);
                            })()}
                          </div>
                          {feesForWithdraw?.amount0 && (
                            <FeeDisplay feeAmount={feesForWithdraw.amount0} tokenSymbol={position.token0.symbol as TokenSymbol} />
                          )}
                        </div>
                      </div>
                    </motion.div>
                  </div>
                )}

                {(!withdrawProductiveSide || withdrawProductiveSide === 'amount1') && parseFloat(position.token1.amount) > 0 && (
                  <div>
                     <div className="flex items-center justify-between mb-2">
                       <Label htmlFor="withdraw-amount1-oor" className="text-sm font-medium">
                         Withdraw {position.token1.symbol}
                       </Label>
                       <button
                         type="button"
                         className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                         onClick={() => handleMaxWithdraw('amount1')}
                         disabled={isWorking}
                       >
                         Max
                       </button>
                     </div>
                    <motion.div 
                      className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4"
                      animate={wiggleControls1}
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                          <Image 
                            src={getTokenIcon(position.token1.symbol)} 
                            alt={position.token1.symbol} 
                            width={20} 
                            height={20} 
                            className="rounded-full"
                          />
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
                              if (cappedAmount && parseFloat(cappedAmount) > 0) {
                                calculateWithdrawAmount(cappedAmount, 'amount1');
                              } else {
                                setIsFullWithdraw(false);
                              }
                            }}
                            disabled={isWorking}
                            className="border-0 bg-transparent text-right text-lg md:text-lg font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                          />
                          <div className="text-right text-xs text-muted-foreground">
                            {(() => {
                              const usdPrice = getUSDPriceForSymbol(position.token1.symbol);
                              const numeric = parseDisplayAmount(withdrawAmount1);
                              return formatCalculatedAmount(numeric * usdPrice);
                            })()}
                          </div>
                          {feesForWithdraw?.amount1 && (
                            <FeeDisplay feeAmount={feesForWithdraw.amount1} tokenSymbol={position.token1.symbol as TokenSymbol} />
                          )}
                        </div>
                      </div>
                    </motion.div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <DialogFooter className="grid grid-cols-2 gap-3">
          <Button 
            variant="outline" 
            className="relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50" 
            onClick={() => onOpenChange(false)} 
            disabled={isWorking}
            style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            Cancel
          </Button>
          <Button 
            className="text-sidebar-primary border border-sidebar-primary bg-[#3d271b] hover:bg-[#3d271b]/90" 
            onClick={handleConfirmWithdraw}
            disabled={isWorking || !hasValidAmount}
          >
            <span className={isWorking ? "animate-pulse" : ""}>
              {(() => {
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
              })()}
            </span>
          </Button>
        </DialogFooter>
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
