"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { PlusIcon, RefreshCwIcon, CheckIcon, ChevronDownIcon, SearchIcon, XIcon, OctagonX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import Image from "next/image";
import { useAccount, useBalance } from "wagmi";
import { toast } from "sonner";
import { TOKEN_DEFINITIONS, TokenSymbol, getToken, getAllTokens, getPoolById } from "@/lib/pools-config";
import { useAddLiquidityTransaction } from "./useAddLiquidityTransaction";
import { useIncreaseLiquidity, type IncreasePositionData } from "./useIncreaseLiquidity";
import { TokenSelectorToken } from "../swap/TokenSelector";
import { AnimatePresence, motion, useAnimation } from "framer-motion";
import { readContract, getBalance } from '@wagmi/core';
import { erc20Abi } from 'viem';
import { config } from '@/lib/wagmiConfig';
import { CHAIN_ID } from "@/lib/pools-config";
import { formatUnits as viemFormatUnits } from "viem";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";
import { useAllPrices } from "@/components/data/hooks";
import { formatUSD } from "@/lib/format";
import { sanitizeDecimalInput, debounce, getTokenSymbolByAddress, formatUncollectedFee } from "@/lib/utils";
import { formatUnits } from "viem";

// Utility functions
const formatTokenDisplayAmount = (amount: string) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0.00";
  if (num > 0 && num < 0.0001) return "< 0.0001";
  return num.toFixed(4);
};

const getTokenIcon = (symbol?: string) => {
  if (!symbol) return "/placeholder-logo.svg";
  const tokenConfig = getToken(symbol);
  return tokenConfig?.icon || "/placeholder-logo.svg";
};

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
            <p className="text-xs">Fees Compounded on Addition</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  } catch (error) {
    console.error("Error displaying fee:", error);
    return null;
  }
};

export interface AddLiquidityModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onLiquidityAdded: () => void; 
  selectedPoolId?: string;
  sdkMinTick: number;
  sdkMaxTick: number;
  defaultTickSpacing: number;
  poolApr?: string;
  // For existing position mode
  positionToModify?: ProcessedPosition | null;
  feesForIncrease?: { amount0: string; amount1: string; } | null;
  // Pass down the page's increaseLiquidity function to avoid duplicate hooks
  increaseLiquidity?: (data: IncreasePositionData) => void;
  isIncreasingLiquidity?: boolean;
}

