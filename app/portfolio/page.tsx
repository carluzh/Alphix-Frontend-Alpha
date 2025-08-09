"use client";

import React from "react";
import { AppLayout } from "@/components/app-layout";
import Image from "next/image";
import { useMemo, useState, useEffect, useRef } from "react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { useAccount } from "wagmi";
import poolsConfig from "@/config/pools.json";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "next/navigation";
import { getAllPools, getToken } from "@/lib/pools-config";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";

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
  tokenPrices: Record<string, number>;
  positions: ProcessedPosition[];
  error?: string;
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
    tokenPrices: {},
    positions: [],
    error: undefined,
  });

  useEffect(() => {
    if (!isConnected || !accountAddress) {
      setPortfolioData({
        totalValue: 0,
        tokenBalances: [],
        isLoading: false,
        tokenPrices: {},
        positions: [],
        error: undefined,
      });
      return;
    }

    const fetchPortfolioData = async () => {
      try {
        setPortfolioData(prev => ({ ...prev, isLoading: true, error: undefined }));

        // 1. Fetch user positions
        const positionsRes = await fetch(`/api/liquidity/get-positions?ownerAddress=${accountAddress}`);
        if (!positionsRes.ok) throw new Error('Failed to fetch positions');
        const positions = await positionsRes.json();

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
        
        if (uniqueCoinIds.length > 0) {
          const priceRes = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${uniqueCoinIds.join(',')}&vs_currencies=usd`
          );
          if (priceRes.ok) {
            const priceData = await priceRes.json();
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

        // Convert priceMap to plain object for state
        const tokenPrices: Record<string, number> = {};
        Array.from(priceMap.entries()).forEach(([sym, price]) => { tokenPrices[sym] = price; });

        setPortfolioData({
          totalValue,
          tokenBalances,
          isLoading: false,
          tokenPrices,
          positions: Array.isArray(positions) ? positions : [],
          error: undefined,
        });

      } catch (error) {
        console.error('Failed to fetch portfolio data:', error);
        setPortfolioData({
          totalValue: 0,
          tokenBalances: [],
          isLoading: false,
          tokenPrices: {},
          positions: [],
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    fetchPortfolioData();
  }, [isConnected, accountAddress]);

  return portfolioData;
}

export default function PortfolioPage() {
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
  const router = useRouter();

  const subgraphToRouteId = useMemo(() => {
    const m = new Map<string, string>();
    getAllPools().forEach(p => {
      if (p.subgraphId) m.set(p.subgraphId.toLowerCase(), p.id);
    });
    return m;
  }, []);

  const getTokenIcon = (symbol?: string) => {
    if (!symbol) return "/placeholder-logo.svg";
    return getToken(symbol)?.icon || "/placeholder-logo.svg";
  };

  const formatTokenAmount = (amount: string) => {
    const n = parseFloat(amount);
    if (!isFinite(n)) return "0.00";
    if (n === 0) return "0.00";
    if (n > 0 && n < 0.0001) return "< 0.0001";
    return n.toFixed(4);
  };

  const getPositionUSDValue = (pos: ProcessedPosition) => {
    const p0 = portfolioData.tokenPrices[pos.token0.symbol] || 0;
    const p1 = portfolioData.tokenPrices[pos.token1.symbol] || 0;
    const v0 = parseFloat(pos.token0.amount || '0') * p0;
    const v1 = parseFloat(pos.token1.amount || '0') * p1;
    return v0 + v1;
  };

  // Set initial responsive states immediately
  useEffect(() => {
    const setInitialStates = () => {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      setIsCompactVis(viewportWidth <= 1300);
      setIsHiddenVis(viewportWidth <= 1100);
      setIsVerySmallScreen(viewportWidth < 695);
    };
    
    setInitialStates();
  }, []);

  // Composition memoized early so hooks remain above conditional returns
  const composition = useMemo(() => {
    const total = portfolioData.totalValue;
    return portfolioData.tokenBalances
      .map(token => ({
        label: token.symbol,
        pct: total > 0 ? (token.usdValue / total) * 100 : 0,
        color: token.color,
      }))
      .filter(item => item.pct >= 1);
  }, [portfolioData.tokenBalances, portfolioData.totalValue]);
  // Decide placement purely by measured available inline width
  useEffect(() => {
    const updateLayoutAndOffset = () => {
      if (!containerRef.current || !netApyRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const netApyRect = netApyRef.current.getBoundingClientRect();
      // Compute left offset so inline visualization starts closer to NET APY at smaller viewports
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      setIsCompactVis(viewportWidth <= 1300);
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


  // Calculate proportional value when hovering
  const displayValue = hoveredSegment !== null && composition[hoveredSegment]
    ? (portfolioData.totalValue * composition[hoveredSegment].pct) / 100
    : portfolioData.totalValue;

  // Calculate some basic stats
  const pnl24hPct = 0; // TODO: Calculate from historical data
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
                <span className="text-xs font-medium" style={{ color: isPositive ? "#22c55e" : "#ef4444" }}>{pnl24hPct.toFixed(2)}%</span>
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
              {(12.3).toFixed(1)}%
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
                  />
                ) : (
                  <PortfolioTickBar
                    composition={composition}
                    onHover={setHoveredSegment}
                    hoveredSegment={hoveredSegment}
                    containerRef={containerRef}
                    netApyRef={netApyRef}
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
              <div ref={blockVisContainerRef} className="w-full overflow-hidden pt-2 pb-2">
                {isMobileVisOpen && (
                  <div className="w-full">
                    <PortfolioTickBar
                      composition={composition}
                      onHover={setHoveredSegment}
                      hoveredSegment={hoveredSegment}
                      containerRef={blockVisContainerRef}
                      netApyRef={blockVisContainerRef}
                      layout="block"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Active Positions */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Active Positions</h2>
          </div>
          <div className="rounded-md border">
            {portfolioData.positions.length > 0 ? (
              <Table className="w-full" style={{ tableLayout: 'fixed' }}>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Pool</TableHead>
                    <TableHead>Amounts</TableHead>
                    <TableHead>Range (ticks)</TableHead>
                    <TableHead>In Range</TableHead>
                    <TableHead className="pr-6 text-right">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {portfolioData.positions.map((pos) => {
                    const poolRouteId = subgraphToRouteId.get(pos.poolId.toLowerCase()) || pos.poolId;
                    const valueUSD = getPositionUSDValue(pos);
                    const inRange = pos.isInRange;
                    return (
                      <TableRow
                        key={pos.positionId}
                        className="group cursor-pointer transition-colors hover:bg-muted/30"
                        onClick={() => router.push(`/liquidity/${poolRouteId}`)}
                      >
                        <TableCell className="pl-6">
                          <div className="flex items-center gap-2">
                            <div className="relative w-14 h-7">
                              <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background z-10">
                                <Image
                                  src={getTokenIcon(pos.token0.symbol)}
                                  alt={pos.token0.symbol}
                                  width={28}
                                  height={28}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                              <div className="absolute top-0 left-4 w-7 h-7">
                                <div className="absolute inset-0 rounded-full overflow-hidden bg-background z-30">
                                  <Image
                                    src={getTokenIcon(pos.token1.symbol)}
                                    alt={pos.token1.symbol}
                                    width={28}
                                    height={28}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[#111111] z-20"></div>
                              </div>
                            </div>
                            <div className="flex flex-col">
                              <span className="font-medium">{pos.token0.symbol} / {pos.token1.symbol}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col text-sm">
                            <span>{formatTokenAmount(pos.token0.amount)} {pos.token0.symbol}</span>
                            <span className="text-muted-foreground">{formatTokenAmount(pos.token1.amount)} {pos.token1.symbol}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">[{pos.tickLower}, {pos.tickUpper}]</div>
                        </TableCell>
                        <TableCell>
                          <span className={inRange ? "text-green-500" : "text-red-500"}>{inRange ? "In range" : "Out of range"}</span>
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          {formatUSD(valueUSD)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="p-6 text-center text-muted-foreground">No active positions</div>
            )}
          </div>
        </div>
        {/* no third state below 1100px */}
      </div>
    </AppLayout>
  );
}

interface CompactCompositionBarProps {
  composition: Array<{ label: string; pct: number; color: string }>;
  onHover: (segment: number | null) => void;
  hoveredSegment: number | null;
}

function CompactCompositionBar({ composition, onHover, hoveredSegment }: CompactCompositionBarProps) {
  const totalPct = composition.reduce((a, b) => a + b.pct, 0) || 1;
  const normalized = composition.map((c) => ({ ...c, pct: (c.pct / totalPct) * 100 }));

  const containerRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const percentRefs = React.useRef<Array<HTMLSpanElement | null>>([]);
  const tokenMeasureRefs = React.useRef<Array<HTMLSpanElement | null>>([]);
  const [nameFits, setNameFits] = React.useState<boolean[]>([]);
  const cascadingNameFits = React.useMemo(() => {
    const result: boolean[] = new Array(normalized.length).fill(false);
    let allPrevFit = true;
    for (let i = 0; i < normalized.length; i += 1) {
      const currentFits = !!nameFits[i];
      const canShow = allPrevFit && currentFits;
      result[i] = canShow;
      allPrevFit = allPrevFit && currentFits;
    }
    return result;
  }, [nameFits, normalized.length]);

  const recomputeFits = React.useCallback(() => {
    const gapPx = 4; // gap-1 between % and token
    const safetyPx = 2; // hide a bit earlier to prevent visual overflow
    const fits = normalized.map((_, i) => {
      const container = containerRefs.current[i];
      const percentEl = percentRefs.current[i];
      const tokenMeasureEl = tokenMeasureRefs.current[i];
      if (!container || !percentEl || !tokenMeasureEl) return false;
      const styles = window.getComputedStyle(container);
      const padL = parseFloat(styles.paddingLeft || '0') || 0;
      const padR = parseFloat(styles.paddingRight || '0') || 0;
      const available = Math.max(0, container.clientWidth - padL - padR - percentEl.offsetWidth - gapPx - safetyPx);
      const needed = tokenMeasureEl.scrollWidth;
      return needed <= available;
    });
    setNameFits(fits);
  }, [normalized]);

  React.useEffect(() => {
    recomputeFits();
    const onResize = () => recomputeFits();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [recomputeFits]);

  return (
    <div className="flex flex-col relative" style={{ width: '100%' }} onMouseLeave={() => onHover(null)}>
      {/* Bar */}
      <div className="h-2 rounded-sm overflow-hidden flex" style={{ width: '100%' }}>
        {normalized.map((s, i) => (
          <div
            key={i}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
            style={{
              width: `${s.pct}%`,
              backgroundColor: hoveredSegment === i ? '#f45502' : s.color,
              opacity: 0.95
            }}
          />
        ))}
      </div>
      {/* Large hover zones across bar + labels */}
      <div className="absolute left-0 top-[-8px] z-10 flex" style={{ width: '100%', height: '40px' }}>
        {normalized.map((s, i) => (
          <div
            key={`hover-zone-${i}`}
            className="h-full"
            style={{ width: `${s.pct}%`, cursor: 'pointer' }}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover(null)}
          />
        ))}
      </div>
      {/* Labels: ensure no overlap and clamp last label to bar end; show token name on hover if overflow risk */}
      <div className="flex mt-2 text-xs gap-0.5" style={{ width: '100%' }}>
        {normalized.map((s, i) => {
          const pct = Math.round(s.pct);
          const segmentWidthPx = `calc(${s.pct}% - 0px)`; // explicit for clarity
          const doesFit = nameFits[i] ?? false;
          const hoveringIdx = hoveredSegment ?? -1;
          const hideFollowingPercent = hoveringIdx >= 0 && !nameFits[hoveringIdx] && i === hoveringIdx + 1;
          const showInlineName = (cascadingNameFits[i] === true) || (hoveredSegment === i);
          return (
            <div
              key={i}
              className="px-1 relative"
              style={{ width: segmentWidthPx, overflow: hoveredSegment === i ? 'visible' : undefined, zIndex: hoveredSegment === i ? (1 as any) : undefined }}
              ref={(el) => {
                containerRefs.current[i] = el;
              }}
            >
              <div className="flex items-baseline gap-1" style={{ whiteSpace: 'nowrap', overflow: hoveredSegment === i ? 'visible' : 'hidden' }}>
                <span
                  ref={(el) => {
                    percentRefs.current[i] = el;
                  }}
                  className="font-medium"
                  style={{ color: hoveredSegment === i ? '#f45502' : s.color, visibility: hideFollowingPercent ? 'hidden' : 'visible' }}
                >
                  {pct}%
                </span>
                {/* Offscreen measurement element for intrinsic token width */}
                <span
                  ref={(el) => {
                    tokenMeasureRefs.current[i] = el;
                  }}
                  className="uppercase tracking-wider whitespace-nowrap"
                  style={{ fontSize: 10, position: 'absolute', visibility: 'hidden' }}
                >
                  {s.label}
                </span>
                {/* Token label: show if it fits, or on hover; otherwise hide */}
                {showInlineName && (
                  <span
                    className="uppercase tracking-wider text-muted-foreground whitespace-nowrap"
                    style={{ fontSize: 10 }}
                  >
                    {s.label}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PortfolioTickBarProps {
  composition: Array<{ label: string; pct: number; color: string }>;
  onHover: (segment: number | null) => void;
  hoveredSegment: number | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  netApyRef: React.RefObject<HTMLDivElement | null>;
  layout?: "inline" | "block"; // inline: next to NET APY, block: full-width row
}

function PortfolioTickBar({ composition, onHover, hoveredSegment, containerRef, netApyRef, layout = "inline" }: PortfolioTickBarProps) {
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
          
          const clampedTicks = Math.max(12, Math.min(250, ticks));
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
  const ticks = maxTicks;
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

  // Compute integer tick spans per segment, adjusted to fill exactly `ticks`
  const rawSpans = segments.map((s) => Math.round((s.pct / 100) * ticks));
  const spanSum = rawSpans.reduce((a, b) => a + b, 0);
  if (spanSum !== ticks) {
    // Distribute the difference across segments to maintain proportions
    const diff = ticks - spanSum;
    if (diff > 0) {
      // Add ticks to largest segments first
      const sortedIndices = rawSpans.map((_, i) => i).sort((a, b) => rawSpans[b] - rawSpans[a]);
      for (let i = 0; i < diff; i++) {
        rawSpans[sortedIndices[i % sortedIndices.length]]++;
      }
    } else {
      // Remove ticks from largest segments first
      const sortedIndices = rawSpans.map((_, i) => i).sort((a, b) => rawSpans[b] - rawSpans[a]);
      for (let i = 0; i < Math.abs(diff); i++) {
        if (rawSpans[sortedIndices[i % sortedIndices.length]] > 1) {
          rawSpans[sortedIndices[i % sortedIndices.length]]--;
        }
      }
    }
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

  return (
    <div className={layout === "block" ? "w-full overflow-hidden" : ""}>
      <div
        className="relative"
        style={{
          width: layout === "block" ? "100%" : totalRowWidth,
          transform: layout === "block" ? undefined : `scaleX(${scaleX})`,
          transformOrigin: layout === "block" ? "left center" : "right center",
          willChange: layout === "block" ? undefined : 'transform'
        }}
      >
        {/* Large hover zones for each segment */}
        <div className="absolute inset-0 z-10 flex">
          {segments.map((segment, segmentIndex) => (
            <div
              key={`hover-zone-${segmentIndex}`}
              className="h-full cursor-pointer"
              style={{ 
                width: `${segment.pct}%`,
                height: "calc(100% + 16px)", // Extend below to cover labels too
              }}
              onMouseEnter={() => onHover(segmentIndex)}
              onMouseLeave={() => onHover(null)}
            />
          ))}
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
            const isHovered = hoveredSegment === segmentIndex;
            return (
              <div
                key={i}
                className="h-full flex-shrink-0"
                style={{
                  width: `${tickPixelWidth}px`,
                  backgroundColor: isHovered ? "#f45502" : tickColors[i],
                  opacity: 0.9,
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
            const isHovered = hoveredSegment === segmentIndex;
            return isSegmentStart ? (
              <div
                key={`marker-${i}`}
                className="flex-shrink-0"
                style={{
                  width: `${tickPixelWidth}px`,
                  height: "100%",
                  backgroundColor: isHovered ? "#f45502" : tickColors[i],
                  opacity: 0.95,
                }}
              />
            ) : (
              <div key={`marker-${i}`} className="flex-shrink-0" style={{ width: `${tickPixelWidth}px`, height: 0 }} />
            );
          })}
        </div>
      </div>
      {/* Labels aligned with segments */}
      <div
        className="flex text-xs"
        style={{
          marginTop: layout === "block" ? '6px' : '4px',
          gap: layout === "block" ? "2px" : "4px",
          width: layout === "block" ? "100%" : totalRowWidth,
          transform: layout === "block" ? undefined : (scaleX !== 1 ? `scaleX(${scaleX})` : undefined),
          transformOrigin: layout === "block" ? "left center" : "right center",
          justifyContent: layout === "block" ? "space-between" : "flex-start"
        }}
      >
        {segments.map((s, i) => {
          const token = s.label;
          const pct = Math.round(s.pct);
          const isHovered = hoveredSegment === i;
          return (
            <div 
              key={i} 
              className={layout === "block" ? "pl-1 pr-1 text-center" : "pl-3 pr-1"}
              style={{ 
                width: layout === "block" ? `${s.pct}%` : `${rawSpans[i] * tickPixelWidth + Math.max(0, rawSpans[i] - 1) * tickGapWidth}px`,
                flexShrink: layout === "block" ? 0 : undefined
              }}
            >
              <div className="flex items-baseline gap-1">
                <span 
                  className="font-medium" 
                  style={{ color: isHovered ? "#f45502" : s.color }}
                >
                  {pct}%
                </span>
                <span className="uppercase tracking-wider text-muted-foreground" style={{ fontSize: 10 }}>{token}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

