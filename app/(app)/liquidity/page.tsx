"use client";

import { formatUSD as formatUSDShared } from "@/lib/format";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Table, Cell, HeaderCell, ClickableHeaderRow, HeaderArrow, HeaderSortText } from "@/components/table-v2";
import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

import * as React from "react";
import { ColumnDef, RowData, Row } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { MobileLiquidityList } from "@/components/MobileLiquidityList";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import { useAccount } from "wagmi";
import { toast as sonnerToast } from "sonner";
import { getEnabledPools, getToken, getPoolSubgraphId, getAllTokenSymbols } from "@/lib/pools-config";
import { loadUserPositionIds, derivePositionsFromIds, getCachedPositionTimestamps } from "@/lib/client-cache";
import { Pool } from "@/types";
import { useRouter, useSearchParams } from "next/navigation";
import { IconCircleXmarkFilled } from "nucleo-micro-bold-essential";
import { IconBadgeCheck2 } from "nucleo-micro-bold-essential";
import { getTokenDefinitions, type TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { useIncreaseLiquidity, type IncreasePositionData, useDecreaseLiquidity, type DecreasePositionData } from "@/lib/liquidity/hooks";
import { prefetchService } from "@/lib/prefetch-service";
import { batchQuotePrices } from "@/lib/swap/quote-prices";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TickMath } from '@uniswap/v3-sdk';
import { TokenSearchBar } from "@/components/liquidity/TokenSearchBar";
import { APRBadge } from "@/components/liquidity/APRBadge";
import { fetchAaveRates, getAaveKey } from "@/lib/aave-rates";

const DEFAULT_TICK_SPACING = 60;

/**
 * PoolRowPrefetchWrapper - Wraps pool table rows with hover prefetch
 * Prefetches pool detail page data when user hovers over a pool row
 */
function PoolRowPrefetchWrapper({
  poolId,
  children,
}: {
  poolId: string;
  children: React.ReactNode;
}) {
  const { onMouseEnter, onMouseLeave } = usePrefetchOnHover({
    prefetchRoute: `/liquidity/${poolId}`,
    prefetchData: () => prefetchService.prefetchPoolDetailData(poolId),
    delay: 150,
  });

  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {children}
    </div>
  );
}

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
  return `${(aprValue / 1000).toFixed(2)}K%`;
};

