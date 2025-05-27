"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PlusIcon, RefreshCwIcon, XIcon, CheckIcon, MinusIcon, ZoomInIcon, ZoomOutIcon, RefreshCcwIcon, InfinityIcon, InfoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Dialog, 
  DialogFooter,
  DialogPortal,
  DialogOverlay
} from "@/components/ui/dialog";
import * as RadixDialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { 
    useAccount, 
    useWriteContract, 
    useSendTransaction, 
    useWaitForTransactionReceipt,
    useBalance,
    useSignTypedData
} from "wagmi";
import { toast } from "sonner";
import { TOKEN_DEFINITIONS, TokenSymbol, V4_POOL_FEE, V4_POOL_TICK_SPACING, V4_POOL_HOOKS } from "@/lib/swap-constants"; // Adjusted path
import { baseSepolia } from "@/lib/wagmiConfig"; // Adjusted path
import { ERC20_ABI } from "@/lib/abis/erc20"; // Adjusted path
import { type Hex, formatUnits as viemFormatUnits, getAddress, parseUnits as viemParseUnits } from "viem"; // Removed parseAbiItem here
import { Token } from '@uniswap/sdk-core'; // Added for pool ID derivation
import { Pool as V4Pool } from "@uniswap/v4-sdk"; // Added for pool ID derivation
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  ResponsiveContainer, 
  ComposedChart, 
  Area, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ReferenceArea, 
  ReferenceLine 
} from 'recharts';
import { motion } from "framer-motion";

// Utility function (copied from app/liquidity/page.tsx)
const formatTokenDisplayAmount = (amount: string) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0.00";
  if (num < 0.0001) return "< 0.0001";
  return num.toFixed(4);
};

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

