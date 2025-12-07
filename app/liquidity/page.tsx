"use client";

import { AppLayout } from "@/components/app-layout";
import { formatUSD as formatUSDShared } from "@/lib/format";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Image from "next/image";

import * as React from "react";
import { 
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  RowData,
  ColumnSizingState
} from "@tanstack/react-table";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileLiquidityList } from "@/components/MobileLiquidityList";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";
import {
    useAccount,
} from "wagmi";
import { toast } from "sonner";
import { getEnabledPools, getToken, getPoolSubgraphId } from "../../lib/pools-config";
import { loadUserPositionIds, derivePositionsFromIds, getCachedPositionTimestamps } from "../../lib/client-cache";
import { Pool } from "../../types";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronUpIcon, ChevronDownIcon, ChevronsUpDownIcon, PlusIcon, BadgeCheck, OctagonX } from "lucide-react";
import { getTokenDefinitions, type TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { useIncreaseLiquidity, type IncreasePositionData } from "@/components/liquidity/useIncreaseLiquidity";
import { useDecreaseLiquidity, type DecreasePositionData } from "@/components/liquidity/useDecreaseLiquidity";
import { toast as sonnerToast } from "sonner";
import { waitForSubgraphBlock } from "../../lib/client-cache";


const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;
const DEFAULT_TICK_SPACING = 60;

// Generate pools from config - called reactively based on network mode
const generatePoolsFromConfig = (): Pool[] => {
  const enabledPools = getEnabledPools();

  return enabledPools.map(poolConfig => {
    const token0 = getToken(poolConfig.currency0.symbol);
    const token1 = getToken(poolConfig.currency1.symbol);

    if (!token0 || !token1) {
      console.warn(`Missing token configuration for pool ${poolConfig.id}`);
      return null;
    }

    return {
      id: poolConfig.id,
      tokens: [
        { symbol: token0.symbol, icon: token0.icon },
        { symbol: token1.symbol, icon: token1.icon }
      ],
      pair: `${token0.symbol} / ${token1.symbol}`,
      volume24h: "Loading...",
      fees24h: "Loading...",
      liquidity: "Loading...",
      apr: "Loading...",
      highlighted: poolConfig.featured,
      type: poolConfig.type,
    } as Pool;
  }).filter(Boolean) as Pool[];
};

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    hidePriority?: number;
  }
}

