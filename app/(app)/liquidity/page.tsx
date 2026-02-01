"use client";

import { formatUSD as formatUSDShared } from "@/lib/format";
import { useState, useMemo, useCallback } from "react";
import { Table, Cell, HeaderCell, ClickableHeaderRow, HeaderArrow, HeaderSortText } from "@/components/table-v2";
import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, useReducedMotion } from "framer-motion";

import * as React from "react";
import { ColumnDef, RowData, Row } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { MobileLiquidityList } from "@/components/MobileLiquidityList";
import { getEnabledPools, getToken, getPoolSubgraphId } from "@/lib/pools-config";
import { Pool } from "@/types";
import { useRouter, useSearchParams } from "next/navigation";
import { useNetwork } from "@/lib/network-context";
import { prefetchService } from "@/lib/prefetch-service";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TokenSearchBar } from "@/components/liquidity/TokenSearchBar";
import { APRBadge } from "@/components/liquidity/APRBadge";
import { fetchAaveRates, getAaveKey } from "@/lib/aave-rates";
import { useWSPools } from "@/lib/websocket";

/**
 * PoolRowPrefetchWrapper - Wraps pool table rows with hover prefetch and stagger animation
 * Prefetches pool detail page data when user hovers over a pool row
 */
function PoolRowPrefetchWrapper({
  poolId,
  children,
  index = 0,
}: {
  poolId: string;
  children: React.ReactNode;
  index?: number;
}) {
  const { onMouseEnter, onMouseLeave } = usePrefetchOnHover({
    prefetchRoute: `/liquidity/${poolId}`,
    prefetchData: () => prefetchService.prefetchPoolDetailData(poolId),
    delay: 150,
  });
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return (
      <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      onHoverStart={onMouseEnter}
      onHoverEnd={onMouseLeave}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: 0.1 + index * 0.03,
        duration: 0.3,
        ease: [0.25, 0.1, 0.25, 1],
      }}
    >
      {children}
    </motion.div>
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
  const { networkMode } = useNetwork();

  // Pool config (static: tokens, icons, pair names)
  const poolConfigs = useMemo(() => generatePoolsFromConfig(), [networkMode]);

  // Pool metrics from WebSocket (real-time: TVL, volume, fees, APR)
  // Pattern: Initial REST from api.alphix.fi → WebSocket updates
  const { pools: wsPoolsData, poolsMap: wsPoolsMap, isLoading: isLoadingPools } = useWSPools();

  // Merge pool config with WebSocket metrics
  const poolsData = useMemo(() => {
    return poolConfigs.map(poolConfig => {
      const subgraphId = (getPoolSubgraphId(poolConfig.id) || poolConfig.id).toLowerCase();
      const wsPool = wsPoolsMap.get(subgraphId);

      if (wsPool) {
        // Format APR string
        const aprValue = wsPool.apr24h;
        const aprStr = Number.isFinite(aprValue) && aprValue > 0
          ? (aprValue < 1000 ? `${aprValue.toFixed(2)}%` : `${(aprValue / 1000).toFixed(2)}K%`)
          : '0.00%';

        return {
          ...poolConfig,
          tvlUSD: wsPool.tvlUsd,
          volume24hUSD: wsPool.volume24hUsd,
          fees24hUSD: wsPool.fees24hUsd,
          apr: aprStr,
        };
      }
      return poolConfig;
    });
  }, [poolConfigs, wsPoolsMap]);

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

  const isMobile = useIsMobile();
  const router = useRouter();
  const searchParams = useSearchParams();

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


  const poolsWithPositionCounts = poolsData;

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
          // Use unified yield (pool APR + lending APR) for sorting
          const aprStr = pool.apr || '0';
          const isK = aprStr.includes('K%');
          const poolApr = parseFloat(aprStr.replace(/[~%K]/g, '')) || 0;
          const normalizedPoolApr = isK ? poolApr * 1000 : poolApr;
          const tokens = pool.tokens || [];
          const lendingApr = getPoolAaveApy(tokens[0]?.symbol || '', tokens[1]?.symbol || '') || 0;
          return normalizedPoolApr + lendingApr;
        }
        default: return 0;
      }
    };

    return [...poolsWithLinks].sort((a, b) => {
      const aVal = getSortValue(a);
      const bVal = getSortValue(b);
      // sortAscending=false means descending (highest first), arrow points down
      return sortAscending ? aVal - bVal : bVal - aVal;
    });
  }, [poolsWithPositionCounts, sortMethod, sortAscending, tokenSearch, getPoolAaveApy]);

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
    for (const p of poolsData || []) {
      const tvl = (p as any).tvlUSD;
      const vol = (p as any).volume24hUSD;
      const fees = (p as any).fees24hUSD;
      if (typeof tvl === 'number' && isFinite(tvl)) totalTVL += tvl;
      if (typeof vol === 'number' && isFinite(vol)) totalVol24h += vol;
      if (typeof fees === 'number' && isFinite(fees)) totalFees24h += fees;
    }
    return { totalTVL, totalVol24h, totalFees24h, isLoading: isLoadingPools };
  }, [poolsData, isLoadingPools]);

  // Prefetch wrapper for pool rows - prefetches data on hover with stagger animation
  const poolRowWrapper = useCallback(
    (row: Row<Pool & { link: string }>, content: React.ReactNode) => {
      const poolId = row.original?.id;
      if (!poolId) return content;

      return (
        <PoolRowPrefetchWrapper poolId={poolId} index={row.index}>
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