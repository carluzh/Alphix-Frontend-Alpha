"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PlusIcon, RefreshCwIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, SearchIcon, XIcon, OctagonX, ActivityIcon, MinusIcon, CircleCheck, Info as InfoIcon, BadgeCheck } from "lucide-react"; // Updated imports
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
import { useAccount, useBalance, useSignTypedData, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { usePercentageInput } from "@/hooks/usePercentageInput";
import { TOKEN_DEFINITIONS, TokenSymbol, getToken, getAllTokens, getPoolById } from "@/lib/pools-config";
import { useAddLiquidityTransaction } from "./useAddLiquidityTransaction";
import { useIncreaseLiquidity, type IncreasePositionData } from "./useIncreaseLiquidity";
import { TokenSelectorToken } from "../swap/TokenSelector";
import { AnimatePresence, motion, useAnimation } from "framer-motion";
import { readContract, getBalance } from '@wagmi/core';
import { erc20Abi } from 'viem';
import { config } from '@/lib/wagmiConfig';
import { CHAIN_ID } from "@/lib/pools-config";
import { formatUnits as viemFormatUnits, parseUnits as viemParseUnits, getAddress } from "viem";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";
import { useAllPrices } from "@/components/data/hooks";
import { formatUSD } from "@/lib/format";
import { sanitizeDecimalInput, debounce, getTokenSymbolByAddress, formatUncollectedFee, cn } from "@/lib/utils";
import { formatUnits } from "viem";
import { preparePermit2BatchForNewPosition } from '@/lib/liquidity-utils';
import { providePreSignedIncreaseBatchPermit } from './useIncreaseLiquidity';

// Utility functions
const formatTokenDisplayAmount = (amount: string) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0";
  if (num > 0 && num < 0.000001) return "< 0.000001";
  return num.toFixed(6);
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
  isIncreaseSuccess?: boolean;
  increaseTxHash?: `0x${string}`;
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
  isIncreasingLiquidity: parentIsIncreasingLiquidity,
  isIncreaseSuccess: parentIsIncreaseSuccess,
  increaseTxHash: parentIncreaseTxHash
}: AddLiquidityModalProps) {
  const { address: accountAddress, chainId, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { data: incApproveHash, writeContractAsync: approveERC20Async, reset: resetIncreaseApprove } = useWriteContract();
  const { isLoading: isIncreaseApproving, isSuccess: isIncreaseApproved } = useWaitForTransactionReceipt({ hash: incApproveHash });
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
  
  // State for showing "You Will Receive" section
  const [showYouWillReceive, setShowYouWillReceive] = useState(false);
  
  // State for showing transaction overview
  const [showTransactionOverview, setShowTransactionOverview] = useState(false);
  
  // State for showing success view
  const [showSuccessView, setShowSuccessView] = useState(false);
  
  // State for tracking allowances
  const [hasToken0Allowance, setHasToken0Allowance] = useState<boolean | null>(null);
  const [hasToken1Allowance, setHasToken1Allowance] = useState<boolean | null>(null);
  
  // Track the transaction hash when we actually start the transaction in this session
  const [currentSessionTxHash, setCurrentSessionTxHash] = useState<string | null>(null);
  
  // Track batch permit signing for existing positions (mimic new position flow)
  const [increaseBatchPermitSigned, setIncreaseBatchPermitSigned] = useState(false);
  const [signedBatchPermit, setSignedBatchPermit] = useState<null | { owner: `0x${string}`; permitBatch: any; signature: string }>(null);

  // Wiggle animation for insufficient approvals
  const [approvalWiggleCount, setApprovalWiggleCount] = useState(0);
  const approvalWiggleControls = useAnimation();

  // Determine if we should use internal hook or parent hook (moved up before useEffect)
  const shouldUseInternalHook = !parentIncreaseLiquidity;

  // State for tracking increase liquidity transaction flow (like useAddLiquidityTransaction)
  const [increaseStep, setIncreaseStep] = useState<'input' | 'approve' | 'permit' | 'deposit'>('input');
  const [increasePreparedTxData, setIncreasePreparedTxData] = useState<any>(null);
  const [increaseNeedsERC20Approvals, setIncreaseNeedsERC20Approvals] = useState<TokenSymbol[]>([]);
  const [increaseIsWorking, setIncreaseIsWorking] = useState(false);

  // Reset transaction state when modal opens
  useEffect(() => {
    if (isOpen) {
      console.log('[DEBUG] Modal opened, resetting all states');
      setTxStarted(false);
      setWasIncreasingLiquidity(false);
      setHasToken0Allowance(null);
      setHasToken1Allowance(null);
      setCurrentSessionTxHash(null);
      setIncreaseBatchPermitSigned(false);
      setSignedBatchPermit(null);
      // Reset increase transaction flow states
      setIncreaseStep('input');
      setIncreasePreparedTxData(null);
      setIncreaseNeedsERC20Approvals([]);
      setIncreaseIsWorking(false);
      // Hard reset per-open to prevent reusing previous flow state
      setShowYouWillReceive(false);
      setShowTransactionOverview(false);
      setShowSuccessView(false);
      if (isExistingPosition) {
        setIncreaseAmount0("");
        setIncreaseAmount1("");
        setIncreaseActiveInputSide(null);
        setIncreasePercentage(0);
      } else {
        setAmount0("");
        setAmount1("");
        setActiveInputSide(null);
      }
      
      // Force reset of parent transaction states if using parent hook
      if (!shouldUseInternalHook) {
        console.log('[DEBUG] Using parent hook, forcing parent state reset');
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
      if (isExistingPosition) {
        setIncreaseAmount0("");
        setIncreaseAmount1("");
        setIncreaseActiveInputSide(null);
        setIncreasePercentage(0);
      } else {
        setAmount0("");
        setAmount1("");
        setActiveInputSide(null);
      }
      
      // Reset animation states
      setBalanceWiggleCount0(0);
      setBalanceWiggleCount1(0);
      
      // Reset transaction tracking
      setTxStarted(false);
      setWasIncreasingLiquidity(false);
      setCurrentSessionTxHash(null);
      setIncreaseBatchPermitSigned(false);
      
      // Reset allowance states
      setHasToken0Allowance(null);
      setHasToken1Allowance(null);
    }
  }, [isOpen, isExistingPosition]);
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
    token: TOKEN_DEFINITIONS[balanceToken0Symbol]?.address === "0x0000000000000000000000000000000000000000" 
      ? undefined 
      : TOKEN_DEFINITIONS[balanceToken0Symbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[balanceToken0Symbol] },
  });

  const { data: token1BalanceData, isLoading: isLoadingToken1Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[balanceToken1Symbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : TOKEN_DEFINITIONS[balanceToken1Symbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[balanceToken1Symbol] },
  });

  // Percentage input handlers using the new shared hook
  const handleToken0Percentage = usePercentageInput(
    token0BalanceData,
    { decimals: TOKEN_DEFINITIONS[balanceToken0Symbol]?.decimals || 18, symbol: balanceToken0Symbol },
    isExistingPosition ? setIncreaseAmount0 : setAmount0
  );

  const handleToken1Percentage = usePercentageInput(
    token1BalanceData,
    { decimals: TOKEN_DEFINITIONS[balanceToken1Symbol]?.decimals || 18, symbol: balanceToken1Symbol },
    isExistingPosition ? setIncreaseAmount1 : setAmount1
  );

  // Transaction hooks
  const {
    isWorking,
    step,
    preparedTxData,
    involvedTokensCount,
    completedERC20ApprovalsCount,
    needsERC20Approvals,
    batchPermitSigned,
    isApproveWritePending,
    isApproving,
    isMintSendPending,
    isMintConfirming,
    isMintSuccess,
    handlePrepareMint,
    handleApprove,
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
    onApprovalInsufficient: () => {
      setApprovalWiggleCount(prev => prev + 1);
    },
    onOpenChange,
  });

  // Always call the hook to maintain hook order, but disable callback when parent exists
  
  const internalHookResult = useIncreaseLiquidity({
    onLiquidityIncreased: (info) => {
      console.log('[DEBUG] Modal internal hook callback fired, shouldUseInternal:', shouldUseInternalHook, 'txHash:', info?.txHash?.slice(0, 10) + '...');
      // Don't set success view here - let the useEffect handle it based on confirmed state
      // This prevents premature success view before transaction confirmation
    },
  });
  
  // Use parent hook if provided, otherwise use internal hook
  const increaseLiquidity = shouldUseInternalHook ? internalHookResult.increaseLiquidity : parentIncreaseLiquidity!;
  const isIncreasingLiquidity = shouldUseInternalHook ? internalHookResult.isLoading : parentIsIncreasingLiquidity ?? false;
  const txHash = shouldUseInternalHook ? internalHookResult.hash : parentIncreaseTxHash;
  const isTransactionSuccess = shouldUseInternalHook ? internalHookResult.isSuccess : parentIsIncreaseSuccess ?? false;

  // Check what ERC20 approvals are needed for increase liquidity (similar to form)
  const checkIncreaseApprovals = useCallback(async (): Promise<TokenSymbol[]> => {
    if (!accountAddress || !chainId || !positionToModify) return [];

    const needsApproval: TokenSymbol[] = [];
    const tokens = [
      { symbol: positionToModify.token0.symbol as TokenSymbol, amount: increaseAmount0 },
      { symbol: positionToModify.token1.symbol as TokenSymbol, amount: increaseAmount1 }
    ];

    for (const token of tokens) {
      if (!token.amount || parseFloat(token.amount) <= 0) continue;
      
      const tokenDef = TOKEN_DEFINITIONS[token.symbol];
      if (!tokenDef || tokenDef.address === "0x0000000000000000000000000000000000000000") continue;

      try {
        // Check ERC20 allowance to Permit2 (same logic as form)
        const allowance = await readContract(config, {
          address: tokenDef.address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [accountAddress, "0x000000000022D473030F116dDEE9F6B43aC78BA3"] // PERMIT2_ADDRESS
        });

        const requiredAmount = viemParseUnits(token.amount, tokenDef.decimals);
        if (allowance < requiredAmount) {
          needsApproval.push(token.symbol);
        }
      } catch (error) {
        console.error(`Error checking allowance for ${token.symbol}:`, error);
      }
    }

    return needsApproval;
  }, [accountAddress, chainId, positionToModify, increaseAmount0, increaseAmount1]);
  
  const handleConfirmIncrease = () => {
    if (!positionToModify) {
      toast.error('Missing Position', { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: 'No position selected for modification.' });
      return;
    }
    
    const amount0Num = parseFloat(increaseAmount0 || "0");
    const amount1Num = parseFloat(increaseAmount1 || "0");
    
    if (amount0Num <= 0 && amount1Num <= 0) {
      toast.error('Missing Amount', { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }), description: 'Please enter at least one amount to add.' });
      return;
    }
    
    // Show "You Will Receive" section first
    setShowYouWillReceive(true);
  };

  const handleFinalConfirmIncrease = () => {
    if (!positionToModify) return;
    
    // Show transaction overview first
    setShowTransactionOverview(true);
    // Don't call handlePrepareMint here as it's for new positions, not increases
  };

  const [txStarted, setTxStarted] = useState(false);

  // Prepare increase transaction (similar to handlePrepareMint in form)
  const handlePrepareIncrease = useCallback(async () => {
    setIncreaseIsWorking(true);
    try {
      // Check what ERC20 approvals are needed
      const needsApprovals = await checkIncreaseApprovals();
      setIncreaseNeedsERC20Approvals(needsApprovals);
      
      if (needsApprovals.length > 0) {
        setIncreaseStep('approve');
        setIncreasePreparedTxData({
          needsApproval: true,
          approvalType: 'ERC20_TO_PERMIT2',
          approvalTokenSymbol: needsApprovals[0], // Show first token needing approval
          approvalTokenAddress: TOKEN_DEFINITIONS[needsApprovals[0]]?.address,
          approvalAmount: "115792089237316195423570985008687907853269984665640564039457584007913129639935", // max uint256
          approveToAddress: "0x000000000022D473030F116dDEE9F6B43aC78BA3", // PERMIT2_ADDRESS
        });
      } else {
        setIncreaseStep('permit');
        setIncreasePreparedTxData({ needsApproval: false });
      }
    } catch (error: any) {
      console.error('Prepare increase error:', error);
      toast.error("Preparation Error", { description: error.message || "Failed to prepare transaction", icon: <OctagonX className="h-4 w-4 text-red-500" /> });
    } finally {
      setIncreaseIsWorking(false);
    }
  }, [checkIncreaseApprovals]);

  // Handle ERC20 approvals for increase (similar to form)
  const handleIncreaseApprove = useCallback(async () => {
    if (!increasePreparedTxData?.needsApproval || increasePreparedTxData.approvalType !== 'ERC20_TO_PERMIT2') return;

    setIncreaseIsWorking(true);

    try {
      const tokenAddress = increasePreparedTxData.approvalTokenAddress as `0x${string}` | undefined;
      if (!tokenAddress) throw new Error('Missing token address for approval');
      
      // Show default toast
      toast("Confirm in Wallet", {
        icon: <InfoIcon className="h-4 w-4" />
      });
      
      await approveERC20Async({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: ["0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`, BigInt(increasePreparedTxData.approvalAmount || '0')],
      });
      // Wait for receipt via hook; state advance handled in effect below
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to approve token.";
      toast.error("Approval Error", {
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description: errorMessage,
        action: {
          label: "Copy Error",
          onClick: () => navigator.clipboard.writeText(errorMessage)
        }
      });
      setIncreaseIsWorking(false);
      resetIncreaseApprove();
    }
  }, [increasePreparedTxData, approveERC20Async, resetIncreaseApprove]);

  // Advance approval step when tx confirms
  useEffect(() => {
    if (!isIncreaseApproved || !increasePreparedTxData) return;
    
    // Re-check actual allowances after each approval transaction
    const recheckAllowances = async () => {
      try {
        // Wait a bit for the blockchain state to update
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log(`[Modal Approval Check] Re-checking actual allowances after ${increasePreparedTxData.approvalTokenSymbol} approval`);
        
        // Check actual allowances vs required amounts for both tokens
        const stillNeedsApprovals: TokenSymbol[] = [];
        const tokens = [
          { symbol: positionToModify?.token0.symbol as TokenSymbol, amount: increaseAmount0 },
          { symbol: positionToModify?.token1.symbol as TokenSymbol, amount: increaseAmount1 }
        ];

        for (const token of tokens) {
          if (!token.amount || parseFloat(token.amount) <= 0) continue;
          
          const tokenDef = TOKEN_DEFINITIONS[token.symbol];
          if (!tokenDef || !accountAddress) continue;

          try {
            const allowance = await readContract(config, {
              address: tokenDef.address as `0x${string}`,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [accountAddress, "0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`],
              blockTag: 'latest'
            });

            const requiredAmount = viemParseUnits(token.amount, tokenDef.decimals);
            
            if (allowance < requiredAmount) {
              stillNeedsApprovals.push(token.symbol);
            }
          } catch (error) {
            console.error(`Error checking allowance for ${token.symbol}:`, error);
            stillNeedsApprovals.push(token.symbol); // Be safe, assume needs approval
          }
        }
        
        console.log(`[Modal Approval Check] Tokens still needing approval:`, stillNeedsApprovals);
        
        if (stillNeedsApprovals.length > 0) {
          // Still need approvals - trigger wiggle if this token still needs approval
          if (stillNeedsApprovals.includes(increasePreparedTxData.approvalTokenSymbol as TokenSymbol)) {
            setApprovalWiggleCount(prev => prev + 1);
            toast.error("Insufficient Approval", { 
              icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" })
            });
          } else {
            toast.success(`${increasePreparedTxData.approvalTokenSymbol} Approved`, { 
              icon: React.createElement(BadgeCheck, { className: "h-4 w-4 text-green-500" })
            });
          }
          
          // Update the needs approval list and set up next approval with exact amount needed
          setIncreaseNeedsERC20Approvals(stillNeedsApprovals);
          
          // Calculate exact amount needed for the first token that needs approval
          const nextTokenSymbol = stillNeedsApprovals[0];
          const nextTokenDef = TOKEN_DEFINITIONS[nextTokenSymbol];
          const nextTokenAmount = nextTokenSymbol === positionToModify?.token0.symbol ? increaseAmount0 : increaseAmount1;
          const exactAmountNeeded = viemParseUnits(nextTokenAmount || '0', nextTokenDef.decimals);
          
          // Round up by 1 smallest decimal unit
          const buffer = BigInt(Math.pow(10, Math.max(0, nextTokenDef.decimals - 6))); // 1 micro-unit
          const roundedUpAmount = exactAmountNeeded + buffer;
          
          setIncreasePreparedTxData({
            needsApproval: true,
            approvalType: 'ERC20_TO_PERMIT2',
            approvalTokenSymbol: nextTokenSymbol,
            approvalTokenAddress: nextTokenDef.address,
            approvalAmount: roundedUpAmount.toString(),
            approveToAddress: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
          });
          setIncreaseStep('approve');
        } else {
          // All approvals done
          console.log(`[Modal Approval Check] ✅ All approvals complete!`);
          toast.success(`${increasePreparedTxData.approvalTokenSymbol} Approved`, { 
            icon: React.createElement(BadgeCheck, { className: "h-4 w-4 text-green-500" })
          });
          setIncreaseNeedsERC20Approvals([]);
          setIncreasePreparedTxData({ needsApproval: false });
          setIncreaseStep('permit');
        }
        
        setIncreaseIsWorking(false);
        resetIncreaseApprove();
      } catch (error) {
        console.error('Error re-checking allowances:', error);
        toast.error("Approval Check Failed", { 
          icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" })
        });
        setIncreaseIsWorking(false);
        resetIncreaseApprove();
      }
    };

    recheckAllowances();
  }, [isIncreaseApproved, increasePreparedTxData, accountAddress, positionToModify, increaseAmount0, increaseAmount1, resetIncreaseApprove]);

  // Handle permit signature (separate step like in form)
  const handleIncreasePermit = useCallback(async () => {
    if (!positionToModify || !accountAddress || !chainId) return;
    // Idempotency: if already signed or not in permit step, skip
    if (increaseBatchPermitSigned || increaseStep !== 'permit') return;
    setIncreaseIsWorking(true);
    try {
      // Derive NFT tokenId from composite position id (last part expected to be hex salt)
      const compositeId = positionToModify.positionId?.toString?.() || '';
      let tokenIdHex = compositeId.includes('-') ? compositeId.split('-').pop() || '' : compositeId;
      if (!tokenIdHex) throw new Error('Unable to derive position tokenId');
      
      console.log('[modal] TokenId extraction:', {
        compositeId,
        tokenIdHex,
        hasDash: compositeId.includes('-'),
        parts: compositeId.split('-')
      });
      
      // Ensure proper hex prefix
      if (!tokenIdHex.startsWith('0x')) tokenIdHex = `0x${tokenIdHex}`;
      let nftTokenId: bigint;
      try {
        nftTokenId = BigInt(tokenIdHex);
        console.log('[modal] Parsed tokenId:', nftTokenId.toString());
      } catch {
        throw new Error('Invalid position tokenId format');
      }

      const deadline = Math.floor(Date.now() / 1000) + (20 * 60);
      const prepared = await preparePermit2BatchForNewPosition(
        positionToModify.token0.symbol,
        positionToModify.token1.symbol,
        accountAddress as `0x${string}`,
        chainId,
        deadline
      );

      if (!prepared?.message?.details || prepared.message.details.length === 0) {
        // No batch permit required. Consider the step satisfied.
        setIncreaseBatchPermitSigned(true);
        setIncreaseStep('deposit');
        setIncreaseIsWorking(false);
        return;
      }

      // Show default toast before signing
      toast("Sign in Wallet", {
        icon: <InfoIcon className="h-4 w-4" />
      });

      const signature = await signTypedDataAsync({
        domain: prepared.domain as any,
        types: prepared.types as any,
        primaryType: prepared.primaryType,
        message: prepared.message as any,
      });

      // Provide pre-signed batch permit to the increase hook via in-memory store
      const payload = { owner: accountAddress as `0x${string}`, permitBatch: prepared.message, signature };
      providePreSignedIncreaseBatchPermit(positionToModify.positionId, payload);
      setSignedBatchPermit(payload);

      // Show success toast with rounded duration
      const durationSeconds = deadline - Math.floor(Date.now() / 1000);
      let durationFormatted = 'next 20 minutes';
      if (durationSeconds > 0) {
        const minutes = Math.ceil(durationSeconds / 60);
        const hours = Math.ceil(minutes / 60);
        if (hours >= 1) {
          durationFormatted = `${hours} hour${hours > 1 ? 's' : ''}`;
        } else {
          durationFormatted = `${minutes} minute${minutes > 1 ? 's' : ''}`;
        }
      }
      toast.success("Batch Signature Complete", {
        icon: <BadgeCheck className="h-4 w-4 text-green-500" />,
        description: `Batch permit signed successfully for ${durationFormatted}`
      });

      setIncreaseBatchPermitSigned(true);
      setIncreaseStep('deposit');
    } catch (error: any) {
      const description = (error?.message || '').includes('User rejected') ? 'Permit signature was rejected.' : (error?.message || 'Failed to sign permit');
      toast.error('Permit Error', { 
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description 
      });
    } finally {
      setIncreaseIsWorking(false);
    }
  }, [positionToModify, accountAddress, chainId, signTypedDataAsync, increaseBatchPermitSigned, increaseStep]);

  // Handle final deposit transaction
  const handleExecuteTransaction = async () => {
    if (!positionToModify) return;
    
    console.log('[DEBUG] Modal: handleExecuteTransaction called, step:', increaseStep, 'shouldUseInternalHook:', shouldUseInternalHook);
    
    if (increaseStep === 'input') {
      // Step 1: Prepare transaction
      await handlePrepareIncrease();
    } else if (increaseStep === 'approve') {
      // Step 2: Handle approvals
      await handleIncreaseApprove();
    } else if (increaseStep === 'permit') {
      // Step 3: Handle permit signature
      await handleIncreasePermit();
    } else if (increaseStep === 'deposit') {
      // Step 4: Execute final transaction - just call the hook directly like the form does
      const data: IncreasePositionData = {
        tokenId: positionToModify.positionId,
        token0Symbol: positionToModify.token0.symbol as TokenSymbol,
        token1Symbol: positionToModify.token1.symbol as TokenSymbol,
        additionalAmount0: increaseAmount0 || '0',
        additionalAmount1: increaseAmount1 || '0',
        poolId: positionToModify.poolId,
        tickLower: positionToModify.tickLower,
        tickUpper: positionToModify.tickUpper,
        feesForIncrease: feesForIncrease,
      };

      console.log('[modal] Executing increase with data:', data);
      console.log('[modal] signedBatchPermit:', signedBatchPermit ? 'present' : 'none');

      // For internal hook usage, onLiquidityAdded will be called by the hook's callback
      // For parent hook usage, the parent page handles all the callbacks
      // Pass pre-signed batch permit to avoid re-prompting at deposit
      try {
        // @ts-ignore opts supported by hook
        increaseLiquidity(data, signedBatchPermit ? { batchPermit: signedBatchPermit } : undefined);
      } catch (e) {
        console.error('[modal] increaseLiquidity call threw before send', e);
      }
      setTxStarted(true);
    }
  };

  // Auto-prepare when entering Transaction Overview to mirror form UX
  useEffect(() => {
    if (showTransactionOverview && isExistingPosition) {
      if (increaseStep === 'input' && !increaseIsWorking) {
        handlePrepareIncrease();
      }
    }
  }, [showTransactionOverview, isExistingPosition, increaseStep, increaseIsWorking, handlePrepareIncrease]);

  // Check allowances when Transaction Overview is shown
  useEffect(() => {
    if (showTransactionOverview && positionToModify && accountAddress) {
      const checkAllowances = async () => {
        try {
          const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
          
          // Check token0 allowance
          const token0Address = positionToModify.token0.address;
          const token0Amount = parseFloat(increaseAmount0 || "0");
          
          if (token0Amount > 0 && token0Address !== "0x0000000000000000000000000000000000000000") {
            const allowance0 = await readContract(config, {
              address: token0Address as `0x${string}`,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [accountAddress, PERMIT2_ADDRESS],
            });
            
            const requiredAmount0 = viemParseUnits(increaseAmount0, TOKEN_DEFINITIONS[positionToModify.token0.symbol as TokenSymbol]?.decimals || 18);
            setHasToken0Allowance(allowance0 >= requiredAmount0);
          } else {
            setHasToken0Allowance(true); // No approval needed if amount is 0 or ETH
          }
          
          // Check token1 allowance
          const token1Address = positionToModify.token1.address;
          const token1Amount = parseFloat(increaseAmount1 || "0");
          
          if (token1Amount > 0 && token1Address !== "0x0000000000000000000000000000000000000000") {
            const allowance1 = await readContract(config, {
              address: token1Address as `0x${string}`,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [accountAddress, PERMIT2_ADDRESS],
            });
            
            const requiredAmount1 = viemParseUnits(increaseAmount1, TOKEN_DEFINITIONS[positionToModify.token1.symbol as TokenSymbol]?.decimals || 18);
            setHasToken1Allowance(allowance1 >= requiredAmount1);
          } else {
            setHasToken1Allowance(true); // No approval needed if amount is 0 or ETH
          }
        } catch (error) {
          console.error("Error checking allowances:", error);
          setHasToken0Allowance(false);
          setHasToken1Allowance(false);
        }
      };
      
      checkAllowances();
    }
  }, [showTransactionOverview, positionToModify, accountAddress, increaseAmount0, increaseAmount1]);

  // Track when transaction was actively running
  const [wasIncreasingLiquidity, setWasIncreasingLiquidity] = useState(false);
  
  // Track when liquidity increase starts
  useEffect(() => {
    if (isIncreasingLiquidity) {
      setWasIncreasingLiquidity(true);
    }
  }, [isIncreasingLiquidity]);

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
    
    console.log('[DEBUG] Success effect triggered:', {
      txHash: txHash?.slice(0, 10) + '...',
      isTransactionSuccess,
      showTransactionOverview,
      txStarted,
      currentSessionTxHash: currentSessionTxHash?.slice(0, 10) + '...',
      hashesMatch: txHash === currentSessionTxHash
    });
    
    // Only show success if we have a confirmed transaction hash that matches our current session
    if (txHash && isTransactionSuccess && showTransactionOverview && txStarted && currentSessionTxHash === txHash) {
      console.log('[DEBUG] Transaction confirmed with hash, showing success view. txHash:', txHash?.slice(0, 10) + '...');
      setShowSuccessView(true);
      
      // Call the success callback to notify parent component
      // Only call this when NOT using internal hook (i.e., for increase operations)
      // For new positions using internal hook, the useAddLiquidityTransaction handles the callback
      if (onLiquidityAdded && !shouldUseInternalHook) {
        console.log('[DEBUG] Calling onLiquidityAdded callback for increase operation');
        onLiquidityAdded();
      } else if (shouldUseInternalHook) {
        console.log('[DEBUG] Skipping modal onLiquidityAdded - internal hook will handle it');
      }
    }
  }, [txHash, isTransactionSuccess, showTransactionOverview, txStarted, currentSessionTxHash, onLiquidityAdded, shouldUseInternalHook]);

  // Reset parent success states when modal opens to prevent premature success view
  // BUT only if we don't have an active transaction in progress
  useEffect(() => {
    if (isOpen && !shouldUseInternalHook && parentIsIncreaseSuccess && !currentSessionTxHash) {
      console.log('[DEBUG] Modal opened with parent success true, resetting by clearing state variables');
      // Reset the current session tracking to prevent immediate success view
      setCurrentSessionTxHash(null);
      setShowSuccessView(false);
      setShowTransactionOverview(false);
      setShowYouWillReceive(false);
      setTxStarted(false);
      setWasIncreasingLiquidity(false);
    }
  }, [isOpen, shouldUseInternalHook, parentIsIncreaseSuccess, currentSessionTxHash]);

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

  // Approval wiggle animation effect
  useEffect(() => {
    if (approvalWiggleCount > 0) {
      approvalWiggleControls.start({
        x: [0, -3, 3, -2, 2, 0],
        transition: { duration: 0.22, ease: 'easeOut' },
      }).catch(() => {});
    }
  }, [approvalWiggleCount, approvalWiggleControls]);

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
      return numericBalance.toFixed(6);
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
          // Trigger calculation for the corresponding amount
          if (formattedBalance && parseFloat(formattedBalance) > 0) {
            calculateIncreaseAmount(formattedBalance, 'amount0');
          }
        } else {
          setIncreaseAmount1(formattedBalance);
          setIncreaseActiveInputSide('amount1');
          // Trigger calculation for the corresponding amount
          if (formattedBalance && parseFloat(formattedBalance) > 0) {
            calculateIncreaseAmount(formattedBalance, 'amount1');
          }
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
  const handleIncreaseAmountChangeWithWiggle = useCallback((e: React.ChangeEvent<HTMLInputElement>, tokenSide: 'amount0' | 'amount1') => {
    if (!isExistingPosition || !positionToModify) return;

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

    // No capping - allow input to exceed balance
    if (tokenSide === 'amount0') {
      setIncreaseAmount0(newAmount);
    } else {
      setIncreaseAmount1(newAmount);
    }
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

  // Determine button text based on current state (for new positions)
  const getButtonText = () => {
    if (step === 'approve') {
      if (isApproveWritePending || isApproving) {
        return `Approve ${preparedTxData?.approvalTokenSymbol || 'Tokens'}`;
      }
      return `Approve ${preparedTxData?.approvalTokenSymbol || 'Tokens'}`;
    } else if (step === 'mint') {
      if (!batchPermitSigned) {
        if (isMintSendPending || isWorking) {
          return 'Sign';
        }
        return 'Sign';
      } else {
        if (isMintSendPending || isMintConfirming) {
          return 'Deposit';
        }
        return 'Deposit';
      }
    } else {
      // step === 'input'
      return 'Add Liquidity';
    }
  };

  // Check if user has insufficient balance for increase
  const checkInsufficientBalanceIncrease = useCallback(() => {
    if (!positionToModify || !token0BalanceData || !token1BalanceData) return false;

    const amt0 = parseFloat(increaseAmount0 || "0");
    const amt1 = parseFloat(increaseAmount1 || "0");
    const bal0 = parseFloat(token0BalanceData.formatted || "0");
    const bal1 = parseFloat(token1BalanceData.formatted || "0");

    return (amt0 > bal0) || (amt1 > bal1);
  }, [positionToModify, increaseAmount0, increaseAmount1, token0BalanceData, token1BalanceData]);

  // Determine button text for existing positions based on transaction state (like form)
  const getIncreaseButtonText = () => {
    // Check for insufficient balance first (only when in input step)
    if (!showTransactionOverview && checkInsufficientBalanceIncrease()) {
      return 'Insufficient Balance';
    }

    if (!showTransactionOverview) {
      return 'Confirm';
    }

    if (increaseStep === 'approve') {
      if (increaseIsWorking) {
        return `Approve ${increasePreparedTxData?.approvalTokenSymbol || 'Tokens'}`;
      }
      return `Approve ${increasePreparedTxData?.approvalTokenSymbol || 'Tokens'}`;
    } else if (increaseStep === 'permit') {
      if (increaseIsWorking || isIncreasingLiquidity) {
        return 'Sign';
      }
      return 'Sign';
    } else if (increaseStep === 'deposit') {
      if (isIncreasingLiquidity) {
        return 'Deposit';
      }
      return 'Deposit';
    } else {
      // increaseStep === 'input'
      return 'Add Liquidity';
    }
  };

  // Calculate involved tokens count and completed approvals for increase (like form)
  const increaseInvolvedTokensCount = useMemo(() => {
    if (!positionToModify) return 0;
    const tokens: TokenSymbol[] = [];
    if (TOKEN_DEFINITIONS[positionToModify.token0.symbol as TokenSymbol]?.address !== "0x0000000000000000000000000000000000000000") {
      tokens.push(positionToModify.token0.symbol as TokenSymbol);
    }
    if (TOKEN_DEFINITIONS[positionToModify.token1.symbol as TokenSymbol]?.address !== "0x0000000000000000000000000000000000000000") {
      tokens.push(positionToModify.token1.symbol as TokenSymbol);
    }
    return tokens.length;
  }, [positionToModify]);

  const increaseCompletedERC20ApprovalsCount = useMemo(() => {
    return increaseInvolvedTokensCount - increaseNeedsERC20Approvals.length;
  }, [increaseInvolvedTokensCount, increaseNeedsERC20Approvals.length]);


  return (
    <Dialog open={isOpen} onOpenChange={(open) => { 
        onOpenChange(open); 
        if (!open) {
            resetForm();
        }
    }}>
      <DialogContent className="p-0 border-0 bg-transparent shadow-none max-w-lg w-[calc(100%-2rem)] sm:w-full [&>button]:hidden">
        {!showSuccessView ? (
          <div className="space-y-6">
        {isExistingPosition ? (
          <>
            {/* Addition Logic Container with Buttons */}
            <div className="border rounded-lg p-6 space-y-4" style={{ backgroundColor: 'var(--modal-background)' }}>
              {/* Amount Inputs: only show in Step 1 (showYouWillReceive === false) */}
              {!showYouWillReceive && (
              <div className="space-y-3">
              {positionToModify.isInRange ? (
                <>
                  {/* In-range: Both token inputs */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="increase-amount0" className="text-sm font-medium">Add</Label>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-0"
                        onClick={() => handleUseFullBalance(token0BalanceData?.formatted || "0", positionToModify.token0.symbol as TokenSymbol, true)}
                        disabled={isIncreasingLiquidity}
                      >
                        Balance: {displayToken0Balance} {positionToModify.token0.symbol}
                      </button>
                    </div>
                    <motion.div
                      className="group rounded-lg bg-muted/30 border border-sidebar-border/60 p-4"
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
                              handleIncreaseAmountChangeWithWiggle(e, 'amount0');
                              setIncreaseActiveInputSide('amount0');
                              const newAmount = sanitizeDecimalInput(e.target.value);
                              if (newAmount && parseFloat(newAmount) > 0) {
                                calculateIncreaseAmount(newAmount, 'amount0');
                              } else {
                                setIncreaseAmount1("");
                              }
                            }}
                            disabled={isIncreasingLiquidity}
                            className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                          />
                          <div className="relative text-right text-xs min-h-5">
                            <div className={cn("text-muted-foreground transition-opacity duration-100", {
                              "group-hover:opacity-0": isConnected && token0BalanceData && parseFloat(token0BalanceData.formatted || "0") > 0
                            })}>
                              {(() => {
                                const usdPrice = getUSDPriceForSymbol(positionToModify.token0.symbol);
                                const numeric = parseFloat(increaseAmount0 || "0");
                                return formatCalculatedAmount(numeric * usdPrice);
                              })()}
                            </div>
                            {isConnected && token0BalanceData && parseFloat(token0BalanceData.formatted || "0") > 0 && (
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
                                        handleToken0Percentage(percentage);
                                        setIncreaseActiveInputSide('amount0');
                                        // Trigger calculation with the new amount from the state (usePercentageInput already set it)
                                        setTimeout(() => {
                                          const currentAmount = isExistingPosition ? increaseAmount0 : amount0;
                                          if (currentAmount && parseFloat(currentAmount) > 0) {
                                            calculateIncreaseAmount(currentAmount, 'amount0');
                                          }
                                        }, 0);
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
                        className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-0"
                        onClick={() => handleUseFullBalance(token1BalanceData?.formatted || "0", positionToModify.token1.symbol as TokenSymbol, false)}
                        disabled={isIncreasingLiquidity}
                      >
                        Balance: {displayToken1Balance} {positionToModify.token1.symbol}
                      </button>
                    </div>
                    <motion.div
                      className="group rounded-lg bg-muted/30 border border-sidebar-border/60 p-4"
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
                              handleIncreaseAmountChangeWithWiggle(e, 'amount1');
                              setIncreaseActiveInputSide('amount1');
                              const newAmount = sanitizeDecimalInput(e.target.value);
                              if (newAmount && parseFloat(newAmount) > 0) {
                                calculateIncreaseAmount(newAmount, 'amount1');
                              } else {
                                setIncreaseAmount0("");
                              }
                            }}
                            disabled={isIncreasingLiquidity}
                            className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                          />
                          <div className="relative text-right text-xs min-h-5">
                            <div className={cn("text-muted-foreground transition-opacity duration-100", {
                              "group-hover:opacity-0": isConnected && token1BalanceData && parseFloat(token1BalanceData.formatted || "0") > 0
                            })}>
                              {(() => {
                                const usdPrice = getUSDPriceForSymbol(positionToModify.token1.symbol);
                                const numeric = parseFloat(increaseAmount1 || "0");
                                return formatCalculatedAmount(numeric * usdPrice);
                              })()}
                            </div>
                            {isConnected && token1BalanceData && parseFloat(token1BalanceData.formatted || "0") > 0 && (
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
                                        handleToken1Percentage(percentage);
                                        setIncreaseActiveInputSide('amount1');
                                        // Trigger calculation with the new amount from the state (usePercentageInput already set it)
                                        setTimeout(() => {
                                          const currentAmount = isExistingPosition ? increaseAmount1 : amount1;
                                          if (currentAmount && parseFloat(currentAmount) > 0) {
                                            calculateIncreaseAmount(currentAmount, 'amount1');
                                          }
                                        }, 0);
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
                          className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-0"
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
                          className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-0"
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
              )}
              
              {/* Step 1: Input Form */}
              {!showYouWillReceive ? (
                <>
                  {/* Buttons */}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <Button 
                      variant="outline" 
                      className="relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50" 
                      onClick={() => onOpenChange(false)} 
                      disabled={isWorking || isIncreasingLiquidity}
                      style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                    >
                      Cancel
                    </Button>

                    <Button
                      className={checkInsufficientBalanceIncrease() ?
                        "relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75" :
                        "text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
                      }
                      onClick={handleConfirmIncrease}
                      disabled={isIncreasingLiquidity || isIncreaseCalculating || (parseFloat(increaseAmount0 || "0") <= 0 && parseFloat(increaseAmount1 || "0") <= 0) || checkInsufficientBalanceIncrease()}
                      style={checkInsufficientBalanceIncrease() ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                    >
                      <span className={isIncreasingLiquidity ? "animate-pulse" : ""}>
                        {getIncreaseButtonText()}
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
                      <span className="text-sm font-medium">You Will Add</span>
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
                                    const baseAmount = parseFloat(increaseAmount0 || "0");
                                    if (!feesForIncrease) return formatTokenDisplayAmount(baseAmount.toString());
                                    
                                    const decimals = getTokenSymbolByAddress(positionToModify.token0.address) ? TOKEN_DEFINITIONS[getTokenSymbolByAddress(positionToModify.token0.address)!]?.decimals || 18 : 18;
                                    const feeAmount = parseFloat(formatUnits(BigInt(feesForIncrease.amount0 || '0'), decimals));
                                    const totalAmount = baseAmount + feeAmount;
                                    return formatTokenDisplayAmount(totalAmount.toString());
                                  })()}
                                </div>
                                <span className="text-sm text-muted-foreground">{positionToModify.token0.symbol}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {(() => {
                                  const baseAmount = parseFloat(increaseAmount0 || "0");
                                  if (!feesForIncrease) return formatUSD(baseAmount * getUSDPriceForSymbol(positionToModify.token0.symbol));
                                  
                                  const decimals = getTokenSymbolByAddress(positionToModify.token0.address) ? TOKEN_DEFINITIONS[getTokenSymbolByAddress(positionToModify.token0.address)!]?.decimals || 18 : 18;
                                  const feeAmount = parseFloat(formatUnits(BigInt(feesForIncrease.amount0 || '0'), decimals));
                                  const totalAmount = baseAmount + feeAmount;
                                  return formatUSD(totalAmount * getUSDPriceForSymbol(positionToModify.token0.symbol));
                                })()}
                              </div>
                            </div>
                            <Image src={getTokenIcon(positionToModify.token0.symbol)} alt={positionToModify.token0.symbol} width={40} height={40} className="rounded-full" />
                          </div>

                          <div className="flex justify-between items-start">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <div className="text-xl font-medium">
                                  {(() => {
                                    const baseAmount = parseFloat(increaseAmount1 || "0");
                                    if (!feesForIncrease) return formatTokenDisplayAmount(baseAmount.toString());
                                    
                                    const decimals = getTokenSymbolByAddress(positionToModify.token1.address) ? TOKEN_DEFINITIONS[getTokenSymbolByAddress(positionToModify.token1.address)!]?.decimals || 18 : 18;
                                    const feeAmount = parseFloat(formatUnits(BigInt(feesForIncrease.amount1 || '0'), decimals));
                                    const totalAmount = baseAmount + feeAmount;
                                    return formatTokenDisplayAmount(totalAmount.toString());
                                  })()}
                                </div>
                                <span className="text-sm text-muted-foreground">{positionToModify.token1.symbol}</span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {(() => {
                                  const baseAmount = parseFloat(increaseAmount1 || "0");
                                  if (!feesForIncrease) return formatUSD(baseAmount * getUSDPriceForSymbol(positionToModify.token1.symbol));
                                  
                                  const decimals = getTokenSymbolByAddress(positionToModify.token1.address) ? TOKEN_DEFINITIONS[getTokenSymbolByAddress(positionToModify.token1.address)!]?.decimals || 18 : 18;
                                  const feeAmount = parseFloat(formatUnits(BigInt(feesForIncrease.amount1 || '0'), decimals));
                                  const totalAmount = baseAmount + feeAmount;
                                  return formatUSD(totalAmount * getUSDPriceForSymbol(positionToModify.token1.symbol));
                                })()}
                              </div>
                            </div>
                            <Image src={getTokenIcon(positionToModify.token1.symbol)} alt={positionToModify.token1.symbol} width={40} height={40} className="rounded-full" />
                          </div>
                        </div>
                      </div>

                    {/* Fees Section with Striped Border - Only show if there are actual fees */}
                    {(() => {
                      // Check if there are any non-zero fees
                      const token0Symbol = getTokenSymbolByAddress(positionToModify.token0.address);
                      const token1Symbol = getTokenSymbolByAddress(positionToModify.token1.address);
                      const token0Decimals = token0Symbol ? TOKEN_DEFINITIONS[token0Symbol]?.decimals || 18 : 18;
                      const token1Decimals = token1Symbol ? TOKEN_DEFINITIONS[token1Symbol]?.decimals || 18 : 18;
                      
                      const fee0Amount = parseFloat(formatUnits(BigInt(feesForIncrease?.amount0 || '0'), token0Decimals));
                      const fee1Amount = parseFloat(formatUnits(BigInt(feesForIncrease?.amount1 || '0'), token1Decimals));
                      
                      // Only show if at least one fee is greater than 0
                      if (fee0Amount <= 0 && fee1Amount <= 0) return null;
                      
                      return (
                        <div className="p-3 border border-dashed rounded-md bg-muted/10 space-y-2">
                          <div className="text-xs font-medium text-muted-foreground mb-2">Includes uncollected fees:</div>
                          
                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <Image src={getTokenIcon(positionToModify.token0.symbol)} alt={positionToModify.token0.symbol} width={16} height={16} className="rounded-full" />
                              <span className="text-xs text-muted-foreground">{positionToModify.token0.symbol} Fees</span>
                            </div>
                            <div className="text-right">
                              <div className="text-xs font-medium">
                                {(() => {
                                  const feeAmountDisplay = formatUnits(BigInt(feesForIncrease?.amount0 || '0'), token0Decimals);
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
                                  const feeAmount = parseFloat(formatUnits(BigInt(feesForIncrease?.amount0 || '0'), token0Decimals));
                                  return formatUSD(feeAmount * getUSDPriceForSymbol(positionToModify.token0.symbol));
                                })()}
                              </div>
                            </div>
                          </div>

                          <div className="flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <Image src={getTokenIcon(positionToModify.token1.symbol)} alt={positionToModify.token1.symbol} width={16} height={16} className="rounded-full" />
                              <span className="text-xs text-muted-foreground">{positionToModify.token1.symbol} Fees</span>
                            </div>
                            <div className="text-right">
                              <div className="text-xs font-medium">
                                {(() => {
                                  const feeAmountDisplay = formatUnits(BigInt(feesForIncrease?.amount1 || '0'), token1Decimals);
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
                                  const feeAmount = parseFloat(formatUnits(BigInt(feesForIncrease?.amount1 || '0'), token1Decimals));
                                  return formatUSD(feeAmount * getUSDPriceForSymbol(positionToModify.token1.symbol));
                                })()}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Additional Info Rows - Conditional Content */}
                    {!showTransactionOverview ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Current Price:</span>
                          <span className="text-xs text-muted-foreground">
                            {(() => {
                              const price0 = getUSDPriceForSymbol(positionToModify.token0.symbol);
                              const price1 = getUSDPriceForSymbol(positionToModify.token1.symbol);
                              if (price0 === 0 || price1 === 0) return "N/A";
                              const ratio = price0 / price1;
                              const decimals = ratio < 0.1 ? 3 : 2;
                              return `1 ${positionToModify.token0.symbol} = ${ratio.toFixed(decimals)} ${positionToModify.token1.symbol}`;
                            })()}
                          </span>
                        </div>
                        
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>New {positionToModify.token0.symbol} position:</span>
                          <div className="flex items-center gap-2">
                            <span className="text-foreground/80 font-medium">
                              {formatTokenDisplayAmount((() => {
                                // Calculate new position: original + (increase + fees)
                                const originalAmount = parseFloat(positionToModify.token0.amount);
                                const increaseAmount = parseFloat(increaseAmount0 || "0");
                                let totalIncrease = increaseAmount;

                                if (feesForIncrease) {
                                  const decimals = getTokenSymbolByAddress(positionToModify.token0.address) ? TOKEN_DEFINITIONS[getTokenSymbolByAddress(positionToModify.token0.address)!]?.decimals || 18 : 18;
                                  const feeAmount = parseFloat(formatUnits(BigInt(feesForIncrease.amount0 || '0'), decimals));
                                  totalIncrease += feeAmount;
                                }

                                return (originalAmount + totalIncrease).toString();
                              })())}
                            </span>
                            <Image src={getTokenIcon(positionToModify.token0.symbol)} alt={positionToModify.token0.symbol} width={12} height={12} className="rounded-full" />
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>New {positionToModify.token1.symbol} position:</span>
                          <div className="flex items-center gap-2">
                            <span className="text-foreground/80 font-medium">
                              {formatTokenDisplayAmount((() => {
                                // Calculate new position: original + (increase + fees)
                                const originalAmount = parseFloat(positionToModify.token1.amount);
                                const increaseAmount = parseFloat(increaseAmount1 || "0");
                                let totalIncrease = increaseAmount;

                                if (feesForIncrease) {
                                  const decimals = getTokenSymbolByAddress(positionToModify.token1.address) ? TOKEN_DEFINITIONS[getTokenSymbolByAddress(positionToModify.token1.address)!]?.decimals || 18 : 18;
                                  const feeAmount = parseFloat(formatUnits(BigInt(feesForIncrease.amount1 || '0'), decimals));
                                  totalIncrease += feeAmount;
                                }

                                return (originalAmount + totalIncrease).toString();
                              })())}
                            </span>
                            <Image src={getTokenIcon(positionToModify.token1.symbol)} alt={positionToModify.token1.symbol} width={12} height={12} className="rounded-full" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Token Approvals</span>
                          <span>
                            {(increaseStep === 'approve' && increaseIsWorking) ? (
                              <RefreshCwIcon className="h-4 w-4 animate-spin" />
                            ) : (
                              <motion.span 
                                animate={approvalWiggleControls}
                                className={`text-xs font-mono ${increaseCompletedERC20ApprovalsCount === increaseInvolvedTokensCount && increaseInvolvedTokensCount > 0 ? 'text-green-500' : approvalWiggleCount > 0 ? 'text-red-500' : 'text-muted-foreground'}`}
                              >
                                {`${increaseCompletedERC20ApprovalsCount}/${increaseInvolvedTokensCount > 0 ? increaseInvolvedTokensCount : '-'}`}
                              </motion.span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Permit Signature</span>
                          <span>
                            {(increaseStep === 'permit' && increaseIsWorking) ? (
                              <RefreshCwIcon className="h-4 w-4 animate-spin" />
                            ) : (
                              <span className={`text-xs font-mono ${increaseBatchPermitSigned ? 'text-green-500' : 'text-muted-foreground'}`}>
                                {increaseBatchPermitSigned ? '1/1' : '0/1'}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Deposit Transaction</span>
                          <span>
                            {(increaseStep === 'deposit' && (isIncreasingLiquidity || parentIsIncreasingLiquidity)) ? (
                              <RefreshCwIcon className="h-4 w-4 animate-spin" />
                            ) : (
                              <span className={`text-xs font-mono ${parentIsIncreaseSuccess ? 'text-green-500' : 'text-muted-foreground'}`}>
                                {parentIsIncreaseSuccess ? '1/1' : '0/1'}
                              </span>
                            )}
                          </span>
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
                            setTxStarted(false); // Reset transaction state when going back
                          } else {
                            setShowYouWillReceive(false);
                          }
                        }} 
                        disabled={increaseIsWorking || isIncreasingLiquidity}
                        style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                      >
                        Back
                      </Button>

                      <Button
                        className="text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
                        onClick={showTransactionOverview ? handleExecuteTransaction : handleFinalConfirmIncrease}
                        disabled={increaseIsWorking || isIncreasingLiquidity || isIncreaseCalculating}
                      >
                        <span className={increaseIsWorking || isIncreasingLiquidity || isIncreaseCalculating ? "animate-pulse" : ""}>
                          {getIncreaseButtonText()}
                        </span>
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          // New Position Mode (simplified version)
          <div className="border rounded-lg p-6 space-y-4" style={{ backgroundColor: 'var(--modal-background)' }}>
            <div className="text-center text-muted-foreground text-sm">
              Select tokens and amounts to add liquidity
            </div>
            
            {/* Transaction Steps Display */}
            {step !== 'input' && (
              <div className="p-3 border border-dashed rounded-md bg-muted/10 mb-4">
                <p className="text-sm font-medium mb-2 text-foreground/80">Transaction Steps</p>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                    {/* ERC20 Approvals to Permit2 */}
                    <div className="flex items-center justify-between">
                        <span>Token Approvals</span>
                        <span>
                          { (step === 'approve' && (isApproveWritePending || isApproving))
                            ? <RefreshCwIcon className="h-4 w-4 animate-spin" />
                            : (
                              <motion.span 
                                animate={approvalWiggleControls}
                                className={`text-xs font-mono ${completedERC20ApprovalsCount === involvedTokensCount && involvedTokensCount > 0 ? 'text-green-500' : approvalWiggleCount > 0 ? 'text-red-500' : 'text-muted-foreground'}`}
                              >
                                {`${completedERC20ApprovalsCount}/${involvedTokensCount > 0 ? involvedTokensCount : '-'}`}
                              </motion.span>
                            )
                          }
                        </span>
                    </div>
                    
                    {/* Permit2 Signature */}
                    <div className="flex items-center justify-between">
                        <span>Permit Signature</span>
                        <span>
                          { (step === 'mint' && !batchPermitSigned && (isMintSendPending || isWorking))
                            ? <RefreshCwIcon className="h-4 w-4 animate-spin" />
                            : (
                              <span className={`text-xs font-mono ${batchPermitSigned ? 'text-green-500' : ''}`}>
                                {batchPermitSigned ? '1/1' : '0/1'}
                              </span>
                            )
                          }
                        </span>
                    </div>
                    
                    {/* Deposit Transaction */}
                    <div className="flex items-center justify-between">
                        <span>Deposit Transaction</span>
                        <span>
                          { (step === 'mint' && batchPermitSigned && (isMintSendPending || isMintConfirming))
                            ? <RefreshCwIcon className="h-4 w-4 animate-spin" />
                            : (
                              <span className={`text-xs font-mono ${isMintSuccess ? 'text-green-500' : ''}`}>
                                {isMintSuccess ? '1/1' : '0/1'}
                              </span>
                            )
                          }
                        </span>
                    </div>
                    
                </div>
              </div>
            )}
            
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
            
            {/* Buttons for New Position */}
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
                className={(isWorking || isCalculating || !token0Symbol || !token1Symbol || (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0"))) ? "relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75" : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"}
                onClick={() => {
                  if (step === 'input') handlePrepareMint();
                  else if (step === 'approve') handleApprove();
                  else if (step === 'mint') handleMint();
                }}
                disabled={isWorking || isCalculating || !token0Symbol || !token1Symbol || (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0"))}
                style={(isWorking || isCalculating || !token0Symbol || !token1Symbol || (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0"))) ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
              >
                <span className={(step === 'approve' && (isApproveWritePending || isApproving)) || (step === 'mint' && (isMintSendPending || isMintConfirming || (!batchPermitSigned && isWorking))) || (step === 'input' && isWorking) ? "animate-pulse" : ""}>
                  {getButtonText()}
                </span>
              </Button>
          </div>
        </div>
        )}

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
        </div>
        ) : null}

        {/* Success View */}
        {showSuccessView && (
          <div className="border rounded-lg p-6" style={{ backgroundColor: 'var(--modal-background)' }}>
            {/* Transaction Summary */}
            <div 
              className="mb-6 flex items-center justify-between rounded-lg border border-sidebar-border p-4 hover:bg-muted/30 transition-colors cursor-pointer" 
              onClick={() => {
                // Don't call onLiquidityAdded here to prevent auto-close
                // The callback was already called when transaction confirmed
                onOpenChange(false);
              }}
            >
              <div className="flex items-center gap-3">
                <Image src={getTokenIcon(positionToModify?.token0.symbol || '')} alt={positionToModify?.token0.symbol || ''} width={32} height={32} className="rounded-full"/>
                <div className="text-left flex flex-col">
                  <div className="font-medium flex items-baseline">
                    <span className="text-sm">{formatTokenDisplayAmount((() => {
                      // Calculate amount with fees added
                      const currentIncrease = increaseAmount0 || "0";
                      if (!feesForIncrease) return currentIncrease;
                      const decimals = getTokenSymbolByAddress(positionToModify?.token0.address || '') ? TOKEN_DEFINITIONS[getTokenSymbolByAddress(positionToModify?.token0.address || '')!]?.decimals || 18 : 18;
                      const feeAmount = formatUnits(BigInt(feesForIncrease.amount0 || '0'), decimals);
                      const totalAmount = parseFloat(currentIncrease) + parseFloat(feeAmount);
                      return totalAmount.toString();
                    })())}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{positionToModify?.token0.symbol}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatUSD((() => {
                      // Calculate USD value with fees added
                      const currentIncrease = increaseAmount0 || "0";
                      if (!feesForIncrease) return parseFloat(currentIncrease) * getUSDPriceForSymbol(positionToModify?.token0.symbol || '');
                      const decimals = getTokenSymbolByAddress(positionToModify?.token0.address || '') ? TOKEN_DEFINITIONS[getTokenSymbolByAddress(positionToModify?.token0.address || '')!]?.decimals || 18 : 18;
                      const feeAmount = formatUnits(BigInt(feesForIncrease.amount0 || '0'), decimals);
                      const totalAmount = parseFloat(currentIncrease) + parseFloat(feeAmount);
                      return totalAmount * getUSDPriceForSymbol(positionToModify?.token0.symbol || '');
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
                      const currentIncrease = increaseAmount1 || "0";
                      if (!feesForIncrease) return currentIncrease;
                      const decimals = getTokenSymbolByAddress(positionToModify?.token1.address || '') ? TOKEN_DEFINITIONS[getTokenSymbolByAddress(positionToModify?.token1.address || '')!]?.decimals || 18 : 18;
                      const feeAmount = formatUnits(BigInt(feesForIncrease.amount1 || '0'), decimals);
                      const totalAmount = parseFloat(currentIncrease) + parseFloat(feeAmount);
                      return totalAmount.toString();
                    })())}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{positionToModify?.token1.symbol}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatUSD((() => {
                      // Calculate USD value with fees added
                      const currentIncrease = increaseAmount1 || "0";
                      if (!feesForIncrease) return parseFloat(currentIncrease) * getUSDPriceForSymbol(positionToModify?.token1.symbol || '');
                      const decimals = getTokenSymbolByAddress(positionToModify?.token1.address || '') ? TOKEN_DEFINITIONS[getTokenSymbolByAddress(positionToModify?.token1.address || '')!]?.decimals || 18 : 18;
                      const feeAmount = formatUnits(BigInt(feesForIncrease.amount1 || '0'), decimals);
                      const totalAmount = parseFloat(currentIncrease) + parseFloat(feeAmount);
                      return totalAmount * getUSDPriceForSymbol(positionToModify?.token1.symbol || '');
                    })())}
                  </div>
                </div>
                <Image src={getTokenIcon(positionToModify?.token1.symbol || '')} alt={positionToModify?.token1.symbol || ''} width={32} height={32} className="rounded-full"/>
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
                <h3 className="text-lg font-medium">Liquidity Added</h3>
                <p className="text-muted-foreground mt-1">
                  {formatTokenDisplayAmount((() => {
                    // Calculate amount with fees added for token0
                    const currentIncrease = increaseAmount0 || "0";
                    if (!feesForIncrease) return currentIncrease;
                    const decimals = getTokenSymbolByAddress(positionToModify?.token0.address || '') ? TOKEN_DEFINITIONS[getTokenSymbolByAddress(positionToModify?.token0.address || '')!]?.decimals || 18 : 18;
                    const feeAmount = formatUnits(BigInt(feesForIncrease.amount0 || '0'), decimals);
                    const totalAmount = parseFloat(currentIncrease) + parseFloat(feeAmount);
                    return totalAmount.toString();
                  })())} {positionToModify?.token0.symbol} and {formatTokenDisplayAmount((() => {
                    // Calculate amount with fees added for token1
                    const currentIncrease = increaseAmount1 || "0";
                    if (!feesForIncrease) return currentIncrease;
                    const decimals = getTokenSymbolByAddress(positionToModify?.token1.address || '') ? TOKEN_DEFINITIONS[getTokenSymbolByAddress(positionToModify?.token1.address || '')!]?.decimals || 18 : 18;
                    const feeAmount = formatUnits(BigInt(feesForIncrease.amount1 || '0'), decimals);
                    const totalAmount = parseFloat(currentIncrease) + parseFloat(feeAmount);
                    return totalAmount.toString();
                  })())} {positionToModify?.token1.symbol}
                </p>
              </div>
            </div>

            {/* View on Explorer Link */}
            <div className="mb-1 flex items-center justify-center">
            <Button
                variant="link"
                className="text-xs font-normal text-muted-foreground hover:text-muted-foreground/80"
                onClick={() => window.open(txHash ? `https://sepolia.basescan.org/tx/${txHash}` : `https://sepolia.basescan.org/`, "_blank")}
              >
                View on Explorer
            </Button>
            </div>

            {/* Action Button */}
            <Button
              variant="outline"
              className="w-full relative border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 text-white/75"
              onClick={() => {
                // Don't call onLiquidityAdded here to prevent auto-close
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
}