// Minimal ABI for Permit2.permit function, defined as a full ABI array for robustness
const PERMIT2_PERMIT_ABI_MINIMAL = [
  {
    "inputs": [
      { "internalType": "address", "name": "owner", "type": "address" },
      {
        "components": [
          {
            "components": [
              { "internalType": "address", "name": "token", "type": "address" },
              { "internalType": "uint160", "name": "amount", "type": "uint160" },
              { "internalType": "uint48", "name": "expiration", "type": "uint48" },
              { "internalType": "uint48", "name": "nonce", "type": "uint48" }
            ],
            "internalType": "struct ISignatureTransfer.PermitDetails",
            "name": "details",
            "type": "tuple"
          },
          { "internalType": "address", "name": "spender", "type": "address" },
          { "internalType": "uint256", "name": "sigDeadline", "type": "uint256" }
        ],
        "internalType": "struct ISignatureTransfer.PermitSingle",
        "name": "permitSingle",
        "type": "tuple"
      },
      { "internalType": "bytes", "name": "signature", "type": "bytes" }
    ],
    "name": "permit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const; // Use 'as const' for better type inference with Viem

export interface AddLiquidityModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onLiquidityAdded: () => void; 
  selectedPoolId?: string;
  sdkMinTick: number;
  sdkMaxTick: number;
  defaultTickSpacing: number;
  poolApr?: string; // New prop for pool APR
}

export function AddLiquidityModal({ 
  isOpen, 
  onOpenChange, 
  onLiquidityAdded, 
  selectedPoolId,
  sdkMinTick,
  sdkMaxTick,
  defaultTickSpacing,
  poolApr // Destructure new prop
}: AddLiquidityModalProps) {
  const { address: accountAddress, chainId } = useAccount();
  const [token0Symbol, setToken0Symbol] = useState<TokenSymbol>('YUSDC');
  const [token1Symbol, setToken1Symbol] = useState<TokenSymbol>('BTCRL');
  const [amount0, setAmount0] = useState<string>("");
  const [amount1, setAmount1] = useState<string>("");
  const [tickLower, setTickLower] = useState<string>(sdkMinTick.toString());
  const [tickUpper, setTickUpper] = useState<string>(sdkMaxTick.toString());
  const [currentPoolTick, setCurrentPoolTick] = useState<number | null>(null);
  const [activeInputSide, setActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculatedData, setCalculatedData] = useState<{
    liquidity: string;
    finalTickLower: number;
    finalTickUpper: number;
    amount0: string; // Renamed from calculatedAmount0 for consistency with API response
    amount1: string; // Renamed from calculatedAmount1
    currentPoolTick?: number; // Added from API response
    currentPrice?: string;    // Added from API response
    priceAtTickLower?: string;
    priceAtTickUpper?: string;
  } | null>(null);
  // Keep separate state for currentPrice, priceAtTickLower/Upper for now, as other parts of the modal might use them directly.
  // The calculatedData object will now also hold them for the price string effect.
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);
  const [priceAtTickLower, setPriceAtTickLower] = useState<string | null>(null);
  const [priceAtTickUpper, setPriceAtTickUpper] = useState<string | null>(null);
  
  const [isWorking, setIsWorking] = useState(false);
  const [step, setStep] = useState<'input' | 'approve' | 'mint' | 'permit2Sign'>('input');
  const [preparedTxData, setPreparedTxData] = useState<any>(null);

  // New state for Permit2 signature request details
  const [permit2SignatureRequest, setPermit2SignatureRequest] = useState<{
    domain: any;
    types: any;
    primaryType: string;
    message: any;
    permit2Address: Hex;
    approvalTokenSymbol: TokenSymbol; 
  } | null>(null);

  // State for tracking transaction flow steps
  const [permit2StepsCompletedCount, setPermit2StepsCompletedCount] = useState<number>(0);

  // const [maxErc20ApprovalsInCurrentTx, setMaxErc20ApprovalsInCurrentTx] = useState<number>(0); // Combined
  // const [maxPermit2SignaturesInCurrentTx, setMaxPermit2SignaturesInCurrentTx] = useState<number>(0); // Combined
  const [maxPermit2StepsInCurrentTx, setMaxPermit2StepsInCurrentTx] = useState<number>(0);

  const [activePreset, setActivePreset] = useState<string | null>("±15%");
  const [baseTokenForPriceDisplay, setBaseTokenForPriceDisplay] = useState<TokenSymbol>(token0Symbol);

  // --- BEGIN New Chart State ---
  interface ChartDataPoint {
    price: number;
    liquidity: number;
  }
  const [chartData, setChartData] = useState<Array<ChartDataPoint>>([]);
  const [xDomain, setXDomain] = useState<[number, number]>([30000, 50000]);
  const [currentPriceLine, setCurrentPriceLine] = useState<number | null>(null);
  const [mockSelectedPriceRange, setMockSelectedPriceRange] = useState<[number, number] | null>(null);
  // --- END New Chart State ---

  // --- BEGIN Panning State ---
  const [isPanning, setIsPanning] = useState(false);
  const panStartXRef = useRef<number | null>(null);
  const panStartDomainRef = useRef<[number, number] | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null); // Ref for the chart container
  // --- END Panning State ---

  const [minPriceInputString, setMinPriceInputString] = useState<string>("");
  const [maxPriceInputString, setMaxPriceInputString] = useState<string>("");

  const [isPoolStateLoading, setIsPoolStateLoading] = useState<boolean>(false);

  const getTokenIcon = (symbol?: string) => {
    if (symbol?.toUpperCase().includes("YUSD")) return "/YUSD.png";
    if (symbol?.toUpperCase().includes("BTCRL")) return "/BTCRL.png";
    return "/default-token.png";
  };

  const { data: token0BalanceData, isLoading: isLoadingToken0Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[token0Symbol]?.addressRaw as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[token0Symbol]?.addressRaw },
  });

  const { data: token1BalanceData, isLoading: isLoadingToken1Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[token1Symbol]?.addressRaw as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS[token1Symbol]?.addressRaw },
  });

  const [initialDefaultApplied, setInitialDefaultApplied] = useState(false);

  useEffect(() => {
    setBaseTokenForPriceDisplay(token0Symbol); 
  }, [token0Symbol]);

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
          setTickLower(sdkMinTick.toString());
          setTickUpper(sdkMaxTick.toString());
          setCurrentPoolTick(null);
          setCalculatedData(null);
          setActiveInputSide(null);
          setCurrentPrice(null); 
          setPriceAtTickLower(null); 
          setPriceAtTickUpper(null); 
          setInitialDefaultApplied(false);
          setActivePreset("±15%"); // Reset preset on pool change
          setBaseTokenForPriceDisplay(t0); // Reset base token for price display
          // Reset chart specific states too
          setChartData([]);
          setCurrentPriceLine(null);
          setMockSelectedPriceRange(null);
          // Do not reset xDomain here, allow it to be driven by new data or reset explicitly if needed
        }
      }
    }
  }, [isOpen, selectedPoolId, sdkMinTick, sdkMaxTick]);

  useEffect(() => {
    setInitialDefaultApplied(false);
    setTickLower(sdkMinTick.toString());
    setTickUpper(sdkMaxTick.toString());
    setAmount0("");
    setAmount1("");
    setCalculatedData(null);
    setCurrentPoolTick(null); 
    setPriceAtTickLower(null);
    setPriceAtTickUpper(null);
    setCurrentPrice(null);
    setActivePreset("±15%"); // Reset preset on token/chain change
    setBaseTokenForPriceDisplay(token0Symbol); // Reset base token for price display
    // Reset chart specific states too
    setChartData([]);
    setCurrentPriceLine(null);
    setMockSelectedPriceRange(null);
  }, [token0Symbol, token1Symbol, chainId, sdkMinTick, sdkMaxTick]);

  // Effect to fetch initial pool state (current price and tick)
  useEffect(() => {
    if (isOpen && token0Symbol && token1Symbol && chainId && !calculatedData && !initialDefaultApplied) {
      const fetchPoolState = async () => {
        setIsPoolStateLoading(true);
        // toast.loading("Fetching pool data...", { id: "pool-state-fetch" }); // Redundant if preset application shows loading
        try {
          const response = await fetch('/api/liquidity/get-pool-state', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token0Symbol,
              token1Symbol,
              chainId,
            }),
          });
          
          if (!response.ok) {
            // toast.dismiss("pool-state-fetch");
            const errorData = await response.json();
            throw new Error(errorData.message || "Failed to fetch initial pool state.");
          }
          const poolState = await response.json();
          // toast.dismiss("pool-state-fetch");

          if (poolState.currentPrice && typeof poolState.currentPoolTick === 'number') {
            setCurrentPrice(poolState.currentPrice); // This will trigger the preset application effect
            setCurrentPoolTick(poolState.currentPoolTick);
             const numericCurrentPrice = parseFloat(poolState.currentPrice);
            if (!isNaN(numericCurrentPrice)) {
                setCurrentPriceLine(numericCurrentPrice);
                 // Initialize xDomain centered around the new current price, chart effect might refine this.
                setXDomain([numericCurrentPrice * 0.5, numericCurrentPrice * 1.5]);
            }
          } else {
            throw new Error("Pool state data is incomplete.");
          }
        } catch (error: any) {
          // toast.dismiss("pool-state-fetch");
          toast.error("Pool Data Error", { description: error.message });
          // Potentially clear currentPrice/Tick or set to error state if needed
        } finally {
          setIsPoolStateLoading(false);
        }
      };
      fetchPoolState();
    }
  }, [isOpen, token0Symbol, token1Symbol, chainId, initialDefaultApplied, calculatedData]); // Added calculatedData to prevent re-fetch if amounts already caused a calculation

  const debouncedCalculateDependentAmount = useCallback(
    debounce(async (currentAmount0: string, currentAmount1: string, currentTickLower: string, currentTickUpper: string, inputSide: 'amount0' | 'amount1') => {
      if (!chainId) return;

      // Update mock current pool tick when params change for graph visualization
      // This is a simplified mock, real value would come from API
      // Removed this as currentPoolTick is now primarily set by get-pool-state or calculate-liquidity-parameters
      // if (currentPoolTick === null) setCurrentPoolTick(Math.round((parseInt(currentTickLower) + parseInt(currentTickUpper)) / 2 / defaultTickSpacing) * defaultTickSpacing);

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
      
      // Early return if primaryAmount is "Error" or not a parsable number
      if (primaryAmount === "Error" || isNaN(parseFloat(primaryAmount))) {
        setCalculatedData(null);
        if (inputSide === 'amount0' && currentAmount1 !== "Error") setAmount1("");
        else if (inputSide === 'amount1' && currentAmount0 !== "Error") setAmount0("");
        // Do not toast here, as this state might be intermediate from another error
        return;
      }
      
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
        
        setCalculatedData({
            liquidity: result.liquidity, 
            finalTickLower: result.finalTickLower, 
            finalTickUpper: result.finalTickUpper, 
            amount0: result.amount0, // Store directly from API
            amount1: result.amount1, // Store directly from API
            currentPoolTick: result.currentPoolTick, // Store from API
            currentPrice: result.currentPrice,       // Store from API
            priceAtTickLower: result.priceAtTickLower, // Store from API
            priceAtTickUpper: result.priceAtTickUpper   // Store from API
        });

        if (typeof result.currentPoolTick === 'number') {
            setCurrentPoolTick(result.currentPoolTick); // Update from this more comprehensive call
        }
        if (result.currentPrice) {
            setCurrentPrice(result.currentPrice); // Update from this more comprehensive call
            const numericCurrentPrice = parseFloat(result.currentPrice);
            if (!isNaN(numericCurrentPrice)) {
                setCurrentPriceLine(numericCurrentPrice); 
                // Update xDomain to be centered around the new current price
                // This will be further adjusted by generateMockData if it sets a different domain based on data points
                // Only update if significantly different or not yet set properly
                if (xDomain[0] === 30000 && xDomain[1] === 50000 || Math.abs( (xDomain[0]+xDomain[1])/2 - numericCurrentPrice) > numericCurrentPrice * 0.25 ) {
                  setXDomain([numericCurrentPrice * 0.5, numericCurrentPrice * 1.5]); 
                }
            }
        }
        if (result.priceAtTickLower) setPriceAtTickLower(result.priceAtTickLower);
        if (result.priceAtTickUpper) setPriceAtTickUpper(result.priceAtTickUpper);

        if (inputSide === 'amount0') {
            try {
                setAmount1(formatTokenDisplayAmount(viemFormatUnits(BigInt(result.amount1), TOKEN_DEFINITIONS[secondaryTokenSymbol]?.decimals || 18)));
            } catch (e) {
                setAmount1("Error"); // Indicate error in the UI field
                toast.error("Calculation Error", { description: "Could not parse calculated amount for the other token. The amount might be too large or invalid." });
                setCalculatedData(null); // Invalidate calculated data
            }
        } else {
            try {
                setAmount0(formatTokenDisplayAmount(viemFormatUnits(BigInt(result.amount0), TOKEN_DEFINITIONS[secondaryTokenSymbol]?.decimals || 18)));
            } catch (e) {
                setAmount0("Error");
                toast.error("Calculation Error", { description: "Could not parse calculated amount for the other token. The amount might be too large or invalid." });
                setCalculatedData(null); // Invalidate calculated data
            }
        }

        // Only update ticks from API if not in "Full Range" mode,
        // as "Full Range" has its ticks set explicitly and should maintain them.
        // AND the initial default logic below should also respect this.

        // If Full Range is active, this initial default application should be skipped.
        // The initial default application logic here might be redundant if the new get-pool-state + preset effect works correctly.
        // We should ensure that setInitialDefaultApplied(true) is called appropriately by the preset application logic.
        // For now, let's comment out this block to see if the primary preset logic handles it.
        /*
        if (activePreset !== "Full Range" && !initialDefaultApplied && result.currentPoolTick !== null && result.currentPoolTick !== undefined) {
          const LOG_1_0001 = 0.0000999950003;
          const PRICE_CHANGE_LOWER_RATIO = 0.25; 
          const PRICE_CHANGE_UPPER_RATIO = 1.75; 

          const deltaTickLower = Math.round(Math.log(PRICE_CHANGE_LOWER_RATIO) / LOG_1_0001);
          const deltaTickUpper = Math.round(Math.log(PRICE_CHANGE_UPPER_RATIO) / LOG_1_0001);

          let defaultLower = result.currentPoolTick + deltaTickLower;
          let defaultUpper = result.currentPoolTick + deltaTickUpper;

          defaultLower = Math.round(defaultLower / defaultTickSpacing) * defaultTickSpacing;
          defaultUpper = Math.round(defaultUpper / defaultTickSpacing) * defaultTickSpacing;
          
          defaultLower = Math.max(sdkMinTick, Math.min(sdkMaxTick, defaultLower));
          defaultUpper = Math.max(sdkMinTick, Math.min(sdkMaxTick, defaultUpper));

          if (defaultLower >= defaultUpper) { 
            setTickLower(sdkMinTick.toString());
            setTickUpper(sdkMaxTick.toString());
            setPriceAtTickLower(result.priceAtTickLower);
            setPriceAtTickUpper(result.priceAtTickUpper);
          } else {
            setTickLower(defaultLower.toString());
            setTickUpper(defaultUpper.toString());
            setPriceAtTickLower(null); 
            setPriceAtTickUpper(null); 
          }
          setInitialDefaultApplied(true); 
        } else {
        */
          // If not applying initial defaults, or if Full Range is active (which skips the above block),
          // then decide whether to update ticks from API (if not Full Range)
          // or just update price points if Full Range is active.
          if (activePreset !== "Full Range") {
            if (result.finalTickLower.toString() !== currentTickLower) {
          setTickLower(result.finalTickLower.toString());
            }
            if (result.finalTickUpper.toString() !== currentTickUpper) {
          setTickUpper(result.finalTickUpper.toString());
            }
          }
          // Always update priceAtTickLower/Upper from the API result in this path if they are provided
          if (result.priceAtTickLower) setPriceAtTickLower(result.priceAtTickLower);
          if (result.priceAtTickUpper) setPriceAtTickUpper(result.priceAtTickUpper);
        // } // End of commented out block

      } catch (error: any) {
        toast.error("Calculation Error", { description: error.message || "Could not estimate amounts." });
        setCalculatedData(null);
        if (inputSide === 'amount0' && amount1 !== "Error") setAmount1(""); 
        else if (inputSide === 'amount1' && amount0 !== "Error") setAmount0("");
      } finally {
        setIsCalculating(false);
      }
    }, 500),
    [token0Symbol, token1Symbol, chainId, initialDefaultApplied, sdkMinTick, sdkMaxTick, defaultTickSpacing, activePreset] // Added activePreset to dependencies
  );

  useEffect(() => {
    // Determine max possible Permit2 steps for the current attempt
    let potentialMaxSteps = 0;
    if (parseFloat(amount0 || "0") > 0) potentialMaxSteps += 2; // 1 ERC20_TO_PERMIT2 + 1 PERMIT2_SIGNATURE_FOR_PM
    if (parseFloat(amount1 || "0") > 0) potentialMaxSteps += 2; // for token1
    setMaxPermit2StepsInCurrentTx(potentialMaxSteps);

    // Reset completed count if amounts change, as it implies a new attempt context
    setPermit2StepsCompletedCount(0);

    if (activeInputSide) {
        if (activeInputSide === 'amount0') {
            debouncedCalculateDependentAmount(amount0, amount1, tickLower, tickUpper, 'amount0');
        } else if (activeInputSide === 'amount1') {
            debouncedCalculateDependentAmount(amount0, amount1, tickLower, tickUpper, 'amount1');
    }
    } else {
        if (parseFloat(amount0) > 0) {
            debouncedCalculateDependentAmount(amount0, amount1, tickLower, tickUpper, 'amount0');
        } else if (parseFloat(amount1) > 0) {
            debouncedCalculateDependentAmount(amount0, amount1, tickLower, tickUpper, 'amount1');
        } else {
            setCalculatedData(null);
        }
    }
  }, [amount0, amount1, tickLower, tickUpper, activeInputSide, token0Symbol, token1Symbol, debouncedCalculateDependentAmount]);


  const handlePrepareMint = async (isAfterApproval = false) => {
    if (!accountAddress || !chainId) {
      toast.error("Please connect your wallet.");
      return;
    }

    // Determine inputAmount and inputTokenSymbol based on activeInputSide or filled amounts
    let finalInputAmount: string | undefined;
    let finalInputTokenSymbol: TokenSymbol | undefined;

    if (activeInputSide === 'amount0' && amount0 && parseFloat(amount0) > 0) {
        finalInputAmount = amount0;
        finalInputTokenSymbol = token0Symbol;
    } else if (activeInputSide === 'amount1' && amount1 && parseFloat(amount1) > 0) {
        finalInputAmount = amount1;
        finalInputTokenSymbol = token1Symbol;
    } else if (amount0 && parseFloat(amount0) > 0 && (!amount1 || parseFloat(amount1) <= 0)) {
        // If only amount0 is filled and no active side, assume amount0 is the input
        finalInputAmount = amount0;
        finalInputTokenSymbol = token0Symbol;
    } else if (amount1 && parseFloat(amount1) > 0 && (!amount0 || parseFloat(amount0) <= 0)) {
        // If only amount1 is filled and no active side, assume amount1 is the input
        finalInputAmount = amount1;
        finalInputTokenSymbol = token1Symbol;
    } else if (amount0 && parseFloat(amount0) > 0) {
        // Fallback: if both potentially filled but no activeInputSide, prefer amount0 as input
        // This case should ideally be covered by activeInputSide or clear one field logic
        finalInputAmount = amount0;
        finalInputTokenSymbol = token0Symbol;
    } else if (amount1 && parseFloat(amount1) > 0) {
        // Fallback: if only amount1 is filled
        finalInputAmount = amount1;
        finalInputTokenSymbol = token1Symbol;
    }

    if (!finalInputAmount || !finalInputTokenSymbol) {
        toast.error("Please enter an amount for at least one token.");
        // Ensure not to proceed if these are undefined.
        // This check might be redundant if the button is disabled correctly, but good for safety.
        return;
    }

    // const rawAmount0 = calculatedData?.calculatedAmount0; // OLD
    // const rawAmount1 = calculatedData?.calculatedAmount1; // OLD

    // console.log("[AddLiquidityModal] DEBUG: Calling handlePrepareMint. Raw amounts from calculatedData:", { rawAmount0, rawAmount1 }); // OLD
    console.log("[AddLiquidityModal] DEBUG: Calling handlePrepareMint with:", { finalInputAmount, finalInputTokenSymbol, tickLower, tickUpper });

    const finalTickLowerNum = calculatedData?.finalTickLower ?? parseInt(tickLower);
    const finalTickUpperNum = calculatedData?.finalTickUpper ?? parseInt(tickUpper);

    // if (!rawAmount0 || !rawAmount1) { // OLD
    //   toast.error("Calculated amounts are missing. Please ensure amounts are correctly calculated.");
    //   return;
    // }
    // if ((BigInt(rawAmount0) <= 0n) && (BigInt(rawAmount1) <= 0n)) { // OLD
    //   toast.error("Please enter or calculate a valid amount for at least one token.");
    //   return;
    // }

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
          inputAmount: finalInputAmount,         
          inputTokenSymbol: finalInputTokenSymbol, 
          userTickLower: finalTickLowerNum,
          userTickUpper: finalTickUpperNum,
          chainId: chainId ?? baseSepolia.id,
        }),
      });
      toast.dismiss("prepare-mint");
      const data = await response.json();

      if (!response.ok) {
        const err = new Error(data.message || "Failed to prepare transaction.");
        throw err; 
      }

      setPreparedTxData(data); // Store the raw data

      if (data.needsApproval) {
        if (data.approvalType === 'ERC20_TO_PERMIT2') {
          toast.info(`ERC20 Approval for Permit2 needed for ${data.approvalTokenSymbol}`, {
            description: `You need to approve Permit2 to use your ${data.approvalTokenSymbol}.`
          });
          setStep('approve'); 
        } else if (data.approvalType === 'PERMIT2_SIGNATURE_FOR_PM') {
          toast.info(`Permit2 Signature needed for ${data.approvalTokenSymbol}`, {
            description: `Please sign the message to allow the Position Manager to use your ${data.approvalTokenSymbol} via Permit2.`
          });
          setPermit2SignatureRequest({
            domain: data.signatureDetails.domain,
            types: data.signatureDetails.types,
            primaryType: data.signatureDetails.primaryType,
            message: data.signatureDetails.message,
            permit2Address: data.permit2Address,
            approvalTokenSymbol: data.approvalTokenSymbol
          });
          setStep('permit2Sign');
        } else {
          // Fallback for unknown approval type, though backend should be specific
          toast.error("Unknown Approval Needed", { description: "An unspecified approval is required." });
          setStep('input'); // Or some error step
        }
      } else {
        toast.success("Transaction ready to mint!");
        setStep('mint');
      }
    } catch (error: any) {
      toast.dismiss("prepare-mint");
      // Check if the error message indicates the specific Permit2 spender allowance issue
      if (error && typeof error.message === 'string' && 
          (error.message.includes("Position Manager does not have sufficient allowance from Permit2") || 
           error.message.includes("Permit2 allowance for the Position Manager to spend") /* Catches expiration too */) 
         ) {
           toast.error("Permit2 Authorization Incomplete", { 
               description: error.message + " This step often requires signing a message or a separate one-time transaction to authorize the Position Manager via Permit2.",
               duration: 12000 // Longer duration for this important message
           });
      } else {
           toast.error("Error Preparing Transaction", { description: error.message || "Unknown error during preparation." });
      }
      
    } finally {
      if (!isAfterApproval) setIsWorking(false);
    }
  };

  const { data: approveTxHash, error: approveWriteError, isPending: isApproveWritePending, writeContractAsync: approveERC20Async, reset: resetApproveWriteContract } = useWriteContract();
  const { isLoading: isApproving, isSuccess: isApproved, error: approveReceiptError } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { data: mintTxHash, error: mintSendError, isPending: isMintSendPending, sendTransactionAsync, reset: resetSendTransaction } = useSendTransaction();
  const { isLoading: isMintConfirming, isSuccess: isMintConfirmed, error: mintReceiptError } = useWaitForTransactionReceipt({ hash: mintTxHash });

  // Wagmi hooks for Permit2.permit() transaction
  const { 
    data: permit2TxHash, 
    error: permit2SendError, 
    isPending: isPermit2SendPending, 
    writeContractAsync: permit2WriteContractAsync, // Using writeContractAsync for Permit2.permit
    reset: resetPermit2WriteContract 
  } = useWriteContract();
  const { 
    isLoading: isPermit2Confirming, 
    isSuccess: isPermit2Confirmed, 
    error: permit2ReceiptError 
  } = useWaitForTransactionReceipt({ hash: permit2TxHash });

  useEffect(() => {
    if (isApproved) {
      toast.success("Approval successful!");
      // setErc20ApprovalsDoneCount(prev => prev + 1); // Combined
      setPermit2StepsCompletedCount(prev => prev + 1);      
      resetApproveWriteContract(); 
      if (preparedTxData) {
        // Call handlePrepareMint to re-evaluate, which might set step to 'mint'
        // It will also handle toast messages for 'Transaction ready to mint!'
        handlePrepareMint(true); 
      }
      // After approval and re-preparation, the system is waiting for the user to click "Confirm Mint"
      // So, it's no longer "working" on an automated step.
      setIsWorking(false); 
    }
    if (approveWriteError || approveReceiptError) {
      const errorMsg = approveWriteError?.message || approveReceiptError?.message || "Approval transaction failed.";
      toast.error("Approval failed", { description: errorMsg });
      setIsWorking(false);
      resetApproveWriteContract();
      setPreparedTxData(null);
      setStep('input'); 
    }
  }, [isApproved, approveWriteError, approveReceiptError, preparedTxData, resetApproveWriteContract, handlePrepareMint]);

  const resetInternalTxState = useCallback(() => {
    setStep('input');
    setPreparedTxData(null);
    setPermit2SignatureRequest(null); 
    setIsWorking(false);
    // setErc20ApprovalsDoneCount(0); // Combined
    // setPermit2SignaturesDoneCount(0); // Combined
    setPermit2StepsCompletedCount(0); 
    // setMaxErc20ApprovalsInCurrentTx(0); // Combined
    // setMaxPermit2SignaturesInCurrentTx(0); // Combined
    setMaxPermit2StepsInCurrentTx(0); 
    resetApproveWriteContract();
    resetSendTransaction();
    resetPermit2WriteContract(); // Reset Permit2 hook
  }, [resetApproveWriteContract, resetSendTransaction, resetPermit2WriteContract]);

  useEffect(() => {
    if (isMintConfirmed) {
      toast.success("Liquidity minted successfully!", { id: "mint-tx" });
      onLiquidityAdded();
      resetInternalTxState(); // Explicitly reset internal TX state here
      onOpenChange(false);    // Then close the modal
      resetSendTransaction(); // Wagmi hook reset
    }
    if (mintSendError || mintReceiptError) {
      const errorMsg = mintSendError?.message || mintReceiptError?.message || "Minting transaction failed.";
      toast.error("Minting failed", { id: "mint-tx", description: errorMsg });
      
      setIsWorking(false);
      resetSendTransaction();
      // If minting fails, allow user to try again or adjust
      setStep('mint'); // Stay on mint step, or consider 'input' if full reset is better
      // setPreparedTxData(null); // Optional: force re-preparation if mint fails catastrophically
    }
  }, [isMintConfirmed, mintSendError, mintReceiptError, onLiquidityAdded, onOpenChange, resetSendTransaction, resetInternalTxState]);

  // useEffect to handle Permit2.permit() transaction result
  useEffect(() => {
    if (isPermit2Confirmed) {
      toast.success("Permit2 call successful!", { id: "permit2-submit" });
      // setPermit2SignaturesDoneCount(prev => prev + 1); // Combined
      setPermit2StepsCompletedCount(prev => prev + 1);
      resetPermit2WriteContract();
      if (preparedTxData) { // Re-check state with backend
        handlePrepareMint(true); 
      }
      setIsWorking(false);
    }
    if (permit2SendError || permit2ReceiptError) {
      const errorMsg = permit2SendError?.message || permit2ReceiptError?.message || "Permit2 transaction failed.";
      toast.error("Permit2 Submission Failed", { id: "permit2-submit", description: errorMsg });
      setIsWorking(false);
      resetPermit2WriteContract();
      // Potentially revert step or allow user to retry
      // setStep('input'); 
      // setPermit2SignatureRequest(null);
    }
  }, [isPermit2Confirmed, permit2SendError, permit2ReceiptError, preparedTxData, resetPermit2WriteContract, handlePrepareMint]);

  const resetForm = () => {
    setToken0Symbol('YUSDC');
    setToken1Symbol('BTCRL');
    setAmount0("");
    setAmount1("");
    setTickLower(sdkMinTick.toString());
    setTickUpper(sdkMaxTick.toString());
    setCurrentPoolTick(null);
    setActiveInputSide(null);
    setCalculatedData(null);
    setCurrentPrice(null); 
    setPriceAtTickLower(null); 
    setPriceAtTickUpper(null); 
    setIsWorking(false);
    setStep('input');
    setPreparedTxData(null);
    setInitialDefaultApplied(false);
    setActivePreset("±15%");
    setBaseTokenForPriceDisplay(token0Symbol);
    setPermit2SignatureRequest(null); // Reset Permit2 request state here too

    // Explicitly reset wagmi hook states
    resetApproveWriteContract();
    resetSendTransaction();
    resetPermit2WriteContract(); // Reset Permit2 hook

    // Chart related state resets
    // setPoolDailyFeesUSD(null);
  };

  const handleSetFullRange = () => {
    setTickLower(sdkMinTick.toString());
    setTickUpper(sdkMaxTick.toString());
    setInitialDefaultApplied(true);
    setMinPriceInputString(baseTokenForPriceDisplay === token0Symbol ? "0" : "∞");
    setMaxPriceInputString(baseTokenForPriceDisplay === token0Symbol ? "∞" : "0");
  };

  const handleSwapTokens = () => {
    setToken0Symbol(token1Symbol);
    setToken1Symbol(token0Symbol);
    setAmount0(amount1);
    setAmount1(amount0);
    setActiveInputSide(activeInputSide === 'amount0' ? 'amount1' : activeInputSide === 'amount1' ? 'amount0' : null);
    setCalculatedData(null); 
  };

  const handleApprove = async () => {
    if (!preparedTxData?.needsApproval || !approveERC20Async) return;

    if (!accountAddress || chainId === undefined || chainId === null) {
      toast.error("Wallet not connected or chain not identified. Please reconnect.");
      setIsWorking(false);
      return;
    }

    setIsWorking(true);
    toast.loading(`Approving ${preparedTxData.approvalTokenSymbol}...`, { id: "approve-tx" });
    try {
      const approvalAmountBigInt = BigInt(preparedTxData.approvalAmount);

      if (chainId !== baseSepolia.id) {
        toast.error("Network Mismatch", { description: `Please switch to ${baseSepolia.name} to approve this transaction.` });
        setIsWorking(false);
        return;
      }

      await approveERC20Async({
        address: preparedTxData.approvalTokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [preparedTxData.approveToAddress as `0x${string}`, approvalAmountBigInt],
        account: accountAddress,
        chain: baseSepolia,
      });
    } catch (err: any) {
      toast.dismiss("approve-tx");
      
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

  const handleUseFullBalance = (balanceString: string, tokenSymbolForDecimals: TokenSymbol, isToken0: boolean) => { 
    try {
      const numericBalance = parseFloat(balanceString);
      if (isNaN(numericBalance) || numericBalance <= 0) return;

      const formattedBalance = numericBalance.toFixed(TOKEN_DEFINITIONS[tokenSymbolForDecimals]?.decimals || 18);

      if (isToken0) {
        setAmount0(formattedBalance);
        setActiveInputSide('amount0');
        if (activeInputSide === 'amount0' || activeInputSide === null) { 
            debouncedCalculateDependentAmount(formattedBalance, amount1, tickLower, tickUpper, 'amount0');
        }
      } else { 
        setAmount1(formattedBalance);
        setActiveInputSide('amount1');
         if (activeInputSide === 'amount1' || activeInputSide === null) { 
            debouncedCalculateDependentAmount(amount0, formattedBalance, tickLower, tickUpper, 'amount1');
        }
      }
    } catch (error) {
      
    }
  };

  // Mock function to convert tick to price (highly simplified for mockup)
  const mockTickToPrice = useCallback((tick: number, basePrice = 50000, tickSpacing = 60, priceChangePerTick = 0.0001) => {
    // This is a placeholder. Real conversion is Math.pow(1.0001, tick)
    // For mockup, let's use a simpler linear-ish mapping around a central price
    const numTicks = tick / tickSpacing;
    return basePrice * Math.pow(1 + priceChangePerTick * tickSpacing, numTicks / 100); // Reduced impact for wider view
  }, []);

  // Generate Mock Chart Data
  useEffect(() => {
    // If currentPriceLine becomes null (e.g. pool change), clear existing chart data to force loading/unavailable state
    if (currentPriceLine === null && chartData.length > 0) {
        setChartData([]);
        // Optionally reset xDomain if it shouldn't persist without a current price context
        // setXDomain([30000, 50000]); // Or some other default if needed
    }

    if (currentPriceLine !== null) { // Only generate data if we have a current price
        const generateMockData = (basePriceForChart?: number, centerTickForChart?: number): Array<ChartDataPoint> => {
          const data: Array<ChartDataPoint> = [];
          const basePrice = basePriceForChart ?? 40000; 
          const priceRange = basePrice * 1; // Make price range relative to basePrice (e.g., 50% on each side)
          const numDataPoints = 200;
          // Center peak liquidity around the basePrice, or adjust based on centerTick if provided
          let peakLiquidityPrice = basePrice; 
          // TODO: If centerTickForChart is provided, adjust peakLiquidityPrice to align better with it if needed.
          // This might involve converting centerTickForChart to a price using Math.pow(1.0001, centerTickForChart)
          // and then deciding how it influences the mock distribution peak.

          for (let i = 0; i < numDataPoints; i++) {
            const price = (basePrice - (priceRange / 2)) + (priceRange / numDataPoints) * i;
            const distanceToPeak = Math.abs(price - peakLiquidityPrice);
            const liquidityFactor = Math.max(0, 1 - (distanceToPeak / (priceRange / 2))); // Liquidity decreases linearly from peak
            const liquidity = liquidityFactor * 1000 + Math.random() * 200; // Base liquidity + random variation
            data.push({ price: parseFloat(price.toFixed(2)), liquidity: parseFloat(liquidity.toFixed(2)) });
          }
          data.sort((a, b) => a.price - b.price);
          return data;
        };

        // Regenerate mock data if currentPriceLine or currentPoolTick changes significantly,
        // or if chartData is empty (initial load).
        // The primary trigger for debouncedCalculateDependentAmount will set currentPriceLine and currentPoolTick.
        // This effect now primarily reacts to currentPriceLine being populated.
        if (currentPriceLine !== null) {
            const mockData = generateMockData(currentPriceLine ?? undefined, currentPoolTick ?? undefined);
            setChartData(mockData);

            if (mockData.length > 0) {
              const minP = mockData[0].price;
              const maxP = mockData[mockData.length - 1].price;
              // Update xDomain if currentPriceLine is available and xDomain is still at default or price is out of view
              if (currentPriceLine < xDomain[0] || currentPriceLine > xDomain[1] || (xDomain[0] === 30000 && xDomain[1] === 50000)) {
                // Center domain around current price, using a portion of the mock data's overall range as spread
                const spread = (maxP - minP) / 2; // Example spread, can be adjusted
                setXDomain([Math.max(minP, currentPriceLine - spread /2), Math.min(maxP, currentPriceLine + spread/2)]);
              } else if (xDomain[0] === 30000 && xDomain[1] === 50000){ // If domain is default and price is within, use mock data range
                 setXDomain([minP, maxP]);
              }

              // Set mock selected range based on the new xDomain or a default if tick-based prices aren't ready
              if (!priceAtTickLower || !priceAtTickUpper) {
                 setMockSelectedPriceRange([minP + (maxP - minP) * 0.1, maxP - (maxP - minP) * 0.1]); 
              }
            } else {
               setChartData([]); // Ensure chart data is empty if mockData generation results in empty array
            }
        } else {
            setChartData([]); // Explicitly clear chart data if currentPriceLine is null
        }
    }
    
    // Initial currentPoolTick setting (if still null after other effects)
    if (currentPoolTick === null) {
        const initialCurrentTick = Math.round(((sdkMinTick + sdkMaxTick) / 2) / defaultTickSpacing) * defaultTickSpacing;
        setCurrentPoolTick(initialCurrentTick);
    }

  }, [currentPriceLine, currentPoolTick, sdkMinTick, sdkMaxTick, defaultTickSpacing, priceAtTickLower, priceAtTickUpper, xDomain]); // Dependencies for chart data regeneration


  const handleGraphZoomIn = () => {
    setXDomain(prevDomain => {
      const range = prevDomain[1] - prevDomain[0];
      const newRange = Math.max(range * 0.8, 100); // Zoom in by 20%, min range 100
      const mid = (prevDomain[0] + prevDomain[1]) / 2;
      return [mid - newRange / 2, mid + newRange / 2];
    });
  };
  const handleGraphZoomOut = () => {
    setXDomain(prevDomain => {
      const range = prevDomain[1] - prevDomain[0];
      const newRange = Math.min(range * 1.25, chartData[chartData.length-1]?.price - chartData[0]?.price || range * 1.25); // Zoom out by 25%
      const mid = (prevDomain[0] + prevDomain[1]) / 2;
      const fullMin = chartData.length > 0 ? chartData[0].price : 0;
      const fullMax = chartData.length > 0 ? chartData[chartData.length-1].price : 100;
      const potentialMin = mid - newRange / 2;
      const potentialMax = mid + newRange / 2;
      return [Math.max(fullMin, potentialMin), Math.min(fullMax, potentialMax)];
    });
  };
  const handleGraphResetZoom = () => {
    if (chartData.length > 0) {
      setXDomain([chartData[0].price, chartData[chartData.length - 1].price]);
    }
  };

  // --- BEGIN Panning Handlers ---
  const handlePanMouseDown = (e: any) => {
    if (e && e.chartX) { // e.chartX is provided by Recharts
      setIsPanning(true);
      panStartXRef.current = e.chartX;
      panStartDomainRef.current = [...xDomain] as [number, number]; // Store current domain
      if (chartContainerRef.current) chartContainerRef.current.style.cursor = 'grabbing';
    }
  };

  const handlePanMouseMove = (e: any) => {
    if (isPanning && e && e.chartX && panStartXRef.current !== null && panStartDomainRef.current !== null && chartData.length > 0) {
      const currentChartX = e.chartX;
      const dxChartPixels = currentChartX - panStartXRef.current;

      // Estimate chart plot area width (can be refined if Recharts provides a better way)
      // For now, assume the initial domain range corresponds to roughly the chart width visible.
      const chartWidthInPixels = chartContainerRef.current?.clientWidth || 400; // Approx width
      const startDomainRange = panStartDomainRef.current[1] - panStartDomainRef.current[0];
      
      const domainShift = (dxChartPixels / chartWidthInPixels) * startDomainRange;

      let newMin = panStartDomainRef.current[0] - domainShift;
      let newMax = panStartDomainRef.current[1] - domainShift;

      // Allow panning beyond initially loaded mock data for a more "infinite" feel
      // Boundaries can be re-introduced if we implement dynamic data loading based on domain
      /*
      if (newMin < fullDataMin) {
        newMin = fullDataMin;
        newMax = fullDataMin + currentDomainWidth;
      }
      if (newMax > fullDataMax) {
        newMax = fullDataMax;
        newMin = fullDataMax - currentDomainWidth;
      }
      */

       // Ensure min is not greater than max after boundary adjustments
      if (newMin >= newMax) {
        // This case should be rare now without strict boundaries, but as a fallback:
        newMin = panStartDomainRef.current[0] - domainShift - 0.1; 
        newMax = panStartDomainRef.current[1] - domainShift;
        if (newMin >= newMax) newMin = newMax - 0.1; // Final safety net
      }

      setXDomain([newMin, newMax]);
    }
  };

  const handlePanMouseUpOrLeave = () => {
    if (isPanning) {
      setIsPanning(false);
      panStartXRef.current = null;
      panStartDomainRef.current = null;
      if (chartContainerRef.current) chartContainerRef.current.style.cursor = 'grab';
    }
  };
  // --- END Panning Handlers ---

  // Effect to update mock selected price range based on activePreset and currentPriceLine/xDomain
  useEffect(() => {
    if (!currentPriceLine) return; // Don't calculate if no current price

    let newRange: [number, number] | null = null;
    const base = currentPriceLine;

    switch (activePreset) {
      case "Full Range":
        // Use a significant portion of the current xDomain or a wider fixed range
        newRange = [xDomain[0] + (xDomain[1] - xDomain[0]) * 0.05, xDomain[1] - (xDomain[1] - xDomain[0]) * 0.05];
        break;
      case "±3%":
        newRange = [base * 0.97, base * 1.03];
        break;
      case "±8%":
        newRange = [base * 0.92, base * 1.08];
        break;
      case "±15%":
        newRange = [base * 0.85, base * 1.15];
        break;
      default:
        // If no preset or an unknown one, clear the mock range or use last known priceAtTickLower/Upper
        // For now, let's try to use priceAtTickLower/Upper if they are valid
        const ptl = parseFloat(priceAtTickLower || "");
        const ptu = parseFloat(priceAtTickUpper || "");
        if (!isNaN(ptl) && !isNaN(ptu) && ptl < ptu && ptu < 1e10 && ptl > 1e-10) { // Added sanity check for extreme values
            newRange = [ptl, ptu];
        } else {
            newRange = null; // Or set to a default small range if needed
        }
        break;
    }
    if (newRange && newRange[0] >= newRange[1]) newRange = null; // Ensure min < max

    setMockSelectedPriceRange(newRange);

  }, [activePreset, currentPriceLine, xDomain, priceAtTickLower, priceAtTickUpper]);

  // Debug useEffect for actual priceAtTickLower/Upper changes (can be removed later)
  useEffect(() => {
    const ptlNum = parseFloat(priceAtTickLower || "");
    const ptuNum = parseFloat(priceAtTickUpper || "");
    if (!isNaN(ptlNum) && !isNaN(ptuNum) && ptlNum < ptuNum) {
      
    }
  }, [priceAtTickLower, priceAtTickUpper, xDomain]);

  // Custom shape for ReferenceArea with rounded top corners
  const RoundedTopReferenceArea = (props: any) => {
    const { x, y, width, height, fill, fillOpacity, strokeOpacity } = props;
    if (width <= 0 || height <= 0) return null;

    const r = 6;

    const path = `
      M ${x},${y + height} 
      L ${x + width},${y + height}
      L ${x + width},${y + r}
      Q ${x + width},${y} ${x + width - r},${y}
      L ${x + r},${y}
      Q ${x},${y} ${x},${y + r}
      Z
    `;

    // Fallback for very small widths where arcs might look weird
    if (width < 2 * r) {
        return <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={fillOpacity} strokeOpacity={strokeOpacity} />;
    }

    return <path d={path} fill={fill} fillOpacity={fillOpacity} strokeOpacity={strokeOpacity} />;
  };

  // --- BEGIN Effect to fetch Pool APR data (currently 24h fees) ---
  // This effect is no longer needed as APR is passed as a prop.
  // It can be removed or commented out if there's a chance it might be re-enabled for other fee data.
  /*
  useEffect(() => {
    if (isOpen && selectedPoolId && token0Symbol && token1Symbol && chainId) {
      const fetchPoolFeeData = async () => {
        setPoolAPR("Loading APR...");
        setPoolDailyFeesUSD(null);
        try {
          const token0Def = TOKEN_DEFINITIONS[token0Symbol];
          const token1Def = TOKEN_DEFINITIONS[token1Symbol];

          if (!token0Def || !token1Def) {
            
            setPoolAPR("APR N/A");
            return;
          }

          const sdkToken0 = new Token(chainId, getAddress(token0Def.addressRaw), token0Def.decimals);
          const sdkToken1 = new Token(chainId, getAddress(token1Def.addressRaw), token1Def.decimals);

          const [sortedSdkToken0, sortedSdkToken1] = sdkToken0.sortsBefore(sdkToken1)
            ? [sdkToken0, sdkToken1]
            : [sdkToken1, sdkToken0];
          
          const poolIdBytes32 = V4Pool.getPoolId(
            sortedSdkToken0,
            sortedSdkToken1,
            V4_POOL_FEE,
            V4_POOL_TICK_SPACING,
            V4_POOL_HOOKS
          );

          const response = await fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${poolIdBytes32}&days=1`);
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || "Failed to fetch 24h fee data");
          }
          const feeData = await response.json();
          
          const fees24h = parseFloat(feeData.feesUSD);
          if (!isNaN(fees24h)) {
            setPoolDailyFeesUSD(fees24h.toLocaleString(undefined, { style: 'currency', currency: 'USD' }));
            
            setPoolAPR("APR (TVL N/A)"); // Placeholder until TVL is implemented
          } else {
            setPoolAPR("Fees N/A");
          }

        } catch (error: any) {
          
          setPoolAPR("APR Error");
          setPoolDailyFeesUSD(null);
        }
      };

      fetchPoolFeeData();
    }
  }, [isOpen, selectedPoolId, token0Symbol, token1Symbol, chainId]);
  */
  // --- END Effect to fetch Pool APR data ---

  // Effect to update price input strings when underlying ticks or base display token changes
  useEffect(() => {
    const numTickLower = parseInt(tickLower);
    const numTickUpper = parseInt(tickUpper);

    let valForMinInput: number | null = null;
    let valForMaxInput: number | null = null;

    const decimalsForToken0Display = TOKEN_DEFINITIONS[token0Symbol]?.displayDecimals ?? (token0Symbol === 'BTCRL' ? 8 : 4);
    const decimalsForToken1Display = TOKEN_DEFINITIONS[token1Symbol]?.displayDecimals ?? (token1Symbol === 'BTCRL' ? 8 : 4);

    // Values from API (via calculatedData state)
    const rawApiPriceAtTickLower = calculatedData?.priceAtTickLower ? parseFloat(calculatedData.priceAtTickLower) : null;
    const rawApiPriceAtTickUpper = calculatedData?.priceAtTickUpper ? parseFloat(calculatedData.priceAtTickUpper) : null;

    if (baseTokenForPriceDisplay === token0Symbol) {
        // Display prices as Token0 per Token1 (e.g., YUSDC per BTCRL)
        if (rawApiPriceAtTickLower !== null) {
            valForMinInput = rawApiPriceAtTickLower;
        } else if (!isNaN(numTickLower)) {
            if (numTickLower === sdkMinTick) valForMinInput = 0;
            else valForMinInput = Math.pow(1.0001, numTickLower);
        }

        if (rawApiPriceAtTickUpper !== null) {
            valForMaxInput = rawApiPriceAtTickUpper;
        } else if (!isNaN(numTickUpper)) {
            if (numTickUpper === sdkMaxTick) valForMaxInput = Infinity;
            else valForMaxInput = Math.pow(1.0001, numTickUpper);
        }
        
        if (valForMinInput !== null && valForMaxInput !== null && valForMinInput > valForMaxInput) {
            // This case implies API might have returned priceAtTickLower > priceAtTickUpper, or fallback calc was unusual.
            // For non-inverted display, price at lower tick should be lower.
            [valForMinInput, valForMaxInput] = [valForMaxInput, valForMinInput]; 
        }

    } else { // baseTokenForPriceDisplay === token1Symbol
        // Display prices as Token1 per Token0 (e.g., BTCRL per YUSDC)
        let price1: number | null = null; // Value derived from rawApiPriceAtTickUpper
        let price2: number | null = null; // Value derived from rawApiPriceAtTickLower

        if (rawApiPriceAtTickUpper !== null && rawApiPriceAtTickUpper !== 0) {
            price1 = 1 / rawApiPriceAtTickUpper;
        } else if (!isNaN(numTickUpper)) {
            if (numTickUpper === sdkMaxTick) price1 = 0; // Max tick for T0/T1 means min price (0) for T1/T0
            else {
                const fallbackUpper = Math.pow(1.0001, numTickUpper);
                if (fallbackUpper === 0) price1 = Infinity;
                else price1 = 1 / fallbackUpper;
            }
        }

        if (rawApiPriceAtTickLower !== null && rawApiPriceAtTickLower !== 0) {
            price2 = 1 / rawApiPriceAtTickLower;
        } else if (!isNaN(numTickLower)) {
            if (numTickLower === sdkMinTick) price2 = Infinity; // Min tick for T0/T1 means max price (Inf) for T1/T0
            else {
                const fallbackLower = Math.pow(1.0001, numTickLower); // Corrected variable name
                if (fallbackLower === 0) price2 = Infinity;
                else price2 = 1 / fallbackLower;
            }
        }
        
        if (price1 !== null && price2 !== null) {
            valForMinInput = Math.min(price1, price2);
            valForMaxInput = Math.max(price1, price2);
        } else if (price1 !== null) { 
            valForMinInput = price1;
            valForMaxInput = price1; 
        } else if (price2 !== null) {
            valForMinInput = price2;
            valForMaxInput = price2;
        }
    }

    let finalMinPriceString = "";
    let finalMaxPriceString = "";
    const displayDecimals = baseTokenForPriceDisplay === token0Symbol ? decimalsForToken0Display : decimalsForToken1Display;

    if (valForMinInput !== null) {
        if (valForMinInput === 0 && baseTokenForPriceDisplay === token0Symbol && numTickLower === sdkMinTick) finalMinPriceString = "0";
        else if (valForMinInput === 0 && baseTokenForPriceDisplay === token1Symbol && numTickUpper === sdkMaxTick) finalMinPriceString = "0";
        else if (!isFinite(valForMinInput)) finalMinPriceString = "∞";
        else finalMinPriceString = valForMinInput.toFixed(displayDecimals);
    }
    if (valForMaxInput !== null) {
        if (valForMaxInput === Infinity && baseTokenForPriceDisplay === token0Symbol && numTickUpper === sdkMaxTick) finalMaxPriceString = "∞";
        else if (valForMaxInput === Infinity && baseTokenForPriceDisplay === token1Symbol && numTickLower === sdkMinTick) finalMaxPriceString = "∞";
        else if (!isFinite(valForMaxInput)) finalMaxPriceString = "∞";
        else finalMaxPriceString = valForMaxInput.toFixed(displayDecimals);
    }

    /* eslint-disable no-console */
    console.log('[AddLiquidityModal] Setting Price Strings:', {
        token0Symbol: token0Symbol, token1Symbol: token1Symbol, baseTokenForPriceDisplay: baseTokenForPriceDisplay,
        rawApiPriceAtTickLower: rawApiPriceAtTickLower, rawApiPriceAtTickUpper: rawApiPriceAtTickUpper,
        valForMinInput: valForMinInput, valForMaxInput: valForMaxInput,
        finalMinPriceString: finalMinPriceString, finalMaxPriceString: finalMaxPriceString, // Log the actual strings being set
        tickLower: tickLower, tickUpper: tickUpper,
        calculatedCurrentPrice: calculatedData?.currentPrice
    });
    /* eslint-enable no-console */
    setMinPriceInputString(finalMinPriceString);
    setMaxPriceInputString(finalMaxPriceString);

  }, [tickLower, tickUpper, baseTokenForPriceDisplay, token0Symbol, token1Symbol, sdkMinTick, sdkMaxTick, calculatedData]);

  // Effect to auto-apply active percentage preset when currentPrice changes OR when activePreset changes
  useEffect(() => {
    // Ensure currentPrice is valid and we have a preset that requires calculation
    //MODIFIED: Now bases off currentPoolTick if available, falling back to currentPrice only if tick is null.
    if (activePreset && ["±3%", "±8%", "±15%"].includes(activePreset)) {
        let percentage = 0;
        if (activePreset === "±3%") percentage = 0.03;
        else if (activePreset === "±8%") percentage = 0.08;
        else if (activePreset === "±15%") percentage = 0.15;

        let newTickLower: number;
        let newTickUpper: number;

        if (currentPoolTick !== null) {
            // Calculate based on currentPoolTick
            const priceRatioUpper = 1 + percentage;
            const priceRatioLower = 1 - percentage;

            const tickDeltaUpper = Math.round(Math.log(priceRatioUpper) / Math.log(1.0001));
            const tickDeltaLower = Math.round(Math.log(priceRatioLower) / Math.log(1.0001)); // Will be negative

            newTickLower = currentPoolTick + tickDeltaLower;
            newTickUpper = currentPoolTick + tickDeltaUpper;
        } else if (currentPrice) {
            // Fallback to currentPrice if currentPoolTick is not yet available
            const numericCurrentPrice = parseFloat(currentPrice);
            if (isNaN(numericCurrentPrice)) {
                toast.error("Preset Error", { description: "Cannot apply preset: current price is invalid and pool tick unavailable." });
                return;
            }
            const priceLowerTarget = numericCurrentPrice * (1 - percentage);
            const priceUpperTarget = numericCurrentPrice * (1 + percentage);

            newTickLower = Math.log(priceLowerTarget) / Math.log(1.0001);
            newTickUpper = Math.log(priceUpperTarget) / Math.log(1.0001);
        } else {
            // Cannot apply preset yet, waiting for pool data
            // toast.info("Preset Info", { description: "Waiting for pool data to apply preset." }); // Optional: can be noisy
            return;
        }

        // Align and clamp
        newTickLower = Math.ceil(newTickLower / defaultTickSpacing) * defaultTickSpacing;
        newTickUpper = Math.floor(newTickUpper / defaultTickSpacing) * defaultTickSpacing;

        newTickLower = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickLower));
        newTickUpper = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTickUpper));

        if (newTickUpper - newTickLower >= defaultTickSpacing) {
            if (newTickLower.toString() !== tickLower || newTickUpper.toString() !== tickUpper) {
                setTickLower(newTickLower.toString());
                setTickUpper(newTickUpper.toString());
                setInitialDefaultApplied(true); 
            }
        } else {
             toast.info("Preset Range Too Narrow", { description: "Selected preset results in an invalid range after tick alignment. Try a wider preset or manual range."});
        }
    } else if (activePreset === "Full Range") {
        if (tickLower !== sdkMinTick.toString() || tickUpper !== sdkMaxTick.toString()) {
            setTickLower(sdkMinTick.toString());
            setTickUpper(sdkMaxTick.toString());
            setInitialDefaultApplied(true); 
        }
    }
  }, [currentPrice, currentPoolTick, activePreset, defaultTickSpacing, sdkMinTick, sdkMaxTick, token0Symbol, token1Symbol, tickLower, tickUpper]);


  // Debounced function to update tickLower from minPriceInputString
  const debouncedUpdateTickLower = useCallback(
    debounce((priceStr: string) => {
      const numericPrice = parseFloat(priceStr);

      if (baseTokenForPriceDisplay === token0Symbol) {
        if (priceStr.trim() === "0") {
          const newTick = sdkMinTick;
          if (newTick < parseInt(tickUpper)) {
            setTickLower(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
            toast.error("Invalid Range", { description: "Min price results in a range where min tick >= max tick." });
          }
          return;
        }
        if (isNaN(numericPrice) || numericPrice < 0) return;

        const priceToConvert = numericPrice;
        if (priceToConvert <= 0) {
          toast.info("Price results in invalid tick", { description: "The entered price must be positive for tick calculation." });
          return;
        }
        let newTick = Math.log(priceToConvert) / Math.log(1.0001);
        newTick = Math.ceil(newTick / defaultTickSpacing) * defaultTickSpacing;
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (newTick < parseInt(tickUpper)) {
          setTickLower(newTick.toString());
          setInitialDefaultApplied(true);
        } else {
          toast.error("Invalid Range", { description: "Min price must be less than max price." });
        }
      } else { // baseTokenForPriceDisplay === token1Symbol (Min Price input sets actual tickUpper)
        if (priceStr.trim() === "0") { // Min price of T0 in T1 is 0 => P_t1_t0_upper is effectively infinity
          const newTick = sdkMaxTick;
          if (newTick > parseInt(tickLower)) {
            setTickUpper(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
            toast.error("Invalid Range", { description: "Min price results in a range where max tick <= min tick." });
          }
          return;
        }
        if (isNaN(numericPrice) || numericPrice < 0) return; // Price of T0 in T1 must be >= 0
        if (numericPrice === 0) { /* handled above */ return; }

        const priceToConvert = 1 / numericPrice; // Convert to P_t1_t0_upper
        if (priceToConvert <= 0) { // Should not happen if numericPrice > 0
          toast.info("Price results in invalid tick", { description: "Converted price is non-positive." });
          return;
        }
        let newTick = Math.log(priceToConvert) / Math.log(1.0001);
        newTick = Math.floor(newTick / defaultTickSpacing) * defaultTickSpacing; // Floor for an upper tick
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (newTick > parseInt(tickLower)) {
          setTickUpper(newTick.toString());
          setInitialDefaultApplied(true);
        } else {
          toast.error("Invalid Range", { description: "Min price (when quoted in other token) must result in a max tick greater than min tick." });
        }
      }
    }, 750), 
    [baseTokenForPriceDisplay, token0Symbol, token1Symbol, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper, setTickLower, setTickUpper, setInitialDefaultApplied] // Added all dependencies
  );

  // Debounced function to update tickUpper from maxPriceInputString
  const debouncedUpdateTickUpper = useCallback(
    debounce((priceStr: string) => {
      const numericPrice = parseFloat(priceStr);
      const isInfinityInput = priceStr.trim().toLowerCase() === "∞" || priceStr.trim().toLowerCase() === "infinity";

      if (baseTokenForPriceDisplay === token0Symbol) {
        if (isInfinityInput) {
          const newTick = sdkMaxTick;
          if (newTick > parseInt(tickLower)) {
            setTickUpper(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
            toast.error("Invalid Range", { description: "Max price results in a range where max tick <= min tick." });
          }
          return;
        }
        if (isNaN(numericPrice) || numericPrice <= 0) return; // Max price (P_t1_t0) must be > 0

        const priceToConvert = numericPrice;
        let newTick = Math.log(priceToConvert) / Math.log(1.0001);
        newTick = Math.floor(newTick / defaultTickSpacing) * defaultTickSpacing;
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (newTick > parseInt(tickLower)) {
          setTickUpper(newTick.toString());
          setInitialDefaultApplied(true);
        } else {
          toast.error("Invalid Range", { description: "Max price must be greater than min price." });
        }
      } else { // baseTokenForPriceDisplay === token1Symbol (Max Price input sets actual tickLower)
         if (isInfinityInput) { // Max price of T0 in T1 is Infinity => P_t1_t0_lower is effectively 0
          const newTick = sdkMinTick;
          if (newTick < parseInt(tickUpper)) {
            setTickLower(newTick.toString());
            setInitialDefaultApplied(true);
          } else {
            toast.error("Invalid Range", { description: "Max price results in a range where min tick >= max tick." });
          }
          return;
        }
        if (isNaN(numericPrice) || numericPrice <= 0) return; // Price of T0 in T1 (max) must be > 0
        
        const priceToConvert = 1 / numericPrice; // Convert to P_t1_t0_lower
        if (priceToConvert <= 0) { // Should not happen if numericPrice > 0
          toast.info("Price results in invalid tick", { description: "Converted price is non-positive." });
          return;
        }
        let newTick = Math.log(priceToConvert) / Math.log(1.0001);
        newTick = Math.ceil(newTick / defaultTickSpacing) * defaultTickSpacing; // Ceil for a lower tick
        newTick = Math.max(sdkMinTick, Math.min(sdkMaxTick, newTick));
        if (newTick < parseInt(tickUpper)) {
          setTickLower(newTick.toString());
          setInitialDefaultApplied(true);
        } else {
          toast.error("Invalid Range", { description: "Max price (when quoted in other token) must result in a min tick less than max tick." });
        }
      }
    }, 750),
    [baseTokenForPriceDisplay, token0Symbol, token1Symbol, defaultTickSpacing, sdkMinTick, sdkMaxTick, tickLower, tickUpper, setTickLower, setTickUpper, setInitialDefaultApplied] // Added all dependencies
  );

  // New handler for signing and submitting Permit2 message
  const { signTypedDataAsync } = useSignTypedData();

  const handleSignAndSubmitPermit2 = async () => {
    if (!permit2SignatureRequest || !accountAddress || !chainId) {
      toast.error("Permit2 Error", { description: "Missing data for Permit2 signature." });
      return;
    }

    setIsWorking(true);
    toast.loading(`Requesting signature for ${permit2SignatureRequest.approvalTokenSymbol}...`, { id: "permit2-sign" });

    try {
      const { domain, types, primaryType, message, permit2Address, approvalTokenSymbol } = permit2SignatureRequest;
      
      // Ensure message values are correctly typed for signing and for contract call
      const typedMessage = {
        details: {
          token: message.details.token as Hex,
          amount: BigInt(message.details.amount), // uint160 -> BigInt
          expiration: Number(message.details.expiration), // uint48 -> Number
          nonce: Number(message.details.nonce), // uint48 -> Number
        },
        spender: message.spender as Hex,
        sigDeadline: BigInt(message.sigDeadline), // uint256 -> BigInt
      };

      const signature = await signTypedDataAsync({
        domain,
        types,
        primaryType,
        message: typedMessage, // Use the structured message with BigInts
        account: accountAddress,
      });

      toast.dismiss("permit2-sign");
      toast.loading(`Submitting Permit2 for ${approvalTokenSymbol}...`, { id: "permit2-submit" });

      if (!permit2WriteContractAsync) {
        throw new Error ("Permit2 write function not available.");
      }

      await permit2WriteContractAsync({
        address: permit2Address,
        abi: PERMIT2_PERMIT_ABI_MINIMAL, // Pass the full ABI array
        functionName: 'permit',
        args: [
          accountAddress, // owner
          typedMessage,   // permitSingle (already structured correctly for ABI)
          signature       // signature
        ],
        account: accountAddress,
        chain: baseSepolia, // Ensure chain is specified if not default
      });
      // Success will be handled by the useEffect watching isPermit2Confirmed

    } catch (err: any) {
      toast.dismiss("permit2-sign");
      toast.dismiss("permit2-submit");
      let detailedErrorMessage = "Permit2 operation failed.";
      if (err instanceof Error) {
        detailedErrorMessage = err.message;
        if ((err as any).shortMessage) { detailedErrorMessage = (err as any).shortMessage; }
      }
      toast.error("Permit2 Error", { description: detailedErrorMessage });
      setIsWorking(false);
      // Optionally reset to 'input' or allow retry of signing
      // setStep('input'); 
      // setPermit2SignatureRequest(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { 
        onOpenChange(open); 
        if (!open) {
            resetForm();
        }
    }}>
      <DialogPortal>
        <DialogOverlay />
        <RadixDialogPrimitive.Content
          aria-label="Add Liquidity"
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
            "sm:max-w-4xl"
          )}
        >
          <div className="flex flex-col md:flex-row gap-6">
            <div className="w-full md:w-1/2 flex flex-col space-y-3">
              <Card className="w-full card-gradient border-0 shadow-none flex-grow">
                <CardContent className="px-4 pt-4 pb-4 flex flex-col space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center">
                      <Button
                          key="Full Range"
                          variant={activePreset === "Full Range" ? "secondary" : "outline"}
                          size="sm"
                          className="h-8 px-2 text-xs rounded-md"
                          onClick={() => {
                            setActivePreset("Full Range");
                            handleSetFullRange();
                          }}
                        >
                          Full Range
                        </Button>
                        <div className="h-5 w-px bg-border ml-2 mr-2" />
                      {["±3%", "±8%", "±15%"].map((preset, index) => (
                        <Button
                          key={preset}
                          variant={activePreset === preset ? "secondary" : "outline"}
                          size="sm"
                          className={`h-8 px-2 text-xs rounded-md ${index === 0 ? '' : 'ml-1'}`}
                          onClick={() => {
                            // Set the active preset. The useEffect watching [currentPrice, activePreset] will handle tick changes.
                            // Removed the conditional toast based on currentPrice/currentPoolTick as the useEffect handles it.
                            setActivePreset(preset); 
                          }}
                        >
                          {preset}
                        </Button>
                      ))}
                    </div>
                    <span className="h-8 flex items-center bg-green-500/20 text-green-500 px-2 py-0.5 rounded-sm text-xs font-medium">
                      {poolApr ? poolApr : "Yield N/A"} {/* Display passed APR */}
                    </span>
                  </div>

                  {/* --- BEGIN Recharts Graph --- */}
                  <div className="w-full h-52 relative rounded-md border bg-muted/30" ref={chartContainerRef} style={{ cursor: isPanning ? 'grabbing' : 'grab' }}>
                    {isPoolStateLoading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-20">
                            <RefreshCwIcon className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : !isPoolStateLoading && chartData.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-20">
                            <span className="text-muted-foreground text-sm px-4 text-center">
                                {currentPriceLine === null ? "Loading pool data for chart..." : "Chart data unavailable for current price."}
                            </span>
                        </div>
                    ) : null}
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart 
                        data={chartData}
                        margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
                        onMouseDown={handlePanMouseDown}
                        onMouseMove={handlePanMouseMove}
                        onMouseUp={handlePanMouseUpOrLeave}
                        onMouseLeave={handlePanMouseUpOrLeave}
                      >
                        <XAxis 
                          dataKey="price" 
                          type="number" 
                          domain={xDomain} 
                          allowDataOverflow 
                          hide={false}
                          tick={false}
                          axisLine={{ stroke: "#a1a1aa", strokeOpacity: 0.5 }}
                          height={10}
                        />
                        <YAxis allowDataOverflow domain={['auto', 'auto']} hide={true} yAxisId={0} />
                        
                        <Area type="stepAfter" dataKey="liquidity" stroke="#888888" fill="#888888" fillOpacity={0.2} name="Liquidity" yAxisId={0}/>
                        
                        {mockSelectedPriceRange && mockSelectedPriceRange[0] < mockSelectedPriceRange[1] && (
                           <ReferenceArea 
                             x1={mockSelectedPriceRange[0]} 
                             x2={mockSelectedPriceRange[1]} 
                             yAxisId={0} 
                             strokeOpacity={0} 
                             fill="#e85102" 
                             fillOpacity={0.25} 
                             ifOverflow="hidden"
                             shape={<RoundedTopReferenceArea />}
                           />
                        )}
                        
                        {currentPriceLine !== null && (
                          <ReferenceLine x={currentPriceLine} stroke="#e85102" strokeWidth={1.5} ifOverflow="extendDomain" yAxisId={0}/>
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                    {/* Graph Controls Overlay - only show if chart is active */} 
                    {!isPoolStateLoading && chartData.length > 0 && (
                        <div className="absolute top-2 right-2 flex flex-col space-y-1 z-10">
                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={handleGraphZoomIn}><ZoomInIcon className="h-4 w-4" /></Button>
                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={handleGraphZoomOut}><ZoomOutIcon className="h-4 w-4" /></Button>
                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={handleGraphResetZoom}><RefreshCcwIcon className="h-4 w-4" /></Button>
                        </div>
                    )}
                    {/* Re-implementing Custom X-Axis Price Labels for even spacing and dynamic values based on xDomain - only show if chart is active */} 
                    {!isPoolStateLoading && chartData.length > 0 && (
                        <div className="flex justify-between text-xs text-muted-foreground px-1 mt-1">
                            <span>{xDomain[0].toFixed(0)}</span>
                            <span>{(xDomain[0] + (xDomain[1]-xDomain[0])*0.25).toFixed(0)}</span>
                            <span>{(xDomain[0] + (xDomain[1]-xDomain[0])*0.5).toFixed(0)}</span>
                            <span>{(xDomain[0] + (xDomain[1]-xDomain[0])*0.75).toFixed(0)}</span>
                            <span>{xDomain[1].toFixed(0)}</span>
                        </div>
                    )}
                  </div>
                  {/* --- END Recharts Graph --- */}

                  <TooltipProvider delayDuration={100}>
                    <div className="space-y-2 pt-3 mt-2">
                      <div className="flex justify-between items-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-muted-foreground cursor-default hover:underline">Min Price</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p>The minimum price at which your position earns fees. Beyond this point, your position converts fully to {token1Symbol}.</p>
                          </TooltipContent>
                        </Tooltip>
                        <Input
                          id="minPriceInput"
                          type="text"
                          value={minPriceInputString} 
                          onChange={(e) => {
                            setMinPriceInputString(e.target.value);
                            debouncedUpdateTickLower(e.target.value);
                          }}
                          onFocus={(e) => e.target.select()}
                          className="w-28 border-0 bg-transparent text-right text-xs font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto no-arrows"
                          placeholder="0.00" // Changed placeholder
                        />
                      </div>
                      <div className="flex justify-between items-center">
                         <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs text-muted-foreground cursor-default hover:underline">Max Price</span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <p>The maximum price at which your position earns fees. Beyond this point, your position converts fully to {token0Symbol}.</p>
                          </TooltipContent>
                        </Tooltip>
                        <Input
                          id="maxPriceInput"
                          type="text"
                          value={maxPriceInputString} 
                          onChange={(e) => {
                            setMaxPriceInputString(e.target.value);
                            debouncedUpdateTickUpper(e.target.value);
                          }}
                          onFocus={(e) => e.target.select()}
                          className="w-28 border-0 bg-transparent text-right text-xs font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto no-arrows"
                          placeholder="0.00" // Changed placeholder
                        />
                      </div>
                    </div>
                  </TooltipProvider>

                  <div className="pt-2">
                    <div className="border-t border-border/70 my-2" />
                    <div className="flex justify-between items-center space-x-2">
                      <span className="text-xs text-muted-foreground">
                        {currentPrice && !isCalculating ? (
                          baseTokenForPriceDisplay === token0Symbol ? (
                            `1 ${token1Symbol} = ${parseFloat(currentPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: TOKEN_DEFINITIONS[token0Symbol]?.displayDecimals || 2 })} ${token0Symbol}`
                          ) : (
                            `1 ${token0Symbol} = ${(1 / parseFloat(currentPrice)).toLocaleString(undefined, { minimumFractionDigits: TOKEN_DEFINITIONS[token1Symbol]?.displayDecimals || (token1Symbol === 'BTCRL' ? 6 : 2), maximumFractionDigits: TOKEN_DEFINITIONS[token1Symbol]?.displayDecimals || (token1Symbol === 'BTCRL' ? 8 : 4)})} ${token1Symbol}`
                          )
                        ) : isCalculating ? (
                          "Calculating price..."
                        ) : (
                          "Price unavailable"
                        )
                        }
                      </span>
                      <div className="flex space-x-1">
                        <Button
                          variant={baseTokenForPriceDisplay === token0Symbol ? "secondary" : "outline"}
                          size="sm"
                          className="h-7 px-2 text-xs rounded-md"
                          onClick={() => setBaseTokenForPriceDisplay(token0Symbol)}
                        >
                          {token0Symbol}
                        </Button>
                        <Button
                          variant={baseTokenForPriceDisplay === token1Symbol ? "secondary" : "outline"}
                          size="sm"
                          className="h-7 px-2 text-xs rounded-md"
                          onClick={() => setBaseTokenForPriceDisplay(token1Symbol)}
                        >
                          {token1Symbol}
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="w-full md:w-1/2 flex flex-col space-y-3">
              <Card className="w-full card-gradient border-0 shadow-none flex-grow">
                <CardContent className="px-4 pt-4 pb-4">
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <Label htmlFor="amount0" className="text-sm font-medium">Amount</Label>
                         <div className="flex items-center gap-1">
                           <Button variant="ghost" className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" onClick={() => handleUseFullBalance(token0BalanceData?.formatted || "0", token0Symbol, true)} disabled={isWorking || isCalculating}>  
                               Balance: {displayToken0Balance} {token0Symbol}
                           </Button>
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

                  <div className="flex justify-center items-center mb-2">
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
                      <PlusIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <Label htmlFor="amount1" className="text-sm font-medium">Amount</Label>
                        <div className="flex items-center gap-1">
                           <Button variant="ghost" className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" onClick={() => handleUseFullBalance(token1BalanceData?.formatted || "0", token1Symbol, false)} disabled={isWorking || isCalculating}> 
                               Balance: {displayToken1Balance} {token1Symbol}
                           </Button>
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

                  <div className="p-3 border border-dashed rounded-md bg-muted/10">
                    <p className="text-sm font-medium mb-2 text-foreground/80">Transaction Steps</p>
                    <div className="space-y-1.5 text-xs text-muted-foreground">
                        <div className="flex items-center justify-between">
                            <span>{`Permit2 Setup`}</span>
                            <span>
                                { (step === 'approve' && (isApproveWritePending || isApproving)) || (step === 'permit2Sign' && (isPermit2SendPending || isPermit2Confirming)) 
                                  ? <RefreshCwIcon className="h-4 w-4 animate-spin" />
                                  : permit2StepsCompletedCount >= maxPermit2StepsInCurrentTx && maxPermit2StepsInCurrentTx > 0 
                                    ? <CheckIcon className="h-4 w-4 text-green-500" />
                                    : step === 'approve' || step === 'permit2Sign' || (preparedTxData?.approvalType === 'ERC20_TO_PERMIT2') || (preparedTxData?.approvalType === 'PERMIT2_SIGNATURE_FOR_PM')
                                      ? <span className="text-xs font-mono">{`${permit2StepsCompletedCount}/${maxPermit2StepsInCurrentTx > 0 ? maxPermit2StepsInCurrentTx : '-'}`}</span>
                                      : maxPermit2StepsInCurrentTx === 0 // No amounts, so no steps needed
                                        ? <CheckIcon className="h-4 w-4 text-green-500" />
                                        : <span className="text-xs font-mono">{`0/${maxPermit2StepsInCurrentTx > 0 ? maxPermit2StepsInCurrentTx : '-'}`}</span>
                                }
                            </span>
                        </div>
                        {/* Removed the individual signature step display */}
                        <div className="flex items-center justify-between">
                            <span>Send Mint Transaction</span> 
                            <span>
                                {isMintConfirming || isMintSendPending ? 
                                  <motion.svg // Heartbeat Icon Copied from SwapInputView
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="15"
                                    height="15"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5" // Adjusted stroke width for better visibility
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="flex-shrink-0"
                                  >
                                    {[ // Simplified to one pulsing line for a cleaner look here
                                      { x: 12, initialHeight: 8, fullHeight: 14 },
                                    ].map((bar, i) => {
                                      return (
                                        <motion.line
                                          key={i}
                                          x1={bar.x}
                                          y1={24}
                                          x2={bar.x}
                                          y2={24 - bar.initialHeight}
                                          fill="currentColor"
                                          stroke="currentColor"
                                          strokeLinecap="round"
                                          animate={{
                                            y2: [24 - bar.initialHeight, 24 - bar.fullHeight, 24 - bar.initialHeight],
                                          }}
                                          transition={{
                                            duration: 0.8,
                                            repeat: Infinity,
                                            ease: "easeInOut",
                                            delay: i * 0.15,
                                          }}
                                        />
                                      );
                                    })}
                                  </motion.svg>
                                 : isMintConfirmed ? <CheckIcon className="h-4 w-4 text-green-500" /> 
                                 : <MinusIcon className="h-4 w-4" />}
                            </span>
                        </div>
                    </div>
                  </div>
                  <DialogFooter className="grid grid-cols-2 gap-3 mt-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (step === 'approve' || step === 'mint' || step === 'permit2Sign') { // Added permit2Sign
                          resetInternalTxState(); 
                        } else {
                          onOpenChange(false);
                        }
                      }}
                      disabled={isCalculating || 
                                (step ==='approve' && (isApproveWritePending || isApproving)) || 
                                (step === 'permit2Sign' && (isPermit2SendPending || isPermit2Confirming)) || 
                                (step ==='mint' && (isMintSendPending || isMintConfirming))}
                      className="border-slate-300 bg-slate-100 hover:bg-slate-200 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 disabled:opacity-50"
                    >
                      {step === 'approve' || step === 'mint' || step === 'permit2Sign' ? 'Cancel & Edit' : 'Change Pool'} {/* Added permit2Sign */}
                    </Button>
                    <Button
                      onClick={() => {
                        if (step === 'input') handlePrepareMint(false);
                        else if (step === 'approve') handleApprove();
                        else if (step === 'permit2Sign') handleSignAndSubmitPermit2(); 
                        else if (step === 'mint') handleMint();
                      }}
                      disabled={                        isWorking ||
                        isCalculating ||
                        isPoolStateLoading || 
                        isApproveWritePending ||
                        isPermit2SendPending || 
                        isMintSendPending ||
                        (step === 'input' && ((!parseFloat(amount0 || "0") && !parseFloat(amount1 || "0")) || !calculatedData))
                      }
                    >
                      {isPoolStateLoading ? 'Loading Pool...' 
                        : step === 'input' ? 'Deposit' 
                        : step === 'approve' ? `Approve ${preparedTxData?.approvalTokenSymbol || 'Token'} for Permit2` 
                        : step === 'permit2Sign' ? `Sign for ${permit2SignatureRequest?.approvalTokenSymbol || 'Token'} via Permit2`
                        : step === 'mint' ? 'Confirm Mint' 
                        : 'Processing...' 
                      }
                    </Button>
                  </DialogFooter>
                </CardContent>
              </Card>
            </div>
          </div>
        </RadixDialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
} 