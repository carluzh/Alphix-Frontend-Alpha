"use client";

import { AppLayout } from "@/components/app-layout";
import { useState, useEffect, useRef } from "react";
import { ArrowRightLeftIcon, PlusIcon, MinusIcon, ArrowLeftIcon, RefreshCwIcon, ChevronLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";
import { useRouter, useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import type { ProcessedPosition } from "../../../pages/api/liquidity/get-positions";
import { TOKEN_DEFINITIONS, TokenSymbol } from "../../../lib/swap-constants";
import { formatUnits as viemFormatUnits, type Hex } from "viem";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWriteContract, useWaitForTransactionReceipt, useSendTransaction } from "wagmi";
import { ERC20_ABI } from "../../../lib/abis/erc20";
import { baseSepolia } from "../../../lib/wagmiConfig";
import { getFromCache, setToCache, getUserPositionsCacheKey, getPoolStatsCacheKey, getPoolDynamicFeeCacheKey } from "../../../lib/client-cache"; // Import cache functions
import type { Pool } from "../../../types"; // Import the main Pool type for stats

// Define the structure of the chart data points from the API
interface ChartDataPoint {
  date: string; // YYYY-MM-DD
  volumeUSD: number;
  tvlUSD: number;
  // apr?: number; // Optional, if your API provides it
}

// Import TanStack Table components
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  RowData
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Reusing components from the main liquidity page
const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;
const TICK_BARS_COUNT = 31;
const DEFAULT_TICK_SPACING = 60;
const TICKS_PER_BAR = 10 * DEFAULT_TICK_SPACING;

// Format token amounts for display
const formatTokenDisplayAmount = (amount: string) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0.00";
  if (num < 0.0001) return "< 0.0001";
  return num.toFixed(4);
};

