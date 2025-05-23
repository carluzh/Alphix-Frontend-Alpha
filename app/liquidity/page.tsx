"use client";

import { AppLayout } from "@/components/app-layout";
import { useState, useEffect, useMemo, useCallback } from "react";
import { ArrowRightLeftIcon, PlusIcon, MinusIcon, ArrowLeftIcon, MoreHorizontal, ArrowUpDown, ExternalLinkIcon, RefreshCwIcon, Settings2Icon, XIcon, TrendingUpIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter,
  DialogTrigger,
  DialogClose
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsList, TabsTrigger, Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";
import * as React from "react";
import { 
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  RowData
} from "@tanstack/react-table";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { MobileLiquidityList } from "@/components/MobileLiquidityList";
import { MobilePoolDetails } from "@/components/MobilePoolDetails";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";
import { 
    useAccount, 
    useWriteContract, 
    useSendTransaction, 
    useWaitForTransactionReceipt,
    useBalance
} from "wagmi";
import { toast } from "sonner";
import Link from "next/link";
import { TOKEN_DEFINITIONS, TokenSymbol } from "../../lib/swap-constants";
import { baseSepolia } from "../../lib/wagmiConfig";
import { ethers } from "ethers";
import { ERC20_ABI } from "../../lib/abis/erc20";
import { type Hex, formatUnits as viemFormatUnits, parseUnits, type Abi } from "viem";
import { position_manager_abi } from "../../lib/abis/PositionManager_abi";
import { getFromCache, setToCache, getUserPositionsCacheKey, getPoolStatsCacheKey, getPoolDynamicFeeCacheKey } from "../../lib/client-cache"; // Import cache functions
import { TickRangeControl } from "@/components/TickRangeControl";
// import { DEFAULT_TICK_SPACING } from "@/components/TickRangeControl"; // Assuming DEFAULT_TICK_SPACING is exported or accessible

const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;
const DEFAULT_TICK_SPACING = 60; // Define it locally
const TICK_BARS_COUNT = 31; // More bars for finer visualization
const TICKS_PER_BAR = 10 * DEFAULT_TICK_SPACING; // Each bar represents 10× tickspacing

declare module '@tanstack/react-table' {
  interface TableMeta<TData extends RowData> {
    explorerBaseUrl?: string;
  }
}

const chartData = Array.from({ length: 60 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - i);
  return {
    date: date.toISOString().split('T')[0],
    volume: Math.floor(Math.random() * 200000) + 100000,
    tvl: Math.floor(Math.random() * 100000) + 1000000,
  };
}).reverse();