const formatUSD = (value: number) => {
  if (!isFinite(value)) return "$0.00";
  if (value >= 1_000_000) return formatUSDShared(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatAPR = (aprValue: number) => {
  if (!isFinite(aprValue)) return '—';
  if (aprValue < 1000) return `${aprValue.toFixed(2)}%`;
  // large APRs: compact to K with two decimals
  return `${(aprValue / 1000).toFixed(2)}K%`;
};

export default function LiquidityPage() {
  const [userPositions, setUserPositions] = useState<ProcessedPosition[]>([]);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const { networkMode } = useNetwork();
  const [optimisticPoolId, setOptimisticPoolId] = useState<string | null>(null);

  // Generate pools based on current network mode - regenerates when network changes
  const initialPools = useMemo(() => generatePoolsFromConfig(), [networkMode]);
  const [poolsData, setPoolsData] = useState<Pool[]>([]);

  // Sync poolsData with network mode changes
  useEffect(() => {
    setPoolsData(initialPools);
  }, [initialPools]);

  const isMobile = useIsMobile();
  const { address: accountAddress, isConnected, chainId } = useAccount();
  const [selectedPoolId, setSelectedPoolId] = useState<string>("");
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );
  const router = useRouter();
  const [poolDataByPoolId, setPoolDataByPoolId] = useState<Record<string, any>>({});
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [isLoadingPoolStates, setIsLoadingPoolStates] = useState(true);

  const navigateToPool = useCallback((poolId: string) => {
    setOptimisticPoolId(poolId);
    router.push(`/liquidity/${poolId}`);
  }, [router]);

  const fetchAllPoolStatsBatch = useCallback(async () => {
      try {
        // Fetch from API - Redis cache handles caching on server side
        console.log('[LiquidityPage] Fetching batch from server (Redis-cached)...');
        const response = await fetch('/api/liquidity/get-pools-batch');
        console.log('[LiquidityPage] Batch fetch status:', response.status);
        if (!response.ok) throw new Error(`Batch API failed: ${response.status}`);
        const batchData = await response.json();
        if (!batchData.success) throw new Error(`Batch API error: ${batchData.message}`);

        const updatedPools = initialPools.map((pool) => {
          const apiPoolId = getPoolSubgraphId(pool.id) || pool.id;
          const batchPoolData = batchData.pools.find((p: any) => p.poolId.toLowerCase() === apiPoolId.toLowerCase());

          if (batchPoolData) {
            const { tvlUSD, volume7dUSD, fees7dUSD, apr7d, volumeAvgDailyUSD, feesAvgDailyUSD } = batchPoolData;

            // Handle APR: show 0.00% for pools with no volume, Loading... only if undefined
            let aprStr = 'Loading...';
            if (typeof apr7d === 'number') {
              aprStr = apr7d > 0 ? formatAPR(apr7d) : '0.00%';
            }

            return {
              ...pool,
              tvlUSD,
              volume7dUSD,
              fees7dUSD,
              // Map daily averages to 24h fields for UI compatibility
              volume24hUSD: volumeAvgDailyUSD,
              fees24hUSD: feesAvgDailyUSD,
              apr: aprStr,
            };
          }
          return pool;
        });

        setPoolsData(updatedPools as Pool[]);
        console.log('[LiquidityPage] Batch fetch successful. Pools:', updatedPools.length);

      } catch (error) {
        console.error("[LiquidityPage] Batch fetch failed:", error);
        toast.error("Could not load pool data", {
          description: "Failed to fetch data from the server.",
          icon: <OctagonX className="h-4 w-4 text-red-500" />,
          action: {
            label: "Open Ticket",
            onClick: () => window.open('https://discord.gg/alphix', '_blank')
          }
        });
      }
    }, [initialPools]);

  useEffect(() => {
    fetchAllPoolStatsBatch();
  }, [fetchAllPoolStatsBatch]);

  const determineBaseTokenForPriceDisplay = useMemo(() => (token0: string, token1: string): string => {
    if (!token0 || !token1) return token0;
    const quotePriority: Record<string, number> = {
      'aUSDC': 10, 'aUSDT': 9, 'aDAI': 8, 'USDC': 7, 'USDT': 6, 'DAI': 5, 'aETH': 4, 'ETH': 3, 'YUSD': 2, 'mUSDT': 1,
    };
    const token0Priority = quotePriority[token0] || 0;
    const token1Priority = quotePriority[token1] || 0;
    return token1Priority > token0Priority ? token1 : token0;
  }, []);

  const convertTickToPrice = useMemo(() => (tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string): string => {
    if (tick === SDK_MAX_TICK) return '∞';
    if (tick === SDK_MIN_TICK) return '0.00';
    if (currentPoolTick === null || !currentPrice) return 'N/A';
    const currentPriceNum = parseFloat(currentPrice);
    if (isNaN(currentPriceNum) || currentPriceNum <= 0) return 'N/A';
    let priceAtTick: number;
    const priceDelta = Math.pow(1.0001, tick - currentPoolTick);
    if (baseTokenForPriceDisplay === token0Symbol) {
      priceAtTick = 1 / (currentPriceNum * priceDelta);
    } else {
      priceAtTick = currentPriceNum * priceDelta;
    }
    if (!isFinite(priceAtTick) || isNaN(priceAtTick)) return 'N/A';
    if (priceAtTick < 1e-11 && priceAtTick > 0) return '0';
    if (priceAtTick > 1e30) return '∞';
    const displayDecimals = 6;
    return priceAtTick.toFixed(displayDecimals);
  }, []);

  const formatTokenDisplayAmount = (amount: string) => {
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    if (num === 0) return "0";
    if (num > 0 && num < 0.000001) return "< 0.000001";
    return num.toFixed(6);
  };

  const formatAgeShort = (seconds: number | undefined) => {
    if (!seconds || !isFinite(seconds)) return '';
    const d = Math.floor(seconds / 86400);
    if (d >= 1) return `${d}d`;
    const h = Math.floor(seconds / 3600);
    if (h >= 1) return `${h}h`;
    const m = Math.floor(seconds / 60);
    return `${m}m`;
  };

  const { increaseLiquidity } = useIncreaseLiquidity({
    onLiquidityIncreased: () => {
      sonnerToast.success("Liquidity Increased", { icon: <BadgeCheck className="h-4 w-4 text-green-500" /> });
      // Consider a targeted position refresh here
    },
  });

  const { decreaseLiquidity, claimFees } = useDecreaseLiquidity({
    onLiquidityDecreased: () => {
      sonnerToast.success("Liquidity Decreased", { icon: <BadgeCheck className="h-4 w-4 text-green-500" /> });
      // Consider a targeted position refresh here
    },
    onFeesCollected: () => {
      sonnerToast.success("Fees Collected", { icon: <BadgeCheck className="h-4 w-4 text-green-500" /> });
      // Consider a targeted position refresh here
    },
  });

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

  useEffect(() => {
    if (isConnected && accountAddress && chainId) {
      (async () => {
        try {
          const ids = await loadUserPositionIds(accountAddress);
          const timestamps = getCachedPositionTimestamps(accountAddress);
          const positions = await derivePositionsFromIds(accountAddress, ids, chainId, timestamps);
          setUserPositions(positions as any);
        } catch (error) {
          console.error("Failed to load derived positions:", error);
          setUserPositions([]);
        }
      })();
    } else {
      setUserPositions([]);
    }
  }, [isConnected, accountAddress, chainId]);

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const response = await fetch('/api/prices/get-token-prices');
        if (response.ok) {
          const data = await response.json();
          const prices: Record<string, number> = {};
          if (data.ETH) prices['ETH'] = data.ETH;
          if (data.aETH) prices['aETH'] = data.aETH;
          if (data.BTC) prices['BTC'] = data.BTC;
          if (data.aBTC) prices['aBTC'] = data.aBTC;
          prices['USDC'] = prices['aUSDC'] = prices['USDT'] = prices['aUSDT'] = 1.0;
          setPriceMap(prices);
        }
      } catch (error) {
        console.error("Failed to fetch token prices for liquidity page:", error);
      }
    };
    fetchPrices();
  }, []);

  const poolsWithPositionCounts = useMemo(() => {
    return poolsData.map(pool => {
      const apiPoolId = (getPoolSubgraphId(pool.id) || pool.id).toLowerCase();
      const count = userPositions.filter((pos) => String(pos?.poolId || '').toLowerCase() === apiPoolId).length;
      return { ...pool, positionsCount: count };
    });
  }, [poolsData, userPositions]);

  const filteredPools = useMemo(() => {
    return poolsWithPositionCounts;
  }, [poolsWithPositionCounts]);

  useEffect(() => {
    poolsWithPositionCounts.forEach((pool) => {
      router.prefetch(`/liquidity/${pool.id}`)
    })
  }, [poolsWithPositionCounts, router])

  const handleAddLiquidity = useCallback((e: React.MouseEvent, poolId: string) => {
    e.stopPropagation();
    router.push(`/liquidity/${poolId}`);
  }, [router]);

  const columns: ColumnDef<Pool>[] = useMemo(() => [
    {
      accessorKey: "pair",
      header: "Pool",
      size: 240, // Compact size for first column
      cell: ({ row }) => {
        const pool = row.original;
        return (
          <div className="flex items-center gap-2">
            <div className="relative w-14 h-7">
              <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-main z-10">
                <Image
                  src={pool.tokens[0].icon}
                  alt={pool.tokens[0].symbol}
                  width={28}
                  height={28}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute top-0 left-4 w-7 h-7">
                <div className="absolute inset-0 rounded-full overflow-hidden bg-main z-30">
                  <Image
                    src={pool.tokens[1].icon}
                    alt={pool.tokens[1].symbol}
                    width={28}
                    height={28}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-main z-20"></div>
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-medium mb-1">{pool.pair}</span>
              <div className="flex items-center gap-3">
                {pool.type && (
                  <span
                    className="px-1.5 py-0.5 text-xs font-normal rounded-md border border-sidebar-border bg-button text-muted-foreground"
                    style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                  >
                    {pool.type}
                  </span>
                )}
                {pool.positionsCount !== undefined && pool.positionsCount > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {pool.positionsCount} {pool.positionsCount === 1 ? 'position' : 'positions'}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "volume24h",
      header: ({ column }) => <SortableHeader column={column} label="Volume (24h)" />,
      size: 140,
      sortingFn: (rowA, rowB) => (rowA.original.volume24hUSD || 0) - (rowB.original.volume24hUSD || 0),
      sortDescFirst: true,
      cell: ({ row }) => (
        <div className="flex items-center justify-start">
          {typeof row.original.volume24hUSD === 'number' ? formatUSD(row.original.volume24hUSD) : (
            <div className="inline-block h-4 w-16 bg-muted/60 rounded animate-pulse" />
          )}
        </div>
      ),
      meta: { hidePriority: 3 },
    },
    {
      accessorKey: "fees24h",
      header: ({ column }) => <SortableHeader column={column} label="Fees (24h)" />,
      size: 120,
      sortingFn: (rowA, rowB) => (rowA.original.fees24hUSD || 0) - (rowB.original.fees24hUSD || 0),
      sortDescFirst: true,
      cell: ({ row }) => (
        <div className="flex items-center justify-start">
          {typeof row.original.fees24hUSD === 'number' ? formatUSD(row.original.fees24hUSD) : (
            <div className="inline-block h-4 w-12 bg-muted/60 rounded animate-pulse" />
          )}
        </div>
      ),
      meta: { hidePriority: 1 },
    },
    {
      accessorKey: "liquidity",
      header: ({ column }) => <SortableHeader column={column} label="Liquidity" />,
      size: 140,
      sortingFn: (rowA, rowB) => (rowA.original.tvlUSD || 0) - (rowB.original.tvlUSD || 0),
      sortDescFirst: true,
      cell: ({ row }) => (
        <div className="flex items-center justify-start">
          {typeof row.original.tvlUSD === 'number' ? formatUSD(row.original.tvlUSD) : (
            <div className="inline-block h-4 w-20 bg-muted/60 rounded animate-pulse" />
          )}
        </div>
      ),
      meta: { hidePriority: 2 },
    },
    {
      accessorKey: "apr",
      header: ({ column }) => <SortableHeader column={column} label="Yield (7d)" justify="end" />,
      size: 200,
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.apr ? parseFloat(rowA.original.apr.replace(/[~%]/g, '')) : 0;
        const b = rowB.original.apr ? parseFloat(rowB.original.apr.replace(/[~%]/g, '')) : 0;
        return a - b;
      },
      sortDescFirst: true,
      cell: ({ row }) => {
        const isAprCalculated = row.original.apr !== undefined && row.original.apr !== "Loading..." && row.original.apr !== "N/A";
        const aprValue = isAprCalculated ? parseFloat(row.original.apr.replace(/[~%]/g, '')) : 0;
        const formattedAPR = isAprCalculated ? formatAPR(aprValue) : undefined;
        const isZeroApr = aprValue === 0;

        return (
          <div className="relative flex items-center justify-end w-full h-full">
            {isAprCalculated ? (
              <div className={`flex items-center justify-center h-6 px-2.5 rounded-md text-[12px] font-semibold overflow-hidden transition-opacity duration-200 group-hover:opacity-0 ${isZeroApr ? 'bg-muted/40 text-muted-foreground' : 'bg-green-500/20 text-green-500'}`}>
                {formattedAPR}
              </div>
            ) : (
              <div className="inline-block h-4 w-16 bg-muted/60 rounded animate-pulse"></div>
            )}

            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleAddLiquidity(e, row.original.id);
              }}
              className="absolute right-0 top-1/2 -translate-y-1/2 flex h-10 cursor-pointer items-center justify-end gap-2 rounded-md border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto hover:brightness-110 hover:border-white/30"
              style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
            >
              <PlusIcon className="h-4 w-4 relative z-0" />
              <span className="relative z-0 whitespace-nowrap">Add Liquidity</span>
            </button>
          </div>
        );
      },
      meta: {
        hidePriority: 4,
      },
    },
  ], [handleAddLiquidity]);

  const visibleColumns = useMemo(() => {
    if (isMobile) {
      return columns;
    }

    let hideLevel = 0;
    if (windowWidth < 1400) {
      hideLevel = 1;
    }
    
    // Filter columns based on hidePriority - proportional distribution happens automatically
    const filteredColumns = columns.filter(
      (column) => column.meta?.hidePriority === undefined || column.meta.hidePriority > hideLevel
    );

    // Adjust column sizes based on screen size - identical spacing for first 4, spacious last column
    return filteredColumns.map((col) => {
      if ('accessorKey' in col && col.accessorKey === 'pair') {
        // Pool column: same size as others for uniform spacing
        return { ...col, size: windowWidth >= 2000 ? 200 : windowWidth >= 1600 ? 300 : windowWidth >= 1200 ? 250 : 250 };
      }
      if ('accessorKey' in col && col.accessorKey === 'volume24h') {
        // Volume column: same size as others
        return { ...col, size: windowWidth >= 2000 ? 150 : windowWidth >= 1600 ? 180 : windowWidth >= 1200 ? 160 : 160 };
      }
      if ('accessorKey' in col && col.accessorKey === 'fees24h') {
        // Fees column: same size as others
        return { ...col, size: windowWidth >= 2000 ? 150 : windowWidth >= 1600 ? 180 : windowWidth >= 1200 ? 160 : 160 };
      }
      if ('accessorKey' in col && col.accessorKey === 'liquidity') {
        // Liquidity column: same size as others
        return { ...col, size: windowWidth >= 2000 ? 180 : windowWidth >= 1600 ? 180 : windowWidth >= 1200 ? 160 : 140 };
      }
      if ('accessorKey' in col && col.accessorKey === 'apr') {
        // Yield column: takes remaining space to push right
        return { ...col, size: windowWidth >= 2000 ? 400 : windowWidth >= 1600 ? 400 : windowWidth >= 1200 ? 320 : 260 };
      }
      return col;
    });
  }, [isMobile, windowWidth, columns]);

  const table = useReactTable({
    data: filteredPools,
    columns: visibleColumns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnSizingChange: setColumnSizing,
    enableColumnResizing: true,
    enableSorting: true,
    columnResizeMode: 'onChange',
    state: {
      sorting,
      columnSizing,
    },
  });

  const columnSizes = React.useMemo(() => {
    const pairCol = table.getColumn('pair' as any);
    const volCol = table.getColumn('volume24h' as any);
    const feesCol = table.getColumn('fees24h' as any);
    const liqCol = table.getColumn('liquidity' as any);
    const aprCol = table.getColumn('apr' as any);
    return {
      pair: pairCol ? pairCol.getSize() : (windowWidth >= 2000 ? 300 : windowWidth >= 1600 ? 300 : windowWidth >= 1200 ? 250 : 140),
      volume24h: volCol ? volCol.getSize() : (windowWidth >= 2000 ? 180 : windowWidth >= 1600 ? 180 : windowWidth >= 1200 ? 160 : 140),
      fees24h: feesCol ? feesCol.getSize() : (windowWidth >= 2000 ? 180 : windowWidth >= 1600 ? 180 : windowWidth >= 1200 ? 160 : 140),
      liquidity: liqCol ? liqCol.getSize() : (windowWidth >= 2000 ? 180 : windowWidth >= 1600 ? 180 : windowWidth >= 1200 ? 160 : 140),
      apr: aprCol ? aprCol.getSize() : (windowWidth >= 2000 ? 400 : windowWidth >= 1600 ? 400 : windowWidth >= 1200 ? 320 : 260),
    };
  }, [table, columnSizing, windowWidth, visibleColumns]);

  const poolAggregates = React.useMemo(() => {
    let totalTVL = 0;
    let totalVol24h = 0;
    let totalFees24h = 0;
    let counted = 0;
    for (const p of poolsData || []) {
      const tvl = (p as any).tvlUSD;
      const vol = (p as any).volume24hUSD;
      const fees = (p as any).fees24hUSD;
      if (typeof tvl === 'number' && isFinite(tvl)) totalTVL += tvl;
      if (typeof vol === 'number' && isFinite(vol)) totalVol24h += vol;
      if (typeof fees === 'number' && isFinite(fees)) totalFees24h += fees;
      if (typeof tvl === 'number' || typeof vol === 'number' || typeof fees === 'number') counted++;
    }
    const isLoading = counted === 0;
    return { totalTVL, totalVol24h, totalFees24h, isLoading };
  }, [poolsData]);

  const handleSortCycle = (columnId: string) => {
    const col = table.getColumn(columnId as any);
    if (!col) return;
    const state = col.getIsSorted();
    if (!state) col.toggleSorting(false);
    else if (state === 'asc') col.toggleSorting(true);
    else setSorting([]);
  };

  const SortIcon = ({ state }: { state: false | 'asc' | 'desc' }) => {
    const baseClass = "ml-1 h-4 w-4 text-muted-foreground group-hover:text-white transition-colors";
    if (state === 'asc') return <ChevronUpIcon className={baseClass} />;
    if (state === 'desc') return <ChevronDownIcon className={baseClass} />;
    return <ChevronsUpDownIcon className={baseClass} />;
  };

  const SortableHeader = ({ column, label, justify = 'start' }: { column: any; label: string; justify?: 'start' | 'end' }) => (
    <div
      className={`flex items-center justify-${justify} gap-1 cursor-pointer group text-muted-foreground hover:text-white transition-colors`}
      onClick={() => {
        const state = column.getIsSorted();
        if (!state) column.toggleSorting(false);
        else if (state === 'asc') column.toggleSorting(true);
        else setSorting([]);
      }}
    >
      {label}
      <SortIcon state={column.getIsSorted()} />
    </div>
  );

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col p-3 sm:p-6 overflow-x-hidden">
            <div className="mb-2">
              <div className="flex items-stretch justify-between gap-4">
                <div className="flex flex-col">
                  <h2 className="text-xl font-semibold">Liquidity Pools</h2>
                  <p className="text-sm text-muted-foreground">Explore and manage your liquidity positions.</p>
                  <div className="mt-4">
                    <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-2 md:p-4">
                      <div className="flex flex-wrap items-stretch gap-1.5 md:gap-3">
                        <div className="flex-1 min-w-[100px] max-w-[180px] rounded-lg bg-muted/30 border border-sidebar-border/60">
                          <div className="px-3 md:px-4 h-7 md:h-9 flex items-center">
                            <h2 className="text-[10px] md:text-xs tracking-wider text-muted-foreground font-mono font-bold">TVL</h2>
                          </div>
                          <div className="px-3 md:px-4 py-1">
                            <div className="text-base md:text-lg font-medium">
                              {poolAggregates.isLoading ? <span className="inline-block h-5 w-16 md:h-6 md:w-20 bg-muted/60 rounded animate-pulse" /> : formatUSD(poolAggregates.totalTVL)}
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 min-w-[100px] max-w-[180px] rounded-lg bg-muted/30 border border-sidebar-border/60">
                          <div className="px-3 md:px-4 h-7 md:h-9 flex items-center">
                            <h2 className="text-[10px] md:text-xs tracking-wider text-muted-foreground font-mono font-bold">VOLUME (24H)</h2>
                          </div>
                          <div className="px-3 md:px-4 py-1">
                            <div className="text-base md:text-lg font-medium">
                              {poolAggregates.isLoading ? <span className="inline-block h-5 w-16 md:h-6 md:w-20 bg-muted/60 rounded animate-pulse" /> : formatUSD(poolAggregates.totalVol24h)}
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 min-w-[100px] max-w-[180px] rounded-lg bg-muted/30 border border-sidebar-border/60">
                          <div className="px-3 md:px-4 h-7 md:h-9 flex items-center">
                            <h2 className="text-[10px] md:text-xs tracking-wider text-muted-foreground font-mono font-bold">FEES (24H)</h2>
                          </div>
                          <div className="px-3 md:px-4 py-1">
                            <div className="text-base md:text-lg font-medium">
                              {poolAggregates.isLoading ? <span className="inline-block h-5 w-16 md:h-6 md:w-20 bg-muted/60 rounded animate-pulse" /> : formatUSD(poolAggregates.totalFees24h)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {isMobile ? (
              <MobileLiquidityList
                pools={filteredPools}
                onSelectPool={navigateToPool}
              />
            ) : (
              <div className="overflow-x-auto isolate">
                <Table className="w-full bg-muted/30 border border-sidebar-border/60 rounded-lg overflow-hidden" style={{ tableLayout: 'fixed' }}>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      {table.getVisibleLeafColumns().map((col, index, arr) => (
                        <TableHead
                          key={`cat-${col.id}`}
                          className={`px-2 relative text-xs text-muted-foreground ${index === 0 ? 'pl-6' : ''} ${index === arr.length - 1 ? 'pr-6' : ''}`}
                          style={{ width: `${col.getSize()}px` }}
                        >
                          {col.id === 'pair' ? (
                            <span className="text-muted-foreground">Pool</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSortCycle(col.id)}
                              className={`flex w-full items-center ${col.id === 'apr' ? 'justify-end text-right' : 'justify-start text-left'} cursor-pointer select-none group text-muted-foreground hover:text-white transition-colors`}
                            >
                              <span>
                                {col.id === 'volume24h' && 'Volume (24h)'}
                                {col.id === 'fees24h' && 'Fees (24h)'}
                                {col.id === 'liquidity' && 'Liquidity'}
                                {col.id === 'apr' && 'Yield (7d)'}
                              </span>
                              <SortIcon state={table.getColumn(col.id as any)?.getIsSorted?.() || false} />
                            </button>
                          )}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows?.length ? (
                      table.getRowModel().rows.map((row) => {
                        const pool = row.original;
                        const isExpanded = false;

                        return (
                            <React.Fragment key={row.id}>
                              <Link
                                href={`/liquidity/${pool.id}`}
                                className="contents"
                                prefetch
                                onClick={() => setOptimisticPoolId(pool.id)}
                              >
                                <TableRow className={`group cursor-pointer transition-colors hover:bg-muted/30 ${optimisticPoolId === pool.id ? 'bg-muted/40' : ''}`}>
                                  {row.getVisibleCells().map((cell, index) => (
                                    <TableCell 
                                      key={cell.id}
                                      className={`relative py-4 px-2 ${index === 0 ? 'pl-6' : ''} ${index === row.getVisibleCells().length - 1 ? 'pr-6' : ''}`}
                                      style={{ width: `${cell.column.getSize()}px` }}
                                    >
                                      {flexRender(
                                        cell.column.columnDef.cell,
                                        cell.getContext()
                                      )}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              </Link>
                            </React.Fragment>
                        );
                      })
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
      </AppLayout>
    );
  } 