// Format USD value
const formatUSD = (value: number) => {
  if (value < 0.01) return "< $0.01";
  if (value < 1000) return `$${value.toFixed(2)}`;
  return `$${(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
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

// TickRangeVisualization Component
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

// Sample chart data for the pool - THIS WILL BE REPLACED BY API DATA
// const chartData = Array.from({ length: 60 }, (_, i) => {
//   const date = new Date();
//   date.setDate(date.getDate() - i);
//   return {
//     date: date.toISOString().split('T')[0],
//     volume: Math.floor(Math.random() * 200000) + 100000,
//     tvl: Math.floor(Math.random() * 100000) + 1000000,
//     apr: (Math.random() * 10 + 5) / 100, // 5-15% APR
//   };
// }).reverse();

const chartConfig = {
  views: { label: "Daily Values" },
  volume: { label: "Volume", color: "hsl(var(--chart-1))" },
  tvl: { label: "TVL", color: "hsl(var(--chart-2))" },
  // apr: { label: "APR", color: "#e85102" }, // Removed APR from chart config for now
} satisfies ChartConfig;

// Mock pool data - in a real app, this would come from an API based on poolId
// This mockPoolsData is now primarily for fallback display of token symbols/pair name if needed
// Actual stats like volume, TVL, APR should be fetched or come from cache.
const mockPoolsData = {
  "yusdc-btcrl": {
    id: "yusdc-btcrl", // This is the key, matches poolId from URL
    // The actual on-chain pool ID used for API calls needs to be managed carefully.
    // For yusdc-btcrl, we might use the known hardcoded one for API calls.
    apiId: "0xbcc20db9b797e211e508500469e553111c6fa8d80f7896e6db60167bcf18ce13", // Store the API-specific ID
    tokens: [
      { symbol: "YUSDC", icon: "/YUSD.png" },
      { symbol: "BTCRL", icon: "/BTCRL.png" }
    ],
    pair: "YUSDC / BTCRL",
    // Static/fallback values - these will be replaced by fetched/cached data
    volume24h: "Loading...",
    volume7d: "Loading...",
    fees24h: "Loading...",
    fees7d: "Loading...",
    liquidity: "Loading...",
    apr: "Loading..."
  }
  // Add other known pools if necessary, or have a more dynamic way to get basic pool info
};

interface PoolDetailData extends Pool { // Extend the main Pool type
  // Add any specific fields needed for this page that are not in the global Pool type
  // For now, the global Pool type should cover what we fetch (volume, fees, tvl USD values)
}

// Renamed from AddLiquidityModal and adapted for inline use
interface InlineAddLiquidityFormProps {
  poolId: string;
  onLiquidityAdded: () => void;
  poolPairSymbol?: string; // Optional: for display in the form title
}

function InlineAddLiquidityForm({ poolId, onLiquidityAdded, poolPairSymbol }: InlineAddLiquidityFormProps) {
  const { address: accountAddress, chainId } = useAccount();
  const [token0Symbol, setToken0Symbol] = useState<TokenSymbol>('YUSDC');
  const [token1Symbol, setToken1Symbol] = useState<TokenSymbol>('BTCRL');
  const [inputAmount, setInputAmount] = useState("");
  const [inputTokenSymbol, setInputTokenSymbol] = useState<TokenSymbol>('YUSDC'); // Which token the amount is for
  const [tickLower, setTickLower] = useState("");
  const [tickUpper, setTickUpper] = useState("");
  
  const [isWorking, setIsWorking] = useState(false);
  const [step, setStep] = useState<'input' | 'approve' | 'mint'>('input');
  const [preparedTxData, setPreparedTxData] = useState<any>(null); // To store data from prepare-mint-tx API

  // Use the poolId to set default token pair
  useEffect(() => {
    // Derive tokens from poolId if provided, otherwise use defaults (though should always be provided)
    if (poolId) {
      const parts = poolId.split('-');
      if (parts.length === 2) {
        const T0 = parts[0].toUpperCase() as TokenSymbol;
        const T1 = parts[1].toUpperCase() as TokenSymbol;
        if (TOKEN_DEFINITIONS[T0] && TOKEN_DEFINITIONS[T1]) {
          setToken0Symbol(T0);
          setToken1Symbol(T1);
          setInputTokenSymbol(T0); // Default input token to the first token of the pair
        } else {
          console.warn(`Tokens for poolId '${poolId}' not found in TOKEN_DEFINITIONS. Using defaults.`);
          // Fallback to YUSDC/BTCRL if symbols from poolId aren't in definitions
          setToken0Symbol('YUSDC');
          setToken1Symbol('BTCRL');
          setInputTokenSymbol('YUSDC');
        }
      } else {
        console.warn(`Invalid poolId format: '${poolId}'. Using default tokens.`);
        setToken0Symbol('YUSDC');
        setToken1Symbol('BTCRL');
        setInputTokenSymbol('YUSDC');
      }
    } else {
      // Default if poolId somehow isn't passed (shouldn't happen in this context)
      setToken0Symbol('YUSDC');
      setToken1Symbol('BTCRL');
      setInputTokenSymbol('YUSDC');
    }
  }, [poolId]);

  // For ERC20 Approve calls (still uses useWriteContract for specific function calls)
  const { data: approveTxHash, error: approveWriteError, isPending: isApproveWritePending, writeContractAsync: approveERC20Async, reset: resetApproveWriteContract } = useWriteContract();
  const { isLoading: isApproving, isSuccess: isApproved, error: approveReceiptError } = useWaitForTransactionReceipt({ hash: approveTxHash });

  // For the main Mint transaction (uses useSendTransaction for pre-built tx)
  const { data: mintTxHash, error: mintSendError, isPending: isMintSendPending, sendTransactionAsync, reset: resetSendTransaction } = useSendTransaction();
  const { isLoading: isMintConfirming, isSuccess: isMintConfirmed, error: mintReceiptError } = useWaitForTransactionReceipt({ hash: mintTxHash });

  // Combined useEffect for ERC20 approvals
  useEffect(() => {
    if (isApproved) {
      toast.success("Approval successful!");
      resetApproveWriteContract(); 
      if (preparedTxData) { // Ensure preparedTxData is available
        handlePrepareMint(true); // Re-check/prepare for next action (mint or another approval)
      }
    }
    if (approveWriteError || approveReceiptError) {
      const errorMsg = approveWriteError?.message || approveReceiptError?.message || "Approval transaction failed.";
      toast.error("Approval failed", { description: errorMsg });
      setIsWorking(false);
      // setStep('input'); // Or stay on approve step for user to retry?
      resetApproveWriteContract();
    }
  }, [isApproved, approveWriteError, approveReceiptError, preparedTxData, resetApproveWriteContract]); // Removed onLiquidityAdded, onOpenChange for this specific effect

  // Combined useEffect for Mint transaction confirmation
  useEffect(() => {
    if (isMintConfirmed) {
      toast.success("Liquidity minted successfully!", { id: "mint-tx" });
      onLiquidityAdded();
      resetSendTransaction();
      resetForm(); // Reset form after successful mint
    }
    if (mintSendError || mintReceiptError) {
      const errorMsg = mintSendError?.message || mintReceiptError?.message || "Minting transaction failed.";
      toast.error("Minting failed", { id: "mint-tx", description: errorMsg });
      console.error("Full minting error object:", mintSendError || mintReceiptError);
      setIsWorking(false);
      resetSendTransaction();
    }
  }, [isMintConfirmed, mintSendError, mintReceiptError, onLiquidityAdded, resetSendTransaction]);

  const resetForm = () => {
    // Don't reset token selections since they're based on the poolId
    setInputAmount("");
    // setInputTokenSymbol remains based on derived token0Symbol
    setTickLower("");
    setTickUpper("");
    setIsWorking(false);
    setStep('input');
    setPreparedTxData(null);
    // Ensure inputTokenSymbol is reset to the current token0Symbol of the pool if needed
    if (poolId) {
      const parts = poolId.split('-');
      if (parts.length === 2) {
        const T0 = parts[0].toUpperCase() as TokenSymbol;
        if (TOKEN_DEFINITIONS[T0]) {
          setInputTokenSymbol(T0);
        }
      }
    }
  };

  const handleSetFullRange = () => {
    setTickLower(SDK_MIN_TICK.toString());
    setTickUpper(SDK_MAX_TICK.toString());
  };

  const handlePrepareMint = async (isAfterApproval = false) => {
    if (!accountAddress || !chainId) {
      toast.error("Please connect your wallet.");
      return;
    }
    if (parseFloat(inputAmount) <= 0 || !tickLower || !tickUpper) {
      toast.error("Please fill all fields correctly.");
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
          inputAmount,
          inputTokenSymbol,
          userTickLower: parseInt(tickLower),
          userTickUpper: parseInt(tickUpper),
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

  const handleApprove = async () => {
    if (!preparedTxData?.needsApproval || !approveERC20Async) return;
    setIsWorking(true);
    toast.loading(`Approving ${preparedTxData.approvalTokenSymbol}...`, { id: "approve-tx" });

    try {
      const approvalAmountBigInt = BigInt(preparedTxData.approvalAmount); 

      await approveERC20Async({ // Use specific async function for approve
        address: preparedTxData.approvalTokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [preparedTxData.approveToAddress as `0x${string}`, approvalAmountBigInt],
      });
      // No need to call handlePrepareMint(true) here, useEffect for isApproved will handle it
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
      resetApproveWriteContract(); // Reset on direct catch
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
      console.log("MINTING ARGS:", { to, data, value: txValueString });

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

  // This component is no longer a Dialog, so we render its content directly in a Card.
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Add Liquidity</CardTitle>
        {poolPairSymbol && 
          <CardDescription>
            To {poolPairSymbol} pool. Set amount and price range.
          </CardDescription>
        }
      </CardHeader>
      <CardContent className="space-y-4 py-2">
        <div>
          <Label htmlFor="inputAmount">Amount of {TOKEN_DEFINITIONS[inputTokenSymbol]?.symbol || 'Token'} to provide</Label>
          <Input id="inputAmount" placeholder="0.0" value={inputAmount} onChange={(e) => setInputAmount(e.target.value)} type="number" disabled={isWorking}/>
          <div className="text-xs text-muted-foreground mt-1">Specify which token this amount is for:</div>
          <Select value={inputTokenSymbol} onValueChange={(val: TokenSymbol) => setInputTokenSymbol(val)} disabled={isWorking}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                  <SelectItem value={token0Symbol}>{TOKEN_DEFINITIONS[token0Symbol]?.symbol || 'Token A'}</SelectItem>
                  <SelectItem value={token1Symbol}>{TOKEN_DEFINITIONS[token1Symbol]?.symbol || 'Token B'}</SelectItem>
              </SelectContent>
          </Select>
        </div>
        <div>
          <div className="flex justify-between items-center mb-1">
            <Label>Price Range (Ticks)</Label>
            <Button variant="outline" size="sm" onClick={handleSetFullRange} disabled={isWorking}>Set Full Range</Button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="tickLower" className="text-xs">Tick Lower</Label>
              <Input id="tickLower" placeholder="Min Tick" value={tickLower} onChange={(e) => setTickLower(e.target.value)} type="number" disabled={isWorking}/>
            </div>
            <div>
              <Label htmlFor="tickUpper" className="text-xs">Tick Upper</Label>
              <Input id="tickUpper" placeholder="Max Tick" value={tickUpper} onChange={(e) => setTickUpper(e.target.value)} type="number" disabled={isWorking}/>
            </div>
          </div>
          {preparedTxData && !preparedTxData.needsApproval && preparedTxData.details && (
            <Card className="mt-4 p-3 text-xs bg-muted/50">
              <CardContent className="space-y-1 p-0">
                <div className="font-medium mb-1">Estimated Position:</div>
                <div>
                  {preparedTxData.details.token0.symbol}: {/* Added space here */}
                  {formatTokenDisplayAmount(
                      viemFormatUnits(
                          BigInt(preparedTxData.details.token0.amount), 
                          TOKEN_DEFINITIONS[preparedTxData.details.token0.symbol as TokenSymbol]?.decimals || 18
                      )
                  )}
                </div>
                <div>
                  {preparedTxData.details.token1.symbol}: {/* Added space here */}
                  {formatTokenDisplayAmount(
                      viemFormatUnits(
                          BigInt(preparedTxData.details.token1.amount), 
                          TOKEN_DEFINITIONS[preparedTxData.details.token1.symbol as TokenSymbol]?.decimals || 18
                      )
                  )}
                </div>
                <div>Liquidity: {preparedTxData.details.liquidity}</div>
                <div>Ticks: {preparedTxData.details.finalTickLower} - {preparedTxData.details.finalTickUpper}</div>
              </CardContent>
            </Card>
          )}
        </div>
      </CardContent>
      <CardFooter className="mt-2">
        {step === 'input' && <Button onClick={() => handlePrepareMint(false)} disabled={isWorking || isApproveWritePending || isMintSendPending} className="w-full">{(isWorking || isApproveWritePending || isMintSendPending) ? <RefreshCwIcon className="animate-spin mr-2" /> : null}Preview & Prepare</Button>}
        {step === 'approve' && <Button onClick={handleApprove} disabled={isWorking || isApproveWritePending || isApproving || isMintSendPending} className="w-full">{(isWorking || isApproveWritePending || isApproving) ? <RefreshCwIcon className="animate-spin mr-2" /> : null}Approve {preparedTxData?.approvalTokenSymbol}</Button>}
        {step === 'mint' && <Button onClick={handleMint} disabled={isWorking || isMintSendPending || isMintConfirming || isApproveWritePending} className="w-full">{(isWorking || isMintSendPending || isMintConfirming) ? <RefreshCwIcon className="animate-spin mr-2" /> : null}Confirm Mint</Button>}
      </CardFooter>
    </Card>
  );
}

export default function PoolDetailPage() {
  const router = useRouter();
  const params = useParams<{ poolId: string }>();
  const poolId = params?.poolId;
  const [userPositions, setUserPositions] = useState<ProcessedPosition[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [activeChart, setActiveChart] = useState<keyof Pick<typeof chartConfig, 'volume' | 'tvl'>>("volume");
  const { address: accountAddress, isConnected } = useAccount();
  const [sorting, setSorting] = useState<SortingState>([]); // Added for table sorting
  const addLiquidityFormRef = useRef<HTMLDivElement>(null); // Ref for scrolling to form

  // State for the pool's detailed data (including fetched stats)
  const [currentPoolData, setCurrentPoolData] = useState<PoolDetailData | null>(null);
  // State for API-fetched chart data
  const [apiChartData, setApiChartData] = useState<ChartDataPoint[]>([]);
  const [isLoadingChartData, setIsLoadingChartData] = useState(false);

  // Define columns for the User Positions table (can be defined early)
  const positionColumns: ColumnDef<ProcessedPosition>[] = [
    {
      id: "pair",
      header: "Pair / Range",
      cell: ({ row }) => {
        const position = row.original;
        const getTokenIcon = (symbol?: string) => {
          if (symbol?.toUpperCase().includes("YUSDC")) return "/YUSD.png";
          if (symbol?.toUpperCase().includes("BTCRL")) return "/BTCRL.png";
          return "/default-token.png";
        };
        const estimatedCurrentTick = position.isInRange 
          ? Math.floor((position.tickLower + position.tickUpper) / 2)
          : (position.tickLower > 0 
              ? position.tickLower - TICKS_PER_BAR 
              : position.tickUpper + TICKS_PER_BAR);

        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="relative w-14 h-7">
                <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                  <Image src={getTokenIcon(position.token0.symbol)} alt={position.token0.symbol || 'Token 0'} width={28} height={28} className="w-full h-full object-cover" />
                </div>
                <div className="absolute top-0 left-4 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                  <Image src={getTokenIcon(position.token1.symbol)} alt={position.token1.symbol || 'Token 1'} width={28} height={28} className="w-full h-full object-cover" />
                </div>
              </div>
              <span className="font-medium text-sm">
                {position.token0.symbol || 'N/A'} / {position.token1.symbol || 'N/A'}
              </span>
            </div>
            <TickRangeVisualization
              tickLower={position.tickLower}
              tickUpper={position.tickUpper}
              currentTick={estimatedCurrentTick}
            />
          </div>
        );
      },
    },
    {
      accessorFn: (row) => row.token0.amount,
      id: "token0Amount",
      header: "Token 0 Amount",
      cell: ({ row }) => <div>{formatTokenDisplayAmount(row.original.token0.amount)} {row.original.token0.symbol}</div>,
    },
    {
      accessorFn: (row) => row.token1.amount,
      id: "token1Amount",
      header: "Token 1 Amount",
      cell: ({ row }) => <div>{formatTokenDisplayAmount(row.original.token1.amount)} {row.original.token1.symbol}</div>,
    },
    {
      id: "totalValueUSD",
      header: "Total Value (USD)",
      cell: ({ row }) => {
        const totalValueUSD = calculateTotalValueUSD(row.original);
        return <div>{formatUSD(totalValueUSD)}</div>;
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const position = row.original;
        return (
          <Badge variant={position.isInRange ? "default" : "secondary"} 
                 className={position.isInRange ? "bg-green-500/20 text-green-700 border-green-500/30" : "bg-orange-500/20 text-orange-700 border-orange-500/30"}>
            {position.isInRange ? "In Range" : "Out of Range"}
          </Badge>
        );
      },
    },
  ];

  // Initialize the table instance (Hook call)
  const positionsTable = useReactTable({
    data: userPositions, // Initialized as []
    columns: positionColumns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting, // setSorting from useState
    getSortedRowModel: getSortedRowModel(),
    state: {
      sorting, // sorting from useState
    },
  });

  // Get pool data based on poolId
  // const poolData = mockPoolsData[poolId as keyof typeof mockPoolsData]; // Old way

  // Fetch user positions for this pool and pool stats
  const fetchPageData = async () => {
    if (!poolId) return;

    // Start loading chart data
    setIsLoadingChartData(true);
    // Fetch chart data from the new API route
    fetch(`/api/liquidity/chart-data/${poolId}`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to fetch chart data: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        // Check if the response has a data property that is an array
        if (data && Array.isArray(data.data)) { 
          setApiChartData(data.data);
        } else if (Array.isArray(data)) { // Fallback if API returns array directly
          setApiChartData(data)
        }else {
          console.error("Chart API response is not in the expected format:", data);
          setApiChartData([]); // Set to empty array on error or bad format
        }
      })
      .catch(error => {
        console.error("Failed to fetch chart data from API:", error);
        toast.error("Could not load pool chart data.", { description: error.message });
        setApiChartData([]); // Set to empty array on error
      })
      .finally(() => {
        setIsLoadingChartData(false);
      });

    const basePoolInfo = mockPoolsData[poolId as keyof typeof mockPoolsData];
    if (!basePoolInfo) {
      toast.error("Pool configuration not found for this ID.");
      router.push('/liquidity');
      return;
    }

    // Determine the API ID (could be from basePoolInfo or derived)
    // For yusdc-btcrl, we use the hardcoded one if basePoolInfo provides it.
    const apiPoolIdToUse = basePoolInfo.apiId || poolId; 

    // 1. Fetch/Cache Pool Stats (Volume, Fees, TVL)
    let poolStats: Partial<Pool> | null = getFromCache(getPoolStatsCacheKey(apiPoolIdToUse));
    if (poolStats) {
      console.log(`[Cache HIT] Using cached stats for pool detail: ${apiPoolIdToUse}`);
    } else {
      console.log(`[Cache MISS] Fetching stats from API for pool detail: ${apiPoolIdToUse}`);
      try {
        const [res24h, res7d, resTvl] = await Promise.all([
          fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${apiPoolIdToUse}&days=1`),
          fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${apiPoolIdToUse}&days=7`),
          fetch(`/api/liquidity/get-pool-tvl?poolId=${apiPoolIdToUse}`)
        ]);

        if (!res24h.ok || !res7d.ok || !resTvl.ok) {
          console.error(`Failed to fetch all stats for pool detail ${apiPoolIdToUse}.`);
          // Handle partial failures if necessary, or just mark as error
        } else {
          const data24h = await res24h.json();
          const data7d = await res7d.json();
          const dataTvl = await resTvl.json();
          poolStats = {
            volume24hUSD: parseFloat(data24h.volumeUSD),
            fees24hUSD: parseFloat(data24h.feesUSD),
            volume7dUSD: parseFloat(data7d.volumeUSD),
            fees7dUSD: parseFloat(data7d.feesUSD),
            tvlUSD: parseFloat(dataTvl.tvlUSD),
            // APR might need its own source or calculation
          };
          setToCache(getPoolStatsCacheKey(apiPoolIdToUse), poolStats);
          console.log(`[Cache SET] Cached stats for pool detail: ${apiPoolIdToUse}`);
        }
      } catch (error) {
        console.error(`Error fetching stats for pool detail ${apiPoolIdToUse}:`, error);
        // poolStats remains null or previous cached value if any part fails
      }
    }

    // 2. Fetch/Cache Dynamic Fee for APR Calculation
    let dynamicFeeBps: number | null = null;
    const [token0SymbolStr, token1SymbolStr] = basePoolInfo.pair.split(' / ');
    const fromTokenSymbolForFee = TOKEN_DEFINITIONS[token0SymbolStr?.trim() as TokenSymbol]?.symbol;
    const toTokenSymbolForFee = TOKEN_DEFINITIONS[token1SymbolStr?.trim() as TokenSymbol]?.symbol;

    if (fromTokenSymbolForFee && toTokenSymbolForFee && baseSepolia.id) {
      const feeCacheKey = getPoolDynamicFeeCacheKey(fromTokenSymbolForFee, toTokenSymbolForFee, baseSepolia.id);
      const cachedFee = getFromCache<{ dynamicFee: string }>(feeCacheKey);

      if (cachedFee) {
        console.log(`[Cache HIT] Using cached dynamic fee for APR calc (${basePoolInfo.pair}):`, cachedFee.dynamicFee);
        dynamicFeeBps = Number(cachedFee.dynamicFee);
      } else {
        console.log(`[Cache MISS] Fetching dynamic fee from API for APR calc (${basePoolInfo.pair})`);
        try {
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
               console.log(`[Cache SET] Cached dynamic fee for APR calc (${basePoolInfo.pair}):`, feeData.dynamicFee);
            } else {
              dynamicFeeBps = null; // Invalid fee from API
            }
          } else {
            console.error(`Failed to fetch dynamic fee for APR calc (${basePoolInfo.pair}):`, await feeResponse.text());
          }
        } catch (feeError) {
           console.error(`Error fetching dynamic fee for APR calc (${basePoolInfo.pair}):`, feeError);
        }
      }
    }

    // 3. Calculate APR if data is available
    let calculatedApr = basePoolInfo.apr; // Start with fallback/loading
    if (poolStats?.volume24hUSD !== undefined && dynamicFeeBps !== null && poolStats?.tvlUSD !== undefined && poolStats.tvlUSD > 0) {
       const feeRate = dynamicFeeBps / 10000 / 100;
       const dailyFees = poolStats.volume24hUSD * feeRate;
       const yearlyFees = dailyFees * 365;
       const apr = (yearlyFees / poolStats.tvlUSD) * 100;
       calculatedApr = apr.toFixed(2) + '%';
       console.log(`Calculated APR for ${basePoolInfo.pair}: ${calculatedApr} (Vol24h: ${poolStats.volume24hUSD}, FeeBPS: ${dynamicFeeBps}, TVL: ${poolStats.tvlUSD})`);
    } else {
      console.warn(`Could not calculate APR for ${basePoolInfo.pair} due to missing data. Vol: ${poolStats?.volume24hUSD}, Fee: ${dynamicFeeBps}, TVL: ${poolStats?.tvlUSD}`);
      calculatedApr = "N/A"; // Set to N/A if calculation not possible
    }

    // Combine all fetched/calculated data, ensuring display strings use fetched numeric data
    const combinedPoolData = {
        ...basePoolInfo,
        ...(poolStats || {}),
        apr: calculatedApr,
        dynamicFeeBps: dynamicFeeBps,
        // Ensure display strings use fetched numeric data if available
        volume24h: poolStats?.volume24hUSD !== undefined ? formatUSD(poolStats.volume24hUSD) : basePoolInfo.volume24h,
        volume7d: poolStats?.volume7dUSD !== undefined ? formatUSD(poolStats.volume7dUSD) : basePoolInfo.volume7d,
        fees24h: poolStats?.fees24hUSD !== undefined ? formatUSD(poolStats.fees24hUSD) : basePoolInfo.fees24h,
        fees7d: poolStats?.fees7dUSD !== undefined ? formatUSD(poolStats.fees7dUSD) : basePoolInfo.fees7d,
        liquidity: poolStats?.tvlUSD !== undefined ? formatUSD(poolStats.tvlUSD) : basePoolInfo.liquidity,
        // Ensure other fields from Pool type are satisfied if not in basePoolInfo or poolStats
        highlighted: false, // Example, set appropriately
    } as PoolDetailData;

    setCurrentPoolData(combinedPoolData);

    // 4. Fetch/Cache User Positions
    if (isConnected && accountAddress) {
      setIsLoadingPositions(true);
      const userPositionsCacheKey = getUserPositionsCacheKey(accountAddress);
      let allUserPositions = getFromCache<ProcessedPosition[]>(userPositionsCacheKey);

      if (allUserPositions) {
        console.log("[Cache HIT] Using cached user positions for filtering on detail page.");
      } else {
        console.log("[Cache MISS] Fetching all user positions for detail page.");
        try {
          const res = await fetch(`/api/liquidity/get-positions?ownerAddress=${accountAddress}`);
          if (!res.ok) throw new Error(`Failed to fetch positions: ${res.statusText}`);
          const data = await res.json();
          if (Array.isArray(data)) {
            allUserPositions = data;
            setToCache(userPositionsCacheKey, allUserPositions);
            console.log("[Cache SET] Cached all user positions on detail page.");
          } else {
            console.error("Error fetching positions on detail page:", (data as any).message);
            allUserPositions = [];
          }
        } catch (error) {
          console.error("Failed to fetch user positions on detail page:", error);
          allUserPositions = [];
        }
      }

      // Filter positions for the current pool
      if (allUserPositions && basePoolInfo) {
        const [poolToken0Raw, poolToken1Raw] = basePoolInfo.pair.split(' / ');
        const poolToken0 = poolToken0Raw?.trim().toUpperCase();
        const poolToken1 = poolToken1Raw?.trim().toUpperCase();
        const filteredPositions = allUserPositions.filter(pos => {
          const posToken0 = pos.token0.symbol?.trim().toUpperCase();
          const posToken1 = pos.token1.symbol?.trim().toUpperCase();
          return (posToken0 === poolToken0 && posToken1 === poolToken1) ||
                 (posToken0 === poolToken1 && posToken1 === poolToken0);
        });
        setUserPositions(filteredPositions);
        console.log(`Filtered ${filteredPositions.length} positions for pool ${basePoolInfo.pair} from ${allUserPositions.length} total cached/fetched positions.`);
      } else {
        setUserPositions([]);
      }
      setIsLoadingPositions(false);
    } else {
      setUserPositions([]);
    }
  };

  useEffect(() => {
    fetchPageData();
  }, [poolId, isConnected, accountAddress]); // Re-fetch if these change

  // Calculate total liquidity value
  const totalLiquidity = userPositions.reduce((sum, pos) => {
    return sum + calculateTotalValueUSD(pos);
  }, 0);

  // Early return for loading state AFTER all hooks have been called
  if (!poolId || !currentPoolData) return (
    <AppLayout>
      <div className="flex flex-1 justify-center items-center p-6">
        <RefreshCwIcon className="mr-2 h-6 w-6 animate-spin" /> Loading pool data...
      </div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col p-6 px-10">
          {/* Back button and header */}
          <div className="mb-6">
            <Button 
              variant="ghost" 
              onClick={() => router.push('/liquidity')}
              className="mb-4 pl-2"
            >
              <ChevronLeftIcon className="mr-2 h-4 w-4" /> Back to Pools
            </Button>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative w-14 h-7">
                  <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                    <Image 
                      src={currentPoolData.tokens[0].icon} 
                      alt={currentPoolData.tokens[0].symbol} 
                      width={28} 
                      height={28} 
                      className="w-full h-full object-cover" 
                    />
                  </div>
                  <div className="absolute top-0 left-4 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                    <Image 
                      src={currentPoolData.tokens[1].icon} 
                      alt={currentPoolData.tokens[1].symbol} 
                      width={28} 
                      height={28} 
                      className="w-full h-full object-cover" 
                    />
                  </div>
                </div>
                <div>
                  <h1 className="text-2xl font-bold">{currentPoolData.pair}</h1>
                  <p className="text-sm text-muted-foreground">
                    {currentPoolData.dynamicFeeBps !== undefined 
                      ? `Fee: ${(currentPoolData.dynamicFeeBps / 10000).toFixed(2)}%` // Assumes 4000 means 0.40% (rate * 1,000,000)
                      : "Fee: Loading..."}
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Main content area with two columns */}
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left Column: Stats and Graph (takes up 2/3 on larger screens) */}
            <div className="lg:w-2/3 space-y-6">
              {/* Pool stats */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>APR</CardDescription>
                    <CardTitle>{currentPoolData.apr}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Total Liquidity</CardDescription>
                    <CardTitle>{currentPoolData.liquidity}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Volume (24h)</CardDescription>
                    <CardTitle>{currentPoolData.volume24h}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Fees (24h)</CardDescription>
                    <CardTitle>{currentPoolData.fees24h}</CardTitle>
                  </CardHeader>
                </Card>
              </div>
              
              {/* Pool Overview Section (formerly Tab) */}
              <div className="space-y-4 mb-8">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-center">
                      <CardTitle>Pool Activity</CardTitle>
                      <div className="flex space-x-3">
                        <Button 
                          variant={activeChart === 'volume' ? 'secondary' : 'ghost'} 
                          size="sm" 
                          onClick={() => setActiveChart('volume')}
                        >
                          Volume
                        </Button>
                        <Button 
                          variant={activeChart === 'tvl' ? 'secondary' : 'ghost'} 
                          size="sm" 
                          onClick={() => setActiveChart('tvl')}
                        >
                          TVL
                        </Button>
                        {/* <Button 
                          variant={activeChart === 'apr' ? 'secondary' : 'ghost'} 
                          size="sm" 
                          onClick={() => setActiveChart('apr')}
                        >
                          APR
                        </Button> */} {/* Removed APR button */}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer
                      config={chartConfig}
                      className="aspect-auto h-[350px] w-full"
                    >
                      {isLoadingChartData ? (
                        <div className="flex justify-center items-center h-full">
                          <RefreshCwIcon className="mr-2 h-6 w-6 animate-spin" /> Loading chart...
                        </div>
                      ) : apiChartData.length > 0 ? (
                      <BarChart
                        accessibilityLayer
                          data={apiChartData} // Use API fetched data
                        margin={{
                          left: 25,
                          right: 25,
                          top: 20, 
                          bottom: 30
                        }}
                      >
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          minTickGap={32}
                          tickFormatter={(value) => {
                            const date = new Date(value);
                            return date.toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            });
                          }}
                        />
                        <ChartTooltip
                            cursor={false} // Added cursor={false} for better UX on BarChart
                          content={
                            <ChartTooltipContent
                              className="w-[150px]"
                                nameKey="views" // This might need adjustment if 'views' is not a direct key in your data
                              labelFormatter={(value) => {
                                return new Date(value).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                });
                              }}
                                // Formatter to display the correct data based on activeChart
                                formatter={(value, name, entry) => {
                                  const dataKey = activeChart === 'volume' ? 'volumeUSD' : 'tvlUSD';
                                  const label = chartConfig[activeChart]?.label || activeChart;
                                  if (entry.payload && typeof entry.payload[dataKey] === 'number') {
                                    return [
                                      activeChart === 'volume' || activeChart === 'tvl' 
                                        ? formatUSD(entry.payload[dataKey]) 
                                        : entry.payload[dataKey].toLocaleString(), 
                                      label
                                    ];
                                  }
                                  return [value, name];
                                }}
                            />
                          }
                        />
                          <Bar dataKey={activeChart === 'volume' ? 'volumeUSD' : 'tvlUSD'} fill={chartConfig[activeChart]?.color || `var(--color-${activeChart})`} />
                      </BarChart>
                      ) : (
                        <div className="flex justify-center items-center h-full text-muted-foreground">
                          No chart data available for this pool.
                        </div>
                      )}
                    </ChartContainer>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Right Column: Inline Add Liquidity Form (takes up 1/3 on larger screens) */}
            <div className="lg:w-1/3" ref={addLiquidityFormRef}>
              {poolId && currentPoolData && (
                <InlineAddLiquidityForm 
                  poolId={poolId} 
                  onLiquidityAdded={fetchPageData} // Changed from fetchUserPositions to re-fetch all page data (incl. stats)
                  poolPairSymbol={currentPoolData.pair}
                />
              )}
            </div>
          </div>
          
          {/* Your Positions Section (Full width below the columns) */}
          <div className="space-y-4 mt-8"> {/* Added mt-8 for spacing */}
            {isLoadingPositions ? (
              <div className="flex justify-center items-center h-48">
                <RefreshCwIcon className="mr-2 h-6 w-6 animate-spin" /> 
                <span>Loading your positions...</span>
              </div>
            ) : userPositions.length > 0 ? (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium">Your Liquidity Positions</h3>
                </div>
                <div className="text-sm mb-4">
                  Total Value: <span className="font-medium">{formatUSD(totalLiquidity)}</span>
                </div>
                {/* Replace PositionCard grid with Table */}
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      {positionsTable.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                          {headerGroup.headers.map((header) => (
                            <TableHead key={header.id}>
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
                      {positionsTable.getRowModel().rows?.length ? (
                        positionsTable.getRowModel().rows.map((row) => (
                          <TableRow key={row.id}>
                            {row.getVisibleCells().map((cell) => (
                              <TableCell key={cell.id}>
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
                            colSpan={positionColumns.length}
                            className="h-24 text-center"
                          >
                            No positions found for this pool.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <div className="border rounded-md p-8 text-center">
                <div className="text-muted-foreground mb-2">
                  {isConnected ? 
                    "You don't have any positions in this pool yet." : 
                    "Please connect your wallet to view your positions."
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
} 