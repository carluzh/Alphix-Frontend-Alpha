"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppLayout } from "@/components/app-layout";
import Image from "next/image";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import JSBI from "jsbi";
import { Token } from "@uniswap/sdk-core";
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import { publicClient } from "@/lib/viemClient";
import { getAllPools, getToken, getPoolById, CHAIN_ID, getStateViewAddress, getPositionManagerAddress } from "@/lib/pools-config";
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { position_manager_abi } from "@/lib/abis/PositionManager_abi";
import { parseAbi, type Abi, type Hex, getAddress } from "viem";
import { ethers } from "ethers";
import { X } from "lucide-react";

// Context for portfolio token filter, so inner components can toggle it
const PortfolioFilterContext = React.createContext<{
  activeTokenFilter: string | null;
  setActiveTokenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  isStickyHover: boolean;
  setIsStickyHover: React.Dispatch<React.SetStateAction<boolean>>;
}>({
  activeTokenFilter: null,
  setActiveTokenFilter: (() => {}) as React.Dispatch<React.SetStateAction<string | null>>,
  isStickyHover: false,
  setIsStickyHover: (() => {}) as React.Dispatch<React.SetStateAction<boolean>>,
});
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { useAccount } from "wagmi";
import poolsConfig from "@/config/pools.json";
// getAllPools/getPoolById already imported above
import { ChevronUpIcon, ChevronDownIcon, ChevronsUpDownIcon, OctagonX, OctagonAlert, EllipsisVertical } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import TickRangePortfolio from "../../components/TickRangePortfolio";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";


const RANGES = ["1D", "1W", "1M", "1Y", "MAX"] as const;
type Range = typeof RANGES[number];

interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  color: string;
}

interface PortfolioData {
  totalValue: number;
  tokenBalances: TokenBalance[];
  isLoading: boolean;
  error?: string;
  priceMap: Record<string, number>;
  pnl24hPct: number;
  priceChange24hPctMap: Record<string, number>;
}

// Subgraph + onchain composition loader (client-side)
const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-test/version/latest";
const GET_USER_POSITIONS_QUERY = `
  query GetUserPositions($owner: Bytes!) {
    hookPositions(first: 200, orderBy: liquidity, orderDirection: desc, where: { owner: $owner }) {
      id
      pool
      owner
      hook
      currency0 { id symbol decimals }
      currency1 { id symbol decimals }
      tickLower
      tickUpper
      liquidity
      blockTimestamp
    }
  }
`;

type GqlToken = { id: string; symbol: string; decimals: string };
type GqlPosition = {
  id: string;
  pool: string;
  owner: string;
  hook: string;
  currency0?: GqlToken;
  currency1?: GqlToken;
  tickLower: string;
  tickUpper: string;
  liquidity: string;
  blockTimestamp?: string;
};

function parseTokenIdFromCompositeId(compositeId: string): bigint | null {
  try {
    const lastDash = compositeId.lastIndexOf('-');
    if (lastDash === -1) return null;
    const hex = compositeId.slice(lastDash + 1);
    if (!hex.startsWith('0x')) return null;
    return BigInt(hex);
  } catch {
    return null;
  }
}

async function getUserPositionsOnchain(ownerAddress: string, opts?: { verifyLiquidity?: boolean }) {
  const owner = getAddress(ownerAddress);
  const verifyLiquidity = !!opts?.verifyLiquidity;

  // Discover via subgraph
  const resp = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: GET_USER_POSITIONS_QUERY, variables: { owner: owner.toLowerCase() } }),
  });
  if (!resp.ok) return [] as any[];
  const json = await resp.json() as { data?: { hookPositions: GqlPosition[] } };
  const pools = getAllPools();
  const allowed = new Set(pools.map(p => p.subgraphId.toLowerCase()));
  const raw = (json?.data?.hookPositions ?? []).filter(p => allowed.has(String(p.pool || '').toLowerCase()));
  if (raw.length === 0) return [] as any[];

  // Slot0 per unique pool
  const stateViewAbi: Abi = parseAbi(STATE_VIEW_HUMAN_READABLE_ABI);
  const stateViewAddr = getStateViewAddress();
  const uniquePools = Array.from(new Set(raw.map(r => r.pool.toLowerCase())));
  const poolSlot0 = new Map<string, { sqrtPriceX96: string; tick: number }>();
  await Promise.all(uniquePools.map(async (pid) => {
    const res = await publicClient.readContract({
      address: stateViewAddr,
      abi: stateViewAbi,
      functionName: 'getSlot0',
      args: [pid as unknown as Hex],
    }) as readonly [bigint, number, number, number];
    poolSlot0.set(pid, { sqrtPriceX96: res[0].toString(), tick: Number(res[1]) });
  }));

  // Optional: onchain liquidity per tokenId
  const pmAddr = getPositionManagerAddress();
  const pmAbi: Abi = position_manager_abi as unknown as Abi;
  const liqMap = new Map<string, bigint>();
  if (verifyLiquidity) {
    await Promise.all(raw.map(async (r) => {
      const tokenId = parseTokenIdFromCompositeId(r.id);
      if (tokenId === null) return;
      try {
        const liq = await publicClient.readContract({
          address: pmAddr,
          abi: pmAbi,
          functionName: 'getPositionLiquidity',
          args: [tokenId],
        }) as bigint;
        liqMap.set(r.id, liq);
      } catch {}
    }));
  }

  // Compute token amounts
  const processed: any[] = [];
  for (const r of raw) {
    const cfg = pools.find(p => p.subgraphId.toLowerCase() === r.pool.toLowerCase());
    if (!cfg) continue;
    const slot0 = poolSlot0.get(r.pool.toLowerCase());
    if (!slot0) continue;

    const t0Addr = getAddress(cfg.currency0.address);
    const t1Addr = getAddress(cfg.currency1.address);
    const t0Dec = r.currency0?.decimals ? parseInt(r.currency0.decimals, 10) : (cfg as any).currency0.decimals ?? 18;
    const t1Dec = r.currency1?.decimals ? parseInt(r.currency1.decimals, 10) : (cfg as any).currency1.decimals ?? 18;
    const t0Sym = r.currency0?.symbol || (cfg as any).currency0.symbol || 'T0';
    const t1Sym = r.currency1?.symbol || (cfg as any).currency1.symbol || 'T1';

    const sdk0 = new Token(CHAIN_ID, t0Addr, t0Dec, t0Sym);
    const sdk1 = new Token(CHAIN_ID, t1Addr, t1Dec, t1Sym);
    const pool = new V4Pool(
      sdk0,
      sdk1,
      cfg.fee,
      cfg.tickSpacing,
      cfg.hooks,
      slot0.sqrtPriceX96,
      JSBI.BigInt(0),
      slot0.tick
    );

    const tickLower = Number(r.tickLower);
    const tickUpper = Number(r.tickUpper);
    const liquidityBigInt = verifyLiquidity && liqMap.has(r.id) ? liqMap.get(r.id)! : BigInt(r.liquidity);
    const position = new V4Position({ pool, tickLower, tickUpper, liquidity: JSBI.BigInt(liquidityBigInt.toString()) });

    const raw0 = position.amount0.quotient.toString();
    const raw1 = position.amount1.quotient.toString();

    processed.push({
      positionId: r.id,
      poolId: r.pool,
      token0: { address: sdk0.address, symbol: sdk0.symbol || 'T0', amount: ethers.utils.formatUnits(raw0, sdk0.decimals), rawAmount: raw0 },
      token1: { address: sdk1.address, symbol: sdk1.symbol || 'T1', amount: ethers.utils.formatUnits(raw1, sdk1.decimals), rawAmount: raw1 },
      tickLower,
      tickUpper,
      liquidityRaw: liquidityBigInt.toString(),
      isInRange: slot0.tick >= tickLower && slot0.tick < tickUpper,
      ageSeconds: 0,
      blockTimestamp: r.blockTimestamp || '0',
    });
  }

  return processed;
}