export default function LiquidityPage() {
  const [userPositions, setUserPositions] = useState<ProcessedPosition[]>([]);
  const { networkMode } = useNetwork();
  const warnedAllZeroBatchRef = React.useRef(false);

  const initialPools = useMemo(() => generatePoolsFromConfig(), [networkMode]);
  const [poolsData, setPoolsData] = useState<Pool[]>([]);

  // Fetch Aave rates for Unified Yield display
  const { data: aaveRatesData } = useQuery({
    queryKey: ['aaveRates'],
    queryFn: fetchAaveRates,
    staleTime: 5 * 60_000, // 5 minutes
  });

  // Calculate Aave APY for a pool based on its token symbols
  const getPoolAaveApy = useCallback((token0Symbol: string, token1Symbol: string): number | undefined => {
    if (!aaveRatesData?.success) return undefined;

    const key0 = getAaveKey(token0Symbol);
    const key1 = getAaveKey(token1Symbol);

    const apy0 = key0 && aaveRatesData.data[key0] ? aaveRatesData.data[key0].apy : null;
    const apy1 = key1 && aaveRatesData.data[key1] ? aaveRatesData.data[key1].apy : null;

    // Average if both tokens supported, otherwise use single token's APY
    if (apy0 !== null && apy1 !== null) {
      return (apy0 + apy1) / 2;
    }
    return apy0 ?? apy1 ?? undefined;
  }, [aaveRatesData]);

  useEffect(() => {
    setPoolsData(initialPools);
  }, [initialPools]);

  const isMobile = useIsMobile();
  const { address: accountAddress, isConnected, chainId } = useAccount();
  const [selectedPoolId, setSelectedPoolId] = useState<string>("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [poolDataByPoolId, setPoolDataByPoolId] = useState<Record<string, any>>({});
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [isLoadingPoolStates, setIsLoadingPoolStates] = useState(true);

  // Token search state - sync with URL param
  const initialTokenSearch = searchParams?.get('token') || '';
  const [tokenSearch, setTokenSearch] = useState(initialTokenSearch);

  // Update URL when token search changes
  const handleTokenSearchChange = useCallback((value: string) => {
    setTokenSearch(value);
    const params = new URLSearchParams(searchParams?.toString() || '');
    if (value) {
      params.set('token', value);
    } else {
      params.delete('token');
    }
    const newUrl = params.toString() ? `?${params.toString()}` : '/liquidity';
    router.replace(newUrl, { scroll: false });
  }, [router, searchParams]);

  // Sorting state
  type SortField = 'tvl' | 'volume24h' | 'fees24h' | 'apr';
  const [sortMethod, setSortMethod] = useState<SortField>('tvl');
  const [sortAscending, setSortAscending] = useState(false);

  const handleSort = useCallback((field: SortField) => {
    if (sortMethod === field) {
      setSortAscending(prev => !prev);
    } else {
      setSortMethod(field);
      setSortAscending(false);
    }
  }, [sortMethod]);

  // Sortable header component
  const SortableHeader = ({ field, label, justify = 'flex-end' }: { field: SortField; label: string; justify?: 'flex-start' | 'flex-end' }) => {
    const isActive = sortMethod === field;
    return (
      <HeaderCell justifyContent={justify}>
        <ClickableHeaderRow className="group gap-1 w-full" style={{ justifyContent: justify }} onClick={() => handleSort(field)}>
          <HeaderSortText active={isActive}>{label}</HeaderSortText>
          {isActive && <HeaderArrow orderDirection={sortAscending ? 'asc' : 'desc'} />}
        </ClickableHeaderRow>
      </HeaderCell>
    );
  };

  const navigateToPool = useCallback((poolId: string) => {
    router.push(`/liquidity/${poolId}`);
  }, [router]);

  const fetchAllPoolStatsBatch = useCallback(async () => {
      try {
        // Fetch from API - Redis cache handles caching on server side
        const response = await fetch(`/api/liquidity/get-pools-batch?network=${networkMode}`);
        if (!response.ok) throw new Error(`Batch API failed: ${response.status}`);
        const batchData = await response.json();
        if (!batchData.success) throw new Error(`Batch API error: ${batchData.message}`);

        const updatedPools = initialPools.map((pool) => {
          const apiPoolId = getPoolSubgraphId(pool.id) || pool.id;
          const batchPoolData = batchData.pools.find((p: any) => p.poolId.toLowerCase() === apiPoolId.toLowerCase());

          if (batchPoolData) {
            const { tvlUSD, volume24hUSD, fees24hUSD, apr } = batchPoolData;

            // Handle APR: show 0.00% for pools with no volume, Loading... only if undefined
            let aprStr = 'Loading...';
            if (typeof apr === 'number') {
              aprStr = apr > 0 ? formatAPR(apr) : '0.00%';
            }

            return {
              ...pool,
              tvlUSD,
              volume24hUSD,
              fees24hUSD,
              apr: aprStr,
            };
          }
          return pool;
        });

        const numericPools = updatedPools.filter((p: any) => typeof p?.tvlUSD === 'number');
        const looksAllZero =
          numericPools.length > 0 &&
          numericPools.every((p: any) => p.tvlUSD === 0 && p.volume24hUSD === 0 && p.fees24hUSD === 0);

        if (looksAllZero) {
          throw new Error('All-zero pool stats response');
        }

        setPoolsData(updatedPools as Pool[]);

      } catch (error) {
        console.error("[LiquidityPage] Batch fetch failed:", error);
        const msg = (error instanceof Error ? error.message : String(error)) || '';
        if (!warnedAllZeroBatchRef.current && msg.includes('All-zero pool stats')) {
          warnedAllZeroBatchRef.current = true;
          sonnerToast.error("Pool data temporarily unavailable", {
            description: "Refresh in a moment — we kept the last good values.",
            icon: <IconCircleXmarkFilled className="h-4 w-4 text-red-500" />,
          });
          return;
        }

        sonnerToast.error("Could not load pool data", {
          description: "Failed to fetch data from the server.",
          icon: <IconCircleXmarkFilled className="h-4 w-4 text-red-500" />,
          action: {
            label: "Open Ticket",
            onClick: () => window.open('https://discord.com/invite/NTXRarFbTr', '_blank')
          }
        });
      }
    }, [initialPools, networkMode]);

  const forceRefreshAllPoolStatsBatch = useCallback(async () => {
    try {
      const response = await fetch(`/api/liquidity/get-pools-batch?network=${networkMode}&v=${Date.now()}`);
      if (!response.ok) return;
      const batchData = await response.json();
      if (!batchData?.success || !Array.isArray(batchData?.pools)) return;

      const updatedPools = initialPools.map((pool) => {
        const apiPoolId = getPoolSubgraphId(pool.id) || pool.id;
        const batchPoolData = batchData.pools.find((p: any) => p.poolId.toLowerCase() === apiPoolId.toLowerCase());

        if (batchPoolData) {
          const { tvlUSD, volume24hUSD, fees24hUSD, apr } = batchPoolData;
          let aprStr = 'Loading...';
          if (typeof apr === 'number') {
            aprStr = apr > 0 ? formatAPR(apr) : '0.00%';
          }
          return {
            ...pool,
            tvlUSD,
            volume24hUSD,
            fees24hUSD,
            apr: aprStr,
          };
        }
        return pool;
      });

      const numericPools = updatedPools.filter((p: any) => typeof p?.tvlUSD === 'number');
      const looksAllZero =
        numericPools.length > 0 &&
        numericPools.every((p: any) => p.tvlUSD === 0 && p.volume24hUSD === 0 && p.fees24hUSD === 0);
      if (looksAllZero) return;

      setPoolsData(updatedPools as Pool[]);
    } catch {}
  }, [initialPools, networkMode]);

  useEffect(() => {
    fetchAllPoolStatsBatch();
  }, [fetchAllPoolStatsBatch]);

  useEffect(() => {
    if (!isConnected || !accountAddress) return;
    return prefetchService.addPositionsListener(accountAddress, () => {
      void forceRefreshAllPoolStatsBatch();
    });
  }, [isConnected, accountAddress, forceRefreshAllPoolStatsBatch]);

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
    if (tick === TickMath.MAX_TICK) return '∞';
    if (tick === TickMath.MIN_TICK) return '0.00';
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
      sonnerToast.success("Liquidity Increased", { icon: <IconBadgeCheck2 className="h-4 w-4 text-green-500" /> });
      // Consider a targeted position refresh here
    },
  });

  const { decreaseLiquidity, claimFees } = useDecreaseLiquidity({
    onLiquidityDecreased: () => {
      sonnerToast.success("Liquidity Decreased", { icon: <IconBadgeCheck2 className="h-4 w-4 text-green-500" /> });
      // Consider a targeted position refresh here
    },
    onFeesCollected: () => {
      sonnerToast.success("Fees Collected", { icon: <IconBadgeCheck2 className="h-4 w-4 text-green-500" /> });
      // Consider a targeted position refresh here
    },
  });

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
        // Use config-derived token list for current network
        const symbols = getAllTokenSymbols(networkMode);
        const prices = await batchQuotePrices(symbols, chainId, networkMode);
        setPriceMap(prices);
      } catch (error) {
        console.error("Failed to fetch token prices for liquidity page:", error);
      }
    };
    fetchPrices();
  }, [networkMode, chainId]);

  const poolsWithPositionCounts = useMemo(() => {
    return poolsData.map(pool => {
      const apiPoolId = (getPoolSubgraphId(pool.id) || pool.id).toLowerCase();
      const count = userPositions.filter((pos) => String(pos?.poolId || '').toLowerCase() === apiPoolId).length;
      return { ...pool, positionsCount: count };
    });
  }, [poolsData, userPositions]);

  const filteredPools = useMemo(() => {
    // Add link property for row navigation in table-v2
    let poolsWithLinks = poolsWithPositionCounts.map(pool => ({
      ...pool,
      link: `/liquidity/${pool.id}`,
    }));

    // Apply token search filter
    if (tokenSearch.trim()) {
      const searchLower = tokenSearch.toLowerCase().trim();
      poolsWithLinks = poolsWithLinks.filter(pool => {
        // Match against token symbols in the pool pair
        const token0 = pool.tokens[0]?.symbol?.toLowerCase() || '';
        const token1 = pool.tokens[1]?.symbol?.toLowerCase() || '';
        return token0.includes(searchLower) || token1.includes(searchLower);
      });
    }

    // Apply sorting
    const getSortValue = (pool: any): number => {
      switch (sortMethod) {
        case 'tvl': return pool.tvlUSD || 0;
        case 'volume24h': return pool.volume24hUSD || 0;
        case 'fees24h': return pool.fees24hUSD || 0;
        case 'apr': {
          const aprStr = pool.apr || '0';
          return parseFloat(aprStr.replace(/[~%]/g, '')) || 0;
        }
        default: return 0;
      }
    };

    return [...poolsWithLinks].sort((a, b) => {
      const aVal = getSortValue(a);
      const bVal = getSortValue(b);
      return sortAscending ? aVal - bVal : bVal - aVal;
    });
  }, [poolsWithPositionCounts, sortMethod, sortAscending, tokenSearch]);

  const [mobileSortBy, setMobileSortBy] = useState<"apr" | "tvl" | "volume">("tvl");

  const mobilePools = useMemo(() => {
    if (!isMobile) return filteredPools;

    const parseApr = (apr: unknown) => {
      if (typeof apr !== "string") return 0;
      if (!apr || apr === "Loading..." || apr === "N/A" || apr === "—") return 0;
      const isK = apr.includes("K%");
      const n = parseFloat(apr.replace(/[~%K]/g, ""));
      if (!Number.isFinite(n)) return 0;
      return isK ? n * 1000 : n;
    };

    const getMetric = (p: any) => {
      if (mobileSortBy === "apr") return parseApr(p?.apr);
      if (mobileSortBy === "volume") return Number.isFinite(p?.volume24hUSD) ? Number(p.volume24hUSD) : 0;
      return Number.isFinite(p?.tvlUSD) ? Number(p.tvlUSD) : 0;
    };

    return [...filteredPools].sort((a: any, b: any) => getMetric(b) - getMetric(a));
  }, [filteredPools, isMobile, mobileSortBy]);

  const columns: ColumnDef<Pool & { link: string }>[] = useMemo(() => [
    {
      id: "pair",
      accessorKey: "pair",
      header: () => (
        <HeaderCell justifyContent="flex-start">
          <span className="text-muted-foreground text-sm">Pool</span>
        </HeaderCell>
      ),
      size: 280,
      cell: ({ row }) => {
        const pool = row?.original;
        if (!pool) {
          return (
            <Cell loading justifyContent="flex-start" />
          );
        }
        return (
          <Cell justifyContent="flex-start">
            <div className="flex items-center gap-3">
              <div className="relative w-14 h-7 flex-shrink-0">
                <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background border border-sidebar-border z-10">
                  <Image
                    src={pool.tokens[0].icon}
                    alt={pool.tokens[0].symbol}
                    width={28}
                    height={28}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="absolute top-0 left-5 w-7 h-7 rounded-full overflow-hidden bg-background border border-sidebar-border z-20">
                  <Image
                    src={pool.tokens[1].icon}
                    alt={pool.tokens[1].symbol}
                    width={28}
                    height={28}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-sm truncate">{pool.pair}</span>
                {pool.type && (
                  <span className="px-1.5 py-0.5 text-[10px] font-normal rounded border border-sidebar-border/50 bg-muted/30 text-muted-foreground flex-shrink-0">
                    {pool.type}
                  </span>
                )}
              </div>
            </div>
          </Cell>
        );
      },
    },
    {
      id: "tvl",
      accessorKey: "tvlUSD",
      header: () => <SortableHeader field="tvl" label="TVL" />,
      size: 140,
      cell: ({ row }) => {
        const isLoading = !row?.original || typeof row.original.tvlUSD !== 'number';
        return (
          <Cell loading={isLoading} justifyContent="flex-end">
            <span className="text-sm font-mono">{formatUSD(row?.original?.tvlUSD || 0)}</span>
          </Cell>
        );
      },
    },
    {
      id: "volume24h",
      accessorKey: "volume24hUSD",
      header: () => <SortableHeader field="volume24h" label="Volume (24h)" />,
      size: 150,
      cell: ({ row }) => {
        const isLoading = !row?.original || typeof row.original.volume24hUSD !== 'number';
        return (
          <Cell loading={isLoading} justifyContent="flex-end">
            <span className="text-sm font-mono">{formatUSD(row?.original?.volume24hUSD || 0)}</span>
          </Cell>
        );
      },
    },
    {
      id: "fees24h",
      accessorKey: "fees24hUSD",
      header: () => <SortableHeader field="fees24h" label="Fees (24h)" />,
      size: 130,
      cell: ({ row }) => {
        const isLoading = !row?.original || typeof row.original.fees24hUSD !== 'number';
        return (
          <Cell loading={isLoading} justifyContent="flex-end">
            <span className="text-sm font-mono">{formatUSD(row?.original?.fees24hUSD || 0)}</span>
          </Cell>
        );
      },
    },
    {
      id: "apr",
      accessorKey: "apr",
      header: () => <SortableHeader field="apr" label="APR" />,
      size: 120,
      cell: ({ row }) => {
        const pool = row?.original;
        if (!pool) {
          return <Cell loading justifyContent="flex-end" />;
        }
        const isAprCalculated = pool.apr !== undefined && pool.apr !== "Loading..." && pool.apr !== "N/A";
        const aprValue = isAprCalculated ? parseFloat(pool.apr.replace(/[~%K]/g, '')) : undefined;
        const tokens = pool.tokens || [];
        const lendingApr = getPoolAaveApy(tokens[0]?.symbol || '', tokens[1]?.symbol || '');

        return (
          <Cell justifyContent="flex-end">
            <APRBadge
              breakdown={{ poolApr: aprValue, lendingApr }}
              token0Symbol={tokens[0]?.symbol}
              token1Symbol={tokens[1]?.symbol}
              isLoading={!isAprCalculated}
            />
          </Cell>
        );
      },
    },
  ], [sortMethod, sortAscending, getPoolAaveApy]);

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

  // Prefetch wrapper for pool rows - prefetches data on hover
  const poolRowWrapper = useCallback(
    (row: Row<Pool & { link: string }>, content: React.ReactNode) => {
      const poolId = row.original?.id;
      if (!poolId) return content;

      return (
        <PoolRowPrefetchWrapper poolId={poolId}>
          {content}
        </PoolRowPrefetchWrapper>
      );
    },
    []
  );

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-6 overflow-x-hidden w-full max-w-[1200px] mx-auto">
      {/* Header Section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Unified Pools</h2>
            <p className="text-sm text-muted-foreground">Explore and manage your liquidity positions.</p>
          </div>
        </div>

        {/* Stats Cards + Search Bar - aligned at bottom */}
        <div className="flex items-end justify-between gap-4">
          {/* Stats Cards */}
          <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-4">
            <div className="flex gap-4">
              <div className="w-[160px] rounded-lg bg-muted/30 border border-sidebar-border/60 px-4 py-3">
                <h2 className="text-xs tracking-wider text-muted-foreground font-mono font-bold whitespace-nowrap mb-1">TVL</h2>
                <div className="text-lg font-medium translate-y-0.5">
                  {poolAggregates.isLoading ? <span className="inline-block h-6 w-20 bg-muted/60 rounded animate-pulse" /> : formatUSD(poolAggregates.totalTVL)}
                </div>
              </div>
              <div className="w-[160px] rounded-lg bg-muted/30 border border-sidebar-border/60 px-4 py-3">
                <h2 className="text-xs tracking-wider text-muted-foreground font-mono font-bold whitespace-nowrap mb-1">VOLUME (24H)</h2>
                <div className="text-lg font-medium translate-y-0.5">
                  {poolAggregates.isLoading ? <span className="inline-block h-6 w-20 bg-muted/60 rounded animate-pulse" /> : formatUSD(poolAggregates.totalVol24h)}
                </div>
              </div>
              <div className="w-[160px] rounded-lg bg-muted/30 border border-sidebar-border/60 px-4 py-3">
                <h2 className="text-xs tracking-wider text-muted-foreground font-mono font-bold whitespace-nowrap mb-1">FEES (24H)</h2>
                <div className="text-lg font-medium translate-y-0.5">
                  {poolAggregates.isLoading ? <span className="inline-block h-6 w-20 bg-muted/60 rounded animate-pulse" /> : formatUSD(poolAggregates.totalFees24h)}
                </div>
              </div>
            </div>
          </div>

          {/* Search bar + New Position button - aligned to bottom */}
          {!isMobile && (
            <div className="flex items-center gap-3">
              <TokenSearchBar
                value={tokenSearch}
                onValueChange={handleTokenSearchChange}
                placeholder="Search tokens..."
              />
              <Button
                asChild
                className="h-10 px-4 gap-2 bg-button-primary hover-button-primary text-sidebar-primary font-semibold rounded-md transition-all active:scale-[0.98]"
              >
                <Link href="/liquidity/add?from=pools">
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                  New position
                </Link>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Table Section */}
      {isMobile ? (
        <div className="flex flex-col gap-3">
          {mobilePools.length >= 3 && (
            <div className="flex items-center justify-end">
              <Select value={mobileSortBy} onValueChange={(v) => setMobileSortBy(v as any)}>
                <SelectTrigger className="h-9 w-[128px] bg-muted/30 border-sidebar-border/60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="apr">APR</SelectItem>
                  <SelectItem value="tvl">TVL</SelectItem>
                  <SelectItem value="volume">Volume</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <MobileLiquidityList pools={mobilePools} />
        </div>
      ) : (
        <Table
          columns={columns}
          data={filteredPools}
          loading={poolAggregates.isLoading}
          maxWidth={1200}
          defaultPinnedColumns={['pair']}
          loadingRowsCount={6}
          rowWrapper={poolRowWrapper}
        />
      )}
    </div>
  );
} 