const chartConfig = {
  views: { label: "Daily Values" },
  volume: { label: "Volume", color: "hsl(var(--chart-1))" },
  tvl: { label: "TVL", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

const formatTokenDisplayAmount = (amount: string) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0.00";
  if (num < 0.0001) return "< 0.0001";
  return num.toFixed(4);
};

// Mock function to calculate USD value (in a real app, you'd use actual price feeds)
const calculateTotalValueUSD = (position: ProcessedPosition) => {
  // This is a placeholder. In a real app, you would:
  // 1. Get current token prices from an API or state
  // 2. Multiply each token amount by its price
  // 3. Sum them up
  
  // For this demo, let's use mock prices
  const mockPrices: Record<string, number> = {
    YUSDC: 1.0,
    BTCRL: 61000.0,
    // Add other token prices as needed
  };
  
  const token0Value = parseFloat(position.token0.amount) * 
    (mockPrices[position.token0.symbol] || 1.0);
  const token1Value = parseFloat(position.token1.amount) * 
    (mockPrices[position.token1.symbol] || 1.0);
  
  return token0Value + token1Value;
};

// Format USD value
const formatUSD = (value: number) => {
  if (value < 0.01) return "< $0.01";
  if (value < 1000) return `$${value.toFixed(2)}`;
  return `$${(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

// TickRangeVisualization Component inspired by dynamic-fee-chart-preview
const TickRangeVisualization = ({ 
  tickLower, 
  tickUpper, 
  currentTick 
}: { 
  tickLower: number; 
  tickUpper: number; 
  currentTick: number; 
}) => {
  // Calculate center of the visualization
  const centerBarIndex = Math.floor(TICK_BARS_COUNT / 2);
  
  // Calculate start tick of the center bar
  const centerBarStartTick = Math.floor(currentTick / TICKS_PER_BAR) * TICKS_PER_BAR;
  
  // Generate bars centered around the current tick
  const bars = Array.from({ length: TICK_BARS_COUNT }, (_, i) => {
    const offset = i - centerBarIndex;
    const barStartTick = centerBarStartTick + (offset * TICKS_PER_BAR);
    const barEndTick = barStartTick + TICKS_PER_BAR;
    
    // Check various conditions
    const containsCurrentTick = currentTick >= barStartTick && currentTick < barEndTick;
    const containsPosition = 
      (barStartTick <= tickUpper && barEndTick > tickLower) || 
      (tickLower <= barStartTick && tickUpper >= barEndTick);
    
    return { containsCurrentTick, containsPosition };
  });

  return (
    <div className="w-full flex justify-center my-1">
      <div className="flex space-x-[1px]">
        {bars.map((bar, i) => {
          let bgColor = "bg-muted/30";
          if (bar.containsCurrentTick) {
            bgColor = "bg-white";
          } else if (bar.containsPosition) {
            bgColor = "bg-orange-500/80";
          }
          
          return (
            <div 
              key={i}
              className={`h-4 w-[2px] rounded-full ${bgColor}`}
            />
          );
        })}
      </div>
    </div>
  );
};

// Define SDK Tick Constants within AddLiquidityModal scope or import from a shared constants file
const MIN_SDK_TICK_FOR_MODAL = -887272;
const MAX_SDK_TICK_FOR_MODAL = 887272;

// Add Liquidity Modal Component
interface AddLiquidityModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onLiquidityAdded: () => void; // Callback to refresh positions
  selectedPoolId?: string; // Add selected pool ID
}

// Debounce function
function debounce<F extends (...args: any[]) => any>(func: F, waitFor: number) {
  let timeout: NodeJS.Timeout | null = null;

  const debounced = (...args: Parameters<F>) => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    timeout = setTimeout(() => func(...args), waitFor);
  };

  return debounced as (...args: Parameters<F>) => ReturnType<F> | void;
}

function AddLiquidityModal({ isOpen, onOpenChange, onLiquidityAdded, selectedPoolId }: AddLiquidityModalProps) {
  const { address: accountAddress, chainId } = useAccount();
  const [token0Symbol, setToken0Symbol] = useState<TokenSymbol>('YUSDC');
  const [token1Symbol, setToken1Symbol] = useState<TokenSymbol>('BTCRL');
  const [amount0, setAmount0] = useState<string>("");
  const [amount1, setAmount1] = useState<string>("");
  const [tickLower, setTickLower] = useState<string>(MIN_SDK_TICK_FOR_MODAL.toString());
  const [tickUpper, setTickUpper] = useState<string>(MAX_SDK_TICK_FOR_MODAL.toString());
  const [currentPoolTick, setCurrentPoolTick] = useState<number | null>(null);
  const [activeInputSide, setActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculatedData, setCalculatedData] = useState<{
    liquidity: string;
    finalTickLower: number;
    finalTickUpper: number;
    calculatedAmount0: string;
    calculatedAmount1: string;
  } | null>(null);
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);
  const [priceAtTickLower, setPriceAtTickLower] = useState<string | null>(null);
  const [priceAtTickUpper, setPriceAtTickUpper] = useState<string | null>(null);
  
  const [isWorking, setIsWorking] = useState(false);
  const [step, setStep] = useState<'input' | 'approve' | 'mint'>('input');
  const [preparedTxData, setPreparedTxData] = useState<any>(null);

  const [initialDefaultApplied, setInitialDefaultApplied] = useState(false);

  // Use the selectedPoolId to set the tokens when the modal opens
  useEffect(() => {
    if (isOpen && selectedPoolId) {
      const parts = selectedPoolId.split('-');
      if (parts.length === 2) {
        const t0 = parts[0].toUpperCase() as TokenSymbol;
        const t1 = parts[1].toUpperCase() as TokenSymbol;
        if (TOKEN_DEFINITIONS[t0] && TOKEN_DEFINITIONS[t1]) {
          setToken0Symbol(t0);
          setToken1Symbol(t1);
          setAmount0("");
          setAmount1("");
          setTickLower(MIN_SDK_TICK_FOR_MODAL.toString());
          setTickUpper(MAX_SDK_TICK_FOR_MODAL.toString());
          setCurrentPoolTick(null);
          setCalculatedData(null);
          setActiveInputSide(null);
          setCurrentPrice(null); // Reset price info
          setPriceAtTickLower(null); // Reset price info
          setPriceAtTickUpper(null); // Reset price info
          setInitialDefaultApplied(false);
        }
      }
    }
  }, [isOpen, selectedPoolId]);

  // Effect to reset default application flag and ticks when tokens change
  useEffect(() => {
    setInitialDefaultApplied(false);
    setTickLower(MIN_SDK_TICK_FOR_MODAL.toString());
    setTickUpper(MAX_SDK_TICK_FOR_MODAL.toString());
    // Resetting amounts and other derived states might be needed too if they shouldn't persist across token pairs
    setAmount0("");
    setAmount1("");
    setCalculatedData(null);
    setCurrentPoolTick(null); // Also reset currentPoolTick to ensure fresh fetch and default logic trigger
    setPriceAtTickLower(null);
    setPriceAtTickUpper(null);
    setCurrentPrice(null);
  }, [token0Symbol, token1Symbol, chainId]);

  // Debounced calculation function
  const debouncedCalculateDependentAmount = useCallback(
    debounce(async (currentAmount0: string, currentAmount1: string, currentTickLower: string, currentTickUpper: string, inputSide: 'amount0' | 'amount1') => {
      if (!chainId) return;

      const tl = parseInt(currentTickLower);
      const tu = parseInt(currentTickUpper);

      if (isNaN(tl) || isNaN(tu) || tl >= tu) {
        setCalculatedData(null);
        if (inputSide === 'amount0') setAmount1(""); else setAmount0("");
        toast.info("Invalid Range", { description: "Min tick must be less than max tick." });
        return;
      }

      const primaryAmount = inputSide === 'amount0' ? currentAmount0 : currentAmount1;
      const primaryTokenSymbol = inputSide === 'amount0' ? token0Symbol : token1Symbol;
      const secondaryTokenSymbol = inputSide === 'amount0' ? token1Symbol : token0Symbol;
      
      if (!primaryAmount || parseFloat(primaryAmount) <= 0) {
        setCalculatedData(null);
        if (inputSide === 'amount0') setAmount1(""); else setAmount0("");
        return;
      }

      setIsCalculating(true);
      setCalculatedData(null); 

      try {
        const response = await fetch('/api/liquidity/calculate-liquidity-parameters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token0Symbol,
            token1Symbol,
            inputAmount: primaryAmount,
            inputTokenSymbol: primaryTokenSymbol,
            userTickLower: tl,
            userTickUpper: tu,
            chainId,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to calculate parameters.");
        }

        const result = await response.json();
        
        // The API is expected to return amounts in their smallest unit (e.g., wei)
        // and final snapped ticks, and liquidity.
        // It should also return which amount was the input ('amount0' or 'amount1')
        // and the corresponding calculated amount for the other token.

        setCalculatedData({
            liquidity: result.liquidity, 
            finalTickLower: result.finalTickLower, 
            finalTickUpper: result.finalTickUpper, 
            calculatedAmount0: result.amount0, 
            calculatedAmount1: result.amount1,
        });

        if (typeof result.currentPoolTick === 'number') {
            setCurrentPoolTick(result.currentPoolTick);
        }
        // Store new price information from API result
        if (result.currentPrice) setCurrentPrice(result.currentPrice);
        if (result.priceAtTickLower) setPriceAtTickLower(result.priceAtTickLower);
        if (result.priceAtTickUpper) setPriceAtTickUpper(result.priceAtTickUpper);

        // Update the non-active input field with the calculated amount, formatted for display
        if (inputSide === 'amount0') {
            setAmount1(formatTokenDisplayAmount(viemFormatUnits(BigInt(result.amount1), TOKEN_DEFINITIONS[secondaryTokenSymbol]?.decimals || 18)));
        } else {
            setAmount0(formatTokenDisplayAmount(viemFormatUnits(BigInt(result.amount0), TOKEN_DEFINITIONS[secondaryTokenSymbol]?.decimals || 18)));
        }
        // Update ticks to snapped values from API if they changed
        if (result.finalTickLower.toString() !== currentTickLower) {
            setTickLower(result.finalTickLower.toString());
    }
        if (result.finalTickUpper.toString() !== currentTickUpper) {
            setTickUpper(result.finalTickUpper.toString());
        }

        if (!initialDefaultApplied && result.currentPoolTick !== null && result.currentPoolTick !== undefined) {
          const LOG_1_0001 = 0.0000999950003;
          const PRICE_CHANGE_LOWER_RATIO = 0.25; // -75%
          const PRICE_CHANGE_UPPER_RATIO = 1.75; // +75%

          const deltaTickLower = Math.round(Math.log(PRICE_CHANGE_LOWER_RATIO) / LOG_1_0001);
          const deltaTickUpper = Math.round(Math.log(PRICE_CHANGE_UPPER_RATIO) / LOG_1_0001);

          let defaultLower = result.currentPoolTick + deltaTickLower;
          let defaultUpper = result.currentPoolTick + deltaTickUpper;

          defaultLower = Math.round(defaultLower / DEFAULT_TICK_SPACING) * DEFAULT_TICK_SPACING;
          defaultUpper = Math.round(defaultUpper / DEFAULT_TICK_SPACING) * DEFAULT_TICK_SPACING;
          
          defaultLower = Math.max(MIN_SDK_TICK_FOR_MODAL, Math.min(MAX_SDK_TICK_FOR_MODAL, defaultLower));
          defaultUpper = Math.max(MIN_SDK_TICK_FOR_MODAL, Math.min(MAX_SDK_TICK_FOR_MODAL, defaultUpper));

          if (defaultLower >= defaultUpper) { 
            setTickLower(MIN_SDK_TICK_FOR_MODAL.toString());
            setTickUpper(MAX_SDK_TICK_FOR_MODAL.toString());
            // If falling back to full range, ensure prices are consistent or cleared
            setPriceAtTickLower(result.priceAtTickLower);
            setPriceAtTickUpper(result.priceAtTickUpper);
          } else {
            setTickLower(defaultLower.toString());
            setTickUpper(defaultUpper.toString());
            // Since we set new default ticks, the prices from the API (result.priceAtTickLower/Upper)
            // which were for result.finalTickLower/Upper are now stale for these new default ticks.
            // Clear them to trigger "Loading..." in TickRangeControl.
            setPriceAtTickLower(null);
            setPriceAtTickUpper(null);
          }
          setInitialDefaultApplied(true); 
        } else {
          // This branch is taken if initial default was already applied, or not applicable.
          // The ticks from API (result.finalTickLower/Upper) are the current effective ticks.
          // The prices (result.priceAtTickLower/Upper) correspond to these ticks.
          setTickLower(result.finalTickLower.toString());
          setTickUpper(result.finalTickUpper.toString());
          setPriceAtTickLower(result.priceAtTickLower);
          setPriceAtTickUpper(result.priceAtTickUpper);
        }

      } catch (error: any) {
        console.error("Error calculating dependent amount:", error);
        toast.error("Calculation Error", { description: error.message || "Could not estimate amounts." });
        setCalculatedData(null);
        // Clear the dependent amount field on error
        if (inputSide === 'amount0') setAmount1(""); else setAmount0("");
      } finally {
        setIsCalculating(false);
      }
    }, 500),
    [token0Symbol, token1Symbol, chainId, initialDefaultApplied]
  );

  // useEffect for dynamic amount calculation
  useEffect(() => {
    if (activeInputSide) {
        if (activeInputSide === 'amount0') {
            debouncedCalculateDependentAmount(amount0, amount1, tickLower, tickUpper, 'amount0');
        } else if (activeInputSide === 'amount1') {
            debouncedCalculateDependentAmount(amount0, amount1, tickLower, tickUpper, 'amount1');
    }
    } else {
        // If no active input side (e.g. only ticks changed), recalculate based on a sensible primary
        // For instance, if amount0 has a value, use it as primary. Otherwise, if amount1 has a value, use it.
        // This handles cases where ticks change after amounts have been set.
        if (parseFloat(amount0) > 0) {
            debouncedCalculateDependentAmount(amount0, amount1, tickLower, tickUpper, 'amount0');
        } else if (parseFloat(amount1) > 0) {
            debouncedCalculateDependentAmount(amount0, amount1, tickLower, tickUpper, 'amount1');
        } else {
            // Both amounts are zero or invalid, clear calculated data
            setCalculatedData(null);
            // setAmount0(""); // Optionally clear amounts if ticks change and no valid base amount
            // setAmount1("");
        }
    }
  }, [amount0, amount1, tickLower, tickUpper, activeInputSide, token0Symbol, token1Symbol, debouncedCalculateDependentAmount]);


  const handlePrepareMint = async (isAfterApproval = false) => {
    if (!accountAddress || !chainId) {
      toast.error("Please connect your wallet.");
      return;
    }
    // Use amounts from calculatedData if available, otherwise state, ensuring they are valid numbers
    const finalAmount0 = calculatedData?.calculatedAmount0 ? viemFormatUnits(BigInt(calculatedData.calculatedAmount0), TOKEN_DEFINITIONS[token0Symbol]?.decimals || 18) : amount0;
    const finalAmount1 = calculatedData?.calculatedAmount1 ? viemFormatUnits(BigInt(calculatedData.calculatedAmount1), TOKEN_DEFINITIONS[token1Symbol]?.decimals || 18) : amount1;

    const amount0Num = parseFloat(finalAmount0);
    const amount1Num = parseFloat(finalAmount1);
    const finalTickLowerNum = calculatedData?.finalTickLower ?? parseInt(tickLower); // Use calculated if available
    const finalTickUpperNum = calculatedData?.finalTickUpper ?? parseInt(tickUpper);

    if ((isNaN(amount0Num) || amount0Num <= 0) && (isNaN(amount1Num) || amount1Num <= 0)) {
      toast.error("Please enter or calculate a valid amount for at least one token.");
      return;
    }
    if (isNaN(finalTickLowerNum) || isNaN(finalTickUpperNum) || finalTickLowerNum >= finalTickUpperNum) {
      toast.error("Invalid tick range provided or calculated.");
      return;
    }
    if (token0Symbol === token1Symbol) {
      toast.error("Tokens cannot be the same.");
      return;
    }
    setIsWorking(true);
    if (!isAfterApproval) setStep('input');
    toast.loading("Preparing transaction...", { id: "prepare-mint" });
    try {
      const response = await fetch('/api/liquidity/prepare-mint-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: accountAddress,
          token0Symbol,
          token1Symbol,
          amount0Desired: finalAmount0, 
          amount1Desired: finalAmount1,
          userTickLower: finalTickLowerNum,
          userTickUpper: finalTickUpperNum,
          chainId: chainId ?? baseSepolia.id,
        }),
      });
      toast.dismiss("prepare-mint");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Failed to prepare transaction.");
      }
      setPreparedTxData(data);
      if (data.needsApproval) {
        toast.info(`Approval needed for ${data.approvalTokenSymbol}`, {
          description: `You need to approve the Position Manager to use your ${data.approvalTokenSymbol}.`
        });
        setStep('approve');
      } else {
        toast.success("Transaction ready to mint!");
        setStep('mint');
      }
    } catch (error: any) {
      toast.dismiss("prepare-mint");
      toast.error("Error preparing transaction", { description: error.message });
      console.error("Prepare mint error:", error);
    } finally {
      if (!isAfterApproval) setIsWorking(false);
    }
  };

  const { data: approveTxHash, error: approveWriteError, isPending: isApproveWritePending, writeContractAsync: approveERC20Async, reset: resetApproveWriteContract } = useWriteContract();
  const { isLoading: isApproving, isSuccess: isApproved, error: approveReceiptError } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { data: mintTxHash, error: mintSendError, isPending: isMintSendPending, sendTransactionAsync, reset: resetSendTransaction } = useSendTransaction();
  const { isLoading: isMintConfirming, isSuccess: isMintConfirmed, error: mintReceiptError } = useWaitForTransactionReceipt({ hash: mintTxHash });

  useEffect(() => {
    if (isApproved) {
      toast.success("Approval successful!");
      resetApproveWriteContract();
      if (preparedTxData) {
        handlePrepareMint(true);
      }
    }
    if (approveWriteError || approveReceiptError) {
      const errorMsg = approveWriteError?.message || approveReceiptError?.message || "Approval transaction failed.";
      toast.error("Approval failed", { description: errorMsg });
      setIsWorking(false);
      resetApproveWriteContract();
    }
  }, [isApproved, approveWriteError, approveReceiptError, preparedTxData, resetApproveWriteContract, handlePrepareMint]);

  useEffect(() => {
    if (isMintConfirmed) {
      toast.success("Liquidity minted successfully!", { id: "mint-tx" });
      onLiquidityAdded();
      onOpenChange(false);
      resetSendTransaction();
    }
    if (mintSendError || mintReceiptError) {
      const errorMsg = mintSendError?.message || mintReceiptError?.message || "Minting transaction failed.";
      toast.error("Minting failed", { id: "mint-tx", description: errorMsg });
      console.error("Full minting error object:", mintSendError || mintReceiptError);
      setIsWorking(false);
      resetSendTransaction();
    }
  }, [isMintConfirmed, mintSendError, mintReceiptError, onLiquidityAdded, onOpenChange, resetSendTransaction]);

  const resetForm = () => {
    setToken0Symbol('YUSDC');
    setToken1Symbol('BTCRL');
    setAmount0("");
    setAmount1("");
    setTickLower(MIN_SDK_TICK_FOR_MODAL.toString());
    setTickUpper(MAX_SDK_TICK_FOR_MODAL.toString());
    setCurrentPoolTick(null);
    setActiveInputSide(null);
    setCalculatedData(null);
    setCurrentPrice(null); // Reset price info
    setPriceAtTickLower(null); // Reset price info
    setPriceAtTickUpper(null); // Reset price info
    setIsWorking(false);
    setStep('input');
    setPreparedTxData(null);
    setInitialDefaultApplied(false);
  };

  const handleSetFullRange = () => {
    setTickLower(MIN_SDK_TICK_FOR_MODAL.toString());
    setTickUpper(MAX_SDK_TICK_FOR_MODAL.toString());
    setInitialDefaultApplied(true);
  };

  const handleSwapTokens = () => {
    setToken0Symbol(token1Symbol);
    setToken1Symbol(token0Symbol);
    setAmount0(amount1);
    setAmount1(amount0);
    setActiveInputSide(activeInputSide === 'amount0' ? 'amount1' : activeInputSide === 'amount1' ? 'amount0' : null);
    setCalculatedData(null); // Clear old calculations
  };

  const handleApprove = async () => {
    if (!preparedTxData?.needsApproval || !approveERC20Async) return;
    setIsWorking(true);
    toast.loading(`Approving ${preparedTxData.approvalTokenSymbol}...`, { id: "approve-tx" });
    try {
      const approvalAmountBigInt = BigInt(preparedTxData.approvalAmount); 
      await approveERC20Async({
        address: preparedTxData.approvalTokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [preparedTxData.approveToAddress as `0x${string}`, approvalAmountBigInt],
      });
    } catch (err: any) {
      toast.dismiss("approve-tx");
      console.error("Full approval error object:", err);
      let detailedErrorMessage = "Unknown error during approval.";
      if (err instanceof Error) {
        detailedErrorMessage = err.message;
        if ((err as any).shortMessage) { detailedErrorMessage = (err as any).shortMessage; }
      }
      toast.error("Failed to send approval transaction.", { description: detailedErrorMessage });
      setIsWorking(false);
      resetApproveWriteContract();
    }
  };

  const handleMint = async () => {
    if (!preparedTxData || preparedTxData.needsApproval || !sendTransactionAsync) return;
    if (!preparedTxData.transaction || typeof preparedTxData.transaction.data !== 'string') {
      toast.error("Minting Error", { description: "Transaction data is missing or invalid. Please try preparing again." });
      setStep('input'); 
      setIsWorking(false);
      return;
    }
    setIsWorking(true);
    toast.loading("Sending mint transaction...", { id: "mint-tx" });
    try {
      const { to, data, value: txValueString } = preparedTxData.transaction;
      const txParams: { to: `0x${string}`; data: Hex; value?: bigint } = {
        to: to as `0x${string}`,
        data: data as Hex,
      };
      if (txValueString && BigInt(txValueString) > 0n) {
        txParams.value = BigInt(txValueString);
      }
      await sendTransactionAsync(txParams);
    } catch (err: any) { 
      console.error("Direct sendTransactionAsync error:", err);
      let detailedErrorMessage = "Unknown error sending mint transaction.";
      if (err instanceof Error) {
        detailedErrorMessage = err.message;
        if ((err as any).shortMessage) { detailedErrorMessage = (err as any).shortMessage; }
      }
      toast.error("Failed to send mint transaction.", { id: "mint-tx", description: detailedErrorMessage });
      setIsWorking(false);
      resetSendTransaction();
    }
  };

  const getTokenIcon = (symbol?: string) => {
    if (symbol?.toUpperCase().includes("YUSD")) return "/YUSD.png";
    if (symbol?.toUpperCase().includes("BTCRL")) return "/BTCRL.png";
    return "/default-token.png";
  };

  console.log("[AddLiquidityModal] Token0 check before useBalance:", { 
    symbol: token0Symbol, 
    addressRaw: TOKEN_DEFINITIONS[token0Symbol]?.addressRaw 
  });
  const { data: token0BalanceData, isLoading: isLoadingToken0Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[token0Symbol]?.addressRaw as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[token0Symbol]?.addressRaw },
  });

  console.log("[AddLiquidityModal] Token1 check before useBalance:", { 
    symbol: token1Symbol, 
    addressRaw: TOKEN_DEFINITIONS[token1Symbol]?.addressRaw 
  });
  const { data: token1BalanceData, isLoading: isLoadingToken1Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[token1Symbol]?.addressRaw as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[token1Symbol]?.addressRaw },
  });

  const getFormattedDisplayBalance = (numericBalance: number | undefined, tokenSymbolForDecimals: TokenSymbol): string => {
    if (numericBalance === undefined || isNaN(numericBalance)) {
      numericBalance = 0;
    }
    if (numericBalance === 0) {
      return "0.000";
    } else if (numericBalance > 0 && numericBalance < 0.001) {
      return "< 0.001";
    } else {
      const displayDecimals = tokenSymbolForDecimals === 'BTCRL' ? 8 : 2;
      return numericBalance.toFixed(displayDecimals);
    }
  };

  const displayToken0Balance = isLoadingToken0Balance ? "Loading..." : (token0BalanceData ? getFormattedDisplayBalance(parseFloat(token0BalanceData.formatted), token0Symbol) : "~");
  const displayToken1Balance = isLoadingToken1Balance ? "Loading..." : (token1BalanceData ? getFormattedDisplayBalance(parseFloat(token1BalanceData.formatted), token1Symbol) : "~");

  const removeNumberInputArrows = () => {
    const style = document.createElement('style');
    style.innerHTML = `
      input[type=number]::-webkit-inner-spin-button,
      input[type=number]::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      input[type=number] {
        -moz-appearance: textfield;
      }
      .no-arrows::-webkit-inner-spin-button,
      .no-arrows::-webkit-outer-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      .no-arrows {
        -moz-appearance: textfield;
      }
    `;
    document.head.appendChild(style);
  };

  useEffect(() => {
    removeNumberInputArrows();
  }, []);

  // Log props just before rendering TickRangeControl
  console.log("[AddLiquidityModal] About to render, props for TickRangeControl:", {
    currentPrice,
    priceAtTickLower,
    priceAtTickUpper,
    token0Symbol,
    token1Symbol,
    currentPoolTick
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { 
        if (!isWorking) { 
            onOpenChange(open); 
            if (!open) {
                resetForm();
            }
        }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Liquidity</DialogTitle>
          <DialogDescription>
            Provide liquidity to a pool. Select tokens, amounts, and price range.
          </DialogDescription>
        </DialogHeader>
        
        <Card className="w-full card-gradient border-0 shadow-none">
          <CardContent className="px-4 py-6 space-y-4">
            {/* Token A Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium">Token A</Label>
                   <div className="flex items-center gap-1">
                     <span className="text-xs text-muted-foreground">Balance: {displayToken0Balance} {token0Symbol}</span>
            </div>
            </div>
              <div className="rounded-lg bg-muted/30 p-4">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                      <Image src={getTokenIcon(token0Symbol)} alt={token0Symbol} width={20} height={20} className="rounded-full"/>
                      <span className="text-sm font-medium">{token0Symbol}</span>
          </div>
                    <div className="flex-1">
                       <Input
                          id="amount0"
                          placeholder="0.0"
                          value={amount0}
                          onChange={(e) => { setAmount0(e.target.value); setActiveInputSide('amount0'); }}
                          type="number"
                          disabled={isWorking || isCalculating && activeInputSide === 'amount1'}
                          className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto no-arrows"
                       />
          </div>
            </div>
              </div>
            </div>

            {/* Token B Section */}
              <div>
              <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium">Token B</Label>
                  <div className="flex items-center gap-1">
                     <span className="text-xs text-muted-foreground">Balance: {displayToken1Balance} {token1Symbol}</span>
              </div>
            </div>
              <div className="rounded-lg bg-muted/30 p-4">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                     <Image src={getTokenIcon(token1Symbol)} alt={token1Symbol} width={20} height={20} className="rounded-full"/>
                    <span className="text-sm font-medium">{token1Symbol}</span>
                  </div>
                  <div className="flex-1">
                      <Input
                          id="amount1"
                          placeholder="0.0"
                          value={amount1}
                          onChange={(e) => { setAmount1(e.target.value); setActiveInputSide('amount1'); }}
                          type="number"
                          disabled={isWorking || isCalculating && activeInputSide === 'amount0'}
                          className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto no-arrows"
                      />
                  </div>
                </div>
              </div>
            </div>

            {/* Price Range Section - Replaced with TickRangeControl */}
            <TickRangeControl
                tickLower={tickLower}
                tickUpper={tickUpper}
                currentPoolTick={currentPoolTick}
                onTickLowerChange={(value) => { 
                    setTickLower(value); 
                    setActiveInputSide(null); 
                    setInitialDefaultApplied(true);
                }}
                onTickUpperChange={(value) => { 
                    setTickUpper(value); 
                    setActiveInputSide(null); 
                    setInitialDefaultApplied(true);
                }}
                onSetFullRange={handleSetFullRange}
                disabled={isWorking || isCalculating}
                minTickBoundary={MIN_SDK_TICK_FOR_MODAL}
                maxTickBoundary={MAX_SDK_TICK_FOR_MODAL}
                tickSpacing={DEFAULT_TICK_SPACING} 
                token0Symbol={token0Symbol}
                token1Symbol={token1Symbol}
                currentPrice={currentPrice}
                priceAtTickLower={priceAtTickLower}
                priceAtTickUpper={priceAtTickUpper}
            />
          </CardContent>
        </Card>

        <DialogFooter className="mt-2">
          <Button 
            onClick={() => handlePrepareMint(false)} 
            disabled={isWorking || isCalculating || isApproveWritePending || isMintSendPending || (!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) || !calculatedData}
            className="w-full"
          >
            {(isWorking || isCalculating || isApproveWritePending || isMintSendPending) ? <RefreshCwIcon className="animate-spin mr-2" /> : null}
            {step === 'input' ? 'Preview & Prepare' : step === 'approve' ? `Approve ${preparedTxData?.approvalTokenSymbol}` : 'Confirm Mint'}
          </Button>
          {/* Separate buttons for approve/mint if preferred, or keep combined logic based on 'step' */}
          {/* Example of separate buttons that could be shown based on 'step' after prepare is done */}
          {/* {step === 'approve' && <Button onClick={handleApprove} disabled={isWorking || isApproveWritePending || isApproving || isMintSendPending} className="w-full">{(isWorking || isApproveWritePending || isApproving) ? <RefreshCwIcon className="animate-spin mr-2" /> : null}Approve {preparedTxData?.approvalTokenSymbol}</Button>} */}
          {/* {step === 'mint' && <Button onClick={handleMint} disabled={isWorking || isMintSendPending || isMintConfirming || isApproveWritePending} className="w-full">{(isWorking || isMintSendPending || isMintConfirming) ? <RefreshCwIcon className="animate-spin mr-2" /> : null}Confirm Mint</Button>} */}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Position Card Component
const PositionCard = ({ position }: { position: ProcessedPosition }) => {
  // Helper function to get token icon
  const getTokenIcon = (symbol?: string) => {
    if (symbol?.toUpperCase().includes("YUSD")) return "/YUSD.png";
    if (symbol?.toUpperCase().includes("BTCRL")) return "/BTCRL.png";
    return "/default-token.png";
  };

  // Calculate total value for the position
  const totalValueUSD = calculateTotalValueUSD(position);
  
  // Estimate current tick based on isInRange status
  const estimatedCurrentTick = position.isInRange 
    ? Math.floor((position.tickLower + position.tickUpper) / 2)
    : (position.tickLower > 0 
        ? position.tickLower - TICKS_PER_BAR 
        : position.tickUpper + TICKS_PER_BAR);

  return (
    <Card className="w-full shadow-md rounded-lg hover:shadow-lg transition-shadow bg-muted/30">
      <CardHeader className="flex flex-row items-start justify-between pb-2 pt-3 px-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <div className="relative w-14 h-7">
              <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                <Image src={getTokenIcon(position.token0.symbol)} alt={position.token0.symbol || 'Token 0'} width={28} height={28} className="w-full h-full object-cover" />
              </div>
              <div className="absolute top-0 left-4 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                <Image src={getTokenIcon(position.token1.symbol)} alt={position.token1.symbol || 'Token 1'} width={28} height={28} className="w-full h-full object-cover" />
              </div>
            </div>
            <CardTitle className="text-base font-medium">
              {position.token0.symbol || 'N/A'} / {position.token1.symbol || 'N/A'}
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-muted-foreground">
            {formatUSD(totalValueUSD)}
          </CardDescription>
        </div>
        <Badge variant={position.isInRange ? "default" : "secondary"} 
           className={position.isInRange ? "bg-green-500/20 text-green-700 border-green-500/30" : "bg-orange-500/20 text-orange-700 border-orange-500/30"}>
          {position.isInRange ? "In Range" : "Out of Range"}
        </Badge>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-1">
        <div className="flex flex-col gap-2">
          <div className="w-full">
            <TickRangeVisualization
              tickLower={position.tickLower}
              tickUpper={position.tickUpper}
              currentTick={estimatedCurrentTick}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Token 0</div>
              <div>{formatTokenDisplayAmount(position.token0.amount)} {position.token0.symbol}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Token 1</div>
              <div>{formatTokenDisplayAmount(position.token1.amount)} {position.token1.symbol}</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Pool data interface
interface Pool {
  id: string;
  tokens: { symbol: string; icon: string }[];
  pair: string;
  volume24h: string; // Keep for initial display, will be updated
  volume7d: string; // Keep for initial display, will be updated
  fees24h: string;  // Keep for initial display, will be updated
  fees7d: string;   // Keep for initial display, will be updated
  volume24hUSD?: number; // For fetched numeric data
  fees24hUSD?: number;   // For fetched numeric data
  volume7dUSD?: number;  // For fetched numeric data
  fees7dUSD?: number;    // For fetched numeric data
  liquidity: string;
  tvlUSD?: number; // For fetched numeric TVL data
  apr: string;
  highlighted: boolean;
  positionsCount?: number; // Number of user positions in this pool
}

// Mock pools data - in a real app, this would come from an API
const mockPools: Pool[] = [
  {
    id: "yusdc-btcrl", // This will be used as poolId for the API
    // For testing, we'll use the example poolId directly later in the fetch logic if needed
    // but the structure here is based on pair symbols.
    // The actual pool ID on-chain for YUSDC/BTCRL might be different and should be mapped correctly.
    // For now, the API will use this `id` field.
    tokens: [
      { symbol: "YUSDC", icon: "/YUSD.png" },
      { symbol: "BTCRL", icon: "/BTCRL.png" }
    ],
    pair: "YUSDC / BTCRL",
    volume24h: "Loading...", // Initial display
    volume7d: "Loading...", // Initial display
    fees24h: "Loading...",   // Initial display
    fees7d: "Loading...",     // Initial display
    liquidity: "Loading...", // Initial display for TVL
    apr: "8.4%",
    highlighted: true,
  }
];

export default function LiquidityPage() {
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [userPositions, setUserPositions] = useState<ProcessedPosition[]>([]); // Added state for all user positions
  const [activeChart, setActiveChart] = React.useState<keyof typeof chartConfig>("volume");
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [poolsData, setPoolsData] = useState<Pool[]>(mockPools); // State for dynamic pool data
  const isMobile = useIsMobile();
  const { address: accountAddress, isConnected, chain } = useAccount();
  const [addLiquidityOpen, setAddLiquidityOpen] = useState(false);
  const [selectedPoolId, setSelectedPoolId] = useState<string>("");
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );

  // Add resize listener
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }
  }, []);

  // Fetch all user positions
  useEffect(() => {
    if (isConnected && accountAddress) {
      const cacheKey = getUserPositionsCacheKey(accountAddress);
      const cachedPositions = getFromCache<ProcessedPosition[]>(cacheKey);

      if (cachedPositions) {
        console.log("[Cache HIT] Using cached user positions for", accountAddress);
        setUserPositions(cachedPositions);
        setIsLoadingPositions(false);
        return;
      }

      console.log("[Cache MISS] Fetching user positions from API for", accountAddress);
      setIsLoadingPositions(true);
      fetch(`/api/liquidity/get-positions?ownerAddress=${accountAddress}`)
        .then(res => {
          if (!res.ok) { throw new Error(`Failed to fetch positions: ${res.statusText}`); }
          return res.json();
        })
        .then((data: ProcessedPosition[] | { message: string }) => {
          if (Array.isArray(data)) {
            setUserPositions(data);
            setToCache(cacheKey, data); // Cache the fetched positions
            console.log("[Cache SET] Cached user positions for", accountAddress);
          } else {
            console.error("Error fetching positions on main page:", data.message);
            toast.error("Could not load your positions for counts", { description: data.message });
            setUserPositions([]);
          }
        })
        .catch(error => {
          console.error("Failed to fetch user positions for counts:", error);
          toast.error("Failed to load your positions for counts.", { description: error.message });
          setUserPositions([]);
        })
        .finally(() => {
          setIsLoadingPositions(false);
        });
    } else {
      setUserPositions([]); // Clear positions if not connected
    }
  }, [isConnected, accountAddress]);

  // useEffect to fetch rolling volume and fees for each pool
  useEffect(() => {
    const fetchPoolStats = async (pool: Pool): Promise<Partial<Pool>> => {
      const apiPoolId = pool.id === 'yusdc-btcrl' ? "0xbcc20db9b797e211e508500469e553111c6fa8d80f7896e6db60167bcf18ce13" : pool.id;
      const statsCacheKey = getPoolStatsCacheKey(apiPoolId);
      let cachedStats = getFromCache<Partial<Pool>>(statsCacheKey);

      // If we have cached stats, we might still need to fetch/recalculate APR if it's not there or uses a separate fee cache
      // For simplicity, if basic stats are cached, we'll try to use them and then fetch fee separately if needed for APR.

      if (cachedStats && cachedStats.apr && cachedStats.volume24hUSD !== undefined && cachedStats.tvlUSD !== undefined) {
        console.log(`[Cache HIT] Using fully cached stats (incl. APR) for pool: ${pool.pair}, API ID: ${apiPoolId}`);
        return cachedStats; 
      }
      
      console.log(`[Cache MISS or APR missing] Fetching/Recomputing stats for pool: ${pool.pair}, using API ID: ${apiPoolId}`);

      let volume24hUSD: number | undefined = cachedStats?.volume24hUSD;
      let fees24hUSD: number | undefined = cachedStats?.fees24hUSD; // Assuming fees are part of this cache if available
      let volume7dUSD: number | undefined = cachedStats?.volume7dUSD;
      let fees7dUSD: number | undefined = cachedStats?.fees7dUSD;
      let tvlUSD: number | undefined = cachedStats?.tvlUSD;
      let calculatedApr = cachedStats?.apr || "Loading..."; // Default to loading or existing cached APR

      try {
        // Fetch volume/TVL only if not fully available in cache (or if we decide to always refresh parts)
        if (volume24hUSD === undefined || tvlUSD === undefined || fees24hUSD === undefined ) { // Simplified condition: if core stats missing, fetch all
          console.log(`Fetching core stats (vol/tvl/fees) for ${apiPoolId}`);
          const [res24h, res7d, resTvl] = await Promise.all([
            fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${apiPoolId}&days=1`),
            fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${apiPoolId}&days=7`),
            fetch(`/api/liquidity/get-pool-tvl?poolId=${apiPoolId}`)
          ]);

          if (!res24h.ok || !res7d.ok || !resTvl.ok) {
            console.error(`Failed to fetch some core stats for ${apiPoolId}.`);
            // Fallback to existing cached values if any, or keep as undefined
          } else {
            const data24h = await res24h.json();
            const data7d = await res7d.json();
            const dataTvl = await resTvl.json();

            console.log(`[LiquidityPage] Raw TVL data for ${apiPoolId}:`, dataTvl);

            volume24hUSD = parseFloat(data24h.volumeUSD);
            fees24hUSD = parseFloat(data24h.feesUSD);
            volume7dUSD = parseFloat(data7d.volumeUSD);
            fees7dUSD = parseFloat(data7d.feesUSD);
            tvlUSD = parseFloat(dataTvl.tvlUSD);
          }
        }

        // Fetch dynamic fee for APR calculation
        const [token0SymbolStr, token1SymbolStr] = pool.pair.split(' / ');
        const fromTokenSymbolForFee = TOKEN_DEFINITIONS[token0SymbolStr?.trim() as TokenSymbol]?.symbol;
        const toTokenSymbolForFee = TOKEN_DEFINITIONS[token1SymbolStr?.trim() as TokenSymbol]?.symbol;

        let dynamicFeeBps: number | null = null;
        if (fromTokenSymbolForFee && toTokenSymbolForFee && baseSepolia.id) {
          const feeCacheKey = getPoolDynamicFeeCacheKey(fromTokenSymbolForFee, toTokenSymbolForFee, baseSepolia.id);
          const cachedFee = getFromCache<{ dynamicFee: string }>(feeCacheKey);

          if (cachedFee) {
            console.log(`[Cache HIT] Using cached dynamic fee for APR calc (${pool.pair}):`, cachedFee.dynamicFee);
            dynamicFeeBps = Number(cachedFee.dynamicFee);
          } else {
            console.log(`[Cache MISS] Fetching dynamic fee from API for APR calc (${pool.pair})`);
            const feeResponse = await fetch('/api/swap/get-dynamic-fee', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fromTokenSymbol: fromTokenSymbolForFee,
                toTokenSymbol: toTokenSymbolForFee,
                chainId: baseSepolia.id,
              }),
            });
            if (feeResponse.ok) {
              const feeData = await feeResponse.json();
              dynamicFeeBps = Number(feeData.dynamicFee);
              if (!isNaN(dynamicFeeBps)) {
                 setToCache(feeCacheKey, { dynamicFee: feeData.dynamicFee });
                 console.log(`[Cache SET] Cached dynamic fee for APR calc (${pool.pair}):`, feeData.dynamicFee);
              } else {
                dynamicFeeBps = null; // Invalid fee from API
              }
            } else {
              console.error(`Failed to fetch dynamic fee for APR calc (${pool.pair}):`, await feeResponse.text());
            }
          }
        }

        // Calculate APR if all parts are available
        if (volume24hUSD !== undefined && dynamicFeeBps !== null && tvlUSD !== undefined && tvlUSD > 0) {
          const feeRate = dynamicFeeBps / 10000 / 100;
          const dailyFees = volume24hUSD * feeRate;
          const yearlyFees = dailyFees * 365;
          const apr = (yearlyFees / tvlUSD) * 100;
          calculatedApr = apr.toFixed(2) + '%';
          console.log(`Calculated APR for ${pool.pair}: ${calculatedApr} (Vol24h: ${volume24hUSD}, FeeBPS: ${dynamicFeeBps}, TVL: ${tvlUSD})`);
        } else {
          console.warn(`Could not calculate APR for ${pool.pair} due to missing data. Vol: ${volume24hUSD}, Fee: ${dynamicFeeBps}, TVL: ${tvlUSD}`);
          calculatedApr = "N/A"; // Set to N/A if calculation not possible
        }
        
        const completeFetchedStats: Partial<Pool> = {
          volume24hUSD,
          fees24hUSD,
          volume7dUSD,
          fees7dUSD,
          tvlUSD,
          apr: calculatedApr,
        };
        // Cache the combined stats including the newly calculated APR
        setToCache(statsCacheKey, completeFetchedStats);
        console.log(`[Cache SET] Cached combined stats for pool: ${pool.pair}, API ID: ${apiPoolId}`);
        return completeFetchedStats;

      } catch (error) {
        console.error(`Error fetching stats for ${pool.pair}:`, error);
        return {}; // Return empty on error
      }
    };

    const updateAllPoolStats = async () => {
      console.log("Starting to fetch/update stats for all pools...");
      const updatedPoolsPromises = poolsData.map(pool => 
        fetchPoolStats(pool).then(stats => ({ ...pool, ...stats }))
      );
      const updatedPools = await Promise.all(updatedPoolsPromises);
      console.log("Fetched stats, updating poolsData state:", updatedPools);
      setPoolsData(updatedPools);
    };

    if (poolsData.length > 0) { // Only run if there are pools to update
        updateAllPoolStats(); // Initial fetch
    }

    // Set up interval for periodic updates
    const intervalId = setInterval(() => {
      console.log("[LiquidityPage] Interval: Refreshing pool stats...");
      updateAllPoolStats();
    }, 60000); // Refresh every 60 seconds

    // Cleanup interval on component unmount
    return () => {
      clearInterval(intervalId);
    };
  }, []); // Run once on component mount to set up initial fetch and interval

  // Calculate pools with their position counts
  const poolsWithPositionCounts = useMemo(() => {
    return poolsData.map(pool => { // Use poolsData state here
      const [poolToken0Raw, poolToken1Raw] = pool.pair.split(' / ');
      const poolToken0 = poolToken0Raw?.trim().toUpperCase();
      const poolToken1 = poolToken1Raw?.trim().toUpperCase();
      
      const count = userPositions.filter(pos => {
        const posToken0 = pos.token0.symbol?.trim().toUpperCase();
        const posToken1 = pos.token1.symbol?.trim().toUpperCase();
        return (posToken0 === poolToken0 && posToken1 === poolToken1) ||
               (posToken0 === poolToken1 && posToken1 === poolToken0);
      }).length;
      
      return { ...pool, positionsCount: count };
    });
  }, [poolsData, userPositions]); // Depend on poolsData and userPositions

  // Calculate totals for stats
  const totals = React.useMemo(() => ({
    volume: chartData.reduce((acc, curr) => acc + curr.volume, 0),
    tvl: chartData.reduce((acc, curr) => acc + curr.tvl, 0),
  }), []);

  // Define the columns for the table
  const columns: ColumnDef<Pool>[] = [
    {
      accessorKey: "pair",
      header: "Pool",
      cell: ({ row }) => {
        const pool = row.original;
        return (
          <div className="flex items-center gap-2">
            <div className="relative w-14 h-7">
              <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                <Image 
                  src={pool.tokens[0].icon} 
                  alt={pool.tokens[0].symbol} 
                  width={28} 
                  height={28} 
                  className="w-full h-full object-cover" 
                />
              </div>
              <div className="absolute top-0 left-4 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                <Image 
                  src={pool.tokens[1].icon} 
                  alt={pool.tokens[1].symbol} 
                  width={28} 
                  height={28} 
                  className="w-full h-full object-cover" 
                />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-medium">{pool.pair}</span>
              {pool.positionsCount !== undefined && pool.positionsCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {pool.positionsCount} {pool.positionsCount === 1 ? 'position' : 'positions'}
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "volume24h",
      header: () => <div className="text-right w-full">Volume (24h)</div>,
      cell: ({ row }) => (
        <div className="text-right flex items-center justify-end gap-1">
          {typeof row.original.volume24hUSD === 'number' ? formatUSD(row.original.volume24hUSD) : row.original.volume24h}
          {/* Update icon logic if needed based on actual data later */}
          {typeof row.original.volume24hUSD === 'number' && row.original.volume24hUSD > 0 && (
            <Image
              src="/arrow_up.svg"
              alt="Volume Increase Icon"
              width={8}
              height={8}
              className="text-green-500"
            />
          )}
        </div>
      ),
      meta: {
        hideOnMobile: true,
        hidePriority: 3,
      }
    },
    {
      accessorKey: "volume7d",
      header: () => <div className="text-right w-full">Volume (7d)</div>,
      cell: ({ row }) => <div className="text-right">{typeof row.original.volume7dUSD === 'number' ? formatUSD(row.original.volume7dUSD) : row.original.volume7d}</div>,
      meta: {
        hideOnMobile: true,
        hidePriority: 2,
      }
    },
    {
      accessorKey: "fees24h",
      header: () => <div className="text-right w-full">Fees (24h)</div>,
      cell: ({ row }) => <div className="text-right">{typeof row.original.fees24hUSD === 'number' ? formatUSD(row.original.fees24hUSD) : row.original.fees24h}</div>,
      meta: {
        hideOnMobile: true,
        hidePriority: 2,
      }
    },
    {
      accessorKey: "fees7d",
      header: () => <div className="text-right w-full">Fees (7d)</div>,
      cell: ({ row }) => <div className="text-right">{typeof row.original.fees7dUSD === 'number' ? formatUSD(row.original.fees7dUSD) : row.original.fees7d}</div>,
      meta: {
        hideOnMobile: true,
        hidePriority: 1,
      }
    },
    {
      accessorKey: "liquidity",
      header: () => <div className="text-right w-full">Liquidity</div>,
      cell: ({ row }) => <div className="text-right">{typeof row.original.tvlUSD === 'number' ? formatUSD(row.original.tvlUSD) : row.original.liquidity}</div>,
    },
    {
      accessorKey: "apr",
      header: () => <div className="text-right w-full flex items-center justify-end">Yield</div>,
      cell: ({ row }) => {
        const aprValue = parseFloat(row.original.apr.replace('%', ''));
        const formattedAPR = aprValue.toFixed(2) + '%';
        // Determine the initial size based on the badge
        const initialWidthClass = 'w-16'; // Approximate width of the badge
        const initialHeightClass = 'h-6'; // Approximate height of the badge

        return (
          <div className={`relative flex items-center ${initialWidthClass} ${initialHeightClass} rounded-md bg-green-500/20 text-green-500 overflow-hidden ml-auto
                      group-hover:w-32 group-hover:h-8
                      group-hover:bg-transparent group-hover:text-foreground group-hover:border group-hover:border-border
                      group-hover:hover:bg-accent group-hover:hover:text-accent-foreground
                      transition-all duration-300 ease-in-out cursor-pointer`}
               onClick={(e) => handleAddLiquidity(e, row.original.id)}
          >
            {/* Percentage Text - visible by default, hidden on hover, centered within this container */}
            <span className="absolute inset-0 flex items-center justify-center opacity-100 group-hover:opacity-0 transition-opacity duration-300 ease-in-out">
              {formattedAPR}
            </span>
            {/* Add Liquidity Text - hidden by default, visible on hover, centered within this container */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-in-out px-2 whitespace-nowrap">
                <PlusIcon className="w-4 h-4 mr-2" />
                Add Liquidity
            </div>
          </div>
        );
      },
    },
  ];

  // Filter columns based on screen size and priority
  const visibleColumns = useMemo(() => {
    if (isMobile) {
       return columns; 
    }
    
    if (windowWidth < 900) { 
       return columns.filter(column => (column.meta as any)?.hidePriority === undefined || 
                                       (column.meta as any)?.hidePriority > 3);
    } else if (windowWidth < 1100) { 
       return columns.filter(column => (column.meta as any)?.hidePriority === undefined || 
                                       (column.meta as any)?.hidePriority > 2);
    } else if (windowWidth < 1280) { 
       return columns.filter(column => (column.meta as any)?.hidePriority === undefined || 
                                       (column.meta as any)?.hidePriority > 1);
    }
    
    return columns;
  }, [columns, isMobile, windowWidth]);
  
  // Initialize the table with filtered columns
  const table = useReactTable({
    data: poolsWithPositionCounts,
    columns: visibleColumns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    state: {
      sorting,
    },
  });

  const handlePoolClick = (poolId: string) => {
    toast.info("Pool details will be available in a few days.");
  };

  const handleAddLiquidity = (e: React.MouseEvent, poolId: string) => {
    e.stopPropagation();
    toast.info("Adding liquidity will be available in a few days.");
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col p-6 px-10">
          <div className="mb-6 mt-6">
            {!isMobile && (
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Liquidity Pools</h2>
                  <p className="text-sm text-muted-foreground">
                    Explore and manage your liquidity positions.
                  </p>
                </div>
              </div>
            )}
            
            {isMobile ? (
              <MobileLiquidityList 
                pools={poolsWithPositionCounts}
                onSelectPool={handlePoolClick}
              />
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead 
                            key={header.id} 
                            className={`${header.column.id !== 'pair' ? 'text-right' : ''}`}>
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows?.length ? (
                      table.getRowModel().rows.map((row) => (
                        <TableRow
                          key={row.id}
                          className={`group cursor-pointer transition-colors ${
                            row.original.highlighted ? 'bg-accent/10 hover:bg-accent/15' : 'hover:bg-muted/10'
                          }`}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell 
                              key={cell.id} 
                              onClick={() => handlePoolClick(row.original.id)}
                              className={`${cell.column.id !== 'pair' ? 'text-right' : ''} relative`}
                            >
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={columns.length}
                          className="h-24 text-center"
                        >
                          No pools available.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Add Liquidity Modal */}
      <AddLiquidityModal
        isOpen={addLiquidityOpen}
        onOpenChange={setAddLiquidityOpen}
        selectedPoolId={selectedPoolId}
        onLiquidityAdded={() => {
          // Fetch all user positions again after adding liquidity
          if (isConnected && accountAddress) {
            fetch(`/api/liquidity/get-positions?ownerAddress=${accountAddress}`)
              .then(res => res.json())
              .then((data: ProcessedPosition[] | { message: string }) => {
                if (Array.isArray(data)) {
                  setUserPositions(data);
                }
              })
              .catch(error => {
                console.error("Failed to refresh positions:", error);
              });
          }
        }}
      />
    </AppLayout>
  );
} 