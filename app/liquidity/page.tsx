"use client";

import { AppLayout } from "@/components/app-layout";
import { useState, useEffect, useMemo } from "react";
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
    useWaitForTransactionReceipt 
} from "wagmi";
import { toast } from "sonner";
import Link from "next/link";
import { TOKEN_DEFINITIONS, TokenSymbol } from "../../lib/swap-constants";
import { baseSepolia } from "../../lib/wagmiConfig";
import { ethers } from "ethers";
import { ERC20_ABI } from "../../lib/abis/erc20";
import { type Hex, formatUnits as viemFormatUnits, type Abi } from "viem";
import { position_manager_abi } from "../../lib/abis/PositionManager_abi";
import { getFromCache, setToCache, getUserPositionsCacheKey, getPoolStatsCacheKey, getPoolDynamicFeeCacheKey } from "../../lib/client-cache"; // Import cache functions

const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;
const DEFAULT_TICK_SPACING = 60;
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

// Add Liquidity Modal Component
interface AddLiquidityModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onLiquidityAdded: () => void; // Callback to refresh positions
  selectedPoolId?: string; // Add selected pool ID
}

function AddLiquidityModal({ isOpen, onOpenChange, onLiquidityAdded, selectedPoolId }: AddLiquidityModalProps) {
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

  // Use the selectedPoolId to set the tokens when the modal opens
  useEffect(() => {
    if (isOpen && selectedPoolId) {
      // Parse pool ID format (e.g., "yusdc-btcrl")
      const parts = selectedPoolId.split('-');
      if (parts.length === 2) {
        // Try to convert to token symbols
        const t0 = parts[0].toUpperCase() as TokenSymbol;
        const t1 = parts[1].toUpperCase() as TokenSymbol;
        
        // Verify these are valid tokens
        if (TOKEN_DEFINITIONS[t0] && TOKEN_DEFINITIONS[t1]) {
          setToken0Symbol(t0);
          setToken1Symbol(t1);
          setInputTokenSymbol(t0);
        }
      }
    }
  }, [isOpen, selectedPoolId]);

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
    setInputAmount("");
    setInputTokenSymbol('YUSDC');
    setTickLower("");
    setTickUpper("");
    setIsWorking(false);
    setStep('input');
    setPreparedTxData(null);
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { 
        if (!isWorking) { 
            onOpenChange(open); 
            if (!open) { // If the dialog is being closed
                resetForm();
            }
        }
    }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Liquidity</DialogTitle>
          <DialogDescription>
            Provide liquidity to a pool. Select tokens, amount, and price range.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="token0">Token A</Label>
              <Select value={token0Symbol} onValueChange={(val) => setToken0Symbol(val as TokenSymbol)} disabled={isWorking}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(TOKEN_DEFINITIONS).map(token => (
                    <SelectItem key={token.symbol} value={token.symbol}>{token.symbol}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="token1">Token B</Label>
              <Select value={token1Symbol} onValueChange={(val) => setToken1Symbol(val as TokenSymbol)} disabled={isWorking}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(TOKEN_DEFINITIONS).map(token => (
                    <SelectItem key={token.symbol} value={token.symbol}>{token.symbol}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="inputAmount">Amount of {TOKEN_DEFINITIONS[inputTokenSymbol]?.symbol || 'Token'} to provide</Label>
            <Input id="inputAmount" placeholder="0.0" value={inputAmount} onChange={(e) => setInputAmount(e.target.value)} type="number" disabled={isWorking}/>
            <div className="text-xs text-muted-foreground mt-1">Specify which token this amount is for:</div>
            <Select value={inputTokenSymbol} onValueChange={(val) => setInputTokenSymbol(val as TokenSymbol)} disabled={isWorking}>
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
        </div>
        <DialogFooter className="mt-2">
          {step === 'input' && <Button onClick={() => handlePrepareMint(false)} disabled={isWorking || isApproveWritePending || isMintSendPending} className="w-full">{(isWorking || isApproveWritePending || isMintSendPending) ? <RefreshCwIcon className="animate-spin mr-2" /> : null}Preview & Prepare</Button>}
          {step === 'approve' && <Button onClick={handleApprove} disabled={isWorking || isApproveWritePending || isApproving || isMintSendPending} className="w-full">{(isWorking || isApproveWritePending || isApproving) ? <RefreshCwIcon className="animate-spin mr-2" /> : null}Approve {preparedTxData?.approvalTokenSymbol}</Button>}
          {step === 'mint' && <Button onClick={handleMint} disabled={isWorking || isMintSendPending || isMintConfirming || isApproveWritePending} className="w-full">{(isWorking || isMintSendPending || isMintConfirming) ? <RefreshCwIcon className="animate-spin mr-2" /> : null}Confirm Mint</Button>}
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
      header: () => <div className="text-right w-full">Yield</div>,
      cell: ({ row }) => {
        const aprValue = parseFloat(row.original.apr.replace('%', '')); // Remove % and parse as float
        const formattedAPR = aprValue.toFixed(2) + '%'; // Format to 2 decimal places and add %
        return (
          <div className="text-right">
            <Badge className="bg-[#e85102]/20 text-[#e85102] rounded-md">
              {formattedAPR}
            </Badge>
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
    setSelectedPoolId(poolId);
    setAddLiquidityOpen(true);
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
                              {cell.column.id === "apr" && (
                                <div className="absolute top-1/2 right-4 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                  <Button 
                                    variant="outline"
                                    size="sm"
                                    className="border bg-background hover:bg-muted hover:border-gray-400"
                                    onClick={(e) => handleAddLiquidity(e, row.original.id)}
                                  >
                                    <PlusIcon className="h-4 w-4 mr-1" /> Add Liquidity
                                  </Button>
                                </div>
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