function formatUSD(num: number) {
  if (!isFinite(num)) return "$0.00";
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Portfolio loading skeleton component
function PortfolioSkeleton() {
  const [isVerySmallScreen, setIsVerySmallScreen] = useState(false);
  
  useEffect(() => {
    const updateScreenSize = () => {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      setIsVerySmallScreen(viewportWidth < 695);
    };
    
    updateScreenSize();
    window.addEventListener('resize', updateScreenSize);
    return () => window.removeEventListener('resize', updateScreenSize);
  }, []);

  return (
    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-6">
      <div
        className="grid items-center"
        style={{
          gridTemplateColumns: isVerySmallScreen
            ? "minmax(100px, max-content) minmax(100px, max-content) 1fr"
            : "minmax(200px, max-content) minmax(200px, max-content) 1fr",
          columnGap: "4rem",
        }}
      >
        {/* Left: stats skeleton (spans first two columns) */}
        <div className="col-[1] col-span-2 h-12 bg-muted/50 rounded animate-pulse" />
        {/* Right: visualization skeleton */}
        <div className="col-[3] h-12 bg-muted/50 rounded animate-pulse" />
      </div>
    </div>
  );
}

// Hook to fetch and aggregate portfolio data
function usePortfolioData(): PortfolioData {
  const { address: accountAddress, isConnected } = useAccount();
  const [portfolioData, setPortfolioData] = useState<PortfolioData>({
    totalValue: 0,
    tokenBalances: [],
    isLoading: true,
    error: undefined,
    priceMap: {},
    pnl24hPct: 0,
    priceChange24hPctMap: {},
  });

  useEffect(() => {
    if (!isConnected || !accountAddress) {
      setPortfolioData({
        totalValue: 0,
        tokenBalances: [],
        isLoading: false,
        error: undefined,
        priceMap: {},
        pnl24hPct: 0,
        priceChange24hPctMap: {},
      });
      return;
    }

    const fetchPortfolioData = async () => {
      try {
        setPortfolioData(prev => ({ ...prev, isLoading: true, error: undefined }));

        // 1. Fetch user positions (discover via subgraph, compute onchain)
        const positions = await getUserPositionsOnchain(accountAddress, { verifyLiquidity: false });

        // 2. Aggregate token balances from positions
        const tokenBalanceMap = new Map<string, number>();
        
        if (Array.isArray(positions)) {
          console.log(`Portfolio: Processing ${positions.length} positions`);
          positions.forEach((position: any) => {
            // Add token0 balance
            const token0Symbol = position.token0?.symbol;
            const token0Amount = parseFloat(position.token0?.amount || '0');
            if (token0Symbol && token0Amount > 0) {
              console.log(`Portfolio: Adding ${token0Amount} ${token0Symbol}`);
              tokenBalanceMap.set(token0Symbol, (tokenBalanceMap.get(token0Symbol) || 0) + token0Amount);
            }

            // Add token1 balance
            const token1Symbol = position.token1?.symbol;
            const token1Amount = parseFloat(position.token1?.amount || '0');
            if (token1Symbol && token1Amount > 0) {
              console.log(`Portfolio: Adding ${token1Amount} ${token1Symbol}`);
              tokenBalanceMap.set(token1Symbol, (tokenBalanceMap.get(token1Symbol) || 0) + token1Amount);
            }
          });
        }

        console.log(`Portfolio: Aggregated balances:`, Array.from(tokenBalanceMap.entries()));

        // 3. Fetch token prices from CoinGecko
        const tokenSymbols = Array.from(tokenBalanceMap.keys());
        const priceMap = new Map<string, number>();
        
        // Map our tokens to CoinGecko IDs
        const coinGeckoIds: Record<string, string> = {
          'aETH': 'ethereum',
          'ETH': 'ethereum',
          'aBTC': 'bitcoin',
          'aUSDC': 'usd-coin',
          'aUSDT': 'tether',
        };

        const uniqueCoinIds = [...new Set(tokenSymbols.map(symbol => coinGeckoIds[symbol]).filter(Boolean))];
        
        let priceData: any = {};
        if (uniqueCoinIds.length > 0) {
          const priceRes = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${uniqueCoinIds.join(',')}&vs_currencies=usd&include_24hr_change=true`
          );
          if (priceRes.ok) {
            priceData = await priceRes.json();
            tokenSymbols.forEach(symbol => {
              const coinId = coinGeckoIds[symbol];
              if (coinId && priceData[coinId]?.usd) {
                priceMap.set(symbol, priceData[coinId].usd);
              } else {
                // Fallback prices for stablecoins
                if (symbol.includes('USDC') || symbol.includes('USDT')) {
                  priceMap.set(symbol, 1.0);
                }
              }
            });
          }
        }

        // 4. Create token balances with USD values and colors
        const tokenBalances: TokenBalance[] = Array.from(tokenBalanceMap.entries())
          .map(([symbol, balance]) => ({
            symbol,
            balance,
            usdValue: balance * (priceMap.get(symbol) || 0),
            color: '', // Will assign after sorting
          }))
          .filter(token => token.usdValue > 0.01) // Filter out dust
          .sort((a, b) => b.usdValue - a.usdValue); // Sort by value desc

        // Assign colors after sorting - using visible greyscale range from globals.css
        const colors = [
          "hsl(0 0% 30%)",   // Darker but visible
          "hsl(0 0% 40%)",   // --chart-2
          "hsl(0 0% 60%)",   // --chart-3
          "hsl(0 0% 80%)",   // --chart-4
          "hsl(0 0% 95%)",   // --chart-5 (lightest)
        ];
        tokenBalances.forEach((token, index) => {
          token.color = colors[index % colors.length];
        });

        const totalValue = tokenBalances.reduce((sum, token) => sum + token.usdValue, 0);

        // Compute portfolio 24h PnL % using per-token 24h change from CoinGecko
        let deltaNowUSD = 0;
        if (uniqueCoinIds.length > 0 && totalValue > 0) {
          tokenBalances.forEach((tb) => {
            const coinId = coinGeckoIds[tb.symbol];
            const ch = coinId ? priceData[coinId]?.usd_24h_change : undefined; // percent
            if (typeof ch === 'number' && isFinite(ch)) {
              // exact delta using current value and inverse of (1 + ch/100)
              const pastUsd = tb.usdValue / (1 + ch / 100);
              const delta = tb.usdValue - pastUsd;
              deltaNowUSD += delta;
            }
          });
        }
        const pnl24hPct = totalValue > 0 ? (deltaNowUSD / totalValue) * 100 : 0;

        const priceChange24hPctMap: Record<string, number> = {};
        tokenSymbols.forEach(symbol => {
          const coinId = coinGeckoIds[symbol];
          const ch = coinId ? priceData[coinId]?.usd_24h_change : undefined;
          if (typeof ch === 'number' && isFinite(ch)) priceChange24hPctMap[symbol] = ch;
        });

        setPortfolioData({
          totalValue,
          tokenBalances,
          isLoading: false,
          error: undefined,
          priceMap: Object.fromEntries(priceMap.entries()),
          pnl24hPct,
          priceChange24hPctMap,
        });

      } catch (error) {
        console.error('Failed to fetch portfolio data:', error);
        setPortfolioData({
          totalValue: 0,
          tokenBalances: [],
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          priceMap: {},
          pnl24hPct: 0,
          priceChange24hPctMap: {},
        });
      }
    };

    fetchPortfolioData();
  }, [isConnected, accountAddress]);

  return portfolioData;
}

export default function PortfolioPage() {
  const router = useRouter();
  const portfolioData = usePortfolioData();
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const netApyRef = useRef<HTMLDivElement>(null);
  const [inlineLeftOffset, setInlineLeftOffset] = useState<number>(0);
  const [isCompactVis, setIsCompactVis] = useState<boolean>(false);
  const [isHiddenVis, setIsHiddenVis] = useState<boolean>(false);
  const [isMobileVisOpen, setIsMobileVisOpen] = useState<boolean>(false);
  const [collapseMaxHeight, setCollapseMaxHeight] = useState<number>(0);
  const [isVerySmallScreen, setIsVerySmallScreen] = useState<boolean>(false);
  const [isMobileVisReady, setIsMobileVisReady] = useState<boolean>(false);
  const blockVisContainerRef = useRef<HTMLDivElement>(null);
  
  // NEW: local state for positions and activity
  const { address: accountAddress, isConnected } = useAccount();
  const allowedPoolIds = useMemo(() => {
    try {
      const ids = getAllPools().map(p => p.subgraphId?.toLowerCase()).filter(Boolean) as string[];
      return new Set(ids);
    } catch {
      return new Set<string>();
    }
  }, []);
  const [activePositions, setActivePositions] = useState<any[]>([]);
  const [activityItems, setActivityItems] = useState<any[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState<boolean>(true);
  const [isLoadingActivity, setIsLoadingActivity] = useState<boolean>(false);
  const [positionsError, setPositionsError] = useState<string | undefined>(undefined);
  const [activityError, setActivityError] = useState<string | undefined>(undefined);
  
  // NEW: selector state for switching between sections
  const [selectedSection, setSelectedSection] = useState<string>('Active Positions');
  const sections = ['Active Positions', 'Activity'];
  
  // Provided by top-level const above

  // Token filter state controlled by clicking portfolio composition segments
  const [activeTokenFilter, setActiveTokenFilter] = useState<string | null>(null);
  const [isStickyHover, setIsStickyHover] = useState<boolean>(false);
  
  // Rest cycling state for complex click behavior
  const [restCycleIndex, setRestCycleIndex] = useState<number>(0);
  const [isRestCycling, setIsRestCycling] = useState<boolean>(false);
  
  // Handle Rest cycling click behavior
  const handleRestClick = useCallback((segment: any, segmentIndex?: number) => {
    const restTokens = segment.restTokens || [];
    if (restTokens.length === 0) return;
    
    if (!isRestCycling) {
      // Start cycling, show first token
      setIsRestCycling(true);
      setRestCycleIndex(0);
      setActiveTokenFilter(restTokens[0].label);
      setIsStickyHover(true);
      // Set hover to the Rest segment if index is provided
      if (typeof segmentIndex === 'number') {
        setHoveredSegment(segmentIndex);
      }
    } else {
      // Continue cycling through rest tokens
      const nextIndex = restCycleIndex + 1;
      if (nextIndex >= restTokens.length) {
        // Cycle back to OTHERS after showing all assets
        setIsRestCycling(false);
        setRestCycleIndex(0);
        setActiveTokenFilter(null);
        setIsStickyHover(false);
      } else {
        // Continue to next token
        setRestCycleIndex(nextIndex);
        setActiveTokenFilter(restTokens[nextIndex].label);
      }
    }
  }, [isRestCycling, restCycleIndex]);
  
  // Reset rest cycling when token filter changes externally
  useEffect(() => {
    // Only reset cycling when the user explicitly clears any token filter
    if (!activeTokenFilter) {
      setIsRestCycling(false);
      setRestCycleIndex(0);
    }
  }, [activeTokenFilter]);

  // Sorting state for Active Positions
  const [activeSort, setActiveSort] = useState<{ column: 'amounts' | 'value' | 'apr' | null; direction: 'asc' | 'desc' | null }>({ column: null, direction: null });
  const [expandedPools, setExpandedPools] = useState<Record<string, boolean>>({});
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);

  const navigateToPoolBySubgraphId = useCallback((poolSubgraphId?: string) => {
    if (!poolSubgraphId) return;
    try {
      const pools = getAllPools();
      const match = pools.find(p => String(p.subgraphId || '').toLowerCase() === String(poolSubgraphId).toLowerCase());
      const routeId = match?.id;
      if (routeId) router.push(`/liquidity/${routeId}`);
    } catch {}
  }, [router]);
  
  // Auto-expand all grouped positions by default
  useEffect(() => {
    const newExpanded: Record<string, boolean> = {};
    activePositions.forEach(p => {
      const poolKey = String(p?.poolId || '').toLowerCase();
      if (!newExpanded[poolKey]) {
        // Count positions in this pool
        const poolPositions = activePositions.filter(pos => 
          String(pos?.poolId || '').toLowerCase() === poolKey
        );
        if (poolPositions.length > 1) {
          newExpanded[poolKey] = true;
        }
      }
    });
    setExpandedPools(newExpanded);
  }, [activePositions]);

  const handleActiveSortCycle = (columnId: 'amounts' | 'value' | 'apr') => {
    setActiveSort((prev) => {
      if (prev.column !== columnId) return { column: columnId, direction: 'asc' };
      if (prev.direction === 'asc') return { column: columnId, direction: 'desc' };
      return { column: null, direction: null };
    });
  };

  const renderSortIcon = (state: 'asc' | 'desc' | null) => {
    if (state === 'asc') return <ChevronUpIcon className="ml-1 h-4 w-4 text-foreground" />;
    if (state === 'desc') return <ChevronDownIcon className="ml-1 h-4 w-4 text-foreground" />;
    return <ChevronsUpDownIcon className="ml-1 h-4 w-4 text-muted-foreground" />;
  };

  // Fetch APRs per pool using existing batch endpoint; cache in-memory
  const [aprByPoolId, setAprByPoolId] = useState<Record<string, string>>({});
  
  // Pool data for tick information
  const [poolDataByPoolId, setPoolDataByPoolId] = useState<Record<string, any>>({});
  
  // Bucket data cache for all pools to avoid repeated API calls
  const [bucketDataCache, setBucketDataCache] = useState<Record<string, any[]>>({});
  const [loadingBuckets, setLoadingBuckets] = useState<Set<string>>(new Set());

  const filteredPositions = useMemo(() => {
    if (!activeTokenFilter) return activePositions;
    const token = activeTokenFilter.toUpperCase();
    
    // Handle "OTHERS" filter - show positions with tokens not in top 3
    if (token === 'OTHERS') {
      const total = portfolioData.totalValue;
      const topThreeTokens = portfolioData.tokenBalances
        .map(tb => ({
          symbol: tb.symbol,
          pct: total > 0 ? (tb.usdValue / total) * 100 : 0,
        }))
        .filter(item => item.pct >= 1)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3)
        .map(tb => tb.symbol.toUpperCase());
      
      return activePositions.filter(p => {
        const token0Upper = p?.token0?.symbol?.toUpperCase?.();
        const token1Upper = p?.token1?.symbol?.toUpperCase?.();
        return (token0Upper && !topThreeTokens.includes(token0Upper)) ||
               (token1Upper && !topThreeTokens.includes(token1Upper));
      });
    }
    
    // Handle specific token filter
    return activePositions.filter(p => (
      (p?.token0?.symbol?.toUpperCase?.() === token) ||
      (p?.token1?.symbol?.toUpperCase?.() === token)
    ));
  }, [activePositions, activeTokenFilter, portfolioData.tokenBalances, portfolioData.totalValue]);

  const sortedActivePositions = useMemo(() => {
    const base = filteredPositions;
    if (!activeSort.column || !activeSort.direction) return base;

    const getAmountsKey = (p: any) => {
      const amt0 = Number.parseFloat(p?.token0?.amount || '0');
      const amt1 = Number.parseFloat(p?.token1?.amount || '0');
      return (isFinite(amt0) ? amt0 : 0) + (isFinite(amt1) ? amt1 : 0);
    };
    const getValueKey = (p: any) => {
      const sym0 = p?.token0?.symbol as string | undefined;
      const sym1 = p?.token1?.symbol as string | undefined;
      const amt0 = Number.parseFloat(p?.token0?.amount || '0');
      const amt1 = Number.parseFloat(p?.token1?.amount || '0');
      const px0 = (sym0 && portfolioData.priceMap[sym0]) || 0;
      const px1 = (sym1 && portfolioData.priceMap[sym1]) || 0;
      return (isFinite(amt0) ? amt0 : 0) * px0 + (isFinite(amt1) ? amt1 : 0) * px1;
    };
    const getAprKey = (p: any) => {
      const aprStr = aprByPoolId[String(p?.poolId || '').toLowerCase()] || '';
      const num = typeof aprStr === 'string' && aprStr.endsWith('%') ? parseFloat(aprStr.replace('%', '')) : 0;
      return isFinite(num) ? num : 0;
    };

    const keyFn = activeSort.column === 'amounts' ? getAmountsKey : activeSort.column === 'value' ? getValueKey : getAprKey;
    const sign = activeSort.direction === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      const ka = keyFn(a);
      const kb = keyFn(b);
      if (ka === kb) return 0;
      return ka < kb ? -1 * sign : 1 * sign;
    });
  }, [filteredPositions, activeSort, portfolioData.priceMap, aprByPoolId]);

  // Group positions by poolId for expandable rows
  const groupedByPool = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const p of sortedActivePositions) {
      const key = String(p?.poolId || '').toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    const groups = Array.from(map.entries()).map(([poolId, items]) => {
      const totalUSD = items.reduce((sum, p) => {
        const sym0 = p?.token0?.symbol as string | undefined;
        const sym1 = p?.token1?.symbol as string | undefined;
        const amt0 = parseFloat(p?.token0?.amount || '0');
        const amt1 = parseFloat(p?.token1?.amount || '0');
        const price0 = (sym0 && portfolioData.priceMap[sym0]) || 0;
        const price1 = (sym1 && portfolioData.priceMap[sym1]) || 0;
        return sum + amt0 * price0 + amt1 * price1;
      }, 0);
      return { poolId, items, totalUSD };
    });
    
    // Apply sorting based on activeSort
    if (activeSort.column === 'value' && activeSort.direction) {
      const sign = activeSort.direction === 'asc' ? 1 : -1;
      groups.sort((a, b) => (a.totalUSD - b.totalUSD) * sign);
    } else {
      // Default sort: single positions first, then by value ascending
      groups.sort((a, b) => {
        // Single positions first
        if (a.items.length === 1 && b.items.length > 1) return -1;
        if (a.items.length > 1 && b.items.length === 1) return 1;
        // Then by value ascending
        return a.totalUSD - b.totalUSD;
      });
    }
    
    return groups;
  }, [sortedActivePositions, portfolioData.priceMap, activeSort]);

  const togglePoolExpanded = (poolId: string) => {
    setExpandedPools(prev => ({ ...prev, [poolId]: !prev[poolId] }));
  };

  useEffect(() => {
    let cancelled = false;
    const fetchApr = async () => {
      try {
        const response = await fetch('/api/liquidity/get-pools-batch');
        if (!response.ok) return;
        const data = await response.json();
        if (!data?.success || !Array.isArray(data.pools)) return;
        const map: Record<string, string> = {};
        for (const p of data.pools as any[]) {
          const fees24h = typeof p.fees24hUSD === 'number' ? p.fees24hUSD : 0;
          const tvl = typeof p.tvlUSD === 'number' ? p.tvlUSD : 0;
          let aprStr = 'N/A';
          if (fees24h > 0 && tvl > 0) {
            const yearlyFees = fees24h * 365;
            const apr = (yearlyFees / tvl) * 100;
            aprStr = apr.toFixed(2) + '%';
          }
          if (p.poolId) map[String(p.poolId).toLowerCase()] = aprStr;
        }
        if (!cancelled) setAprByPoolId(map);
      } catch {}
    };
    fetchApr();
    return () => { cancelled = true; };
  }, []);

  // Fetch pool state data for tick information
  useEffect(() => {
    let cancelled = false;
    const fetchPoolData = async () => {
      if (activePositions.length === 0) return;
      
      try {
        const uniquePairs = new Map<string, { token0Symbol: string; token1Symbol: string; poolId: string }>();
        
        // Collect unique token pairs from positions
        activePositions.forEach(p => {
          if (p?.poolId && p?.token0?.symbol && p?.token1?.symbol) {
            const key = `${p.token0.symbol}-${p.token1.symbol}`;
            if (!uniquePairs.has(key)) {
              uniquePairs.set(key, {
                token0Symbol: p.token0.symbol,
                token1Symbol: p.token1.symbol,
                poolId: p.poolId
              });
            }
          }
        });
        
        const poolDataMap: Record<string, any> = {};
        
        // Fetch pool state for each unique token pair
        for (const { token0Symbol, token1Symbol, poolId } of uniquePairs.values()) {
          try {
            const response = await fetch('/api/liquidity/get-pool-state', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                token0Symbol,
                token1Symbol,
                chainId: 84532 // Base Sepolia
              }),
            });
            
            if (response.ok) {
              const poolState = await response.json();
              if (poolState.currentPoolTick !== undefined) {
                poolDataMap[String(poolId).toLowerCase()] = {
                  tick: poolState.currentPoolTick,
                  price: poolState.currentPrice,
                  sqrtPriceX96: poolState.sqrtPriceX96,
                  tickSpacing: getPoolById(poolId)?.tickSpacing || 60
                };
              }
            }
          } catch (error) {
            console.error(`Failed to fetch pool state for ${token0Symbol}/${token1Symbol}:`, error);
          }
        }
        
        if (!cancelled) setPoolDataByPoolId(poolDataMap);
      } catch (error) {
        console.error('Error fetching pool data:', error);
      }
    };
    
    fetchPoolData();
    return () => { cancelled = true; };
  }, [activePositions]);

  // Helper function to get cache key consistently
  const getCacheKey = useCallback((poolId: string, tickLower: number, tickUpper: number) => {
    const positionRange = Math.abs(tickUpper - tickLower);
    const maxRange = 5000;
    const padding = Math.min(positionRange * 0.5, maxRange * 0.3);
    const minTick = Math.floor(Math.min(tickLower, tickUpper) - padding);
    const maxTick = Math.ceil(Math.max(tickLower, tickUpper) + padding);
    return `${poolId}-${minTick}-${maxTick}`;
  }, []);

  // Centralized bucket data fetching
  const fetchBucketData = useCallback(async (poolId: string, tickLower: number, tickUpper: number, tickSpacing: number) => {
    const cacheKey = getCacheKey(poolId, tickLower, tickUpper);
    if (bucketDataCache[cacheKey] || loadingBuckets.has(cacheKey)) return;

    setLoadingBuckets(prev => new Set(prev).add(cacheKey));
    
    try {
      const positionRange = Math.abs(tickUpper - tickLower);
      const maxRange = 5000;
      const padding = Math.min(positionRange * 0.5, maxRange * 0.3);
      const minTick = Math.floor(Math.min(tickLower, tickUpper) - padding);
      const maxTick = Math.ceil(Math.max(tickLower, tickUpper) + padding);
      
      const response = await fetch('/api/liquidity/get-bucket-depths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poolId,
          tickLower: minTick,
          tickUpper: maxTick,
          tickSpacing: Number(tickSpacing),
          bucketCount: 25
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.buckets) {
          setBucketDataCache(prev => ({ ...prev, [cacheKey]: result.buckets }));
        }
      }
    } catch (error) {
      console.error('Error fetching bucket data:', error);
    } finally {
      setLoadingBuckets(prev => {
        const newSet = new Set(prev);
        newSet.delete(cacheKey);
        return newSet;
      });
    }
  }, [getCacheKey]);

  // Trigger bucket data fetching for visible positions
  useEffect(() => {
    activePositions.forEach(p => {
      if (p?.poolId && p?.tickLower !== undefined && p?.tickUpper !== undefined) {
        const poolData = poolDataByPoolId[String(p.poolId).toLowerCase()];
        if (poolData?.tickSpacing) {
          fetchBucketData(p.poolId, p.tickLower, p.tickUpper, poolData.tickSpacing);
        }
      }
    });
  }, [activePositions, poolDataByPoolId, fetchBucketData]);

  const formatAgeShort = (seconds: number | undefined) => {
    if (!seconds || !isFinite(seconds)) return '';
    const d = Math.floor(seconds / 86400);
    if (d >= 1) return `${d}d`;
    const h = Math.floor(seconds / 3600);
    if (h >= 1) return `${h}h`;
    const m = Math.floor(seconds / 60);
    return `${m}m`;
  };

  // Load positions (processed for active only)
  useEffect(() => {
    let isCancelled = false;

    const fetchPositions = async () => {
      if (!isConnected || !accountAddress) {
        if (!isCancelled) {
          setActivePositions([]);
          setIsLoadingPositions(false);
          setPositionsError(undefined);
        }
        return;
      }

      setIsLoadingPositions(true);
      setPositionsError(undefined);

      try {
        // Processed active positions (discover via subgraph, compute onchain)
        const processedActive = await getUserPositionsOnchain(accountAddress, { verifyLiquidity: false });
        if (!isCancelled) {
          setActivePositions(processedActive);
        }
      } catch (e: any) {
        if (!isCancelled) {
          setPositionsError(e?.message || 'Failed to load positions');
          setActivePositions([]);
        }
      } finally {
        if (!isCancelled) setIsLoadingPositions(false);
      }
    };

    fetchPositions();
    return () => { isCancelled = true; };
  }, [isConnected, accountAddress]);

  // Load activity (best-effort): mints, burns, collects for owner
  useEffect(() => {
    let isCancelled = false;
    const fetchActivity = async () => {
      if (!isConnected || !accountAddress) {
        if (!isCancelled) {
          setActivityItems([]);
          setActivityError(undefined);
        }
        return;
      }
      setIsLoadingActivity(true);
      setActivityError(undefined);
      try {
        const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/111443/alphix-test/version/latest";
        const ACTIVITY_QUERY = `
          query GetUserActivity($owner: Bytes!, $first: Int!) {
            mints(first: $first, orderBy: timestamp, orderDirection: desc, where: { owner: $owner }) {
              id
              timestamp
              tickLower
              tickUpper
              amount0
              amount1
              pool { id currency0 { symbol decimals } currency1 { symbol decimals } }
              transaction { id }
            }
            burns(first: $first, orderBy: timestamp, orderDirection: desc, where: { owner: $owner }) {
              id
              timestamp
              tickLower
              tickUpper
              amount0
              amount1
              pool { id currency0 { symbol decimals } currency1 { symbol decimals } }
              transaction { id }
            }
            collects(first: $first, orderBy: timestamp, orderDirection: desc, where: { owner: $owner }) {
              id
              timestamp
              amount0
              amount1
              pool { id currency0 { symbol decimals } currency1 { symbol decimals } }
              transaction { id }
            }
          }
        `;
        const resp = await fetch(SUBGRAPH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: ACTIVITY_QUERY, variables: { owner: accountAddress.toLowerCase(), first: 50 } }),
        });
        if (!resp.ok) throw new Error(`Subgraph error ${resp.status}`);
        const json = await resp.json();
        const mk = (type: string, rows: any[]) => rows.map((r: any) => ({
          type,
          id: r.id,
          ts: Number(r.timestamp || r.blockTimestamp || 0),
          poolSymbols: [r.pool?.currency0?.symbol, r.pool?.currency1?.symbol].filter(Boolean).join('/'),
          poolId: r.pool?.id,
          amount0: r.amount0,
          amount1: r.amount1,
          tx: r.transaction?.id,
          tickLower: r.tickLower,
          tickUpper: r.tickUpper,
        }));
        const items = [
          ...mk('Mint', json?.data?.mints ?? []),
          ...mk('Burn', json?.data?.burns ?? []),
          ...mk('Collect', json?.data?.collects ?? []),
        ].filter((it: any) => allowedPoolIds.has(String(it.poolId || '').toLowerCase()))
         .sort((a, b) => b.ts - a.ts).slice(0, 50);
        if (!isCancelled) setActivityItems(items);
      } catch (e: any) {
        if (!isCancelled) setActivityError(e?.message || 'Failed to load activity');
      } finally {
        if (!isCancelled) setIsLoadingActivity(false);
      }
    };
    fetchActivity();
    return () => { isCancelled = true; };
  }, [isConnected, accountAddress]);

  // Set initial responsive states immediately
  useEffect(() => {
    const setInitialStates = () => {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      setIsCompactVis(viewportWidth <= 1400);
      setIsHiddenVis(viewportWidth <= 1100);
      setIsVerySmallScreen(viewportWidth < 695);
    };
    
    setInitialStates();
  }, []);

  // Wide composition - aggregate beyond first 3 into Rest if more than 4 tokens (prevents overflow with many positions)
  const wideComposition = useMemo(() => {
    const total = portfolioData.totalValue;
    const tokenItems = portfolioData.tokenBalances
      .map(token => ({
        label: token.symbol,
        pct: total > 0 ? (token.usdValue / total) * 100 : 0,
        color: token.color,
      }))
      .filter(item => item.pct >= 1)
      .sort((a, b) => b.pct - a.pct);

    if (tokenItems.length > 4) {
      const topThree = tokenItems.slice(0, 3);
      const rest = tokenItems.slice(3);
      const restPct = rest.reduce((sum, item) => sum + item.pct, 0);
      return [
        ...topThree,
        {
          label: 'Rest',
          pct: restPct,
          color: 'hsl(0 0% 70%)',
          restTokens: rest,
        } as any,
      ];
    }
    return tokenItems;
  }, [portfolioData.tokenBalances, portfolioData.totalValue]);

  // Compact composition - aggregate items beyond first 3 into Rest if more than 4 total
  const compactComposition = useMemo(() => {
    const total = portfolioData.totalValue;
    const tokenItems = portfolioData.tokenBalances
      .map(token => ({
        label: token.symbol,
        pct: total > 0 ? (token.usdValue / total) * 100 : 0,
        color: token.color,
      }))
      .filter(item => item.pct >= 1)
      .sort((a, b) => b.pct - a.pct); // Sort by percentage descending

    // If more than 4 items, aggregate items beyond first 3 into Rest
    if (tokenItems.length > 4) {
      const topThree = tokenItems.slice(0, 3);
      const rest = tokenItems.slice(3);
      const restPct = rest.reduce((sum, item) => sum + item.pct, 0);
      
      return [
        ...topThree,
        {
          label: 'Rest',
          pct: restPct,
          color: 'hsl(0 0% 70%)', // Distinct lighter color for rest, brighter than first segment (30%)
          restTokens: rest, // Store the aggregated tokens for later use
        }
      ];
    }
    
    return tokenItems;
  }, [portfolioData.tokenBalances, portfolioData.totalValue]);

  // Use appropriate composition based on view
  const composition = isCompactVis ? compactComposition : wideComposition;
  // Decide placement purely by measured available inline width
  useEffect(() => {
    const updateLayoutAndOffset = () => {
      if (!containerRef.current || !netApyRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const netApyRect = netApyRef.current.getBoundingClientRect();
      // Compute left offset so inline visualization starts closer to NET APY at smaller viewports
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      setIsCompactVis(viewportWidth <= 1400);
      setIsHiddenVis(viewportWidth <= 1100); // Changed to <= to be more consistent
      setIsVerySmallScreen(viewportWidth < 695);
      // Aggressively shrink the LEFT margin at/below 1500px
      const desiredGapPx = viewportWidth <= 1500 ? -18 : 18;
      // Use padding-left to shift start while letting the bar fill the remaining width
      const leftOffset = Math.max(0, netApyRect.right - containerRect.left + desiredGapPx);
      setInlineLeftOffset(leftOffset);
    };
    
    // Run immediately and after a short delay to ensure DOM is ready
    updateLayoutAndOffset();
    const timeoutId = setTimeout(updateLayoutAndOffset, 50);
    
    window.addEventListener('resize', updateLayoutAndOffset);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', updateLayoutAndOffset);
    };
  }, []);

  // Keep collapse height in sync when opened and when layout/data change
  useEffect(() => {
    if (!isHiddenVis) {
      setIsMobileVisOpen(false);
      setCollapseMaxHeight(0);
      return;
    }
    const measure = () => {
      if (blockVisContainerRef.current) {
        setCollapseMaxHeight(blockVisContainerRef.current.scrollHeight);
      }
    };
    if (isMobileVisOpen) {
      // Reset ready state when opening
      setIsMobileVisReady(false);
      
      // measure now and shortly after mount/layout settles
      measure();
      const id = setTimeout(measure, 60);
      
      // Delay rendering the visualization until container is stable
      const readyId = setTimeout(() => {
        setIsMobileVisReady(true);
      }, 150);
      
      window.addEventListener('resize', measure);
      return () => {
        clearTimeout(id);
        clearTimeout(readyId);
        window.removeEventListener('resize', measure);
      };
    } else {
      setIsMobileVisReady(false);
    }
  }, [isHiddenVis, isMobileVisOpen, composition.length]);

  // Show skeleton while loading
  if (portfolioData.isLoading) {
    return (
      <AppLayout>
        <div className="flex flex-1 flex-col p-3 sm:p-6 sm:px-10">
          <PortfolioSkeleton />
        </div>
      </AppLayout>
    );
  }


  // Calculate proportional value with persistent selection via token filter
  const selectedSegmentIndex = activeTokenFilter
    ? (() => {
        // If Rest is being cycled, always point to the Rest segment
        if (isRestCycling) {
          const restIdx = composition.findIndex(c => c.label === 'Rest');
          return restIdx >= 0 ? restIdx : null;
        }
        
        const idx = composition.findIndex(c => c.label?.toUpperCase?.() === activeTokenFilter.toUpperCase());
        return idx >= 0 ? idx : null;
      })()
    : null;

  const effectiveSegmentIndex = (() => {
    // If Rest is cycling, always lock to the Rest segment regardless of hover
    if (isRestCycling) {
      const restIdx = composition.findIndex(c => c.label === 'Rest');
      return restIdx >= 0 ? restIdx : null;
    }
    // Normal hover logic
    return (isStickyHover && hoveredSegment !== null)
      ? hoveredSegment
      : (activeTokenFilter ? selectedSegmentIndex : (hoveredSegment !== null ? hoveredSegment : null));
  })();

  const displayValue = effectiveSegmentIndex !== null && composition[effectiveSegmentIndex]
    ? (portfolioData.totalValue * composition[effectiveSegmentIndex].pct) / 100
    : portfolioData.totalValue;

  // Effective token label for hover/selection
  const effectiveTokenLabel = (() => {
    if (effectiveSegmentIndex === null || !composition[effectiveSegmentIndex]) return null;
    
    const segment = composition[effectiveSegmentIndex];
    
    // If Rest is being cycled, always show the current cycled token
    if (segment.label === 'Rest' && isRestCycling) {
      const restTokens = (segment as any)?.restTokens || [];
      return restTokens[restCycleIndex]?.label || 'Rest';
    }
    
    return segment.label;
  })();

  // Calculate effective PnL (24h) based on hover/filter
  const pnl24hPct = (() => {
    if (!effectiveTokenLabel) return portfolioData.pnl24hPct || 0;
    
    if (effectiveTokenLabel === 'Rest') {
      // For Rest, calculate weighted average of all rest tokens
      const segment = composition[effectiveSegmentIndex!];
      const restTokens = (segment as any)?.restTokens || [];
      let weightedPnl = 0;
      let totalWeight = 0;
      
      restTokens.forEach((token: any) => {
        const pnl = portfolioData.priceChange24hPctMap[token.label] ?? 0;
        weightedPnl += pnl * token.pct;
        totalWeight += token.pct;
      });
      
      return totalWeight > 0 ? weightedPnl / totalWeight : 0;
    }
    
    return portfolioData.priceChange24hPctMap[effectiveTokenLabel] ?? 0;
  })();

  // Compute simple annualized net fees (APR) weighted by USD value
  const effectiveAprPct = (() => {
    const relevant = activePositions.filter((p) => {
      if (!effectiveTokenLabel) return true;
      
      if (effectiveTokenLabel === 'Rest') {
        // For Rest, include positions with tokens that are in the rest group
        const segment = composition[effectiveSegmentIndex!];
        const restTokens = (segment as any)?.restTokens || [];
        const restTokenSymbols = restTokens.map((t: any) => t.label.toUpperCase());
        const s0 = p?.token0?.symbol?.toUpperCase();
        const s1 = p?.token1?.symbol?.toUpperCase();
        return (s0 && restTokenSymbols.includes(s0)) || (s1 && restTokenSymbols.includes(s1));
      }
      
      const s0 = p?.token0?.symbol;
      const s1 = p?.token1?.symbol;
      return s0 === effectiveTokenLabel || s1 === effectiveTokenLabel;
    });
    let weighted = 0;
    let totalUsd = 0;
    for (const p of relevant) {
      const poolKey = String(p?.poolId || '').toLowerCase();
      const aprStr = aprByPoolId[poolKey];
      const aprNum = typeof aprStr === 'string' && aprStr.endsWith('%')
        ? parseFloat(aprStr.replace('%', ''))
        : NaN;
      if (!isFinite(aprNum)) continue;
      const sym0 = p?.token0?.symbol as string | undefined;
      const sym1 = p?.token1?.symbol as string | undefined;
      const amt0 = parseFloat(p?.token0?.amount || '0');
      const amt1 = parseFloat(p?.token1?.amount || '0');
      const px0 = (sym0 && portfolioData.priceMap[sym0]) || 0;
      const px1 = (sym1 && portfolioData.priceMap[sym1]) || 0;
      const usd = (isFinite(amt0) ? amt0 : 0) * px0 + (isFinite(amt1) ? amt1 : 0) * px1;
      if (usd <= 0) continue;
      weighted += usd * aprNum;
      totalUsd += usd;
    }
    if (totalUsd <= 0) return null as number | null;
    return weighted / totalUsd;
  })();
  const positionsCount = portfolioData.tokenBalances.length;
  const poolsCount = portfolioData.tokenBalances.length; // Simplified for now
  const isPositive = pnl24hPct >= 0;

  // Show empty state if no positions
  if (composition.length === 0) {
    return (
      <AppLayout>
        <div className="flex flex-1 flex-col p-3 sm:p-6 sm:px-10">
          <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-6">
            <div 
              className="grid items-start relative" 
              style={{ 
                gridTemplateColumns: isVerySmallScreen 
                  ? "minmax(100px, max-content) minmax(100px, max-content) 1fr" 
                  : "minmax(200px, max-content) minmax(200px, max-content) 1fr", 
                gridTemplateRows: "auto auto", 
                columnGap: "3rem" 
              }}
            >
              {/* Row 1, Col 1: PORTFOLIO header */}
              <div className="col-[1] row-[1]">
                <h1 className="text-xs tracking-wider text-muted-foreground font-mono font-bold">
                  PORTFOLIO
                </h1>
              </div>
              {/* Row 1, Col 2: NET APY header */}
              <div className="col-[2] row-[1]">
                <h1 className="text-xs tracking-wider text-muted-foreground font-mono font-bold">
                  NET APY
                </h1>
              </div>
              {/* Row 2, Col 1: Portfolio amount */}
              <div className={`col-[1] row-[2] mt-2 font-medium tracking-tight ${isVerySmallScreen ? 'text-2xl' : 'text-3xl sm:text-4xl'}`}>
                {formatUSD(0)}
              </div>
              {/* Row 2, Col 2: NET APY percentage */}
              <div className={`col-[2] row-[2] mt-2 font-medium tracking-tight ${isVerySmallScreen ? 'text-2xl' : 'text-3xl sm:text-4xl'}`}>
                0.0%
              </div>
              {/* Empty state message */}
              <div className="col-[1] col-span-3 mt-6 text-center text-muted-foreground">
                <p>No liquidity positions found. Add liquidity to start tracking your portfolio.</p>
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <PortfolioFilterContext.Provider value={{ activeTokenFilter, setActiveTokenFilter, isStickyHover, setIsStickyHover }}>
    <AppLayout>
      <div className="flex flex-1 flex-col p-3 sm:p-6 sm:px-10">
        <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-6">
          {/* Inline header grid (original) */}
          <div
            ref={containerRef}
            className={`grid items-start relative ${isHiddenVis ? 'group cursor-pointer hover:bg-muted/10 rounded-lg transition-colors duration-200 -m-2 p-2' : ''}`}
            style={{
              gridTemplateColumns: isVerySmallScreen 
                ? "minmax(100px, max-content) minmax(100px, max-content) 1fr"
                : "minmax(200px, max-content) minmax(200px, max-content) 1fr",
              gridTemplateRows: "auto auto",
              columnGap: "4rem",
            }}
            onClick={isHiddenVis ? () => setIsMobileVisOpen(v => !v) : undefined}
          >
            {/* Row 1, Col 1: PORTFOLIO header with percentage */}
            <div className="col-[1] row-[1] grid grid-cols-[auto_max-content] items-center gap-x-2">
              <h1 className="text-xs tracking-wider text-muted-foreground font-mono font-bold">
                PORTFOLIO
              </h1>
              <div className="flex items-center gap-1 justify-self-end">
                <Image src={isPositive ? "/arrow_up.svg" : "/arrow_down.svg"} alt={isPositive ? "Up" : "Down"} width={8} height={8} />
                <span className="text-xs font-medium" style={{ color: isPositive ? "#22c55e" : "#ef4444" }}>{Math.abs(pnl24hPct).toFixed(2)}%</span>
              </div>
            </div>
            {/* Row 1, Col 2: NET APY header */}
            <div className="col-[2] row-[1]">
              <h1 className="text-xs tracking-wider text-muted-foreground font-mono font-bold">
                NET APY
              </h1>
            </div>
            {/* Row 2, Col 1: Portfolio amount */}
            <div className={`col-[1] row-[2] mt-2 font-medium tracking-tight ${isVerySmallScreen ? 'text-2xl' : 'text-3xl sm:text-4xl'}`}>
              {formatUSD(displayValue)}
            </div>
            {/* Row 2, Col 2: NET APY percentage */}
            <div ref={netApyRef} className={`col-[2] row-[2] mt-2 font-medium tracking-tight ${isVerySmallScreen ? 'text-2xl' : 'text-3xl sm:text-4xl'}`}>
              {effectiveAprPct !== null ? (
                effectiveAprPct > 999 ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default">&gt;999%</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">{`${effectiveAprPct.toFixed(2)}%`}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  effectiveAprPct.toFixed(1) + '%'
                )
              ) : '—'}
            </div>
            {/* Row 2, Col 3: mobile toggler when visualization is hidden inline */}
            <div className="col-[3] row-[1/3] flex items-center justify-end self-center">
              {isHiddenVis && (
                <div className="p-2 rounded-md text-muted-foreground group-hover:text-foreground transition-all duration-200 pointer-events-none">
                  <svg
                    width={20}
                    height={20}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-transform duration-200"
                    style={{ transform: isMobileVisOpen ? 'rotate(180deg)' : 'none' }}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>
              )}
            </div>
            {/* Inline visualization: absolute overlay on the right */}
            {!isHiddenVis && (
              <div
                className="absolute top-1/2 -translate-y-1/2 flex justify-end"
                style={{ left: 0, right: 0, paddingLeft: inlineLeftOffset, transform: 'translateY(-50%) translateY(4px)' }}
              >
                {isCompactVis ? (
                  <CompactCompositionBar
                    composition={composition}
                    onHover={setHoveredSegment}
                    hoveredSegment={hoveredSegment}
                    handleRestClick={handleRestClick}
                    setIsRestCycling={setIsRestCycling}
                    isRestCycling={isRestCycling}
                    restCycleIndex={restCycleIndex}
                    initialWidth={(() => {
                      // Compute initial width once from this absolute wrapper (left/right 0 with padding-left applied)
                      const wrapper = containerRef.current;
                      const apyEl = netApyRef.current;
                      if (!wrapper || !apyEl) return undefined;
                      const wrapperRect = wrapper.getBoundingClientRect();
                      const apyRect = apyEl.getBoundingClientRect();
                      // Match the same offset logic used for padding-left so bar fills remaining space to the right
                      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
                      const desiredGapPx = viewportWidth <= 1500 ? -18 : 18;
                      const leftOffset = Math.max(0, apyRect.right - wrapperRect.left + desiredGapPx);
                      return Math.max(0, Math.round(wrapperRect.width - leftOffset));
                    })()}
                  />
                ) : (
                  <PortfolioTickBar
                    composition={composition}
                    onHover={setHoveredSegment}
                    hoveredSegment={hoveredSegment}
                    containerRef={containerRef}
                    netApyRef={netApyRef}
                    handleRestClick={handleRestClick}
                    setIsRestCycling={setIsRestCycling}
                    isRestCycling={isRestCycling}
                    restCycleIndex={restCycleIndex}
                  />
                )}
              </div>
            )}
          </div>
          {/* Mobile expandable visualization below 1100px */}
          {isHiddenVis && (
            <div
              id="mobile-portfolio-vis"
              className="mt-3 overflow-hidden"
              style={{
                maxHeight: isMobileVisOpen ? collapseMaxHeight : 0,
                opacity: isMobileVisOpen ? 1 : 0,
                transition: 'max-height 300ms ease-out, opacity 250ms ease-out',
              }}
            >
              <div ref={blockVisContainerRef} className="w-full overflow-hidden pt-2">
                {isMobileVisOpen && (
                  <div className="w-full">
                    <PortfolioTickBar
                      composition={composition}
                      onHover={setHoveredSegment}
                      hoveredSegment={hoveredSegment}
                      containerRef={blockVisContainerRef}
                      netApyRef={blockVisContainerRef}
                      layout="block"
                      handleRestClick={handleRestClick}
                      setIsRestCycling={setIsRestCycling}
                      isRestCycling={isRestCycling}
                      restCycleIndex={restCycleIndex}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* NEW: Portfolio sections with selector */}
        <div className="mt-6">
          {/* Section selector above the container */}
          <div className="flex items-center gap-2 mb-4 justify-between">
            {/* Left: section tabs */}
            {sections.map((section) => (
                      <button
          key={section}
          onClick={() => setSelectedSection(section)}
          className={`px-2 py-1 text-xs rounded-md transition-all duration-200 cursor-pointer ${
            selectedSection === section
              ? 'border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-foreground brightness-110'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          style={selectedSection === section ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
        >
                {section}
              </button>
            ))}
            {/* Right: token filter badge area */}
            <div className="ml-auto flex items-center gap-2 pr-2">
              {activeTokenFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTokenFilter(null);
                    setIsStickyHover(false);
                    setIsRestCycling(false);
                  }}
                  className="flex items-center gap-1 px-2 py-1 rounded-md border border-sidebar-border/60 bg-muted/40 text-xs text-foreground hover:bg-muted/50 relative"
                >
                  {isRestCycling && (
                    <div 
                      className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md"
                      style={{ backgroundColor: 'hsl(var(--sidebar-primary))' }}
                    />
                  )}
                  <X className="h-3.5 w-3.5" />
                  <span className="uppercase tracking-wider">{activeTokenFilter}</span>
                </button>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
            <div className="p-0">
              {/* Active Positions */}
              {selectedSection === 'Active Positions' && (
                <div>
                  <div className="p-0">
                    {activePositions.length === 0 && !isLoadingPositions ? (
                      <div className="text-sm text-muted-foreground px-2 py-6">No active positions.</div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                          <colgroup>
                            <col style={{ width: '30%' }} />
                            <col style={{ width: '18%' }} />
                            <col style={{ width: '10%' }} />
                            <col style={{ width: '20%' }} />
                            <col style={{ width: '13%' }} />
                            <col style={{ width: '3%' }} />
                          </colgroup>
                          <thead className="border-b border-sidebar-border/60 text-xs text-muted-foreground">
                            <tr>
                              <th className="px-2 pl-6 py-3 text-left tracking-wider font-mono font-bold">POOL</th>
                              <th className="px-2 py-3 text-left">
                                <button type="button" onClick={() => handleActiveSortCycle('amounts')} className="inline-flex items-center">
                                  <span>Amounts</span>
                                  {renderSortIcon(activeSort.column === 'amounts' ? activeSort.direction : null)}
                                </button>
                              </th>
                              <th className="px-2 py-3 text-left">
                                <button type="button" onClick={() => handleActiveSortCycle('apr')} className="inline-flex items-center">
                                  <span>APR</span>
                                  {renderSortIcon(activeSort.column === 'apr' ? activeSort.direction : null)}
                                </button>
                              </th>
                              <th className="px-2 py-3 text-left">Range</th>
                              <th className="py-3 pr-2 text-right">
                                <button type="button" onClick={() => handleActiveSortCycle('value')} className="inline-flex items-center justify-end">
                                  <span>Value (USD)</span>
                                  {renderSortIcon(activeSort.column === 'value' ? activeSort.direction : null)}
                                </button>
                              </th>
                              <th className="py-3 pr-6 text-right"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupedByPool.map(({ poolId, items, totalUSD }, gIdx) => {
                              const first = items[0];
                              const poolKey = String(poolId).toLowerCase();
                              const isExpanded = !!expandedPools[poolKey];
                              const hiddenCount = Math.max(0, items.length - 1);
                              const token0Icon = getToken(first?.token0?.symbol || '')?.icon || '/placeholder.svg';
                              const token1Icon = getToken(first?.token1?.symbol || '')?.icon || '/placeholder.svg';
                              const apr = aprByPoolId[poolKey] || '—';
                                                              return (
                                  <React.Fragment key={`group-wrap-${poolKey}`}>
                                    <tr
                                      key={`group-${poolKey}`}
                                      className={`hover:bg-muted/20 ${items.length > 1 ? 'bg-muted/10' : ''} ${openMenuKey === poolKey ? 'bg-muted/20' : ''} border-t border-b border-sidebar-border/60 ${gIdx === 0 ? 'border-t-0' : ''} last:border-b-0 cursor-pointer`}
                                      onClick={() => items.length > 1 && togglePoolExpanded(poolKey)}
                                    >
                                    <td className="py-4 px-2 pl-6 align-middle relative">
                                      {items.length > 1 && (
                                        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: 'hsl(var(--sidebar-primary))' }} />
                                      )}
                                      <div className="flex items-center gap-2">
                                        {items.length > 1 && (
                                          <button
                                            type="button"
                                            onClick={() => togglePoolExpanded(poolKey)}
                                            className="text-muted-foreground hover:text-foreground transition-colors"
                                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                                          >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                                              <path d="m9 18 6-6-6-6" />
                                            </svg>
                                          </button>
                                        )}
                                        <div className="relative w-14 h-7 cursor-pointer" onClick={() => navigateToPoolBySubgraphId(first?.poolId)}>
                                          <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background z-10">
                                            <Image src={token0Icon} alt={first?.token0?.symbol || ''} width={28} height={28} className="w-full h-full object-cover" />
                                          </div>
                                          <div className="absolute top-0 left-4 w-7 h-7">
                                            <div className="absolute inset-0 rounded-full overflow-hidden bg-background z-30">
                                              <Image src={token1Icon} alt={first?.token1?.symbol || ''} width={28} height={28} className="w-full h-full object-cover" />
                                            </div>
                                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[#111111] z-20"></div>
                                          </div>
                                        </div>
                                        <span className="font-medium cursor-pointer" onClick={() => navigateToPoolBySubgraphId(first?.poolId)}>{first?.token0?.symbol}/{first?.token1?.symbol}</span>
                                        {items.length > 1 && (
                                          <span className="ml-1 w-5 h-5 flex items-center justify-center text-[10px] rounded bg-[var(--sidebar-connect-button-bg)] text-muted-foreground" style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
                                            {items.length}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-4 px-2 align-middle">
                                      {items.length > 1 ? (
                                        <div></div>
                                      ) : (
                                        <div className="text-xs text-muted-foreground">
                                          <span>{Number.parseFloat(first?.token0?.amount || '0').toFixed(4)} {first?.token0?.symbol}</span>
                                          <span className="mx-1">·</span>
                                          <span>{Number.parseFloat(first?.token1?.amount || '0').toFixed(4)} {first?.token1?.symbol}</span>
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-4 px-2 align-middle">
                                      {items.length > 1 ? (
                                        <span></span>
                                      ) : (
                                        (() => {
                                          const aprNum = typeof apr === 'string' && apr.endsWith('%') ? parseFloat(apr.replace('%', '')) : NaN;
                                          if (!isFinite(aprNum)) return <span className="text-xs cursor-pointer">{apr}</span>;
                                          if (aprNum > 999) {
                                            return (
                                              <TooltipProvider>
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <span className="text-xs cursor-default">&gt;999%</span>
                                                  </TooltipTrigger>
                                                  <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">{`${aprNum.toFixed(2)}%`}</TooltipContent>
                                                </Tooltip>
                                              </TooltipProvider>
                                            );
                                          }
                                          return <span className="text-xs cursor-pointer">{aprNum.toFixed(2)}%</span>;
                                        })()
                                      )}
                                    </td>
                                    <td className="py-4 px-2 align-middle">
                                      {items.length > 1 ? (
                                        <div></div>
                                      ) : (
                                        (() => {
                                          const ct = poolDataByPoolId[poolKey]?.tick ?? 0;
                                          const ts = poolDataByPoolId[poolKey]?.tickSpacing ?? 60;
                                          const tl = first?.tickLower ?? 0;
                                          const tu = first?.tickUpper ?? 0;
                                          const widthTicks = Math.max(1, tu - tl);
                                          const distToEdge = Math.min(
                                            Math.max(0, ct - tl),
                                            Math.max(0, tu - ct)
                                          );
                                          const edgeRatio = distToEdge / widthTicks;
                                          const inRange = !!first?.isInRange;
                                          const isNearEdge = inRange && edgeRatio <= 0.15;
                                          return (
                                            <div className="flex items-center">
                                              <div className="h-8 overflow-hidden">
                                                <TickRangePortfolio
                                                tickLower={tl}
                                                tickUpper={tu}
                                                currentTick={ct}
                                                tickSpacing={ts}
                                                poolId={first?.poolId}
                                                token0Symbol={first?.token0?.symbol}
                                                token1Symbol={first?.token1?.symbol}
                                                currentPrice={poolDataByPoolId[poolKey]?.price ? String(poolDataByPoolId[poolKey]?.price) : null}
                                                bucketData={bucketDataCache[getCacheKey(first?.poolId || '', tl, tu)] || []}
                                                isLoading={loadingBuckets.has(getCacheKey(first?.poolId || '', tl, tu))}
                                                bare
                                              />
                                              </div>
                                              {(!inRange || isNearEdge) && (
                                                <div className="ml-2 shrink-0 flex items-center">
                                                  {!inRange ? (
                                                    <OctagonX className="h-4 w-4 text-red-500" />
                                                  ) : (
                                                    <OctagonAlert className="h-4 w-4 text-amber-500" />
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()
                                      )}
                                    </td>
                                    <td className="py-4 px-0 pr-2 align-middle text-right">{formatUSD(totalUSD)}</td>
                                    <td className="py-4 px-0 pr-2 align-middle text-right relative" style={{ overflow: 'visible' }}>
                                      {items.length > 1 ? (
                                        <div />
                                      ) : (
                                        <div className="relative" style={{ overflow: 'visible' }}>
                                          <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                              <Button variant="ghost" className="h-8 w-8 p-0">
                                                <span className="sr-only">Open menu</span>
                                                <EllipsisVertical className="h-4 w-4" />
                                              </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" sideOffset={2}>
                                              <DropdownMenuItem asChild>
                                                <Link href="/liquidity">Add Liquidity</Link>
                                              </DropdownMenuItem>
                                              <DropdownMenuItem>Withdraw</DropdownMenuItem>
                                            </DropdownMenuContent>
                                          </DropdownMenu>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                  {isExpanded && items.map((p, idx) => {
                                    const valueUSD = (() => {
                                      const sym0 = p?.token0?.symbol as string | undefined;
                                      const sym1 = p?.token1?.symbol as string | undefined;
                                      const amt0 = parseFloat(p?.token0?.amount || '0');
                                      const amt1 = parseFloat(p?.token1?.amount || '0');
                                      const price0 = (sym0 && portfolioData.priceMap[sym0]) || 0;
                                      const price1 = (sym1 && portfolioData.priceMap[sym1]) || 0;
                                      return amt0 * price0 + amt1 * price1;
                                    })();
                                    const token0Icon = getToken(p?.token0?.symbol || '')?.icon || '/placeholder.svg';
                                    const token1Icon = getToken(p?.token1?.symbol || '')?.icon || '/placeholder.svg';
                                    const apr = aprByPoolId[poolKey] || '—';
                                    return (
                                      <tr key={`${poolKey}-child-${idx}`} className={`hover:bg-muted/10 ${isExpanded ? '' : 'border-b border-sidebar-border/60 last:border-0'}`}>
                                        <td className="py-3 px-2 pl-[3.25rem] align-middle">
                                          <div></div>
                                        </td>
                                        <td className="py-3 px-2 align-middle">
                                          <div className="text-xs text-muted-foreground">
                                            <span>{Number.parseFloat(p?.token0?.amount || '0').toFixed(4)} {p?.token0?.symbol}</span>
                                            <span className="mx-1">·</span>
                                            <span>{Number.parseFloat(p?.token1?.amount || '0').toFixed(4)} {p?.token1?.symbol}</span>
                                          </div>
                                        </td>
                                        <td className="py-3 px-2 align-middle">
                                          {(() => {
                                            const aprNum = typeof apr === 'string' && apr.endsWith('%') ? parseFloat(apr.replace('%', '')) : NaN;
                                            if (!isFinite(aprNum)) return <span className="text-xs cursor-pointer">{apr}</span>;
                                             if (aprNum > 999) {
                                               return (
                                                 <TooltipProvider>
                                                   <Tooltip>
                                                     <TooltipTrigger asChild>
                                                       <span className="text-xs cursor-default">&gt;999%</span>
                                                     </TooltipTrigger>
                                                     <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">{`${aprNum.toFixed(2)}%`}</TooltipContent>
                                                   </Tooltip>
                                                 </TooltipProvider>
                                               );
                                             }
                                            return <span className="text-xs cursor-pointer">{aprNum.toFixed(2)}%</span>;
                                          })()}
                                        </td>
                                        <td className="py-3 px-2 align-middle">
                                          {(() => {
                                            const ct = poolDataByPoolId[poolKey]?.tick ?? 0;
                                            const ts = poolDataByPoolId[poolKey]?.tickSpacing ?? 60;
                                            const tl = p?.tickLower ?? 0;
                                            const tu = p?.tickUpper ?? 0;
                                            const widthTicks = Math.max(1, tu - tl);
                                            const distToEdge = Math.min(
                                              Math.max(0, ct - tl),
                                              Math.max(0, tu - ct)
                                            );
                                            const edgeRatio = distToEdge / widthTicks;
                                            const inRange = !!p?.isInRange;
                                            const isNearEdge = inRange && edgeRatio <= 0.15;
                                            return (
                                              <div className="flex items-center">
                                                <div className="h-8 overflow-hidden">
                                                  <TickRangePortfolio
                                                    tickLower={tl}
                                                    tickUpper={tu}
                                                    currentTick={ct}
                                                    tickSpacing={ts}
                                                    poolId={p?.poolId}
                                                    token0Symbol={p?.token0?.symbol}
                                                    token1Symbol={p?.token1?.symbol}
                                                    currentPrice={poolDataByPoolId[poolKey]?.price ? String(poolDataByPoolId[poolKey]?.price) : null}
                                                    bucketData={bucketDataCache[getCacheKey(p?.poolId || '', tl, tu)] || []}
                                                    isLoading={loadingBuckets.has(getCacheKey(p?.poolId || '', tl, tu))}
                                                    bare
                                                  />
                                                </div>
                                                {(!inRange || isNearEdge) && (
                                                  <div className="ml-2 shrink-0 flex items-center">
                                                    {!inRange ? (
                                                      <OctagonX className="h-4 w-4 text-red-500" />
                                                    ) : (
                                                      <OctagonAlert className="h-4 w-4 text-amber-500" />
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })()}
                                        </td>
                                        <td className="py-3 px-0 pr-2 align-middle text-right">
                                          <span className="text-xs text-muted-foreground">{formatUSD(valueUSD)}</span>
                                        </td>
                                        <td className="py-3 px-0 pr-2 align-middle text-right relative" style={{ overflow: 'visible' }}>
                                          <div className="relative" style={{ overflow: 'visible' }}>
                                            <DropdownMenu>
                                              <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                  <span className="sr-only">Open menu</span>
                                                  <EllipsisVertical className="h-4 w-4" />
                                                </Button>
                                              </DropdownMenuTrigger>
                                              <DropdownMenuContent align="end" sideOffset={2}>
                                                <DropdownMenuItem asChild>
                                                  <Link href="/liquidity">Add Liquidity</Link>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem>Withdraw</DropdownMenuItem>
                                              </DropdownMenuContent>
                                            </DropdownMenu>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Old Positions removed */}

              {/* Activity */}
              {selectedSection === 'Activity' && (
                <div>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border/60">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs tracking-wider text-muted-foreground font-mono font-bold">ACTIVITY</h3>
                      {isLoadingActivity && <span className="text-[10px] text-muted-foreground">Loading…</span>}
                      {activityError && <span className="text-[10px] text-red-500">{activityError}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{activityItems.length}</div>
                  </div>
                  <div className="p-2">
                    {activityItems.length === 0 && !isLoadingActivity ? (
                      <div className="text-sm text-muted-foreground px-2 py-6">No recent activity.</div>
                    ) : (
                      <div className="flex flex-col">
                        {activityItems.map((it, idx) => (
                          <div key={it.id || idx} className="flex items-start justify-between px-3 py-3 hover:bg-muted/20 rounded-md">
                            <div className="flex items-center gap-3">
                              <div className={`h-6 w-6 rounded-full border border-sidebar-border flex items-center justify-center text-[10px] ${it.type === 'Mint' ? 'text-green-500' : it.type === 'Burn' ? 'text-amber-500' : 'text-blue-400'}`}>
                                {it.type.charAt(0)}
                              </div>
                              <div className="flex flex-col">
                                <div className="text-sm">
                                  <span className="font-medium mr-2">{it.type}</span>
                                  <span className="text-muted-foreground">{it.poolSymbols}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {it.amount0 && (<span className="mr-2">{it.amount0}</span>)}
                                  {it.amount1 && (<span>{it.amount1}</span>)}
                                  {(it.tickLower || it.tickUpper) && (
                                    <span className="ml-2">ticks {it.tickLower} – {it.tickUpper}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground text-right">
                              {it.ts ? new Date(Number(it.ts) * 1000).toLocaleString() : ''}
                              {it.tx && (
                                <div className="mt-1 opacity-70 truncate max-w-[140px]">{it.tx.slice(0, 10)}…</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        {/* no third state below 1100px */}
      </div>
    </AppLayout>
    </PortfolioFilterContext.Provider>
  );
}

interface CompactCompositionBarProps {
  composition: Array<{ label: string; pct: number; color: string }>;
  onHover: (segment: number | null) => void;
  hoveredSegment: number | null;
  handleRestClick: (segment: any, segmentIndex?: number) => void;
  setIsRestCycling: (value: boolean) => void;
  isRestCycling: boolean;
  restCycleIndex: number;
  initialWidth?: number; // width computed by parent for first paint
}

function CompactCompositionBar({ composition, onHover, hoveredSegment, handleRestClick, setIsRestCycling, isRestCycling, restCycleIndex, initialWidth }: CompactCompositionBarProps) {
  //
  const SMALL_SEGMENT_THRESHOLD = 10; // tweakable (e.g., 5)
  const { activeTokenFilter, setActiveTokenFilter } = React.useContext(PortfolioFilterContext);
  const selectedIdx = activeTokenFilter
    ? (() => {
        const idx = composition.findIndex(c => c.label?.toUpperCase?.() === activeTokenFilter.toUpperCase());
        return idx >= 0 ? idx : null;
      })()
    : null;
  const hoverIdx = hoveredSegment;
  const hoverColor = '#f45502';
  const selectedColor = hoverColor;
  
  // Check if Rest segment should be highlighted when cycling
  const isRestSegmentHighlighted = (segmentIdx: number) => {
    if (!isRestCycling) return false;
    const segment = composition[segmentIdx];
    return segment?.label === 'Rest';
  };
  const normalized = React.useMemo(() => {
    const totalPct = composition.reduce((a, b) => a + b.pct, 0) || 1;
    return composition.map((c) => ({ ...c, pct: (c.pct / totalPct) * 100 }));
  }, [composition]);

  // Refs and measured width must be declared before any memo that reads them
  const barContainerRef = React.useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = React.useState<number>(Math.max(0, Math.round(initialWidth ?? 300))); // seed from parent if provided

  // Force immediate render for compact view
  const [forceRender, setForceRender] = React.useState(false);
  React.useEffect(() => {
    setForceRender(true);
  }, []);

  // Compute pixel-perfect column widths that sum exactly to the container width.
  // This avoids cumulative percentage rounding drift.
  const segmentPixelWidths = React.useMemo(() => {
    const totalWidth = Math.max(0, Math.round(availableWidth));
    if (!isFinite(totalWidth) || totalWidth <= 0 || normalized.length === 0) return [] as number[];
    const raw = normalized.map(s => (s.pct / 100) * totalWidth);
    const floors = raw.map(x => Math.floor(x));
    let used = floors.reduce((a, b) => a + b, 0);
    let remainder = totalWidth - used;
    if (remainder > 0) {
      // Distribute remaining pixels to entries with largest fractional parts
      const fracIndices = raw
        .map((x, i) => ({ i, frac: x - Math.floor(x) }))
        .sort((a, b) => b.frac - a.frac)
        .map(o => o.i);
      for (let k = 0; k < remainder && k < fracIndices.length; k += 1) {
        floors[fracIndices[k]] += 1;
      }
      used = floors.reduce((a, b) => a + b, 0);
    }
    // As a final guard, if rounding anomalies occur, adjust last cell
    if (used !== totalWidth && floors.length > 0) {
      floors[floors.length - 1] += (totalWidth - used);
    }
    return floors;
  }, [normalized, availableWidth]);

  const gridTemplateColumns = React.useMemo(
    () => segmentPixelWidths.map((w) => `${w}px`).join(' '),
    [segmentPixelWidths]
  );

  const segmentLeftOffsets = React.useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (let i = 0; i < segmentPixelWidths.length; i += 1) {
      offsets.push(acc);
      acc += segmentPixelWidths[i];
    }
    return offsets;
  }, [segmentPixelWidths]);

  const DEBUG_TICKS = false;

  const calculateAvailableWidth = React.useCallback(() => {
    const container = barContainerRef.current;
    if (!container) return;
    // Measure the immediate wrapper that has the left padding applied
    const wrapper = container.parentElement;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const computed = window.getComputedStyle(wrapper);
    const paddingLeft = parseFloat(computed.paddingLeft || '0') || 0;
    const paddingRight = parseFloat(computed.paddingRight || '0') || 0;
    const innerWidth = Math.max(0, Math.round(wrapperRect.width - paddingLeft - paddingRight));
    if (innerWidth > 0) setAvailableWidth(innerWidth);
  }, []);

  // Measure on mount and resize. Also react if parent supplies a different initialWidth later
  React.useEffect(() => {
    calculateAvailableWidth();
    const onResize = () => calculateAvailableWidth();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [calculateAvailableWidth]);

  React.useEffect(() => {
    if (typeof initialWidth === 'number' && initialWidth > 0) {
      setAvailableWidth(Math.max(0, Math.round(initialWidth)));
    }
  }, [initialWidth]);

  return (
    <TooltipProvider>
    <div ref={barContainerRef} className="relative flex-none box-border" style={{ width: `${availableWidth}px` }} onMouseLeave={() => onHover(null)}>
      {/* Bar row */}
      <div className="h-2 w-full flex overflow-hidden rounded-full" style={{ gap: 0 }}>
        {normalized.map((s, i) => (
          <div
            key={`bar-${i}`}
            style={{ 
              width: `${segmentPixelWidths[i] || 0}px`, 
              backgroundColor: hoverIdx === i ? hoverColor : (selectedIdx === i ? selectedColor : (isRestSegmentHighlighted(i) ? selectedColor : s.color)), 
              opacity: 0.95 
            }}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
            onClick={() => {
              if (s.label === 'Rest') {
                handleRestClick(s, i);
              } else {
                setActiveTokenFilter((activeToken) => (activeToken?.toUpperCase?.() === s.label?.toUpperCase?.() ? null : s.label));
                setIsRestCycling(false);
              }
            }}
          />
        ))}
      </div>
      {/* Hover zones spanning bar + label area */}
      <div className="absolute left-0 top-[-8px] z-10" style={{ width: '100%', height: '40px' }}>
        {normalized.map((s, i) => {
          const pctRounded = Math.round(s.pct);
          const showTip = s.pct < SMALL_SEGMENT_THRESHOLD;
          const isRest = s.label === 'Rest';
          
          const content = isRest ? (
            <div className="space-y-1">
              {(s as any).restTokens?.map((token: any, idx: number) => (
                <div key={idx} className="flex justify-between items-center gap-2">
                  <span className="flex items-center gap-1 uppercase">
                    {/* primary marker for current highlighted token */}
                    {isRestCycling && (s as any).restTokens?.[restCycleIndex]?.label === token.label ? (
                      <span className="inline-block w-1 h-3 rounded-sm" style={{ backgroundColor: hoverColor }} />
                    ) : (
                      <span className="inline-block w-1 h-3 rounded-sm" style={{ backgroundColor: 'hsl(var(--muted-foreground))' }} />
                    )}
                    {token.label}
                  </span>
                  <span>{Math.round(token.pct)}%</span>
                </div>
              ))}
            </div>
          ) : `${pctRounded}% ${s.label}`;
          
          const zone = (
            <div
              key={`hover-zone-${i}`}
              className="absolute h-full"
              style={{ left: `${segmentLeftOffsets[i] || 0}px`, width: `${segmentPixelWidths[i] || 0}px`, cursor: 'pointer' }}
              onMouseEnter={() => onHover(i)}
              onMouseLeave={() => onHover(null)}
              onClick={() => {
                if (s.label === 'Rest') {
                  handleRestClick(s, i);
                } else {
                  setActiveTokenFilter((activeToken) => (activeToken?.toUpperCase?.() === s.label?.toUpperCase?.() ? null : s.label));
                  setIsRestCycling(false);
                }
              }}
            />
          );
          return (showTip || isRest) ? (
            <Tooltip key={`hover-zone-wrap-${i}`} open={hoverIdx === i}>
              <TooltipTrigger asChild>{zone}</TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs" style={{ pointerEvents: 'none' }}>{content}</TooltipContent>
            </Tooltip>
          ) : zone;
        })}

        {DEBUG_TICKS && (
          <div className="pointer-events-none absolute inset-0 z-10">
            {segmentLeftOffsets.map((x, i) => (
              <div key={`guide-${i}`} className="absolute top-0 bottom-0" style={{ left: `${x}px`, width: 1, background: 'rgba(255,0,0,0.4)' }} />
            ))}
          </div>
        )}
      </div>
      {/* Labels row with overflow rules (inline bar) */}
      <div className="relative mt-0 text-xs" style={{ height: '14px', width: `${Math.max(0, Math.round(availableWidth))}px` }}>
        {(() => {
          let hideNamesFromIndex: number | null = null;
          // Determine if hovered segment's name is hidden; if so, enable cascade-right
          const hoveredNeedsCascade = (() => {
            if (hoverIdx === null || hoverIdx === undefined) return false;
            const segWidth = (segmentPixelWidths[hoverIdx] || 0);
            const leftPad = 0;
            const availableLabelWidth = Math.max(0, segWidth - leftPad);
            const s = normalized[hoverIdx] as any;
            const restToken = (s as any)?.restTokens?.[restCycleIndex];
            const isRestHighlighted = isRestSegmentHighlighted(hoverIdx);
            const pctRounded = Math.round(isRestHighlighted && restToken ? restToken.pct : s.pct);
            const labelText = (isRestHighlighted && restToken ? (restToken as any).label : (s as any).label) as string;
            const estChar = 7;
            const estNameWidth = (labelText?.length || 0) * estChar;
            const estPctWidth = (`${pctRounded}%`).length * estChar;
            const minGap = 6;
            const barSafetyEarly = 4;
            const required = estPctWidth + minGap + estNameWidth + barSafetyEarly;
            return availableLabelWidth < required;
          })();
          const nodes: React.ReactNode[] = [];
          for (let i = 0; i < normalized.length; i += 1) {
            const s = normalized[i];
            const restToken = (s as any)?.restTokens?.[restCycleIndex];
            const isRestHighlighted = isRestSegmentHighlighted(i);
            const pctRounded = Math.round(isRestHighlighted && restToken ? restToken.pct : s.pct);
            const isHovered = hoverIdx === i;
            const isSelected = selectedIdx === i;
            // Available width inside this segment for text
            const segWidth = (segmentPixelWidths[i] || 0);
            const left = (segmentLeftOffsets[i] || 0);
            const leftPad = 0; // keep flush in inline
            const availableLabelWidth = Math.max(0, segWidth - leftPad);
            // Build REST-aware labels
            const isRest = (s as any).label === 'Rest';
            const isCycling = isRest && !!isRestCycling && isRestHighlighted;
            const restCount = ((s as any)?.restTokens?.length || 0) as number;
            const nameLabel = isRest ? (isCycling ? ((restToken as any)?.label || 'Assets') : 'Assets') : ((s as any).label as string);
            const percentText = isRest ? (isCycling ? `${pctRounded}%` : `+${restCount}`) : `${pctRounded}%`;
            const estChar = 7; // px per char at this size
            const estNameWidth = (nameLabel?.length || 0) * estChar;
            const estPctWidth = (percentText?.length || 0) * estChar;
            const minGap = 6;
            // Decide if we can show name here
            const barSafetyEarly = 4; // hide a touch earlier to avoid visible overlap
            let showName = hideNamesFromIndex === null && (availableLabelWidth >= estPctWidth + minGap + estNameWidth + barSafetyEarly);
            if (!showName && hideNamesFromIndex === null) hideNamesFromIndex = i; // overflow starts here
            // Hover rule: only cascade-right if hovered segment's name is hidden
            const hideFollowingPct = hoveredNeedsCascade ? (hoverIdx !== null && hoverIdx !== undefined && i > (hoverIdx as number)) : false;
            if (isHovered) showName = true;
            const nameLeftPadPx = isRest ? (estPctWidth + minGap) : 0;
            nodes.push(
              <div
                key={`lbl-${i}`}
                className="absolute cursor-pointer"
                style={{ 
                  left: `${left}px`, 
                  width: `${segWidth}px`, 
                  overflow: ((s as any).label === 'Rest' || isHovered) ? 'visible' : 'hidden', 
                  zIndex: ((s as any).label === 'Rest' || isHovered) ? 20 : undefined 
                }}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
                onClick={() => {
                  if (s.label === 'Rest') {
                    handleRestClick(s, i);
                  } else {
                    setActiveTokenFilter((activeToken) => (activeToken?.toUpperCase?.() === s.label?.toUpperCase?.() ? null : s.label));
                    setIsRestCycling(false);
                  }
                }}
              >
                <div className="flex items-baseline gap-1" style={{ position: 'relative' }}>
                  {(() => {
                    // Always show percent/+N for REST, respect hideFollowingPct for others
                    const shouldShow = isRest || !hideFollowingPct;
                    if (!shouldShow) return null;
                    const color = isHovered ? hoverColor : ((isSelected || isRestHighlighted) ? selectedColor : s.color);
                    return (
                      <span 
                        className="font-medium"
                        style={{ 
                          color,
                          position: isRest ? 'absolute' : 'static',
                          left: isRest ? 0 : undefined,
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {percentText}
                      </span>
                    );
                  })()}
                  {showName && (
                    <span 
                      className="uppercase tracking-wider text-muted-foreground whitespace-nowrap" 
                      style={{ 
                        fontSize: 10,
                        maxWidth: isHovered ? undefined : `${Math.max(0, availableLabelWidth - estPctWidth - minGap)}px`,
                        overflow: isHovered ? 'visible' : 'hidden',
                        textOverflow: isHovered ? 'clip' : 'ellipsis',
                        textTransform: isRest && !isCycling ? 'none' : undefined,
                        color: 'hsl(var(--muted-foreground))',
                        paddingLeft: nameLeftPadPx
                      }}
                    >
                      {nameLabel}
                    </span>
                  )}
                </div>
              </div>
            );
          }
          return nodes;
        })()}
      </div>
    </div>
    </TooltipProvider>
  );
}

interface PortfolioTickBarProps {
  composition: Array<{ label: string; pct: number; color: string }>;
  onHover: (segment: number | null) => void;
  hoveredSegment: number | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  netApyRef: React.RefObject<HTMLDivElement | null>;
  layout?: "inline" | "block"; // inline: next to NET APY, block: full-width row
  handleRestClick: (segment: any, segmentIndex?: number) => void;
  setIsRestCycling: (value: boolean) => void;
  isRestCycling: boolean;
  restCycleIndex: number;
}

function PortfolioTickBar({ composition, onHover, hoveredSegment, containerRef, netApyRef, layout = "inline", handleRestClick, setIsRestCycling, isRestCycling, restCycleIndex }: PortfolioTickBarProps) {
  const SMALL_SEGMENT_THRESHOLD = 10; // tweakable (e.g., 5)
  const { activeTokenFilter, setActiveTokenFilter } = React.useContext(PortfolioFilterContext);
  const selectedIdx = activeTokenFilter
    ? (() => {
        const idx = composition.findIndex(c => c.label?.toUpperCase?.() === activeTokenFilter.toUpperCase());
        return idx >= 0 ? idx : null;
      })()
    : null;
  const hoverIdx = hoveredSegment;
  
  // Check if Rest segment should be highlighted when cycling
  const isRestSegmentHighlighted = (segmentIdx: number) => {
    if (!isRestCycling) return false;
    const segment = composition[segmentIdx];
    return segment?.label === 'Rest';
  };
  // Precise text measurement for overflow decisions (10px label font)
  const measureTextWidth = React.useCallback((text: string): number => {
    try {
      if (typeof document === 'undefined') return (text || '').length * 7;
      const anyDoc = document as any;
      const canvas: HTMLCanvasElement = anyDoc.__alphixMeasureCanvas || (anyDoc.__alphixMeasureCanvas = document.createElement('canvas'));
      const ctx = canvas.getContext('2d');
      if (!ctx) return (text || '').length * 7;
      ctx.font = '10px ui-sans-serif';
      return ctx.measureText(text || '').width;
    } catch {
      return (text || '').length * 7;
    }
  }, []);
  const hoverColor = '#f45502';
  const selectedColor = hoverColor;
  const [maxTicks, setMaxTicks] = useState(200); // Default fallback
  const [tickPixelWidth, setTickPixelWidth] = useState<number>(2);
  const [tickGapWidth, setTickGapWidth] = useState<number>(4);
  const [availablePixels, setAvailablePixels] = useState<number>(0);
  const lastPerTickRef = useRef<number | null>(null);
  const lastTicksRef = useRef<number | null>(null);

  useEffect(() => {
    const calculateMaxTicks = () => {
      if (containerRef.current && netApyRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const netApyRect = netApyRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const padding = viewportWidth <= 1500 ? 32 : 44; // More padding for mobile
        
        // Available width computation depends on layout
        const availableInline = layout === "block" || containerRef.current === netApyRef.current
          ? Math.max(0, containerRect.width - padding)
          : Math.max(0, (containerRect.right - netApyRect.right) - padding);

        const calcForAvailable = (avail: number) => {
          // FIXED sizing - never change these values
          const px = 2;
          const gap = 4;
          const perTick = px + gap;
          let ticks = Math.floor(avail / perTick);
          
          // For mobile block layout, use a reasonable number
          if (layout === "block") {
            ticks = Math.min(60, Math.max(40, ticks)); // Between 40-60 ticks for mobile
          }
          
          const clampedTicks = Math.max(12, Math.min(300, ticks)); // Increased to better show small percentages
          const rowWidth = clampedTicks * px + Math.max(0, (clampedTicks - 1)) * gap;
          return { px, gap, perTick, ticks: clampedTicks, rowWidth };
        };

        const result = calcForAvailable(availableInline);

        setTickPixelWidth(result.px);
        setTickGapWidth(result.gap);
        setMaxTicks(result.ticks);
        setAvailablePixels(availableInline);

        lastPerTickRef.current = result.perTick;
        lastTicksRef.current = result.ticks;
      }
    };

    // Multiple calculations to ensure proper initial sizing
    calculateMaxTicks();
    const timeoutId1 = setTimeout(calculateMaxTicks, 10);
    const timeoutId2 = setTimeout(calculateMaxTicks, 100);
    
    window.addEventListener('resize', calculateMaxTicks);
    return () => {
      clearTimeout(timeoutId1);
      clearTimeout(timeoutId2);
      window.removeEventListener('resize', calculateMaxTicks);
    };
  }, [containerRef, netApyRef, layout]);

  const total = composition.reduce((a, b) => a + b.pct, 0) || 1;
  const segments = composition.map((c) => ({ ...c, pct: (c.pct / total) * 100 }));
  // Ensure every segment can display at least a percentage label (~24px)
  const minLabelPx = 24;
  const minTicksPerSegment = Math.max(1, Math.ceil(minLabelPx / (tickPixelWidth + tickGapWidth)));
  // Compute the theoretical ticks required if every segment had min ticks
  const requiredTicksForLabels = segments.length * minTicksPerSegment;
  // Prefer maxTicks, but if segments are many, expand ticks so labels fit; scaling is fine per user spec
  const ticks = Math.max(maxTicks, requiredTicksForLabels);
  const totalRowWidth = ticks * tickPixelWidth + Math.max(0, (ticks - 1)) * tickGapWidth;
  // In block layout, scale to exactly the container width; in inline, only shrink if needed.
  const scaleX = (() => {
    if (totalRowWidth <= 0) return 1;
    if (layout === "block") {
      const containerWidth = containerRef.current?.getBoundingClientRect().width ?? totalRowWidth;
      // Ensure we don't exceed container width by adding some padding
      const maxWidth = Math.max(containerWidth - 32, 100); // 32px padding to prevent overflow
      return Math.min(1, maxWidth / totalRowWidth);
    }
    if (availablePixels > 0 && totalRowWidth > availablePixels) {
      return availablePixels / totalRowWidth;
    }
    return 1;
  })();

  // Compute integer tick spans per segment, ensuring minimum ticks for percentage display
  const minTicksForPct = minTicksPerSegment; // baseline minimum
  const minLabelPxSmall = 34; // ensure space for small "%" label comfortably
  const perTickPx = (tickPixelWidth + tickGapWidth);
  const baseMinTicksForSmall = Math.max(1, Math.ceil(minLabelPxSmall / perTickPx));
  const minTicksForSmall = Math.max(1, baseMinTicksForSmall - 1); // shorter by one tick
  
  // Establish per-segment minimums (tiny non-OTHERS get larger floor)
  const minTicksPerSegmentArr = segments.map((s) => {
    const isSmallNonRest = (s.pct < 5) && (String(s.label) !== 'Rest');
    return isSmallNonRest ? Math.max(minTicksForSmall, minTicksForPct) : minTicksForPct;
  });

  // Initial spans respecting minimums
  const rawSpans = segments.map((s, i) => {
    const proportionalTicks = Math.round((s.pct / 100) * ticks);
    return Math.max(minTicksPerSegmentArr[i], proportionalTicks);
  });

  let spanSum = rawSpans.reduce((a, b) => a + b, 0);

  if (spanSum > ticks) {
    // Reduce from largest segments first, but never below their own minimums
    let excess = spanSum - ticks;
    const candidates = rawSpans
      .map((span, i) => ({ i, span }))
      .filter(({ i, span }) => span > minTicksPerSegmentArr[i])
      .sort((a, b) => b.span - a.span);
    while (excess > 0 && candidates.length > 0) {
      for (let k = 0; k < candidates.length && excess > 0; k += 1) {
        const idx = candidates[k].i;
        if (rawSpans[idx] > minTicksPerSegmentArr[idx]) {
          rawSpans[idx] -= 1;
          excess -= 1;
        }
      }
      // Refilter in case some segments reached their minimums
      for (let k = candidates.length - 1; k >= 0; k -= 1) {
        const idx = candidates[k].i;
        if (rawSpans[idx] <= minTicksPerSegmentArr[idx]) candidates.splice(k, 1);
      }
    }
    spanSum = rawSpans.reduce((a, b) => a + b, 0);
  } else if (spanSum < ticks) {
    const deficit = ticks - spanSum;
    const sortedIndices = rawSpans.map((_, i) => i).sort((a, b) => rawSpans[b] - rawSpans[a]);
    for (let i = 0; i < deficit; i++) {
      rawSpans[sortedIndices[i % sortedIndices.length]] += 1;
    }
    spanSum = rawSpans.reduce((a, b) => a + b, 0);
  }

  // Compute starting tick index for each segment
  const segmentStarts: number[] = [];
  {
    let cursor = 0;
    for (let i = 0; i < rawSpans.length; i += 1) {
      segmentStarts.push(cursor);
      cursor += rawSpans[i];
    }
  }

  // Precompute tick colors and segment indices aligned to spans
  const tickColors: string[] = new Array(ticks);
  const tickSegments: number[] = new Array(ticks);
  {
    let cursor = 0;
    for (let i = 0; i < segments.length; i += 1) {
      const span = rawSpans[i];
      const color = segments[i].color;
      for (let j = 0; j < span; j += 1) {
        tickColors[cursor + j] = color;
        tickSegments[cursor + j] = i;
      }
      cursor += span;
    }
  }

  // Shorten next segment-start tick if hovered/selected label text would overflow into it
  const shortStartTicks = React.useMemo(() => {
    const set = new Set<number>();
    const activeIdx = hoverIdx ?? selectedIdx ?? null;
    if (activeIdx === null || activeIdx === undefined) return set;
    if (!segments[activeIdx]) return set;
    const s = segments[activeIdx] as any;
    const restToken = (s as any)?.restTokens?.[restCycleIndex];
    const labelText = (restToken ? restToken.label : s.label) as string;
    const estNameWidth = measureTextWidth(labelText || '');
    const pctRounded = Math.round(s.pct);
    const estPctWidth = measureTextWidth(`${pctRounded}%`);
    const minGap = 6;
    const leftPad = tickPixelWidth + tickGapWidth;
    const spanTicks = rawSpans[activeIdx];
    const segmentPxWidth = spanTicks * tickPixelWidth + Math.max(0, spanTicks - 1) * tickGapWidth;
    const availableLabelWidth = Math.max(0, segmentPxWidth - leftPad);
    const requiredWidth = estPctWidth + minGap + estNameWidth;
    if (requiredWidth > availableLabelWidth) {
      const nextStartTick = segmentStarts[activeIdx] + rawSpans[activeIdx];
      set.add(nextStartTick);
    }
    return set;
  }, [hoverIdx, selectedIdx, segments, rawSpans, segmentStarts, tickPixelWidth, tickGapWidth, restCycleIndex, measureTextWidth]);

  const isMeasured = layout === 'block' ? true : (availablePixels > 0);
  return (
    <TooltipProvider>
    <div
      className={layout === "block" ? "w-full overflow-hidden" : ""}
      style={{
        width: layout === 'block' ? '100%' : (isMeasured ? `${availablePixels}px` : 0),
        overflow: 'hidden',
      }}
    >
      <div
        className="relative"
        style={{
          width: layout === "block" ? "100%" : totalRowWidth,
          transform: layout === "block" ? `translateY(3px)` : `scaleX(${isMeasured ? scaleX : 0})`,
          transformOrigin: layout === "block" ? "left center" : "right center",
          willChange: 'transform',
          opacity: isMeasured ? 1 : 0,
        }}
      >
        {/* Large hover zones for each segment (cover ticks + label area) */}
        <div className="absolute inset-0 z-50 flex" style={{ pointerEvents: 'auto' }}>
          {segments.map((segment, segmentIndex) => {
            const pctRounded = Math.round(segment.pct);
            const isRest = segment.label === 'Rest';
            // Custom widened small segment: exactly those with boosted minimum ticks
            const isCustomSmallWidened = (minTicksPerSegmentArr[segmentIndex] > minTicksForPct) && !isRest;

            // Determine if the segment label is hidden in inline view (percentage-only)
            const spanTicks = rawSpans[segmentIndex];
            const segmentPxWidth = spanTicks * tickPixelWidth + Math.max(0, spanTicks - 1) * tickGapWidth;
            const leftPadForLabel = tickPixelWidth + tickGapWidth;
            const availableLabelWidthInline = Math.max(0, segmentPxWidth - leftPadForLabel);
            const restTokenInline = (segment as any)?.restTokens?.[restCycleIndex];
            const isRestHighlightedInline = isRestSegmentHighlighted(segmentIndex);
            const labelTextInline = (isRestHighlightedInline && restTokenInline ? restTokenInline.label : (segment as any).label) as string;
            const estNameWidthInline = measureTextWidth(labelTextInline || '');
            const estPctWidthInline = measureTextWidth(`${pctRounded}%`);
            const minGapInline = 6;
            const barSafetyEarlyInline = 4;
            const nameHiddenInline = availableLabelWidthInline < (estPctWidthInline + minGapInline + estNameWidthInline + barSafetyEarlyInline);

            // Block layout: detect if label is hidden (percentage-only) using block label metrics
            const nameHiddenBlock = (() => {
              if (layout !== 'block') return false;
              try {
                const sAny: any = segment as any;
                const restTok = sAny?.restTokens?.[restCycleIndex];
                const isRestHi = isRestSegmentHighlighted(segmentIndex);
                const labelTxt = (isRestHi && restTok ? restTok.label : sAny.label) as string;
                const span = rawSpans[segmentIndex];
                const segPx = span * tickPixelWidth + Math.max(0, span - 1) * tickGapWidth;
                const leftPad = tickPixelWidth + tickGapWidth;
                const avail = Math.max(0, segPx - leftPad);
                const estName = measureTextWidth(labelTxt || '');
                const estPct = measureTextWidth(`${pctRounded}%`);
                const minGap = 6;
                const barSafetyEarly = 4;
                return avail < (estPct + minGap + estName + barSafetyEarly);
              } catch {
                return false;
              }
            })();

              const content = isRest ? (
              <div className="space-y-1 max-h-56 overflow-auto pr-1">
                {(segment as any).restTokens?.map((token: any, idx: number) => (
                  <div key={idx} className="flex justify-between items-center gap-2">
                    <span className="flex items-center gap-1 uppercase">
                      {isRestCycling && (segment as any).restTokens?.[restCycleIndex]?.label === token.label ? (
                        <span className="inline-block w-1 h-3 rounded-sm" style={{ backgroundColor: hoverColor }} />
                      ) : (
                        <span className="inline-block w-1 h-3 rounded-sm" style={{ backgroundColor: 'hsl(var(--muted-foreground))' }} />
                      )}
                      {token.label}
                    </span>
                    <span>{Math.round(token.pct)}%</span>
                  </div>
                ))}
              </div>
            ) : `${segment.label}`;
            
            const zone = (
              <div
                key={`hover-zone-${segmentIndex}`}
                className="h-full"
                style={{ 
                  width: `${segment.pct}%`,
                  height: "calc(100% + 16px)",
                  cursor: 'pointer'
                }}
                onMouseEnter={() => onHover(segmentIndex)}
                onMouseLeave={() => onHover(null)}
                onClick={() => {
                  if (segment.label === 'Rest') {
                    handleRestClick(segment, segmentIndex);
                  } else {
                    setActiveTokenFilter((activeToken) => (activeToken?.toUpperCase?.() === segment.label?.toUpperCase?.() ? null : segment.label));
                    setIsRestCycling(false);
                  }
                }}
              />
            );
            // Only show tooltip for REST and for custom low-pct widened segments (not for all small/hidden)
            return (isRest || isCustomSmallWidened) ? (
              <Tooltip key={`hover-zone-wrap-${segmentIndex}`} open={hoverIdx === segmentIndex} disableHoverableContent>
                <TooltipTrigger asChild>
                  {zone}
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs" style={{ pointerEvents: 'none' }}>{content}</TooltipContent>
              </Tooltip>
            ) : zone;
          })}
        </div>
        {/* Tick row */}
        <div 
          className="flex h-8 select-none" 
          style={{ 
            gap: layout === "block" ? "2px" : `${tickGapWidth}px`, 
            width: layout === "block" ? "100%" : totalRowWidth,
            justifyContent: layout === "block" ? "space-between" : "flex-start"
          }}
        >
          {Array.from({ length: ticks }).map((_, i) => {
            const segmentIndex = tickSegments[i];
            const isHovered = hoverIdx === segmentIndex;
            const isSelected = selectedIdx === segmentIndex;
            return (
              <div
                key={i}
                className="h-full flex-shrink-0"
                style={{
                  width: `${tickPixelWidth}px`,
                  backgroundColor: isHovered ? hoverColor : (isSelected ? selectedColor : (isRestSegmentHighlighted(segmentIndex) ? selectedColor : tickColors[i])),
                  opacity: 0.9,
                }}
                onMouseEnter={() => onHover(segmentIndex)}
                onMouseLeave={() => onHover(null)}
                onClick={() => {
                  const segment = composition[segmentIndex];
                  if (!segment) return;
                  
                  if (segment.label === 'Rest') {
                    handleRestClick(segment, segmentIndex);
                  } else {
                    setActiveTokenFilter((activeToken) => {
                      const next = segment.label || null;
                      if (!next) return null;
                      return activeToken?.toUpperCase?.() === next.toUpperCase?.() ? null : next;
                    });
                    setIsRestCycling(false);
                  }
                }}
              />
            );
          })}
        </div>
        {/* Segment start markers extending downward */}
        <div
          className="pointer-events-none absolute left-0 top-0 flex"
          style={{ 
            height: "calc(100% + 12px)", 
            gap: `${tickGapWidth}px`, 
            width: layout === "block" ? "100%" : totalRowWidth,
            justifyContent: layout === "block" ? "space-between" : "flex-start"
          }}
        >
          {Array.from({ length: ticks }).map((_, i) => {
            const isSegmentStart = segmentStarts.includes(i);
            const segmentIndex = tickSegments[i];
            const isHovered = hoverIdx === segmentIndex;
            const isSelected = selectedIdx === segmentIndex;
            return isSegmentStart ? (
              <div
                key={`marker-${i}`}
                className="flex-shrink-0"
                style={{
                  width: `${tickPixelWidth}px`,
                  height: shortStartTicks.has(i) ? `calc(100% - 12px)` : "100%",
                  backgroundColor: isHovered ? hoverColor : (isSelected ? selectedColor : (isRestSegmentHighlighted(segmentIndex) ? selectedColor : tickColors[i])),
                  opacity: 0.95,
                }}
              />
            ) : (
              <div key={`marker-${i}`} className="flex-shrink-0" style={{ width: `${tickPixelWidth}px`, height: 0 }} />
            );
          })}
        </div>
      </div>
        {/* Labels aligned to segment-start ticks */}
        {layout === "block" ? (
          <div
            className="flex text-xs mt-0"
            style={{
              gap: "2px",
              width: "100%",
              justifyContent: "space-between",
              position: "relative",
              height: "20px",
              transform: 'translateY(3px)',
              willChange: 'transform',
              pointerEvents: 'none'
            }}
          >
            {(() => {
              let hideNamesFromIndex: number | null = null;
              const slots: React.ReactNode[] = [];
              for (let tickIdx = 0; tickIdx < ticks; tickIdx += 1) {
                const segIdx = segmentStarts.indexOf(tickIdx);
                const slot = (
                  <div key={`lbl-slot-${tickIdx}`} className="flex-shrink-0 relative" style={{ width: `${tickPixelWidth}px`, height: "100%" }}>
                    {segIdx !== -1 && (() => {
                      const s = segments[segIdx];
                      const restToken = (s as any)?.restTokens?.[restCycleIndex];
                      const isRestHighlighted = isRestSegmentHighlighted(segIdx);
                      const pctRounded = Math.round(isRestHighlighted && restToken ? restToken.pct : s.pct);
                      const isHovered = hoverIdx === segIdx;
                      const isSelected = selectedIdx === segIdx;
                      const startTick = segmentStarts[segIdx];
                      const spanTicks = rawSpans[segIdx];
                      const segmentPxWidth = spanTicks * tickPixelWidth + Math.max(0, spanTicks - 1) * tickGapWidth;
                      const leftPad = tickPixelWidth + tickGapWidth;
                      const availableLabelWidth = Math.max(0, segmentPxWidth - leftPad);
                      const labelText = (isRestHighlighted && restToken ? (restToken as any).label : (s as any).label) as string;
                      const estNameWidth = measureTextWidth(labelText || '');
                      const estPctWidth = measureTextWidth(`${pctRounded}%`);
                      const minGap = 6;
                      const barSafetyEarly = 4; // hide a touch earlier to avoid visible overlap
                      let showName = (s.pct >= 10);
                      if (hideNamesFromIndex !== null && segIdx >= hideNamesFromIndex) showName = false;
                      if (showName && availableLabelWidth < estPctWidth + minGap + estNameWidth + barSafetyEarly) {
                        hideNamesFromIndex = segIdx;
                        showName = false;
                      }
                      // Force show on hover or when selected
                      if (isHovered || isSelected) showName = true;
                      const color = isHovered ? hoverColor : ((isSelected || isRestHighlighted) ? selectedColor : (s as any).color);
                      return (
                        <div
                          className="absolute left-0 top-0"
                          onMouseEnter={() => onHover(segIdx)}
                          onMouseLeave={() => onHover(null)}
                          onClick={() => {
                            if ((s as any).label === 'Rest') {
                              handleRestClick(s as any, segIdx);
                            } else {
                              setActiveTokenFilter((activeToken) => (activeToken?.toUpperCase?.() === (s as any).label?.toUpperCase?.() ? null : ((s as any).label as string)));
                              setIsRestCycling(false);
                            }
                          }}
                          style={{ paddingLeft: leftPad, width: `${segmentPxWidth}px`, overflow: (isHovered || isSelected) ? 'visible' : 'hidden', zIndex: (isHovered || isSelected) ? 20 : undefined }}
                        >
                          <div className="flex items-baseline gap-1" style={{ overflow: (isHovered || isSelected) ? 'visible' : 'hidden' }}>
                            {(s as any).label === 'Rest' ? (
                              Array.isArray((s as any).restTokens) && (s as any).restTokens.length > 0 && (
                                <span className="font-medium" style={{ color, fontSize: 12 }}>
                                  {isRestCycling && (s as any).restTokens?.[restCycleIndex] ? 
                                    `${Math.round((s as any).restTokens[restCycleIndex].pct)}%` : 
                                    `+${(s as any).restTokens.length}`
                                  }
                                </span>
                              )
                            ) : (
                              <span className="font-medium" style={{ color }}>{pctRounded}%</span>
                            )}
                            {showName && (
                              <span className="uppercase tracking-wider text-muted-foreground whitespace-nowrap" style={{ fontSize: 10, maxWidth: (isHovered || isSelected) ? undefined : `${Math.max(0, availableLabelWidth - estPctWidth - minGap)}px`, overflow: (isHovered || isSelected) ? 'visible' : 'hidden', textOverflow: (isHovered || isSelected) ? 'clip' : 'ellipsis', textTransform: (s as any).label === 'Rest' ? 'none' : undefined }}>
                                {(s as any).label === 'Rest' ? (
                                  isRestCycling && (s as any).restTokens?.[restCycleIndex] ? 
                                    (s as any).restTokens[restCycleIndex].label : 
                                    'Assets'
                                ) : (
                                  labelText
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
                slots.push(slot);
              }
              return slots;
            })()}
          </div>
        ) : (
          <div
            className="relative text-xs"
            style={{
              marginTop: '0px',
              height: '20px',
              width: totalRowWidth,
              transform: `scaleX(${scaleX})`,
              transformOrigin: 'left center',
              willChange: 'transform',
              zIndex: 30
            }}
          >
            {(() => {
              let hideNamesFromIndex: number | null = null;
              const nodes: React.ReactNode[] = [];
              for (let i = 0; i < segments.length; i += 1) {
                const s = segments[i];
                const restToken = (s as any)?.restTokens?.[restCycleIndex];
                const isRestHighlighted = isRestSegmentHighlighted(i);
                const pctRounded = Math.round(isRestHighlighted && restToken ? restToken.pct : s.pct);
                const isHovered = hoverIdx === i;
                const isSelected = selectedIdx === i;
                const segmentStart = segmentStarts[i];
                const startPosition = segmentStart * (tickPixelWidth + tickGapWidth);
                const segmentPixelWidth = rawSpans[i] * tickPixelWidth + Math.max(0, rawSpans[i] - 1) * tickGapWidth;
                const leftPad = tickPixelWidth + tickGapWidth;
                const availableLabelWidth = Math.max(0, segmentPixelWidth - leftPad);
                const labelText = (isRestHighlighted && restToken ? (restToken as any).label : (s as any).label) as string;
                const estChar = 7;
                const estNameWidth = (labelText?.length || 0) * estChar;
                const estPctWidth = (`${pctRounded}%`).length * estChar;
                const minGap = 6;
                const barSafetyEarly = 4; // hide a touch earlier to avoid visible overlap
                let showName = (s.pct >= 10);
                if (hideNamesFromIndex !== null && i >= hideNamesFromIndex) showName = false;
                if (showName && availableLabelWidth < Math.max(0, estPctWidth + minGap + estNameWidth - barSafetyEarly)) {
                  hideNamesFromIndex = i;
                  showName = false;
                }
                // Do not force inline label on hover; rely on tooltip for small/hidden labels
            {
              const isRest = (s as any).label === 'Rest';
              const content = isRest
                ? (
                  <div className="space-y-1">
                    {(s as any).restTokens?.map((token: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center gap-2">
                        <span className="flex items-center gap-1 uppercase">
                          {isRestCycling && (s as any).restTokens?.[restCycleIndex]?.label === token.label ? (
                            <span className="inline-block w-1 h-3 rounded-sm" style={{ backgroundColor: hoverColor }} />
                          ) : (
                            <span className="inline-block w-1 h-3 rounded-sm" style={{ backgroundColor: 'hsl(var(--muted-foreground))' }} />
                          )}
                          {token.label}
                        </span>
                        <span>{Math.round(token.pct)}%</span>
                      </div>
                    ))}
                  </div>
                )
                : `${pctRounded}% ${labelText}`;

              const labelBody = (
                <div 
                  key={`lbl-${i}`}
                  className="absolute top-0"
                  style={{ left: `${startPosition}px`, width: `${segmentPixelWidth}px`, paddingLeft: leftPad, overflow: (isHovered || isSelected) ? 'visible' : 'hidden', zIndex: (isHovered || isSelected) ? 20 : undefined }}
                  onMouseEnter={() => onHover(i)}
                  onMouseLeave={() => onHover(null)}
                >
                  <div className="flex items-baseline gap-1" style={{ overflow: (isHovered || isSelected) ? 'visible' : 'hidden' }}>
                    {(s as any).label === 'Rest'
                      ? (() => {
                          const restArr = (s as any).restTokens as any[] | undefined;
                          if (!Array.isArray(restArr) || restArr.length === 0) return null;
                          const isCycling = !!isRestCycling;
                          if (isCycling) {
                            const rt = restArr[restCycleIndex] as any;
                            const rp = Math.round(rt?.pct ?? 0);
                            return (
                              <span className="font-medium" style={{ color: isHovered || isSelected ? hoverColor : ((isSelected || isRestSegmentHighlighted(i)) ? selectedColor : (s as any).color) }}>{rp}%</span>
                            );
                          }
                          return (
                            <span className="font-medium" style={{ color: isHovered || isSelected ? hoverColor : ((isSelected || isRestSegmentHighlighted(i)) ? selectedColor : (s as any).color), fontSize: 12 }}>+{restArr.length}</span>
                          );
                        })()
                      : (
                        <span className="font-medium" style={{ color: isHovered ? hoverColor : ((isSelected || isRestSegmentHighlighted(i)) ? selectedColor : (s as any).color) }}>{pctRounded}%</span>
                      )}
                    {showName && (() => {
                      const isRest = (s as any).label === 'Rest';
                      const restArr = (s as any).restTokens as any[] | undefined;
                      const isCycling = isRest && !!isRestCycling && Array.isArray(restArr) && restArr.length > 0;
                      const nameText = isRest ? (isCycling ? (restArr?.[restCycleIndex]?.label ?? 'Assets') : 'Assets') : labelText;
                      const style: React.CSSProperties = {
                        fontSize: 10,
                        maxWidth: `${Math.max(0, availableLabelWidth - estPctWidth - minGap)}px`,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        textTransform: isRest && !isCycling ? 'none' : undefined,
                      };
                      return (
                        <span className="uppercase tracking-wider text-muted-foreground whitespace-nowrap" style={style}>
                          {nameText}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              );

              // Do not wrap labels in tooltip to avoid hover flicker; tooltips are handled by the striped segment hover zones
              nodes.push(labelBody);
            }
              }
              return nodes;
            })()}
          </div>
        )}
    </div>
    </TooltipProvider>
  );
}