export function AddLiquidityModal({
  isOpen,
  onOpenChange,
  onLiquidityAdded, 
  selectedPoolId,
  sdkMinTick,
  sdkMaxTick,
  defaultTickSpacing,
  poolApr,
  positionToModify,
  feesForIncrease,
  increaseLiquidity: parentIncreaseLiquidity,
  isIncreasingLiquidity: parentIsIncreasingLiquidity
}: AddLiquidityModalProps) {
  const { address: accountAddress, chainId, isConnected } = useAccount();
  const { data: allPrices } = useAllPrices();
  
  // Determine if this is for an existing position or new position
  const isExistingPosition = !!positionToModify;

  // Map any token symbol to a USD price
  const extractUsd = (value: unknown, fallback: number): number => {
    if (typeof value === 'number') return value;
    if (value && typeof (value as any).usd === 'number') return (value as any).usd as number;
    return fallback;
  };

  const getUSDPriceForSymbol = useCallback((symbol?: string): number => {
    if (!symbol) return 0;
    const s = symbol.toUpperCase();
    if (s.includes('BTC')) return allPrices?.BTC?.usd ?? 0;
    if (s.includes('ETH')) return allPrices?.ETH?.usd ?? 0;
    if (s.includes('USDC')) return allPrices?.USDC?.usd ?? 1;
    if (s.includes('USDT')) return allPrices?.USDT?.usd ?? 1;
    return 0;
  }, [allPrices]);


  // Format calculated input values (non-USD) with max 9 decimals
  const formatCalculatedInput = useCallback((value: string): string => {
    if (!value) return value;

    const [integerPart, decimalPart] = value.split('.');

    if (!decimalPart || decimalPart.length <= 9) {
      return value;
    }

    // Truncate to 9 decimals (no ellipsis for input fields)
    return `${integerPart}.${decimalPart.substring(0, 9)}`;
  }, []);

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
  
  // For new positions: token selection and range setting
  const [token0Symbol, setToken0Symbol] = useState<TokenSymbol>('');
  const [token1Symbol, setToken1Symbol] = useState<TokenSymbol>('');
  const [amount0, setAmount0] = useState<string>("");
  const [amount1, setAmount1] = useState<string>("");
  const [tickLower, setTickLower] = useState<string>(sdkMinTick.toString());
  const [tickUpper, setTickUpper] = useState<string>(sdkMaxTick.toString());
  const [activeInputSide, setActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculatedData, setCalculatedData] = useState<any>(null);
  
  // For existing positions: percentage-based increase
  const [increaseAmount0, setIncreaseAmount0] = useState<string>("");
  const [increaseAmount1, setIncreaseAmount1] = useState<string>("");
  const [increaseActiveInputSide, setIncreaseActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [increasePercentage, setIncreasePercentage] = useState<number>(0);
  const [isIncreaseCalculating, setIsIncreaseCalculating] = useState(false);
  
  // Animation states for balance wiggle
  const [balanceWiggleCount0, setBalanceWiggleCount0] = useState(0);
  const [balanceWiggleCount1, setBalanceWiggleCount1] = useState(0);
  const wiggleControls0 = useAnimation();
  const wiggleControls1 = useAnimation();
  
  // Versioning for calculation debounce
  const increaseCalcVersionRef = useRef(0);
  
  // Token selection state
  const [tokenChooserOpen, setTokenChooserOpen] = useState<null | 'token0' | 'token1'>(null);
  const [tokenSearchTerm, setTokenSearchTerm] = useState('');
  const [availableTokens, setAvailableTokens] = useState<TokenSelectorToken[]>([]);
  
  // Get token symbols for balance hooks (handle both new positions and existing positions)
  const balanceToken0Symbol = isExistingPosition ? positionToModify?.token0.symbol : token0Symbol;
  const balanceToken1Symbol = isExistingPosition ? positionToModify?.token1.symbol : token1Symbol;

  // Balance data
  const { data: token0BalanceData, isLoading: isLoadingToken0Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[balanceToken0Symbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[balanceToken0Symbol]?.address && !!balanceToken0Symbol },
  });

  const { data: token1BalanceData, isLoading: isLoadingToken1Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[balanceToken1Symbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[balanceToken1Symbol]?.address && !!balanceToken1Symbol },
  });

  // Transaction hooks
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
    onOpenChange,
  });

  // Always call the hook to maintain hook order, but disable callback when parent exists
  const shouldUseInternalHook = !parentIncreaseLiquidity;
  
  const internalHookResult = useIncreaseLiquidity({
    onLiquidityIncreased: (info) => {
      console.log('[DEBUG] Modal internal hook callback fired, shouldUseInternal:', shouldUseInternalHook, 'txHash:', info?.txHash?.slice(0, 10) + '...');
      // Only fire callback when no parent hook is provided to prevent duplicates
      if (shouldUseInternalHook) {
        console.log('[DEBUG] Modal executing internal callback');
        onLiquidityAdded();
        onOpenChange(false);
      } else {
        console.log('[DEBUG] Modal skipping internal callback - parent hook provided');
      }
    },
  });
  
  // Use parent hook if provided, otherwise use internal hook
  const increaseLiquidity = shouldUseInternalHook ? internalHookResult.increaseLiquidity : parentIncreaseLiquidity!;
  const isIncreasingLiquidity = shouldUseInternalHook ? internalHookResult.isLoading : parentIsIncreasingLiquidity ?? false;
  
  const handleConfirmIncrease = () => {
    if (!positionToModify || (!increaseAmount0 && !increaseAmount1)) {
      toast.error('Missing Amount', { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: 'Please enter at least one amount to add.' });
      return;
    }
    
    console.log('[DEBUG] Modal: handleConfirmIncrease called, shouldUseInternalHook:', shouldUseInternalHook);
    
    const data: IncreasePositionData = {
      tokenId: positionToModify.positionId,
      token0Symbol: positionToModify.token0.symbol as TokenSymbol,
      token1Symbol: positionToModify.token1.symbol as TokenSymbol,
      additionalAmount0: increaseAmount0 || '0',
      additionalAmount1: increaseAmount1 || '0',
      poolId: positionToModify.poolId,
      tickLower: positionToModify.tickLower,
      tickUpper: positionToModify.tickUpper,
    };

    // For internal hook usage, onLiquidityAdded will be called by the hook's callback
    // For parent hook usage, the parent page handles all the callbacks
    increaseLiquidity(data);
  };

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

  // Calculate increase amounts based on input (for existing positions)
  const calculateIncreaseAmount = useCallback(
    debounce(async (inputAmount: string, inputSide: 'amount0' | 'amount1') => {
      const version = ++increaseCalcVersionRef.current;
      
      if (!positionToModify || !inputAmount || parseFloat(inputAmount) <= 0) {
        if (inputSide === 'amount0') setIncreaseAmount1("");
        else setIncreaseAmount0("");
        return;
      }

      setIsIncreaseCalculating(true);
      
      try {
        // For out-of-range positions, don't calculate corresponding amount
        if (!positionToModify.isInRange) {
          if (inputSide === 'amount0') {
            setIncreaseAmount1("0");
          } else {
            setIncreaseAmount0("0");
          }
          setIsIncreaseCalculating(false);
          return;
        }

        // For in-range positions, use liquidity calculation API
        const token0Symbol = getTokenSymbolByAddress(positionToModify.token0.address);
        const token1Symbol = getTokenSymbolByAddress(positionToModify.token1.address);
        
        if (!token0Symbol || !token1Symbol) {
          // Fallback to simple ratio if token mapping fails
          const amount0Total = parseFloat(positionToModify.token0.amount);
          const amount1Total = parseFloat(positionToModify.token1.amount);
          const inputAmountNum = parseFloat(inputAmount);

          if (inputSide === 'amount0') {
            // Only update the calculated field, not the user input field
            const ratio = inputAmountNum / amount0Total;
            const calculatedAmount1 = amount1Total * ratio;
            if (version === increaseCalcVersionRef.current) {
              setIncreaseAmount1(calculatedAmount1.toString());
            }
          } else {
            // Only update the calculated field, not the user input field
            const ratio = inputAmountNum / amount1Total;
            const calculatedAmount0 = amount0Total * ratio;
            if (version === increaseCalcVersionRef.current) {
              setIncreaseAmount0(calculatedAmount0.toString());
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
            userTickLower: positionToModify.tickLower,
            userTickUpper: positionToModify.tickUpper,
            chainId: 8453, // Base chain
          }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const result = await response.json();
        
        if (version === increaseCalcVersionRef.current) {
          if (inputSide === 'amount0') {
            // Only update the calculated field, not the user input field
            const token1Symbol = getTokenSymbolByAddress(positionToModify.token1.address);
            const token1Decimals = token1Symbol ? TOKEN_DEFINITIONS[token1Symbol]?.decimals || 18 : 18;
            const amount1Display = formatUnits(BigInt(result.amount1 || '0'), token1Decimals);
            setIncreaseAmount1(formatCalculatedInput(amount1Display));
          } else {
            // Only update the calculated field, not the user input field
            const token0Symbol = getTokenSymbolByAddress(positionToModify.token0.address);
            const token0Decimals = token0Symbol ? TOKEN_DEFINITIONS[token0Symbol]?.decimals || 18 : 18;
            const amount0Display = formatUnits(BigInt(result.amount0 || '0'), token0Decimals);
            setIncreaseAmount0(formatCalculatedInput(amount0Display));
          }
        }
      } catch (error) {
        console.error("Error calculating increase amount:", error);
        
        // Fallback to simple ratio calculation on API error
        try {
          const amount0Total = parseFloat(positionToModify.token0.amount);
          const amount1Total = parseFloat(positionToModify.token1.amount);
          const inputAmountNum = parseFloat(inputAmount);

          if (version === increaseCalcVersionRef.current) {
            if (inputSide === 'amount0') {
              // Only update the calculated field, not the user input field
              const ratio = inputAmountNum / amount0Total;
              const calculatedAmount1 = amount1Total * ratio;
              setIncreaseAmount1(formatCalculatedInput(calculatedAmount1.toString()));
            } else {
              // Only update the calculated field, not the user input field
              const ratio = inputAmountNum / amount1Total;
              const calculatedAmount0 = amount0Total * ratio;
              setIncreaseAmount0(formatCalculatedInput(calculatedAmount0.toString()));
            }
          }
        } catch (fallbackError) {
          console.error("Fallback calculation also failed:", fallbackError);
        }
      } finally {
        if (version === increaseCalcVersionRef.current) {
          setIsIncreaseCalculating(false);
        }
      }
    }, 300),
    [positionToModify]
  );

  // Helper functions
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

  const displayToken0Balance = !balanceToken0Symbol ? "~" : (isLoadingToken0Balance ? "Loading..." : (token0BalanceData ? getFormattedDisplayBalance(parseFloat(token0BalanceData.formatted), balanceToken0Symbol) : "~"));
  const displayToken1Balance = !balanceToken1Symbol ? "~" : (isLoadingToken1Balance ? "Loading..." : (token1BalanceData ? getFormattedDisplayBalance(parseFloat(token1BalanceData.formatted), balanceToken1Symbol) : "~"));

  // Calculate which side is productive for out-of-range positions
  let increaseProductiveSide: null | 'amount0' | 'amount1' = null;
  try {
    if (positionToModify && !positionToModify.isInRange) {
      // Prefer actual balances to determine productive side when out of range
      const amt0 = Number.parseFloat(positionToModify.token0?.amount || '0');
      const amt1 = Number.parseFloat(positionToModify.token1?.amount || '0');
      if (amt0 > 0 && (!Number.isFinite(amt1) || amt1 <= 0)) increaseProductiveSide = 'amount0';
      else if (amt1 > 0 && (!Number.isFinite(amt0) || amt0 <= 0)) increaseProductiveSide = 'amount1';
      // If both sides have amounts, return null to show both
    }
  } catch (error) {
    console.error("Error calculating productive side:", error);
  }

  // Initialize tokens based on selected pool
  useEffect(() => {
    if (isOpen && selectedPoolId && !isExistingPosition) {
      const poolConfig = getPoolById(selectedPoolId);
      if (poolConfig) {
        setToken0Symbol(poolConfig.currency0.symbol as TokenSymbol);
        setToken1Symbol(poolConfig.currency1.symbol as TokenSymbol);
      }
    }
  }, [isOpen, selectedPoolId, isExistingPosition]);

  // Initialize existing position state when modal opens
  useEffect(() => {
    if (isOpen && isExistingPosition && positionToModify) {
      // Reset amounts when modal opens
      setIncreaseAmount0("");
      setIncreaseAmount1("");
      setIncreaseActiveInputSide(null);
      setIncreasePercentage(0);
    }
  }, [isOpen, isExistingPosition, positionToModify]);

  // Populate available tokens
  useEffect(() => {
    if (isOpen) {
      const tokensRecord = getAllTokens();
      const tokenSelectorTokens: TokenSelectorToken[] = Object.values(tokensRecord).map(token => ({
        address: token.address as `0x${string}`,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        icon: token.icon,
        usdPrice: getUSDPriceForSymbol(token.symbol)
      }));
      setAvailableTokens(tokenSelectorTokens);
    }
  }, [isOpen, getUSDPriceForSymbol]);

  // Token selection handlers
  const handleToken0Select = (token: TokenSelectorToken) => {
    setToken0Symbol(token.symbol as TokenSymbol);
    setAmount0("");
    setAmount1("");
    setCalculatedData(null);
    setActiveInputSide(null);
  };

  const handleToken1Select = (token: TokenSelectorToken) => {
    setToken1Symbol(token.symbol as TokenSymbol);
    setAmount0("");
    setAmount1("");
    setCalculatedData(null);
    setActiveInputSide(null);
  };

  const handleUseFullBalance = (balanceString: string, tokenSymbolForDecimals: TokenSymbol, isToken0: boolean) => {
    try {
      const numericBalance = parseFloat(balanceString);
      if (isNaN(numericBalance) || numericBalance <= 0) return;

      const formattedBalance = numericBalance.toFixed(TOKEN_DEFINITIONS[tokenSymbolForDecimals]?.decimals || 18);

      if (isExistingPosition) {
        // For existing positions
        if (isToken0) {
          setIncreaseAmount0(formattedBalance);
          setIncreaseActiveInputSide('amount0');
        } else {
          setIncreaseAmount1(formattedBalance);
          setIncreaseActiveInputSide('amount1');
        }
      } else {
        // For new positions
        if (isToken0) {
          setAmount0(formattedBalance);
          setActiveInputSide('amount0');
        } else {
          setAmount1(formattedBalance);
          setActiveInputSide('amount1');
        }
      }
    } catch (error) {
      // Handle error silently
    }
  };

  // Handle amount input change with balance capping and wiggle animation
  const handleIncreaseAmountChangeWithWiggle = useCallback((e: React.ChangeEvent<HTMLInputElement>, tokenSide: 'amount0' | 'amount1'): string => {
    if (!isExistingPosition || !positionToModify) return e.target.value;
    
    const newAmount = sanitizeDecimalInput(e.target.value);
    
    const balanceData = tokenSide === 'amount0' ? token0BalanceData : token1BalanceData;
    const maxAmount = balanceData ? parseFloat(balanceData.formatted) : 0;
    
    const inputAmount = parseFloat(newAmount || "0");
    const prevAmount = tokenSide === 'amount0' 
      ? parseFloat(increaseAmount0 || "0")
      : parseFloat(increaseAmount1 || "0");
    
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
      setIncreaseAmount0(finalAmount);
    } else {
      setIncreaseAmount1(finalAmount);
    }
    
    return finalAmount;
  }, [isExistingPosition, positionToModify, token0BalanceData, token1BalanceData, increaseAmount0, increaseAmount1]);


  // Reset form when modal closes
  const resetForm = () => {
    if (!isExistingPosition) {
      setToken0Symbol('');
      setToken1Symbol('');
      setAmount0("");
      setAmount1("");
      setTickLower(sdkMinTick.toString());
      setTickUpper(sdkMaxTick.toString());
      setActiveInputSide(null);
      setCalculatedData(null);
    } else {
      setIncreaseAmount0("");
      setIncreaseAmount1("");
      setIncreaseActiveInputSide(null);
      setIncreasePercentage(0);
    }
    setTokenChooserOpen(null);
    setTokenSearchTerm('');
    resetTransactionState();
  };

  // Filter tokens for the chooser
  const filteredTokens = availableTokens.filter(token => {
    if (!tokenSearchTerm) return true;
    const search = tokenSearchTerm.toLowerCase();
    return (
      token.symbol.toLowerCase().includes(search) ||
      token.name.toLowerCase().includes(search) ||
      token.address.toLowerCase().includes(search)
    );
  });

  const handleTokenSelect = (token: TokenSelectorToken) => {
    if (tokenChooserOpen === 'token0') {
      handleToken0Select(token);
    } else {
      handleToken1Select(token);
    }
    setTokenChooserOpen(null);
    setTokenSearchTerm('');
  };


  return (
    <Dialog open={isOpen} onOpenChange={(open) => { 
        onOpenChange(open); 
        if (!open) {
            resetForm();
        }
    }}>
      <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-lg shadow-lg [&>button]:hidden" style={{ backgroundColor: 'var(--modal-background)' }}>
        <div className="space-y-4">
        {isExistingPosition ? (
          // Existing Position Mode (from portfolio page)
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Current Position</span>
              <div className="flex items-center gap-2">
                {positionToModify.isInRange ? (
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
                  <Image src={getTokenIcon(positionToModify.token0.symbol)} alt={positionToModify.token0.symbol} width={20} height={20} className="rounded-full" />
                  <span className="text-sm font-medium">{positionToModify.token0.symbol}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">{formatTokenDisplayAmount(positionToModify.token0.amount)}</span>
                  {feesForIncrease?.amount0 && (
                    <TooltipProvider delayDuration={0}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span 
                            className="text-[10px] text-muted-foreground cursor-default"
                          >
                            <span className="select-none">
                              {(() => {
                                // Convert from raw units to display units
                                const token0Symbol = getTokenSymbolByAddress(positionToModify.token0.address);
                                const token0Decimals = token0Symbol ? TOKEN_DEFINITIONS[token0Symbol]?.decimals || 18 : 18;
                                const feeAmountDisplay = parseFloat(formatUnits(BigInt(feesForIncrease?.amount0 || '0'), token0Decimals));
                                const usdPrice = getUSDPriceForSymbol(positionToModify.token0.symbol);
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
                          Fees Compounded on Addition
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Image src={getTokenIcon(positionToModify.token1.symbol)} alt={positionToModify.token1.symbol} width={20} height={20} className="rounded-full" />
                  <span className="text-sm font-medium">{positionToModify.token1.symbol}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">{formatTokenDisplayAmount(positionToModify.token1.amount)}</span>
                  {feesForIncrease?.amount1 && (
                    <TooltipProvider delayDuration={0}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span 
                            className="text-[10px] text-muted-foreground cursor-default"
                          >
                            <span className="select-none">
                              {(() => {
                                // Convert from raw units to display units
                                const token1Symbol = getTokenSymbolByAddress(positionToModify.token1.address);
                                const token1Decimals = token1Symbol ? TOKEN_DEFINITIONS[token1Symbol]?.decimals || 18 : 18;
                                const feeAmountDisplay = parseFloat(formatUnits(BigInt(feesForIncrease?.amount1 || '0'), token1Decimals));
                                const usdPrice = getUSDPriceForSymbol(positionToModify.token1.symbol);
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
                          Fees Compounded on Addition
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
            </div>

            {/* Amount Inputs */}
            <div className="space-y-3 mt-6">
              {positionToModify.isInRange ? (
                <>
                  {/* In-range: Both token inputs */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="increase-amount0" className="text-sm font-medium">Add</Label>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => handleUseFullBalance(token0BalanceData?.formatted || "0", positionToModify.token0.symbol as TokenSymbol, true)}
                        disabled={isIncreasingLiquidity}
                      >
                        Balance: {displayToken0Balance} {positionToModify.token0.symbol}
                      </button>
                    </div>
                    <motion.div 
                      className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4"
                      animate={wiggleControls0}
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                          <Image src={getTokenIcon(positionToModify.token0.symbol)} alt={positionToModify.token0.symbol} width={20} height={20} className="rounded-full" />
                          <span className="text-sm font-medium">{positionToModify.token0.symbol}</span>
                        </div>
                        <div className="flex-1">
                          <Input
                            id="increase-amount0"
                            placeholder="0.0"
                            value={increaseAmount0}
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                            inputMode="decimal"
                            enterKeyHint="done"
                            onChange={(e) => {
                              const cappedAmount = handleIncreaseAmountChangeWithWiggle(e, 'amount0');
                              setIncreaseActiveInputSide('amount0');
                              if (cappedAmount && parseFloat(cappedAmount) > 0) {
                                calculateIncreaseAmount(cappedAmount, 'amount0');
                              } else {
                                setIncreaseAmount1("");
                              }
                            }}
                            disabled={isIncreasingLiquidity}
                            className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                          />
                          <div className="text-right text-xs text-muted-foreground">
                            {(() => {
                              const usdPrice = getUSDPriceForSymbol(positionToModify.token0.symbol);
                              const numeric = parseFloat(increaseAmount0 || "0");
                              return formatCalculatedAmount(numeric * usdPrice);
                            })()}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </div>

                  <div className="flex justify-center items-center my-2">
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
                      <PlusIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="increase-amount1" className="text-sm font-medium">Add</Label>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => handleUseFullBalance(token1BalanceData?.formatted || "0", positionToModify.token1.symbol as TokenSymbol, false)}
                        disabled={isIncreasingLiquidity}
                      >
                        Balance: {displayToken1Balance} {positionToModify.token1.symbol}
                      </button>
                    </div>
                    <motion.div 
                      className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4"
                      animate={wiggleControls1}
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                          <Image src={getTokenIcon(positionToModify.token1.symbol)} alt={positionToModify.token1.symbol} width={20} height={20} className="rounded-full" />
                          <span className="text-sm font-medium">{positionToModify.token1.symbol}</span>
                        </div>
                        <div className="flex-1">
                          <Input
                            id="increase-amount1"
                            placeholder="0.0"
                            value={increaseAmount1}
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck={false}
                            inputMode="decimal"
                            enterKeyHint="done"
                            onChange={(e) => {
                              const cappedAmount = handleIncreaseAmountChangeWithWiggle(e, 'amount1');
                              setIncreaseActiveInputSide('amount1');
                              if (cappedAmount && parseFloat(cappedAmount) > 0) {
                                calculateIncreaseAmount(cappedAmount, 'amount1');
                              } else {
                                setIncreaseAmount0("");
                              }
                            }}
                            disabled={isIncreasingLiquidity}
                            className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                          />
                          <div className="text-right text-xs text-muted-foreground">
                            {(() => {
                              const usdPrice = getUSDPriceForSymbol(positionToModify.token1.symbol);
                              const numeric = parseFloat(increaseAmount1 || "0");
                              return formatCalculatedAmount(numeric * usdPrice);
                            })()}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </div>
                </>
              ) : (
                <>
                  {/* Out-of-range: Single-sided inputs based on available liquidity */}
                  {(!increaseProductiveSide || increaseProductiveSide === 'amount0') && parseFloat(positionToModify.token0.amount) >= 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label htmlFor="increase-amount0-oor" className="text-sm font-medium">
                          Add {positionToModify.token0.symbol}
                        </Label>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => handleUseFullBalance(token0BalanceData?.formatted || "0", positionToModify.token0.symbol as TokenSymbol, true)}
                          disabled={isIncreasingLiquidity}
                        >
                          Balance: {displayToken0Balance} {positionToModify.token0.symbol}
                        </button>
                      </div>
                      <motion.div 
                        className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4"
                        animate={wiggleControls0}
                      >
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                            <Image src={getTokenIcon(positionToModify.token0.symbol)} alt={positionToModify.token0.symbol} width={20} height={20} className="rounded-full" />
                            <span className="text-sm font-medium">{positionToModify.token0.symbol}</span>
                          </div>
                          <div className="flex-1">
                            <Input
                              id="increase-amount0-oor"
                              placeholder="0.0"
                              value={increaseAmount0}
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                              inputMode="decimal"
                              enterKeyHint="done"
                              onChange={(e) => {
                                const cappedAmount = handleIncreaseAmountChangeWithWiggle(e, 'amount0');
                                setIncreaseActiveInputSide('amount0');
                                // No calculation needed for OOR positions
                              }}
                              disabled={isIncreasingLiquidity}
                              className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                            />
                            <div className="text-right text-xs text-muted-foreground">
                              {(() => {
                                const usdPrice = getUSDPriceForSymbol(positionToModify.token0.symbol);
                                const numeric = parseFloat(increaseAmount0 || "0");
                                return formatCalculatedAmount(numeric * usdPrice);
                              })()}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  )}

                  {(!increaseProductiveSide || increaseProductiveSide === 'amount1') && parseFloat(positionToModify.token1.amount) >= 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label htmlFor="increase-amount1-oor" className="text-sm font-medium">
                          Add {positionToModify.token1.symbol}
                        </Label>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => handleUseFullBalance(token1BalanceData?.formatted || "0", positionToModify.token1.symbol as TokenSymbol, false)}
                          disabled={isIncreasingLiquidity}
                        >
                          Balance: {displayToken1Balance} {positionToModify.token1.symbol}
                        </button>
                      </div>
                      <motion.div 
                        className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4"
                        animate={wiggleControls1}
                      >
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                            <Image src={getTokenIcon(positionToModify.token1.symbol)} alt={positionToModify.token1.symbol} width={20} height={20} className="rounded-full" />
                            <span className="text-sm font-medium">{positionToModify.token1.symbol}</span>
                          </div>
                          <div className="flex-1">
                            <Input
                              id="increase-amount1-oor"
                              placeholder="0.0"
                              value={increaseAmount1}
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                              inputMode="decimal"
                              enterKeyHint="done"
                              onChange={(e) => {
                                const cappedAmount = handleIncreaseAmountChangeWithWiggle(e, 'amount1');
                                setIncreaseActiveInputSide('amount1');
                                // No calculation needed for OOR positions
                              }}
                              disabled={isIncreasingLiquidity}
                              className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                            />
                            <div className="text-right text-xs text-muted-foreground">
                              {(() => {
                                const usdPrice = getUSDPriceForSymbol(positionToModify.token1.symbol);
                                const numeric = parseFloat(increaseAmount1 || "0");
                                return formatCalculatedAmount(numeric * usdPrice);
                              })()}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          // New Position Mode (simplified version)
          <div className="space-y-4">
            <div className="text-center text-muted-foreground text-sm">
              Select tokens and amounts to add liquidity
            </div>
            
            {/* Token Selection */}
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">Token 0</Label>
                <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                  <div className="flex items-center gap-2">
                    <div 
                      className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2 cursor-pointer" 
                      onClick={() => setTokenChooserOpen('token0')}
                    >
                      {token0Symbol ? (
                        <Image src={getTokenIcon(token0Symbol)} alt={token0Symbol} width={20} height={20} className="rounded-full"/>
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-muted-foreground/30"></div>
                      )}
                      <span className="text-sm font-medium">{token0Symbol || "Select"}</span>
                      <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <Input
                        placeholder="0.0"
                        value={amount0}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        inputMode="decimal"
                        enterKeyHint="done"
                        onChange={(e) => {
                          setAmount0(e.target.value);
                          setActiveInputSide('amount0');
                        }}
                        disabled={isWorking || isCalculating}
                        className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center items-center">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
                  <PlusIcon className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium">Token 1</Label>
                <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                  <div className="flex items-center gap-2">
                    <div 
                      className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2 cursor-pointer" 
                      onClick={() => setTokenChooserOpen('token1')}
                    >
                      {token1Symbol ? (
                        <Image src={getTokenIcon(token1Symbol)} alt={token1Symbol} width={20} height={20} className="rounded-full"/>
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-muted-foreground/30"></div>
                      )}
                      <span className="text-sm font-medium">{token1Symbol || "Select"}</span>
                      <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <Input
                        placeholder="0.0"
                        value={amount1}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        inputMode="decimal"
                        enterKeyHint="done"
                        onChange={(e) => {
                          setAmount1(e.target.value);
                          setActiveInputSide('amount1');
                        }}
                        disabled={isWorking || isCalculating}
                        className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>

        {/* Token Chooser */}
        <AnimatePresence>
          {tokenChooserOpen && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-background border border-border rounded-lg p-4 w-full max-w-md max-h-96 overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium">Select Token</h3>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setTokenChooserOpen(null)}
                  >
                    <XIcon className="h-4 w-4" />
                  </Button>
                </div>
                
                <div className="mb-4">
                  <div className="relative">
                    <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search tokens..."
                      value={tokenSearchTerm}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      onChange={(e) => setTokenSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="overflow-y-auto max-h-64">
                  {filteredTokens.map((token) => (
                    <button
                      key={token.address}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left rounded-lg"
                      onClick={() => handleTokenSelect(token)}
                    >
                      <Image
                        src={token.icon} 
                        alt={token.symbol} 
                        width={28} 
                        height={28} 
                        className="rounded-full"
                      />
                      <div className="flex-1">
                        <div className="font-medium">{token.symbol}</div>
                        <div className="text-sm text-muted-foreground">{token.name}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </AnimatePresence>

        <DialogFooter className="grid grid-cols-2 gap-3">
          <Button 
            variant="outline" 
            className="relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50" 
            onClick={() => onOpenChange(false)} 
            disabled={isWorking || isIncreasingLiquidity}
            style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            Cancel
          </Button>

          {isExistingPosition ? (
            <Button
              className="text-sidebar-primary border border-sidebar-primary bg-[#3d271b] hover:bg-[#3d271b]/90"
              onClick={handleConfirmIncrease}
              disabled={isIncreasingLiquidity || isIncreaseCalculating || ((!increaseAmount0 || parseFloat(increaseAmount0) <= 0) && (!increaseAmount1 || parseFloat(increaseAmount1) <= 0))}
            >
              <span className={isIncreasingLiquidity ? "animate-pulse" : ""}>
                Add Liquidity
              </span>
            </Button>
          ) : (
            <Button
              className={isWorking ? "relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75" : "text-sidebar-primary border border-sidebar-primary bg-[#3d271b] hover:bg-[#3d271b]/90"}
              onClick={() => {
                if (step === 'input') handlePrepareMint();
                else if (step === 'approve') handleApprove();
                else if (step === 'permit2Sign') handleSignAndSubmitPermit2();
                else if (step === 'mint') handleMint();
              }}
              disabled={isWorking || isCalculating || !token0Symbol || !token1Symbol || (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0"))}
              style={isWorking ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
            >
              {isWorking ? 'Processing...' : 'Add Liquidity'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
