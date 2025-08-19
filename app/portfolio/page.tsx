"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppLayout } from "@/components/app-layout";
import Image from "next/image";
import { useMemo, useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import JSBI from "jsbi";
import { Token } from "@uniswap/sdk-core";
import { Pool as V4Pool, Position as V4Position } from "@uniswap/v4-sdk";
import { publicClient } from "@/lib/viemClient";
import { getAllPools, getToken, getPoolById, CHAIN_ID, getStateViewAddress, getPositionManagerAddress, getAllTokens, NATIVE_TOKEN_ADDRESS, getContracts } from "@/lib/pools-config";
import { STATE_VIEW_ABI as STATE_VIEW_HUMAN_READABLE_ABI } from "@/lib/abis/state_view_abi";
import { position_manager_abi } from "@/lib/abis/PositionManager_abi";
import { parseAbi, type Abi, type Hex, getAddress } from "viem";
import { ethers } from "ethers";
import { X } from "lucide-react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { baseSepolia } from "@/lib/wagmiConfig";
import { toast } from "sonner";
import { FAUCET_CONTRACT_ADDRESS, faucetContractAbi } from "@/pages/api/misc/faucet";
import poolsConfig from "@/config/pools.json";
import { ChevronUpIcon, ChevronDownIcon, ChevronsUpDownIcon, ChevronRight, OctagonX, OctagonAlert, EllipsisVertical, ArrowUpRight, ArrowDownRight, PlusIcon, RefreshCwIcon, BadgeCheck, Menu } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import TickRangePortfolio from "../../components/TickRangePortfolio";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TOKEN_DEFINITIONS, type TokenSymbol, getToken as getTokenCfg } from "@/lib/pools-config";
import { formatUnits as viemFormatUnits } from "viem";
import { useIncreaseLiquidity, type IncreasePositionData } from "@/components/liquidity/useIncreaseLiquidity";
import { useDecreaseLiquidity, type DecreasePositionData } from "@/components/liquidity/useDecreaseLiquidity";
import { useBalance } from "wagmi";

// Loading phases for skeleton system
type LoadPhases = { phase: 0 | 1 | 2 | 3 | 4; startedAt: number };
type Readiness = {
  core: boolean;            // positions, balances loaded
  prices: boolean;          // price map available
  apr: boolean;             // APR calculations done
  buckets: Record<string, boolean>; // per-pool bucket readiness
};

// Multi-phase skeleton loading orchestration hook
function useLoadPhases(readiness: Readiness) {
  const [phases, setPhases] = useState<LoadPhases>({ phase: 0, startedAt: Date.now() });
  const [showSkeletonFor, setShowSkeletonFor] = useState({
    header: true,
    table: true,
    charts: true,
    actions: true,
  });

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - phases.startedAt;
    const minShowTime = 350; // minimum skeleton visibility time
    const initialDelay = 100; // initial delay to avoid flicker
    
    // Determine target phase based on readiness
    let targetPhase: 0 | 1 | 2 | 3 | 4 = 0;
    if (readiness.core && readiness.prices) {
      targetPhase = 2; // core data ready
    }
    if (readiness.core && readiness.prices && readiness.apr) {
      targetPhase = 3; // APR ready
    }
    if (readiness.core && readiness.prices && readiness.apr && Object.values(readiness.buckets).every(Boolean)) {
      targetPhase = 4; // everything ready
    }
    if (readiness.core || readiness.prices) {
      targetPhase = Math.max(targetPhase, 1) as 0 | 1 | 2 | 3 | 4; // at least show layout
    }

    // Only advance phases, never regress
    if (targetPhase > phases.phase) {
      setPhases({ phase: targetPhase, startedAt: phases.startedAt });
    }

    // Control skeleton visibility with staggered timing for smooth transitions
    if (elapsed >= minShowTime && targetPhase >= 3) {
      setShowSkeletonFor({
        header: false,
        table: targetPhase < 3,
        charts: targetPhase < 4,
        actions: false,
      });
    } else if (elapsed >= initialDelay) { // initial delay to avoid flicker
      setShowSkeletonFor({
        header: targetPhase < 2,
        table: targetPhase < 3,
        charts: targetPhase < 4,
        actions: targetPhase < 2,
      });
    }
  }, [readiness, phases.phase, phases.startedAt]);

  return { phase: phases.phase, showSkeletonFor };
}

// Skeleton primitives
const SkeletonBlock = ({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`bg-muted/60 rounded animate-pulse ${className}`} {...props} />
);

const SkeletonPill = ({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`bg-muted/60 rounded-md animate-pulse h-6 w-16 ${className}`} {...props} />
);

const SkeletonLine = ({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`bg-muted/60 rounded animate-pulse h-4 w-20 ${className}`} {...props} />
);

const SkeletonDot = ({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`inline-block h-3 w-3 bg-muted/60 rounded-full animate-pulse ${className}`} {...props} />
);

const SkeletonIcon = ({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`w-7 h-7 rounded-full bg-muted/30 border border-sidebar-border ${className}`} {...props} />
);

// Token pair logo skeleton (single circle, matching bar style)
const TokenPairLogoSkeleton = ({ size = 28, offset = 16, className = "" }: { size?: number; offset?: number; className?: string }) => {
  return (
    <div className={`rounded-full bg-muted/60 animate-pulse ${className}`} style={{ width: `${size}px`, height: `${size}px` }} />
  );
};

// Portfolio header skeleton (left-aligned on mobile; square vis on small)
const PortfolioHeaderSkeleton = ({ isVerySmallScreen = false, viewportWidth = 1440, isHiddenVis = false, isCompactVis = false, inlineAvailableWidth = 0 }: { isVerySmallScreen?: boolean; viewportWidth?: number; isHiddenVis?: boolean; isCompactVis?: boolean; inlineAvailableWidth?: number }) => {
  const visWidthPx = (() => {
    if (isVerySmallScreen || isHiddenVis) return 20; // chevron-only
    if (isCompactVis) return Math.max(80, Math.min(420, Math.round(viewportWidth * 0.25)));
    // Inline: match measured available width next to NET APY
    return Math.max(80, inlineAvailableWidth || Math.min(560, Math.round(viewportWidth * 0.32)));
  })();
  const visHeightPx = isVerySmallScreen ? 32 : 40; // match value skeleton heights (h-8 / h-10)
  return (
    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-6">
      <div
        className="grid items-start"
        style={{
          gridTemplateColumns: isVerySmallScreen 
            ? "minmax(100px, max-content) minmax(100px, max-content) 1fr"
            : "minmax(200px, max-content) minmax(200px, max-content) 1fr",
          gridTemplateRows: "auto auto",
          columnGap: "4rem",
        }}
      >
        {/* Row 1: Headers */}
        <div className="col-[1] row-[1]">
          <div className="flex sm:block justify-start">
            <SkeletonLine className="h-3 w-20" />
          </div>
        </div>
        <div className="col-[2] row-[1]">
          <div className="flex sm:block justify-start">
            <SkeletonLine className="h-3 w-16" />
          </div>
        </div>
        
        {/* Row 2: Values (consistent vertical alignment) */}
        <div className="col-[1] row-[2] pt-1.5 sm:pt-2">
          <div className="flex items-center justify-start">
            <SkeletonBlock className={`${isVerySmallScreen ? 'h-8 w-32' : 'h-10 w-40'}`} />
          </div>
        </div>
        <div className="col-[2] row-[2] pt-1.5 sm:pt-2">
          <div className="flex items-center justify-start">
            <SkeletonBlock className={`${isVerySmallScreen ? 'h-8 w-32' : 'h-10 w-40'}`} />
          </div>
        </div>
        
        {/* Row 2, Col 3: Visualization placeholder (match real width, center vertically) */}
        <div className="col-[3] row-[1/3] flex items-center justify-end self-center">
          <SkeletonBlock style={{ width: (isVerySmallScreen || isHiddenVis) ? visHeightPx : visWidthPx, height: visHeightPx }} />
        </div>
      </div>
    </div>
  );
};

// Positions table skeleton
const PositionsTableSkeleton = ({ isMobile = false }: { isMobile?: boolean }) => {
  if (isMobile) {
    return (
      <div className="flex flex-col gap-3">
        {[...Array(3)].map((_, idx) => (
          <div key={idx} className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-3">
            <div className="flex items-center gap-3 min-w-0">
              <TokenPairLogoSkeleton size={24} offset={14} />
              <div className="flex-1 space-y-2 min-w-0">
                <SkeletonLine className="h-4 w-24 sm:w-32" />
                <SkeletonLine className="h-3 w-32 sm:w-40" />
              </div>
              <div className="text-right space-y-1">
                <SkeletonLine className="h-4 w-16" />
                <SkeletonLine className="h-3 w-12" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full" style={{ tableLayout: 'fixed' }}>
        <thead className="border-b border-sidebar-border/60 text-xs text-muted-foreground">
          <tr>
            <th className="px-2 pl-6 py-3 text-left tracking-wider font-mono font-bold">POOL</th>
            <th className="pl-6 pr-2 py-3 text-left min-w-0 tracking-wider font-mono font-bold">AMOUNTS</th>
            <th className="pl-6 pr-2 py-3 text-left min-w-0 tracking-wider font-mono font-bold">APR</th>
            <th className="pl-6 pr-2 py-3 text-left min-w-0 tracking-wider font-mono font-bold">RANGE</th>
            <th className="py-3 pr-3 text-right tracking-wider font-mono font-bold">VALUE</th>
            <th className="py-3 pr-2 text-right w-[44px] sticky right-0 z-10 bg-background"></th>
          </tr>
        </thead>
        <tbody>
          {[...Array(4)].map((_, idx) => (
            <tr key={idx} className="border-b border-sidebar-border/60 last:border-b-0">
              <td className="py-4 px-2 pl-6 align-middle">
                <div className="flex items-center gap-2 min-w-0">
                  <TokenPairLogoSkeleton />
                  <SkeletonLine className="h-4 w-20 sm:w-28" />
                </div>
              </td>
              <td className="py-4 px-2">
                <SkeletonLine className="h-3 w-24 sm:w-32" />
              </td>
              <td className="py-4 px-2">
                <SkeletonLine className="h-3 w-16 sm:w-20" />
              </td>
              <td className="py-4 px-2">
                <div className="h-8 overflow-hidden flex items-center">
                  <TickRangePortfolio
                    tickLower={0}
                    tickUpper={100}
                    currentTick={50}
                    tickSpacing={1}
                    bare
                    bucketData={[]}
                    isLoading
                  />
                </div>
              </td>
              <td className="py-4 px-2 text-right">
                <SkeletonLine className="h-4 w-16 sm:w-20 ml-auto" />
              </td>
              <td className="py-4 px-2"></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Deprecated: RangeChartSkeleton no longer used (replaced by TickRangePortfolio loading state)
const RangeChartSkeleton = ({ className = "" }: { className?: string }) => null;

// Token balance cards skeleton
const TokenBalancesSkeleton = ({ isMobile = false }: { isMobile?: boolean }) => (
  <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3'}`}>
    {[...Array(isMobile ? 3 : 6)].map((_, idx) => (
      <div key={idx} className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-7 h-7 rounded-full bg-muted/60 animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-2 min-w-0">
            <SkeletonLine className="h-3 w-24 sm:w-28" />
            <SkeletonLine className="h-4 w-28 sm:w-32" />
            <SkeletonLine className="h-3 w-20 sm:w-24" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

// Balances list skeleton (matches integrated balances list layout)
const BalancesListSkeleton = () => (
  <div className="flex flex-col divide-y divide-sidebar-border/60">
    {[...Array(6)].map((_, idx) => (
      <div key={idx} className="flex items-center justify-between h-[64px] pl-6 pr-6">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-full bg-muted/60 animate-pulse flex-shrink-0" />
          <div className="flex flex-col min-w-0 gap-1">
            <SkeletonLine className="h-3 w-16" />
            <SkeletonLine className="h-3 w-24 opacity-80" />
          </div>
        </div>
        <div className="flex flex-col items-end whitespace-nowrap pl-2 gap-1">
          <SkeletonLine className="h-4 w-20" />
          <SkeletonLine className="h-3 w-14 opacity-80" />
        </div>
      </div>
    ))}
  </div>
);

// Context for portfolio token filter, so inner components can toggle it
const PortfolioFilterContext = React.createContext<{
  activeTokenFilter: string | null;
  setActiveTokenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  isStickyHover: boolean;
  setIsStickyHover: React.Dispatch<React.SetStateAction<boolean>>;
  hoverTokenLabel?: string | null;
}>({
  activeTokenFilter: null,
  setActiveTokenFilter: (() => {}) as React.Dispatch<React.SetStateAction<string | null>>,
  isStickyHover: false,
  setIsStickyHover: (() => {}) as React.Dispatch<React.SetStateAction<boolean>>,
  hoverTokenLabel: null,
});


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
  if (!isFinite(num)) return "$0,00";
  const abs = Math.abs(num);
  const opts = abs >= 100_000
    ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return `$${num.toLocaleString('de-DE', opts as Intl.NumberFormatOptions)}`;
}

// For the PORTFOLIO header only: show no decimals at >= $1,000,000
function formatUSDHeader(num: number) {
  if (!isFinite(num)) return "$0";
  const abs = Math.abs(num);
  const opts = abs >= 100_000
    ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return `$${num.toLocaleString('de-DE', opts as Intl.NumberFormatOptions)}`;
}

// (removed old PortfolioSkeleton)

// Hook to fetch and aggregate portfolio data
function usePortfolioData(refreshKey: number = 0): PortfolioData {
  const { address: accountAddress, isConnected, chainId: currentChainId } = useAccount();
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
          positions.forEach((position: any) => {
            const t0 = position.token0?.symbol;
            const a0 = parseFloat(position.token0?.amount || '0');
            if (t0 && a0 > 0) tokenBalanceMap.set(t0, (tokenBalanceMap.get(t0) || 0) + a0);
            const t1 = position.token1?.symbol;
            const a1 = parseFloat(position.token1?.amount || '0');
            if (t1 && a1 > 0) tokenBalanceMap.set(t1, (tokenBalanceMap.get(t1) || 0) + a1);
          });
        }
        

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
  }, [isConnected, accountAddress, refreshKey]);

  return portfolioData;
}

export default function PortfolioPage() {
  const router = useRouter();
  const [positionsRefresh, setPositionsRefresh] = useState(0);
  const portfolioData = usePortfolioData(positionsRefresh);
  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const netApyRef = useRef<HTMLDivElement>(null);
  const [inlineLeftOffset, setInlineLeftOffset] = useState<number>(0);
  const [inlineAvailableWidth, setInlineAvailableWidth] = useState<number>(0);
  const [isCompactVis, setIsCompactVis] = useState<boolean>(false);
  const [isHiddenVis, setIsHiddenVis] = useState<boolean>(false);
  const [isMobileVisOpen, setIsMobileVisOpen] = useState<boolean>(false);
  const [collapseMaxHeight, setCollapseMaxHeight] = useState<number>(0);
  const [isVerySmallScreen, setIsVerySmallScreen] = useState<boolean>(false);
  const [isMobileVisReady, setIsMobileVisReady] = useState<boolean>(false);
  const blockVisContainerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(typeof window !== 'undefined' ? window.innerWidth : 1440);
  useLayoutEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    if (typeof window !== 'undefined') {
      // set immediately before first paint to avoid layout flicker
      setViewportWidth(window.innerWidth);
      window.addEventListener('resize', onResize);
    }
    return () => {
      if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
    };
  }, []);
  const poolConfigBySubgraphId = useMemo(() => {
    try {
      const map = new Map<string, any>();
      (poolsConfig?.pools || []).forEach((p: any) => map.set(String(p.subgraphId || '').toLowerCase(), p));
      return map;
    } catch {
      return new Map<string, any>();
    }
  }, []);

  // Dynamic layout helpers
  const getColumnGapPx = useCallback((vw: number) => {
    // Mobile: match pool page spacing (~mt-6 = 24px)
    if (vw <= 768) return 24;
    // Desktop/tablet: prior behavior
    if (vw >= 1280) return 16; // gap-4 baseline
    if (vw >= 1100) return 14;
    return 12; // small gap as window shrinks
  }, []);

  const getBalancesWidthPx = useCallback((vw: number) => {
    // Clamp balances panel between 320–520px, scale around ~28% of viewport
    const ideal = Math.round(vw * 0.28);
    return Math.max(320, Math.min(520, ideal));
  }, []);

  // Table-responsive flags and column widths
  const isStackThreshold = viewportWidth <= 1800; // stack amounts & remove dot
  const isIconOnlyRangeThreshold = viewportWidth <= 1500; // replace range chart with icons
  const colWidths = useMemo(() => {
    if (viewportWidth <= 1500) {
      // user's preferred narrow layout
      return { pool: 26, amounts: 22, apr: 14, range: 22, value: 10 };
    }
    if (viewportWidth <= 1800) {
      // start stacking amounts at 1800, keep columns similar to narrow to avoid crowding
      return { pool: 26, amounts: 22, apr: 14, range: 22, value: 10 };
    }
    return { pool: 22, amounts: 22, apr: 12, range: 17, value: 27 };
  }, [viewportWidth]);
  
  // NEW: local state for positions and activity
  const { address: accountAddress, isConnected, chainId: currentChainId } = useAccount();
  const { writeContract } = useWriteContract();
  const faucetAbi = parseAbi(['function faucet() external']);
  const [faucetHash, setFaucetHash] = useState<`0x${string}` | undefined>(undefined);
  const { isLoading: isFaucetConfirming, isSuccess: isFaucetConfirmed } = useWaitForTransactionReceipt({ hash: faucetHash });
  // -1 means unknown (prevents showing active state before cache check like sidebar)
  const [faucetLastClaimTs, setFaucetLastClaimTs] = useState<number>(-1);
  const [isFaucetBusy, setIsFaucetBusy] = useState<boolean>(false);
  const { data: faucetLastCalledOnchain, isLoading: isLoadingFaucetOnchain, refetch: refetchFaucetOnchain } = useReadContract({
    address: FAUCET_CONTRACT_ADDRESS,
    abi: faucetContractAbi,
    functionName: 'lastCalled',
    args: [accountAddress!],
    chainId: baseSepolia.id,
    query: {
      enabled: isConnected && currentChainId === baseSepolia.id && !!accountAddress,
    },
  });

  // When confirmed, mirror sidebar behavior: update local cache and button state immediately
  useEffect(() => {
    if (!isFaucetConfirmed || !accountAddress) return;
    try {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem(`faucetLastClaimTimestamp_${accountAddress}`, String(now));
      // Signal sidebar listeners to update unread badge
      localStorage.setItem(`faucetClaimLastSeenAt_${accountAddress}`, String(now));
      setFaucetLastClaimTs(now);
      setIsFaucetBusy(false);
    } catch {}
  }, [isFaucetConfirmed, accountAddress]);

  // Sync cached faucet last-claim timestamp like sidebar does
  useEffect(() => {
    if (!accountAddress) {
      setFaucetLastClaimTs(-1);
      return;
    }
    // Prefer onchain if available
    if (faucetLastCalledOnchain !== undefined && faucetLastCalledOnchain !== null) {
      const n = Number(faucetLastCalledOnchain);
      if (Number.isFinite(n) && n > 0) {
        setFaucetLastClaimTs(n);
      }
    }
    try {
      const cached = localStorage.getItem(`faucetLastClaimTimestamp_${accountAddress}`);
      setFaucetLastClaimTs(cached ? Number(cached) : 0);
    } catch {
      setFaucetLastClaimTs(0);
    }
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === `faucetLastClaimTimestamp_${accountAddress}`) {
        const next = Number(localStorage.getItem(`faucetLastClaimTimestamp_${accountAddress}`) || '0');
        setFaucetLastClaimTs(Number.isFinite(next) ? next : 0);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [accountAddress, faucetLastCalledOnchain]);
  const allowedPoolIds = useMemo(() => {
    try {
      return new Set((poolsConfig?.pools || []).map((p: any) => String(p.subgraphId || "").toLowerCase()));
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
  
  const ACTIVITY_PAGE_SIZE = 10;
  const [activityPage, setActivityPage] = useState<number>(0);
  
  // Apply the same token filter to Activity items (Swaps & Liquidity)
  useEffect(() => { setActivityPage(0); }, [activityItems.length]);

  const totalActivityPages = Math.max(1, Math.ceil((activityItems.length || 0) / ACTIVITY_PAGE_SIZE));
  const pagedActivityItems = useMemo(() => {
    const start = activityPage * ACTIVITY_PAGE_SIZE;
    return activityItems.slice(start, start + ACTIVITY_PAGE_SIZE);
  }, [activityItems, activityPage]);
  
  // NEW: selector state for switching between sections
  const [selectedSection, setSelectedSection] = useState<string>('Active Positions');
  const isMobile = viewportWidth <= 768;
  const isIntegrateBalances = viewportWidth < 1400 && !isMobile;
  const sectionsList = useMemo(() => {
    const base = ['Active Positions', 'Activity'];
    return isIntegrateBalances ? [...base, 'Balances'] : base;
  }, [isIntegrateBalances]);
  useEffect(() => {
    if (!isIntegrateBalances && selectedSection === 'Balances') {
      setSelectedSection('Active Positions');
    }
  }, [isIntegrateBalances, selectedSection]);

  // Modals: Add Liquidity / Withdraw (Decrease)
  const [showIncreaseModal, setShowIncreaseModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [positionToModify, setPositionToModify] = useState<any | null>(null);
  const [positionToWithdraw, setPositionToWithdraw] = useState<any | null>(null);
  // Inputs
  const [increaseAmount0, setIncreaseAmount0] = useState<string>("");
  const [increaseAmount1, setIncreaseAmount1] = useState<string>("");
  const [withdrawAmount0, setWithdrawAmount0] = useState<string>("");
  const [withdrawAmount1, setWithdrawAmount1] = useState<string>("");
  const [isIncreaseCalculating, setIsIncreaseCalculating] = useState(false);
  const [isWithdrawCalculating, setIsWithdrawCalculating] = useState(false);
  const [increaseActiveInputSide, setIncreaseActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [withdrawActiveInputSide, setWithdrawActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [increasePercentage, setIncreasePercentage] = useState<number>(0);
  const [isIncreaseAmountValid, setIsIncreaseAmountValid] = useState(true);
  const [withdrawPercentage, setWithdrawPercentage] = useState<number>(0);
  const [isFullWithdraw, setIsFullWithdraw] = useState(false);

  // Helpers
  const formatTokenDisplayAmount = (amount: string) => {
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    if (num === 0) return "0.00";
    if (num > 0 && num < 0.0001) return "< 0.0001";
    return num.toFixed(4);
  };

  const getTokenIconSrc = (symbol?: string) => {
    if (!symbol) return '/placeholder-logo.svg';
    return getTokenCfg(symbol)?.icon || '/placeholder-logo.svg';
  };

  // Balances for add-liquidity modal
  const token0SymForBalance = (positionToModify?.token0?.symbol || '') as TokenSymbol;
  const token1SymForBalance = (positionToModify?.token1?.symbol || '') as TokenSymbol;
  const addr0ForBalance = TOKEN_DEFINITIONS[token0SymForBalance]?.address as `0x${string}` | undefined;
  const addr1ForBalance = TOKEN_DEFINITIONS[token1SymForBalance]?.address as `0x${string}` | undefined;
  const { data: token0BalanceData } = useBalance({
    address: accountAddress,
    token: addr0ForBalance && addr0ForBalance !== '0x0000000000000000000000000000000000000000' ? addr0ForBalance : undefined,
    chainId: currentChainId,
    query: { enabled: !!accountAddress && !!currentChainId && !!addr0ForBalance },
  });
  const { data: token1BalanceData } = useBalance({
    address: accountAddress,
    token: addr1ForBalance && addr1ForBalance !== '0x0000000000000000000000000000000000000000' ? addr1ForBalance : undefined,
    chainId: currentChainId,
    query: { enabled: !!accountAddress && !!currentChainId && !!addr1ForBalance },
  });

  const displayToken0Balance = token0BalanceData?.formatted ? formatTokenDisplayAmount(token0BalanceData.formatted) : '~';
  const displayToken1Balance = token1BalanceData?.formatted ? formatTokenDisplayAmount(token1BalanceData.formatted) : '~';

  // Liquidity hooks
  const onLiquidityIncreased = useCallback(() => {
    toast.success('Position increased successfully!');
    setPositionsRefresh((k) => k + 1);
  }, []);
  const onLiquidityDecreased = useCallback(() => {
    toast.success('Position modified successfully!');
    setPositionsRefresh((k) => k + 1);
  }, []);
  const { increaseLiquidity, isLoading: isIncreasingLiquidity } = useIncreaseLiquidity({ onLiquidityIncreased });
  const { decreaseLiquidity, isLoading: isDecreasingLiquidity } = useDecreaseLiquidity({ onLiquidityDecreased });

  // Sticky slider stops helper (copied behavior)
  const snapToStickyStops = (value: number): number => {
    const stickyStops = [25, 50, 75, 100];
    const snapZone = 3;
    for (const stop of stickyStops) {
      if (Math.abs(value - stop) <= snapZone) return stop;
    }
    return value;
  };

  // Increase slider % and amount sync
  const handleIncreasePercentageChange = (newPercentage: number) => {
    const snapped = snapToStickyStops(newPercentage);
    setIncreasePercentage(snapped);
    if (positionToModify) {
      const balance0 = parseFloat(token0BalanceData?.formatted || '0');
      const percentage = snapped / 100;
      const displayDecimals0 = TOKEN_DEFINITIONS[positionToModify.token0.symbol as TokenSymbol]?.displayDecimals ?? 4;
      const calculatedAmount0 = (balance0 * percentage).toFixed(displayDecimals0);
      setIncreaseAmount0(calculatedAmount0);
      setIncreaseActiveInputSide('amount0');
      if (parseFloat(calculatedAmount0) > 0) calculateIncreaseAmount(calculatedAmount0, 'amount0', positionToModify); else setIncreaseAmount1('');
    }
  };

  const handleIncreaseAmountChange = (newAmount: string, tokenSide: 'amount0' | 'amount1') => {
    if (tokenSide === 'amount0') {
      setIncreaseAmount0(newAmount);
      setIncreaseActiveInputSide('amount0');
    } else {
      setIncreaseAmount1(newAmount);
      setIncreaseActiveInputSide('amount1');
    }
    if (positionToModify && newAmount) {
      const maxAmount = tokenSide === 'amount0' ? parseFloat(token0BalanceData?.formatted || '0') : parseFloat(token1BalanceData?.formatted || '0');
      const currentAmount = parseFloat(newAmount);
      if (maxAmount > 0 && !isNaN(currentAmount)) {
        const percentage = Math.min(100, Math.max(0, (currentAmount / maxAmount) * 100));
        setIncreasePercentage(Math.round(percentage));
        setIsIncreaseAmountValid(currentAmount <= maxAmount);
      } else {
        setIsIncreaseAmountValid(true);
      }
    } else {
      setIsIncreaseAmountValid(true);
    }
  };

  // Withdraw slider % and amount sync
  const handleWithdrawPercentageChange = (newPercentage: number) => {
    const snapped = snapToStickyStops(newPercentage);
    setWithdrawPercentage(snapped);
    if (positionToWithdraw) {
      const amount0 = parseFloat(positionToWithdraw.token0.amount);
      const percentage = snapped / 100;
      const displayDecimals0 = TOKEN_DEFINITIONS[positionToWithdraw.token0.symbol as TokenSymbol]?.displayDecimals ?? 4;
      const calculatedAmount0 = (amount0 * percentage).toFixed(displayDecimals0);
      setWithdrawAmount0(calculatedAmount0);
      setWithdrawActiveInputSide('amount0');
      setIsFullWithdraw(snapped >= 99);
      if (parseFloat(calculatedAmount0) > 0) calculateWithdrawAmount(calculatedAmount0, 'amount0', positionToWithdraw); else setWithdrawAmount1('');
    }
  };

  const handleWithdrawAmountChange = (newAmount: string, tokenSide: 'amount0' | 'amount1') => {
    if (tokenSide === 'amount0') setWithdrawAmount0(newAmount); else setWithdrawAmount1(newAmount);
    if (positionToWithdraw && newAmount) {
      const maxAmount = tokenSide === 'amount0' ? parseFloat(positionToWithdraw.token0.amount) : parseFloat(positionToWithdraw.token1.amount);
      const currentAmount = parseFloat(newAmount);
      if (maxAmount > 0 && !isNaN(currentAmount)) {
        const percentage = Math.min(100, Math.max(0, (currentAmount / maxAmount) * 100));
        setWithdrawPercentage(Math.round(percentage));
        setIsFullWithdraw(percentage >= 99);
      }
    }
  };
  
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
  const [balancesSortDir, setBalancesSortDir] = useState<'asc' | 'desc'>('desc');

  // Activity filter state
  const [activityTokenFilter, setActivityTokenFilter] = useState<string | null>(null);
  const [activityTypeFilter, setActivityTypeFilter] = useState<'all' | 'Swap' | 'Liquidity'>('all');

  // Wallet balances (for Balances UI only; excluded from global portfolio worth)
  const [walletBalances, setWalletBalances] = useState<Array<{ symbol: string; balance: number; usdValue: number; color: string }>>([]);
  const [isLoadingWalletBalances, setIsLoadingWalletBalances] = useState<boolean>(false);
  const [walletPriceMap, setWalletPriceMap] = useState<Record<string, number>>({});
  const [walletPriceChange24hPctMap, setWalletPriceChange24hPctMap] = useState<Record<string, number>>({});

  useEffect(() => {
    const run = async () => {
      if (!isConnected || !accountAddress) {
        setWalletBalances([]);
        setWalletPriceMap({});
        setWalletPriceChange24hPctMap({});
        return;
      }
      setIsLoadingWalletBalances(true);
      try {
        // Collect configured tokens
        const tokenMapOrArray = getAllTokens?.() as any;
        const tokens = Array.isArray(tokenMapOrArray) ? tokenMapOrArray : Object.values(tokenMapOrArray || {});
        // Fetch raw balances
        const balances: Record<string, number> = {};
        for (const t of tokens) {
          const symbol = t?.symbol as string | undefined;
          if (!symbol) continue;
          const addr = (t as any)?.address as `0x${string}` | undefined;
          try {
            let raw: bigint = 0n;
            if (!addr || addr.toLowerCase() === NATIVE_TOKEN_ADDRESS?.toLowerCase?.()) {
              raw = await publicClient.getBalance({ address: accountAddress as `0x${string}` });
            } else {
              // balanceOf(address)
              const bal = await publicClient.readContract({
                address: addr,
                abi: parseAbi(['function balanceOf(address) view returns (uint256)']) as unknown as Abi,
                functionName: 'balanceOf',
                args: [accountAddress as `0x${string}`],
              });
              raw = BigInt(bal as any);
            }
            const dec = (TOKEN_DEFINITIONS as any)?.[symbol]?.decimals ?? 18;
            const asFloat = parseFloat(viemFormatUnits(raw, dec));
            balances[symbol] = asFloat;
          } catch {}
        }

        // Build price map via CoinGecko (same mapping as positions)
        const coinGeckoIds: Record<string, string> = {
          aETH: 'ethereum',
          ETH: 'ethereum',
          aBTC: 'bitcoin',
          aUSDC: 'usd-coin',
          aUSDT: 'tether',
        };
        const symbols = Object.keys(balances);
        const priceMap = new Map<string, number>();
        const uniqueCoinIds = [...new Set(symbols.map(s => coinGeckoIds[s]).filter(Boolean))];
        let priceData: any = {};
        if (uniqueCoinIds.length > 0) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
            
            const priceRes = await fetch(
              `https://api.coingecko.com/api/v3/simple/price?ids=${uniqueCoinIds.join(',')}&vs_currencies=usd&include_24hr_change=true`,
              {
                method: 'GET',
                headers: {
                  'Accept': 'application/json',
                },
                signal: controller.signal,
              }
            );
            
            clearTimeout(timeoutId);
            
            if (priceRes.ok) {
              priceData = await priceRes.json();
            } else {
              console.warn('CoinGecko API error:', priceRes.status, priceRes.statusText);
            }
          } catch (error) {
            console.warn('Failed to fetch prices from CoinGecko:', error);
          }
        }
        const priceChangeMap: Record<string, number> = {};
        symbols.forEach((symbol) => {
          const coinId = coinGeckoIds[symbol];
          const px = coinId && priceData[coinId]?.usd;
          if (px) priceMap.set(symbol, px);
          else if (symbol.includes('USDC') || symbol.includes('USDT')) priceMap.set(symbol, 1.0);
          const ch = coinId ? priceData[coinId]?.usd_24h_change : undefined;
          if (typeof ch === 'number' && isFinite(ch)) priceChangeMap[symbol] = ch;
        });

        // Construct balances array (filter out zeros), assign colors
        const entries = symbols
          .map((symbol) => ({
            symbol,
            balance: balances[symbol] || 0,
            usdValue: (balances[symbol] || 0) * (priceMap.get(symbol) || 0),
            color: '',
          }))
          .filter((x) => x.usdValue > 0.01)
          .sort((a, b) => b.usdValue - a.usdValue);
        const colors = [
          'hsl(0 0% 30%)',
          'hsl(0 0% 40%)',
          'hsl(0 0% 60%)',
          'hsl(0 0% 80%)',
          'hsl(0 0% 95%)',
        ];
        entries.forEach((e, i) => { e.color = colors[i % colors.length]; });

        setWalletBalances(entries);
        setWalletPriceMap(Object.fromEntries(priceMap.entries()));
        setWalletPriceChange24hPctMap(priceChangeMap);
      } finally {
        setIsLoadingWalletBalances(false);
      }
    };
    run();
    // Listen for global balance refresh triggers (from faucet claim)
    const onRefresh = () => {
      // Re-run balances fetch immediately
      run();
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !accountAddress) return;
      if (e.key === `walletBalancesRefreshAt_${accountAddress}`) run();
    };
    window.addEventListener('walletBalancesRefresh', onRefresh as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('walletBalancesRefresh', onRefresh as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [isConnected, accountAddress, currentChainId]);

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
          newExpanded[poolKey] = false;
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
    if (state === 'asc') return <ChevronUpIcon className="ml-1 h-4 w-4 text-muted-foreground group-hover:text-foreground" />;
    if (state === 'desc') return <ChevronDownIcon className="ml-1 h-4 w-4 text-muted-foreground group-hover:text-foreground" />;
    return <ChevronsUpDownIcon className="ml-1 h-4 w-4 text-muted-foreground group-hover:text-foreground" />;
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

  // Apply filters to Activity items (Swaps & Liquidity)
  const filteredActivityItems = useMemo(() => {
    let filtered = activityItems;

    // Apply token filter (from portfolio visualization)
    if (activeTokenFilter) {
      const token = activeTokenFilter.toUpperCase();

      if (token === 'OTHERS') {
        const total = portfolioData.totalValue;
        const topThreeTokens = (portfolioData.tokenBalances || [])
          .map(tb => ({ symbol: tb.symbol, pct: total > 0 ? (tb.usdValue / total) * 100 : 0 }))
          .filter(item => item.pct >= 1)
          .sort((a, b) => b.pct - a.pct)
          .slice(0, 3)
          .map(tb => (tb.symbol || '').toUpperCase());

        filtered = filtered.filter((it: any) => {
          const [sym0Raw, sym1Raw] = String(it?.poolSymbols || '').split('/');
          const sym0 = sym0Raw?.trim()?.toUpperCase?.();
          const sym1 = sym1Raw?.trim()?.toUpperCase?.();
          return (sym0 && !topThreeTokens.includes(sym0)) || (sym1 && !topThreeTokens.includes(sym1));
        });
      } else {
        filtered = filtered.filter((it: any) => {
          const [sym0Raw, sym1Raw] = String(it?.poolSymbols || '').split('/');
          const sym0 = sym0Raw?.trim()?.toUpperCase?.();
          const sym1 = sym1Raw?.trim()?.toUpperCase?.();
          return sym0 === token || sym1 === token;
        });
      }
    }

    // Apply Activity-specific token filter
    if (activityTokenFilter) {
      const token = activityTokenFilter.toUpperCase();
      filtered = filtered.filter((it: any) => {
        const [sym0Raw, sym1Raw] = String(it?.poolSymbols || '').split('/');
        const sym0 = sym0Raw?.trim()?.toUpperCase?.();
        const sym1 = sym1Raw?.trim()?.toUpperCase?.();
        return sym0 === token || sym1 === token;
      });
    }

    // Apply type filter
    if (activityTypeFilter !== 'all') {
      if (activityTypeFilter === 'Liquidity') {
        filtered = filtered.filter((it: any) => it.type === 'Add' || it.type === 'Withdraw');
      } else {
        filtered = filtered.filter((it: any) => it.type === activityTypeFilter);
      }
    }

    return filtered;
  }, [activityItems, activeTokenFilter, activityTokenFilter, activityTypeFilter, portfolioData.tokenBalances, portfolioData.totalValue]);

  // Reset activity pagination on filter change
  useEffect(() => { setActivityPage(0); }, [filteredActivityItems.length]);

  const filteredTotalActivityPages = Math.max(1, Math.ceil((filteredActivityItems.length || 0) / ACTIVITY_PAGE_SIZE));
  const pagedFilteredActivityItems = useMemo(() => {
    const start = activityPage * ACTIVITY_PAGE_SIZE;
    return filteredActivityItems.slice(start, start + ACTIVITY_PAGE_SIZE);
  }, [filteredActivityItems, activityPage]);

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

  // Wire up menu actions
  const openAddLiquidity = useCallback((pos: any) => {
    setPositionToModify(pos);
    setIncreaseAmount0("");
    setIncreaseAmount1("");
    setIncreaseActiveInputSide(null);
    setShowIncreaseModal(true);
  }, []);
  const openWithdraw = useCallback((pos: any) => {
    setPositionToWithdraw(pos);
    setWithdrawAmount0("");
    setWithdrawAmount1("");
    setWithdrawActiveInputSide(null);
    setShowWithdrawModal(true);
  }, []);

  // Debounce helper
  const debounce = (func: Function, waitFor: number) => {
    let timeout: ReturnType<typeof setTimeout>;
    return (...args: any[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), waitFor);
    };
  };

  // Calculate other side for increase
  const calculateIncreaseAmount = useCallback(
    debounce(async (inputAmount: string, inputSide: 'amount0' | 'amount1', pos: any) => {
      if (!pos || !inputAmount || parseFloat(inputAmount) <= 0) {
        if (inputSide === 'amount0') setIncreaseAmount1("");
        else setIncreaseAmount0("");
        return;
      }
      setIsIncreaseCalculating(true);
      try {
        // For out-of-range, single-sided
        if (!pos.isInRange) {
          if (inputSide === 'amount0') setIncreaseAmount1('0'); else setIncreaseAmount0('0');
          setIsIncreaseCalculating(false);
          return;
        }
        const resp = await fetch('/api/liquidity/calculate-liquidity-parameters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token0Symbol: pos.token0.symbol,
            token1Symbol: pos.token1.symbol,
            inputAmount,
            inputTokenSymbol: inputSide === 'amount0' ? pos.token0.symbol : pos.token1.symbol,
            userTickLower: pos.tickLower,
            userTickUpper: pos.tickUpper,
            chainId: currentChainId,
          }),
        });
        if (!resp.ok) throw new Error((await resp.json())?.message || 'Failed to calculate');
        const data = await resp.json();
        if (inputSide === 'amount0') {
          const dec = TOKEN_DEFINITIONS[pos.token1.symbol as TokenSymbol]?.decimals || 18;
          setIncreaseAmount1(formatTokenDisplayAmount(viemFormatUnits(BigInt(data.amount1), dec)));
        } else {
          const dec = TOKEN_DEFINITIONS[pos.token0.symbol as TokenSymbol]?.decimals || 18;
          setIncreaseAmount0(formatTokenDisplayAmount(viemFormatUnits(BigInt(data.amount0), dec)));
        }
      } catch (e: any) {
        toast.error('Calculation Error', { description: e?.message || 'Could not calculate corresponding amount.' });
        if (inputSide === 'amount0') setIncreaseAmount1(""); else setIncreaseAmount0("");
      } finally {
        setIsIncreaseCalculating(false);
      }
    }, 400),
    [currentChainId]
  );

  // Calculate other side for withdraw
  const calculateWithdrawAmount = useCallback(
    debounce(async (inputAmount: string, inputSide: 'amount0' | 'amount1', pos: any) => {
      if (!pos || !inputAmount || parseFloat(inputAmount) <= 0) {
        if (inputSide === 'amount0') setWithdrawAmount1("");
        else setWithdrawAmount0("");
        return;
      }
      setIsWithdrawCalculating(true);
      try {
        if (!pos.isInRange) {
          if (inputSide === 'amount0') setWithdrawAmount1('0'); else setWithdrawAmount0('0');
          setIsWithdrawCalculating(false);
          return;
        }
        const resp = await fetch('/api/liquidity/calculate-liquidity-parameters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token0Symbol: pos.token0.symbol,
            token1Symbol: pos.token1.symbol,
            inputAmount,
            inputTokenSymbol: inputSide === 'amount0' ? pos.token0.symbol : pos.token1.symbol,
            userTickLower: pos.tickLower,
            userTickUpper: pos.tickUpper,
            chainId: currentChainId,
          }),
        });
        if (!resp.ok) throw new Error((await resp.json())?.message || 'Failed to calculate');
        const data = await resp.json();
        if (inputSide === 'amount0') {
          const dec = TOKEN_DEFINITIONS[pos.token1.symbol as TokenSymbol]?.decimals || 18;
          setWithdrawAmount1(formatTokenDisplayAmount(viemFormatUnits(BigInt(data.amount1), dec)));
        } else {
          const dec = TOKEN_DEFINITIONS[pos.token0.symbol as TokenSymbol]?.decimals || 18;
          setWithdrawAmount0(formatTokenDisplayAmount(viemFormatUnits(BigInt(data.amount0), dec)));
        }
      } catch (e: any) {
        toast.error('Calculation Error', { description: e?.message || 'Could not calculate corresponding amount.' });
        if (inputSide === 'amount0') setWithdrawAmount1(""); else setWithdrawAmount0("");
      } finally {
        setIsWithdrawCalculating(false);
      }
    }, 400),
    [currentChainId]
  );

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

  // Skeleton loading orchestration (placed after getCacheKey definition)
  const readiness: Readiness = useMemo(() => {
    const buckets: Record<string, boolean> = {};
    // Build bucket readiness map for all current positions
    activePositions.forEach(position => {
      if (position?.poolId) {
        const tl = position.tickLower;
        const tu = position.tickUpper;
        const cacheKey = getCacheKey(position.poolId, tl, tu);
        buckets[cacheKey] = !loadingBuckets.has(cacheKey);
      }
    });

    return {
      core: !portfolioData.isLoading && activePositions.length >= 0, // core data ready
      prices: Object.keys(portfolioData.priceMap).length > 0, // prices available
      apr: Object.keys(aprByPoolId).length > 0, // APR calculations done
      buckets, // per-position bucket readiness
    };
  }, [portfolioData.isLoading, portfolioData.priceMap, aprByPoolId, activePositions, loadingBuckets, getCacheKey]);

  const { phase, showSkeletonFor } = useLoadPhases(readiness);

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

  // Load activity (best-effort): mints, burns, collects, swaps for owner
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
          query GetUserActivity($owner: String!, $poolIds: [String!], $first: Int!) {
            positionsCreated: hookPositions(
              first: $first,
              orderBy: blockTimestamp,
              orderDirection: desc,
              where: { owner: $owner, pool_in: $poolIds }
            ) {
              id
              pool
              owner
              currency0 { id symbol decimals }
              currency1 { id symbol decimals }
              tickLower
              tickUpper
              liquidity
              blockTimestamp
              blockNumber
              transactionHash
            }
            swapsRecent: swaps(first: $first, orderBy: timestamp, orderDirection: desc, where: { pool_in: $poolIds }) {
              id
              timestamp
              sender
              recipient
              amount0
              amount1
              pool { id currency0 { id symbol decimals } currency1 { id symbol decimals } }
            }
          }
        `;

        const variables = {
          owner: accountAddress?.toLowerCase(),
          poolIds: Array.from(allowedPoolIds),
          first: 300,
        } as const;

        const cacheKey = `activity:${variables.owner}:${variables.first}:${variables.poolIds.join(",")}`;
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached && !isCancelled) {
            const parsed = JSON.parse(cached);
            setActivityItems(parsed.items || []);
          }
        } catch {}

        const res = await fetch(SUBGRAPH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: ACTIVITY_QUERY, variables }),
        });
        const text = await res.text();
        let json: any = null;
        try { json = JSON.parse(text); } catch {}
        if (!res.ok) {
          const message = `HTTP ${res.status} ${res.statusText}`;
          throw new Error(message);
        }
        if (json?.errors?.length) {
          const msg = json.errors.map((e: any) => e.message).join('; ');
          throw new Error(msg);
        }
        if (!json?.data) {
          throw new Error('No data');
        }

        type Row = {
          id?: string;
          type: 'Swap' | 'Add' | 'Withdraw';
          ts: number;
          tx?: string;
          poolId: string;
          poolSymbols: string;
          amount0?: string;
          amount1?: string;
          sender?: string;
          recipient?: string;
          tickLower?: string;
          tickUpper?: string;
          liquidity?: string;
          blockNumber?: number;
          token0Addr?: string;
          token1Addr?: string;
        };

        const mkRow = (type: Row['type'], r: any): Row => {
          const idStr = String(r?.id || '');
          const hashFromId = type === 'Swap' ? (() => {
            const h = idStr.split('-')[0];
            return h && h.startsWith('0x') && h.length === 66 ? h : undefined;
          })() : undefined;
          return {
            id: r?.id,
            type,
            ts: Number(r?.timestamp || r?.blockTimestamp || 0),
            tx: r?.transactionHash || r?.transaction?.id || hashFromId,
            poolId: String((r?.pool?.id ?? r?.pool) || '').toLowerCase(),
            poolSymbols: r?.pool?.currency0?.symbol
              ? `${r?.pool?.currency0?.symbol}/${r?.pool?.currency1?.symbol}`
              : `${r?.currency0?.symbol}/${r?.currency1?.symbol}`,
            amount0: r?.amount0,
            amount1: r?.amount1,
            sender: r?.sender,
            recipient: r?.recipient,
            tickLower: r?.tickLower,
            tickUpper: r?.tickUpper,
            liquidity: r?.liquidity,
            blockNumber: r?.blockNumber ? Number(r.blockNumber) : undefined,
            token0Addr: (r?.currency0?.id || r?.pool?.currency0?.id || '').toLowerCase() || undefined,
            token1Addr: (r?.currency1?.id || r?.pool?.currency1?.id || '').toLowerCase() || undefined,
          };
        };

        const userLc = (accountAddress || '').toLowerCase();
        const swapsRaw = (json.data.swapsRecent || []) as any[];
        // Attribute swaps primarily by tx.from (EOA). Fallback: sender/recipient match.
        const parseTxHash = (id: string | undefined) => {
          if (!id) return undefined;
          const h = String(id).split('-')[0];
          return h && h.startsWith('0x') && h.length === 66 ? (h as `0x${string}`) : undefined;
        };
        const txFromCache: Record<string, string> = (() => {
          try { return JSON.parse(localStorage.getItem('txFromCache') || '{}') || {}; } catch { return {}; }
        })();
        const unknownTxHashes: (`0x${string}`)[] = [];
        for (const r of swapsRaw) {
          const txh = parseTxHash(r?.id);
          if (txh && !txFromCache[txh.toLowerCase()]) unknownTxHashes.push(txh);
          if (unknownTxHashes.length >= 60) break;
        }
        for (const txh of unknownTxHashes) {
          try {
            const tx = await publicClient.getTransaction({ hash: txh });
            if (tx?.from) txFromCache[txh.toLowerCase()] = tx.from.toLowerCase();
          } catch {}
        }
        try { localStorage.setItem('txFromCache', JSON.stringify(txFromCache)); } catch {}
        const swapsFiltered = swapsRaw.filter((r: any) => {
          const senderLc = String(r?.sender || '').toLowerCase();
          const recipientLc = String(r?.recipient || '').toLowerCase();
          const txh = parseTxHash(r?.id);
          const fromLc = txh ? txFromCache[txh.toLowerCase()] : undefined;
          return fromLc === userLc || senderLc === userLc || recipientLc === userLc;
        });

        // Map position creations as Add
        const addRows: Row[] = (json.data.positionsCreated || []).map((r: any) => mkRow('Add', r));

        const rows: Row[] = [
          ...addRows,
          ...swapsFiltered.map((r: any) => mkRow('Swap', r)),
        ]
        .filter((r) => allowedPoolIds.has(r.poolId))
        .sort((a, b) => b.ts - a.ts);

        const deduped = (() => {
          const seen = new Set<string>();
          const out: Row[] = [];
          for (const r of rows) {
            const k = `${r.type}:${r.tx || r.ts}:${r.poolId}:${r.amount0}:${r.amount1}`;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(r);
          }
          return out.slice(0, 50);
        })();

        // Enrich Liquidity rows with simplified direct Transfer log matching
        const enrichLiquidityRows = async (rowsIn: Row[]): Promise<Row[]> => {
          const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
          const userLower = String(accountAddress || '').toLowerCase();
          const out: Row[] = [];
          for (const row of rowsIn) {
            if (row.type !== 'Add' && row.type !== 'Withdraw') { out.push(row); continue; }
            if (!row.tx) { out.push(row); continue; }
            
            try {
              const receipt = await publicClient.getTransactionReceipt({ hash: row.tx as `0x${string}` });
              
              let amount0 = '';
              let amount1 = '';
              for (const log of receipt?.logs || []) {
                if (!log || !log.topics || log.topics[0] !== transferTopic) continue;
                const logAddress = (log as any).address?.toLowerCase();
                const topicsArr = (log as any).topics as string[] | undefined;
                const fromRaw = topicsArr && topicsArr.length > 1 ? topicsArr[1] : undefined;
                const toRaw = topicsArr && topicsArr.length > 2 ? topicsArr[2] : undefined;
                const valueRaw = (log as any).data as string | undefined;
                if (!fromRaw || !toRaw || !valueRaw || valueRaw === '0x') continue;
                const from = `0x${fromRaw.slice(26)}`.toLowerCase();
                const to = `0x${toRaw.slice(26)}`.toLowerCase();
                let val: bigint;
                try { val = BigInt(valueRaw); } catch { continue; }
                
                // Match against user -> anyone for outgoing amounts
                if (from === userLower) {
                  if (row.token0Addr && logAddress === row.token0Addr.toLowerCase()) {
                    amount0 = val.toString();
                    
                  } else if (row.token1Addr && logAddress === row.token1Addr.toLowerCase()) {
                    amount1 = val.toString();
                    
                  }
                }
              }
              const next: Row = { ...row };
              if (amount0) next.amount0 = amount0;
              if (amount1) next.amount1 = amount1;
              
              out.push(next);
            } catch (e) {
              
              out.push(row);
            }
          }
          return out;
        };

        const enriched = await enrichLiquidityRows(deduped);
        if (!isCancelled) setActivityItems(enriched);
        try { localStorage.setItem(cacheKey, JSON.stringify({ items: enriched, ts: Date.now() })); } catch {}
      } catch (e: any) {
        if (!isCancelled) setActivityError(e?.message || 'Failed to load activity');
      } finally {
        if (!isCancelled) setIsLoadingActivity(false);
      }
    };
    fetchActivity();
    return () => { isCancelled = true; };
  }, [isConnected, accountAddress, allowedPoolIds]);

  // Set initial responsive states before paint to avoid layout flicker
  useLayoutEffect(() => {
    const setInitialStates = () => {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      setIsCompactVis(viewportWidth <= 1400);
      setIsHiddenVis(viewportWidth <= 1100);
      setIsVerySmallScreen(viewportWidth < 695);
    };
    
    setInitialStates();
  }, []);

  // Wide composition - always group into Rest if there are more than 4 assets overall (even if some are <1%)
  const wideComposition = useMemo(() => {
    const total = portfolioData.totalValue;
    const allItems = portfolioData.tokenBalances
      .map(token => ({
        label: token.symbol,
        pct: total > 0 ? (token.usdValue / total) * 100 : 0,
        color: token.color,
      }))
      .sort((a, b) => b.pct - a.pct);

    if (allItems.length > 4) {
      const topThree = allItems.slice(0, 3);
      const rest = allItems.slice(3);
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
    // If 4 or fewer, show them; keep tiny ones but they may have hidden names
    return allItems;
  }, [portfolioData.tokenBalances, portfolioData.totalValue]);

  // Compact composition - aggregate items beyond first 3 into Rest if more than 4 total (same counting as wide)
  const compactComposition = useMemo(() => {
    const total = portfolioData.totalValue;
    const tokenItems = portfolioData.tokenBalances
      .map(token => ({
        label: token.symbol,
        pct: total > 0 ? (token.usdValue / total) * 100 : 0,
        color: token.color,
      }))
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
  useLayoutEffect(() => {
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
      const available = Math.max(0, Math.round(containerRect.width - leftOffset));
      setInlineAvailableWidth(available);
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
  useLayoutEffect(() => {
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

  // (removed skeleton early-return gate)


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

  // Show skeleton during loading, empty state only after data is loaded
  if (showSkeletonFor.header || showSkeletonFor.table) {
    return (
      <AppLayout>
        <div className="flex flex-1 flex-col p-3 sm:p-6 sm:px-10">
          <PortfolioHeaderSkeleton 
            isVerySmallScreen={isVerySmallScreen}
            viewportWidth={viewportWidth}
            isHiddenVis={isHiddenVis}
            isCompactVis={isCompactVis}
            inlineAvailableWidth={inlineAvailableWidth}
          />
          
          <div className="mt-6 flex flex-col lg:flex-row" style={{ gap: `${getColumnGapPx(viewportWidth)}px` }}>
            <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 justify-between">
              {sectionsList.map((section) => (
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
                                        <div className="ml-auto flex items-center gap-2">
              {activeTokenFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTokenFilter(null);
                    setIsStickyHover(false);
                    setIsRestCycling(false);
                  }}
                  className="group flex items-center gap-1 px-2 py-1 rounded-md border border-sidebar-border/60 bg-muted/40 text-xs text-muted-foreground hover:bg-muted/50 relative"
                >
                  {isRestCycling && (
                    <div 
                      className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md"
                      style={{ backgroundColor: 'hsl(var(--sidebar-primary))' }}
                    />
                  )}
                  <X className="h-3 w-3 text-muted-foreground transition-colors group-hover:text-foreground" />
                  <span className="uppercase tracking-wider text-muted-foreground font-mono font-bold text-xs">{activeTokenFilter}</span>
                </button>
              )}
              
              {/* Activity Filter Dropdown */}
              {selectedSection === 'Activity' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 px-3 py-1 rounded-md border border-sidebar-border/60 bg-[var(--sidebar-connect-button-bg)] text-xs text-muted-foreground hover:bg-muted/50 transition-colors">
                      <Menu className="h-3 w-3" />
                      <span className="font-medium">Filter</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={4} className="border border-sidebar-border min-w-[300px]" style={{ backgroundColor: '#0f0f0f' }}>
                    <div className="grid grid-cols-2 gap-0">
                      {/* Left Column: Type Filter */}
                      <div className="px-3 py-2 border-r border-sidebar-border/60">
                        <div className="text-xs font-medium text-muted-foreground mb-2">Type</div>
                        <div className="space-y-1">
                          {(['all', 'Swap', 'Liquidity'] as const).map((type) => (
                            <button
                              key={type}
                              onClick={() => setActivityTypeFilter(type)}
                              className={`w-full text-left px-2 py-1.5 text-xs rounded border transition-colors ${
                                activityTypeFilter === type
                                  ? 'border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-foreground'
                                  : 'border-sidebar-border/40 text-muted-foreground hover:border-sidebar-border/60'
                              }`}
                              style={activityTypeFilter === type ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                            >
                              {type === 'all' ? 'All' : type}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      {/* Right Column: Token Filter */}
                      <div className="px-3 py-2">
                        <div className="text-xs font-medium text-muted-foreground mb-2">Token</div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          <button
                            onClick={() => setActivityTokenFilter(null)}
                            className={`w-full text-left px-2 py-1.5 text-xs rounded border transition-colors ${
                              !activityTokenFilter
                                ? 'border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-foreground'
                                : 'border-sidebar-border/40 text-muted-foreground hover:border-sidebar-border/60'
                            }`}
                            style={!activityTokenFilter ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                          >
                            All
                          </button>
                          {Array.from(new Set(activityItems.map((it: any) => {
                            const [sym0, sym1] = String(it?.poolSymbols || '').split('/');
                            return [sym0?.trim(), sym1?.trim()].filter(Boolean);
                          }).flat())).sort().map((symbol) => (
                            <button
                              key={symbol}
                              onClick={() => setActivityTokenFilter(activityTokenFilter === symbol ? null : symbol)}
                              className={`w-full text-left px-2 py-1.5 text-xs rounded border transition-colors ${
                                activityTokenFilter === symbol
                                  ? 'border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-foreground'
                                  : 'border-sidebar-border/40 text-muted-foreground hover:border-sidebar-border/60'
                              }`}
                              style={activityTokenFilter === symbol ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                            >
                              {symbol}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            </div>
            {isIntegrateBalances && selectedSection === 'Balances' ? (
              <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                <div className="flex items-center justify-between pl-6 pr-6 py-3 border-b border-sidebar-border/60 text-xs text-muted-foreground">
                  <span className="tracking-wider font-mono font-bold">TOKEN</span>
                  <div className="group inline-flex items-center">
                    <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">VALUE</span>
                    {renderSortIcon(balancesSortDir)}
                  </div>
                </div>
                <div className="p-0">
                  <BalancesListSkeleton />
                </div>
              </div>
            ) : (
              isMobile ? (
                <div className="flex flex-col gap-3">
                  {[...Array(3)].map((_, idx) => (
                    <div key={idx} className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <TokenPairLogoSkeleton size={24} offset={14} />
                        <div className="flex-1 space-y-2 min-w-0">
                          <SkeletonLine className="h-4 w-24 sm:w-32" />
                          <SkeletonLine className="h-3 w-32 sm:w-40" />
                        </div>
                        <div className="text-right space-y-1">
                          <SkeletonLine className="h-4 w-16" />
                          <SkeletonLine className="h-3 w-12" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: `${colWidths.pool}%` }} />
                        <col style={{ width: `${colWidths.amounts}%` }} />
                        <col style={{ width: `${colWidths.apr}%` }} />
                        <col style={{ width: `${colWidths.range}%` }} />
                        <col style={{ width: `${colWidths.value}%` }} />
                        <col style={{ width: '44px' }} />
                      </colgroup>
                      <thead className="border-b border-sidebar-border/60 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-2 pl-6 py-3 text-left tracking-wider font-mono font-bold">POOL</th>
                          <th className="pl-6 pr-2 py-3 text-left min-w-0">
                            <button type="button" onClick={() => handleActiveSortCycle('amounts')} className="group inline-flex items-center">
                              <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">AMOUNTS</span>
                              {renderSortIcon(activeSort.column === 'amounts' ? activeSort.direction : null)}
                            </button>
                          </th>
                          <th className="pl-6 pr-2 py-3 text-left min-w-0">
                            <button type="button" onClick={() => handleActiveSortCycle('apr')} className="group inline-flex items-center">
                              <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">APR</span>
                              {renderSortIcon(activeSort.column === 'apr' ? activeSort.direction : null)}
                            </button>
                          </th>
                          <th className="pl-6 pr-2 py-3 text-left min-w-0">
                            <span className="uppercase tracking-wider font-mono font-bold">RANGE</span>
                          </th>
                          <th className="py-3 pr-3 text-right tracking-wider font-mono font-bold">VALUE</th>
                          <th className="py-3 pr-2 text-right w-[44px] sticky right-0 z-10 bg-background"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...Array(4)].map((_, idx) => (
                          <tr key={idx} className="border-b border-sidebar-border/60 last:border-b-0">
                            <td className="py-4 px-2 pl-6 align-middle">
                              <div className="flex items-center gap-2 min-w-0">
                                <TokenPairLogoSkeleton />
                                <SkeletonLine className="h-4 w-20 sm:w-28" />
                              </div>
                            </td>
                            <td className="py-4 px-2">
                              <SkeletonLine className="h-3 w-24 sm:w-32" />
                            </td>
                            <td className="py-4 px-2">
                              <SkeletonLine className="h-3 w-16 sm:w-20" />
                            </td>
                            <td className="py-4 px-2">
                              <div className="h-8 overflow-hidden flex items-center">
                                <TickRangePortfolio
                                  tickLower={0}
                                  tickUpper={100}
                                  currentTick={50}
                                  tickSpacing={1}
                                  bare
                                  bucketData={[]}
                                  isLoading
                                />
                              </div>
                            </td>
                            <td className="py-4 px-2 text-right">
                              <SkeletonLine className="h-4 w-16 sm:w-20 ml-auto" />
                            </td>
                            <td className="py-4 px-2"></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )}
            </div>
            {!isIntegrateBalances && (
              <aside className="lg:flex-none" style={{ width: viewportWidth >= 1024 ? '450px' : '100%' }}>
                <div className="mb-2 flex items-center gap-2 justify-between">
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-foreground brightness-110"
                    style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                  >
                    Balances
                  </button>
                </div>
                <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                  <div className="flex items-center justify-between pl-6 pr-6 py-3 border-b border-sidebar-border/60 text-xs text-muted-foreground">
                    <span className="tracking-wider font-mono font-bold">TOKEN</span>
                    <div className="group inline-flex items-center">
                      <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">VALUE</span>
                      {renderSortIcon(balancesSortDir)}
                    </div>
                  </div>
                  <div className="p-0">
                    <BalancesListSkeleton />
                  </div>
                </div>
              </aside>
            )}
          </div>
        </div>
      </AppLayout>
    );
  }

  // Show empty state only after loading is complete and no positions found
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
    <PortfolioFilterContext.Provider value={{ activeTokenFilter, setActiveTokenFilter, isStickyHover, setIsStickyHover, hoverTokenLabel: effectiveTokenLabel }}>
      <AppLayout>
      <div className="flex flex-1 flex-col p-3 sm:p-6 sm:px-10">
        {/* Portfolio header with skeleton gate */}
        {showSkeletonFor.header ? (
          <PortfolioHeaderSkeleton isVerySmallScreen={isVerySmallScreen} />
        ) : (
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
                {isPositive ? (
                  <ArrowUpRight className="h-3 w-3 text-green-500" />
                ) : (
                  <ArrowDownRight className="h-3 w-3 text-red-500" />
                )}
                <span className={`text-xs font-medium ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                  {Math.abs(pnl24hPct).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                </span>
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
              {formatUSDHeader(displayValue)}
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
                      <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">{`${effectiveAprPct.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  `${effectiveAprPct.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
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
        )}

        {/* NEW: Portfolio sections with selector + right Balances aside */}
        <div className="mt-6 flex flex-col lg:flex-row" style={{ gap: `${getColumnGapPx(viewportWidth)}px` }}>
          <div className="flex-1 min-w-0">
          {/* Section selector above the container */}
          <div className="flex items-center gap-2 mb-2 justify-between">
            {/* Left: section tabs */}
            {sectionsList.map((section) => (
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
            {/* Right: token filter badge area + Faucet (only show faucet when Balances tab active in integrated mode) */}
            <div className="ml-auto flex items-center gap-2">
              {activeTokenFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTokenFilter(null);
                    setIsStickyHover(false);
                    setIsRestCycling(false);
                  }}
                  className="group flex items-center gap-1 px-2 py-1 rounded-md border border-sidebar-border/60 bg-muted/40 text-xs text-muted-foreground hover:bg-muted/50 relative"
                >
                  {isRestCycling && (
                    <div 
                      className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md"
                      style={{ backgroundColor: 'hsl(var(--sidebar-primary))' }}
                    />
                  )}
                  <X className="h-3 w-3 text-muted-foreground transition-colors group-hover:text-foreground" />
                  <span className="uppercase tracking-wider text-muted-foreground font-mono font-bold text-xs">{activeTokenFilter}</span>
                </button>
              )}
              
              {/* Activity Filter Dropdown */}
              {selectedSection === 'Activity' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 px-3 py-1 rounded-md border border-sidebar-border/60 bg-[var(--sidebar-connect-button-bg)] text-xs text-muted-foreground hover:bg-muted/50 transition-colors">
                      <Menu className="h-3 w-3" />
                      <span className="font-medium">Filter</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={4} className="border border-sidebar-border min-w-[300px]" style={{ backgroundColor: '#0f0f0f' }}>
                    <div className="grid grid-cols-2 gap-0">
                      {/* Left Column: Type Filter */}
                      <div className="px-3 py-2 border-r border-sidebar-border/60">
                        <div className="text-xs font-medium text-muted-foreground mb-2">Type</div>
                        <div className="space-y-1">
                          {(['all', 'Swap', 'Liquidity'] as const).map((type) => (
                            <button
                              key={type}
                              onClick={() => setActivityTypeFilter(type)}
                              className={`w-full text-left px-2 py-1.5 text-xs rounded border transition-colors ${
                                activityTypeFilter === type
                                  ? 'border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-foreground'
                                  : 'border-sidebar-border/40 text-muted-foreground hover:border-sidebar-border/60'
                              }`}
                              style={activityTypeFilter === type ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                            >
                              {type === 'all' ? 'All' : type}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      {/* Right Column: Token Filter */}
                      <div className="px-3 py-2">
                        <div className="text-xs font-medium text-muted-foreground mb-2">Token</div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          <button
                            onClick={() => setActivityTokenFilter(null)}
                            className={`w-full text-left px-2 py-1.5 text-xs rounded border transition-colors ${
                              !activityTokenFilter
                                ? 'border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-foreground'
                                : 'border-sidebar-border/40 text-muted-foreground hover:border-sidebar-border/60'
                            }`}
                            style={!activityTokenFilter ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                          >
                            All
                          </button>
                          {Array.from(new Set(activityItems.map((it: any) => {
                            const [sym0, sym1] = String(it?.poolSymbols || '').split('/');
                            return [sym0?.trim(), sym1?.trim()].filter(Boolean);
                          }).flat())).sort().map((symbol) => (
                            <button
                              key={symbol}
                              onClick={() => setActivityTokenFilter(activityTokenFilter === symbol ? null : symbol)}
                              className={`w-full text-left px-2 py-1.5 text-xs rounded border transition-colors ${
                                activityTokenFilter === symbol
                                  ? 'border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-foreground'
                                  : 'border-sidebar-border/40 text-muted-foreground hover:border-sidebar-border/60'
                              }`}
                              style={activityTokenFilter === symbol ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                            >
                              {symbol}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              
              {isIntegrateBalances && selectedSection === 'Balances' && (
                (() => {
                  const last = faucetLastClaimTs < 0 ? -1 : Number(faucetLastClaimTs || 0);
                  const now = Math.floor(Date.now() / 1000);
                  const onchainLast = faucetLastCalledOnchain ? Number(faucetLastCalledOnchain) : null;
                  const effectiveLast = onchainLast && onchainLast > 0 ? onchainLast : (last >= 0 ? last : -1);
                  const canClaim = isConnected && currentChainId === baseSepolia.id && effectiveLast >= 0 && (effectiveLast === 0 || now - effectiveLast >= 24 * 60 * 60);
                  const handleClick = async () => {
                    if (!canClaim) {
                      toast.error('Can only claim once per day', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                      return;
                    }
                    try {
                      setIsFaucetBusy(true);
                      const res = await fetch('/api/misc/faucet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userAddress: accountAddress, chainId: baseSepolia.id }) });
                      const data = await res.json();
                      if (!res.ok) {
                        const msg = (data?.errorDetails || data?.message || '').toLowerCase();
                        if (msg.includes('once per day')) {
                          toast.error('Can only claim once per day', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                        } else {
                          toast.error(data?.errorDetails || data?.message || 'API Error', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                        }
                        setIsFaucetBusy(false);
                        return;
                      }
                      toast.info('Sending faucet transaction to wallet...');
                      writeContract({ address: data.to as `0x${string}`, abi: faucetAbi, functionName: 'faucet', args: [], chainId: data.chainId } as any, {
                        onSuccess: (hash) => { setFaucetHash(hash); setTimeout(() => { try { refetchFaucetOnchain?.(); } catch {} }, 1000); }
                      } as any);
                    } catch (e: any) {
                      toast.error(`Error during faucet action: ${e?.message || 'Unknown error'}`);
                      setIsFaucetBusy(false);
                    }
                  };
                  const disabled = Boolean(isFaucetBusy || isFaucetConfirming);
                  const className = canClaim
                    ? `px-2 py-1 text-xs rounded-md border border-sidebar-primary bg-[#3d271b] text-sidebar-primary transition-colors ${disabled ? 'opacity-70 cursor-not-allowed' : 'hover:bg-[#4a2f22]'}`
                    : `px-2 py-1 text-xs rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-muted-foreground transition-colors ${disabled || last < 0 ? 'opacity-70 cursor-not-allowed' : 'hover:bg-muted/60'}`;
                  const style = canClaim ? undefined : { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } as React.CSSProperties;
                  return (
                    <button type="button" onClick={handleClick} className={className} style={style} disabled={disabled || last < 0}>
                      {disabled ? 'Processing…' : (last < 0 ? '—' : 'Claim Faucet')}
                    </button>
                  );
                })()
              )}
            </div>
          </div>

          <div className={isMobile ? "" : (selectedSection === 'Active Positions' ? "rounded-lg bg-muted/30 border border-sidebar-border/60" : "")}>
            <div className={isMobile ? "" : (selectedSection === 'Active Positions' ? "p-0" : "") }>
              {/* Active Positions */}
              {selectedSection === 'Active Positions' && (
                <div className={isMobile ? "" : undefined}>
                  <div className={isMobile ? "" : "p-0"}>
                    {showSkeletonFor.table ? (
                      isMobile ? (
                        <div className="flex flex-col gap-3">
                          {[...Array(3)].map((_, idx) => (
                            <div key={idx} className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <TokenPairLogoSkeleton size={24} offset={14} />
                                <div className="flex-1 space-y-2 min-w-0">
                                  <SkeletonLine className="h-4 w-24 sm:w-32" />
                                  <SkeletonLine className="h-3 w-32 sm:w-40" />
                                </div>
                                <div className="text-right space-y-1">
                                  <SkeletonLine className="h-4 w-16" />
                                  <SkeletonLine className="h-3 w-12" />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                            <colgroup>
                              {/* Pool */}
                              <col style={{ width: `${colWidths.pool}%` }} />
                              {/* Amounts */}
                              <col style={{ width: `${colWidths.amounts}%` }} />
                              {/* APR */}
                              <col style={{ width: `${colWidths.apr}%` }} />
                              {/* Range */}
                              <col style={{ width: `${colWidths.range}%` }} />
                              {/* Value */}
                              <col style={{ width: `${colWidths.value}%` }} />
                              {/* Menu (fixed px to prevent overflow) */}
                              <col style={{ width: '44px' }} />
                            </colgroup>
                            <thead className="border-b border-sidebar-border/60 text-xs text-muted-foreground">
                              <tr>
                                <th className="px-2 pl-6 py-3 text-left tracking-wider font-mono font-bold">POOL</th>
                                <th className="pl-6 pr-2 py-3 text-left min-w-0">
                                  <button type="button" onClick={() => handleActiveSortCycle('amounts')} className="group inline-flex items-center">
                                    <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">AMOUNTS</span>
                                    {renderSortIcon(activeSort.column === 'amounts' ? activeSort.direction : null)}
                                  </button>
                                </th>
                                <th className="pl-6 pr-2 py-3 text-left min-w-0">
                                  <button type="button" onClick={() => handleActiveSortCycle('apr')} className="group inline-flex items-center">
                                    <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">APR</span>
                                    {renderSortIcon(activeSort.column === 'apr' ? activeSort.direction : null)}
                                  </button>
                                </th>
                                <th className="pl-6 pr-2 py-3 text-left min-w-0">
                                  <span className="uppercase tracking-wider font-mono font-bold">RANGE</span>
                                </th>
                                <th className="py-3 pr-3 text-right">
                                  <button type="button" onClick={() => handleActiveSortCycle('value')} className="group inline-flex items-center justify-end">
                                    <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">VALUE</span>
                                    {renderSortIcon(activeSort.column === 'value' ? activeSort.direction : null)}
                                  </button>
                                </th>
                                <th className="py-3 pr-2 text-right w-[44px] sticky right-0 z-10 bg-background"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...Array(4)].map((_, idx) => (
                                <tr key={idx} className="border-b border-sidebar-border/60 last:border-b-0">
                                  <td className="py-4 px-2 pl-6 align-middle text-left">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <TokenPairLogoSkeleton />
                                      <SkeletonLine className="h-4 w-20 sm:w-28" />
                                    </div>
                                  </td>
                                  <td className="py-4 px-2 text-left">
                                    <SkeletonLine className="h-3 w-24 sm:w-32" />
                                  </td>
                                  <td className="py-4 px-2 text-left">
                                    <SkeletonLine className="h-3 w-16 sm:w-20" />
                                  </td>
                                  <td className="py-4 px-2 text-left">
                                    <div className="h-8 overflow-hidden flex items-center justify-start">
                                      <TickRangePortfolio
                                        tickLower={0}
                                        tickUpper={100}
                                        currentTick={50}
                                        tickSpacing={1}
                                        bare
                                        bucketData={[]}
                                        isLoading
                                      />
                                    </div>
                                  </td>
                                  <td className="py-4 px-2 text-right">
                                    <SkeletonLine className="h-4 w-16 sm:w-20 ml-auto" />
                                  </td>
                                  <td className="py-4 px-2"></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    ) : (!isConnected || activePositions.length === 0) && !isLoadingPositions ? (
                      <div className="text-sm text-muted-foreground px-2 py-6">
                        {!isConnected ? 'Connect your wallet to view your positions.' : 'No active positions.'}
                      </div>
                    ) : (
                      isMobile ? (
                        <div className="flex flex-col gap-3">
                          {activePositions.map((position, idx) => {
                            const token0Icon = getToken(position?.token0?.symbol || '')?.icon || '/placeholder.svg';
                            const token1Icon = getToken(position?.token1?.symbol || '')?.icon || '/placeholder.svg';
                            const valueUSD = (() => {
                              const sym0 = position?.token0?.symbol as string | undefined;
                              const sym1 = position?.token1?.symbol as string | undefined;
                              const amt0 = parseFloat(position?.token0?.amount || '0');
                              const amt1 = parseFloat(position?.token1?.amount || '0');
                              const price0 = (sym0 && portfolioData.priceMap[sym0]) || 0;
                              const price1 = (sym1 && portfolioData.priceMap[sym1]) || 0;
                              return amt0 * price0 + amt1 * price1;
                            })();
                            const inRange = !!position?.isInRange;
                            return (
                              <div
                                key={position.positionId || idx}
                                className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-3 cursor-pointer"
                                onClick={() => navigateToPoolBySubgraphId(position?.poolId)}
                              >
                                <div className="flex items-center gap-3">
                                  <div className="relative w-14 h-7">
                                    <div className="absolute top-1/2 -translate-y-1/2 left-0 w-7 h-7 rounded-full overflow-hidden bg-background z-10">
                                      <Image src={token0Icon} alt={position?.token0?.symbol || ''} width={28} height={28} className="w-full h-full object-cover" />
                                    </div>
                                    <div className="absolute top-1/2 -translate-y-1/2 left-4 w-7 h-7">
                                      <div className="absolute inset-0 rounded-full overflow-hidden bg-background z-30">
                                        <Image src={token1Icon} alt={position?.token1?.symbol || ''} width={28} height={28} className="w-full h-full object-cover" />
                                      </div>
                                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[#111111] z-20"></div>
                                    </div>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm truncate">{position?.token0?.symbol}/{position?.token1?.symbol}</div>
                                    <div className="text-xs text-muted-foreground">
                                      <span>{Number(position?.token0?.amount || 0).toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} {position?.token0?.symbol}</span>
                                      <span className="mx-1">·</span>
                                      <span>{Number(position?.token1?.amount || 0).toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} {position?.token1?.symbol}</span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {inRange ? (
                                      <BadgeCheck className="h-4 w-4 text-green-500" />
                                    ) : (
                                      <OctagonX className="h-4 w-4 text-red-500" />
                                    )}
                                    <div className="text-xs text-muted-foreground whitespace-nowrap">{formatUSD(valueUSD)}</div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                          <colgroup>
                            {/* Pool */}
                            <col style={{ width: `${colWidths.pool}%` }} />
                            {/* Amounts */}
                            <col style={{ width: `${colWidths.amounts}%` }} />
                            {/* APR */}
                            <col style={{ width: `${colWidths.apr}%` }} />
                            {/* Range */}
                            <col style={{ width: `${colWidths.range}%` }} />
                            {/* Value */}
                            <col style={{ width: `${colWidths.value}%` }} />
                            {/* Menu (fixed px to prevent overflow) */}
                            <col style={{ width: '44px' }} />
                          </colgroup>
                          <thead className="border-b border-sidebar-border/60 text-xs text-muted-foreground">
                            <tr>
                              <th className="px-2 pl-6 py-3 text-left tracking-wider font-mono font-bold">POOL</th>
                              <th className="pl-6 pr-2 py-3 text-left min-w-0">
                                <button type="button" onClick={() => handleActiveSortCycle('amounts')} className="group inline-flex items-center">
                                  <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">AMOUNTS</span>
                                  {renderSortIcon(activeSort.column === 'amounts' ? activeSort.direction : null)}
                                </button>
                              </th>
                              <th className="pl-6 pr-2 py-3 text-left min-w-0">
                                <button type="button" onClick={() => handleActiveSortCycle('apr')} className="group inline-flex items-center">
                                  <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">APR</span>
                                  {renderSortIcon(activeSort.column === 'apr' ? activeSort.direction : null)}
                                </button>
                              </th>
                              <th className="pl-6 pr-2 py-3 text-left min-w-0">
                                <span className="uppercase tracking-wider font-mono font-bold">RANGE</span>
                              </th>
                              <th className="py-3 pr-3 text-right">
                                <button type="button" onClick={() => handleActiveSortCycle('value')} className="group inline-flex items-center justify-end">
                                  <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">VALUE</span>
                                  {renderSortIcon(activeSort.column === 'value' ? activeSort.direction : null)}
                                </button>
                              </th>
                              <th className="py-3 pr-2 text-right w-[44px] sticky right-0 z-10 bg-background"></th>
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
                                      onClick={() => {
                                        if (items.length > 1) {
                                          togglePoolExpanded(poolKey)
                                        } else {
                                          navigateToPoolBySubgraphId(first?.poolId)
                                        }
                                      }}
                                    >
                                    <td className="py-4 px-2 pl-6 align-middle relative" colSpan={items.length > 1 ? 2 : 1}>
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
                                        <div className="relative cursor-pointer" onClick={() => navigateToPoolBySubgraphId(first?.poolId)} style={{ width: isIconOnlyRangeThreshold ? '2.5rem' : '3.5rem', height: isIconOnlyRangeThreshold ? '1.25rem' : '1.75rem' }}>
                                          <div className="absolute top-1/2 -translate-y-1/2 left-0 rounded-full overflow-hidden bg-background z-10" style={{ width: isIconOnlyRangeThreshold ? 20 : 28, height: isIconOnlyRangeThreshold ? 20 : 28 }}>
                                            <Image src={token0Icon} alt={first?.token0?.symbol || ''} width={isIconOnlyRangeThreshold ? 20 : 28} height={isIconOnlyRangeThreshold ? 20 : 28} className="w-full h-full object-cover" />
                                          </div>
                                          <div className="absolute top-1/2 -translate-y-1/2" style={{ left: isIconOnlyRangeThreshold ? '0.9rem' : '1rem', width: isIconOnlyRangeThreshold ? '1.25rem' : '1.75rem', height: isIconOnlyRangeThreshold ? '1.25rem' : '1.75rem' }}>
                                            <div className="absolute inset-0 rounded-full overflow-hidden bg-background z-30">
                                              <Image src={token1Icon} alt={first?.token1?.symbol || ''} width={isIconOnlyRangeThreshold ? 20 : 28} height={isIconOnlyRangeThreshold ? 20 : 28} className="w-full h-full object-cover" />
                                            </div>
                                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#111111] z-20" style={{ width: isIconOnlyRangeThreshold ? 22 : 32, height: isIconOnlyRangeThreshold ? 22 : 32 }}></div>
                                          </div>
                                        </div>
                                        <span className="font-medium cursor-pointer truncate max-w-[10rem] sm:max-w-[12rem]" onClick={() => navigateToPoolBySubgraphId(first?.poolId)}>{first?.token0?.symbol}/{first?.token1?.symbol}</span>
                                        {items.length > 1 && (
                                          <span className="ml-1 w-5 h-5 flex items-center justify-center text-[10px] rounded bg-[var(--sidebar-connect-button-bg)] text-muted-foreground" style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
                                            {items.length}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    {!(items.length > 1) && (
                                      <td className="py-4 pl-6 pr-2 align-middle min-w-0">
                                        <div className="text-xs text-muted-foreground">
                                          {(() => {
                                            const sel = activeTokenFilter?.toUpperCase?.();
                                            const hover = effectiveTokenLabel?.toUpperCase?.();
                                            const s0 = first?.token0?.symbol?.toUpperCase?.();
                                            const s1 = first?.token1?.symbol?.toUpperCase?.();
                                            const amt0 = Number.parseFloat(first?.token0?.amount || '0').toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
                                            const amt1 = Number.parseFloat(first?.token1?.amount || '0').toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
                                            if (isStackThreshold) {
                                              return (
                                                <div className="flex flex-col gap-0.5">
                                                  <span className={((sel && s0 && sel === s0) || (hover && s0 && hover === s0)) ? 'text-foreground font-medium text-xs' : undefined}>{amt0} {first?.token0?.symbol}</span>
                                                  <span className={((sel && s1 && sel === s1) || (hover && s1 && hover === s1)) ? 'text-foreground font-medium text-xs' : undefined}>{amt1} {first?.token1?.symbol}</span>
                                                </div>
                                              );
                                            }
                                            return (
                                              <>
                                                <span className={((sel && s0 && sel === s0) || (hover && s0 && hover === s0)) ? 'text-foreground font-medium text-xs' : undefined}>{amt0} {first?.token0?.symbol}</span>
                                                <span className="mx-1">·</span>
                                                <span className={((sel && s1 && sel === s1) || (hover && s1 && hover === s1)) ? 'text-foreground font-medium text-xs' : undefined}>{amt1} {first?.token1?.symbol}</span>
                                              </>
                                            );
                                          })()}
                                        </div>
                                      </td>
                                    )}
                                        <td className="py-4 pl-6 pr-2 align-middle min-w-0">
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
                                                   <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">{`${aprNum.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}</TooltipContent>
                                                </Tooltip>
                                              </TooltipProvider>
                                            );
                                          }
                                           return <span className="text-xs cursor-pointer">{aprNum.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span>;
                                        })()
                                      )}
                                    </td>
                                        <td className="py-4 pl-6 pr-2 align-middle min-w-0">
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
                                          const isNearEdge = false; // per spec: do not show near-edge icon
                                            if (isIconOnlyRangeThreshold) {
                                              return (
                                                <div className="flex items-center justify-center gap-2">
                                                  {inRange ? (
                                                    <BadgeCheck className="h-4 w-4 text-green-500" />
                                                  ) : (
                                                    <OctagonX className="h-4 w-4 text-red-500" />
                                                  )}
                                                </div>
                                              );
                                            }
                                            return (
                                              <div className="flex items-center">
                                                <div className="h-8 overflow-hidden">
                                                  {showSkeletonFor.charts && loadingBuckets.has(getCacheKey(first?.poolId || '', tl, tu)) ? (
                                                    <TickRangePortfolio
                                                      tickLower={tl}
                                                      tickUpper={tu}
                                                      currentTick={ct}
                                                      tickSpacing={ts}
                                                      poolId={first?.poolId}
                                                      token0Symbol={first?.token0?.symbol}
                                                      token1Symbol={first?.token1?.symbol}
                                                      currentPrice={poolDataByPoolId[poolKey]?.price ? String(poolDataByPoolId[poolKey]?.price) : null}
                                                      bucketData={[]}
                                                      isLoading
                                                      bare
                                                    />
                                                  ) : (
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
                                                  )}
                                                </div>
                                                {(!inRange) && (
                                                  <div className="ml-2 shrink-0 flex items-center">
                                                    <TooltipProvider>
                                                      <Tooltip>
                                                        <TooltipTrigger asChild>
                                                          <OctagonX className="h-4 w-4 text-red-500 cursor-default" />
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">Out of range</TooltipContent>
                                                      </Tooltip>
                                                    </TooltipProvider>
                                                  </div>
                                                )}
                                              </div>
                                            );
                                        })()
                                      )}
                                    </td>
                                    <td className="py-4 px-2 pr-3 align-middle text-right whitespace-nowrap">{formatUSD(totalUSD)}</td>
                                    <td className="py-4 px-1 align-middle text-center w-[44px] sticky right-0 z-10 bg-background group-hover:bg-muted/30 transition-colors" onClick={(e) => e.stopPropagation()}>
                                      {items.length > 1 ? (
                                        <div />
                                      ) : (
                                        <div className="relative">
                                          <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                              <Button variant="ghost" className="h-8 w-8 p-0">
                                                <span className="sr-only">Open menu</span>
                                                <EllipsisVertical className="h-4 w-4" />
                                              </Button>
                                            </DropdownMenuTrigger>
                                             <DropdownMenuContent align="end" sideOffset={2} className="border border-sidebar-border" style={{ backgroundColor: '#0f0f0f' }}>
                                              <DropdownMenuItem className="cursor-pointer" onClick={() => openAddLiquidity(first)}>Add Liquidity</DropdownMenuItem>
                                              <DropdownMenuItem className="cursor-pointer" onClick={() => openWithdraw(first)}>Withdraw</DropdownMenuItem>
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
                                      <tr key={`${poolKey}-child-${idx}`} className={`hover:bg-muted/10 ${isExpanded ? '' : 'border-b border-sidebar-border/60 last:border-0'} cursor-pointer`} onClick={() => navigateToPoolBySubgraphId(p?.poolId)}>
                                        <td className="py-3 px-2 pl-[3.25rem] align-middle">
                                          <div></div>
                                        </td>
                                        <td className="py-3 pl-6 pr-2 align-middle">
                                        <div className="text-xs text-muted-foreground">
                                            {(() => {
                                              const sel = activeTokenFilter?.toUpperCase?.();
                                              const hover = effectiveTokenLabel?.toUpperCase?.();
                                              const s0 = p?.token0?.symbol?.toUpperCase?.();
                                              const s1 = p?.token1?.symbol?.toUpperCase?.();
                                              const amt0 = Number.parseFloat(p?.token0?.amount || '0').toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
                                              const amt1 = Number.parseFloat(p?.token1?.amount || '0').toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
                                              if (isStackThreshold) {
                                                return (
                                                  <div className="flex flex-col gap-0.5">
                                                    <span className={((sel && s0 && sel === s0) || (hover && s0 && hover === s0)) ? 'text-foreground font-medium text-xs' : undefined}>{amt0} {p?.token0?.symbol}</span>
                                                    <span className={((sel && s1 && sel === s1) || (hover && s1 && hover === s1)) ? 'text-foreground text-xs' : undefined}>{amt1} {p?.token1?.symbol}</span>
                                                  </div>
                                                );
                                              }
                                              return (
                                                <>
                                                  <span className={((sel && s0 && sel === s0) || (hover && s0 && hover === s0)) ? 'text-foreground font-medium text-xs' : undefined}>{amt0} {p?.token0?.symbol}</span>
                                                  <span className="mx-1">·</span>
                                                  <span className={((sel && s1 && sel === s1) || (hover && s1 && hover === s1)) ? 'text-foreground text-xs' : undefined}>{amt1} {p?.token1?.symbol}</span>
                                                </>
                                              );
                                            })()}
                                          </div>
                                        </td>
                                        <td className="py-3 pl-6 pr-2 align-middle">
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
                                                      <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">{`${aprNum.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`}</TooltipContent>
                                                   </Tooltip>
                                                 </TooltipProvider>
                                               );
                                             }
                                             return <span className="text-xs cursor-pointer">{aprNum.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span>;
                                          })()}
                                        </td>
                                    <td className="py-3 pl-6 pr-2 align-middle min-w-0">
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
                                            const isNearEdge = false; // per spec: do not show near-edge icon
                                            if (isIconOnlyRangeThreshold) {
                                              return (
                                                <div className="flex items-center justify-center gap-2">
                                                  {inRange ? (
                                                    <BadgeCheck className="h-4 w-4 text-green-500" />
                                                  ) : (
                                                    <OctagonX className="h-4 w-4 text-red-500" />
                                                  )}
                                                </div>
                                              );
                                            }
                                            return (
                                              <div className="flex items-center">
                                                <div className="h-8 overflow-hidden">
                                                  {showSkeletonFor.charts && loadingBuckets.has(getCacheKey(p?.poolId || '', tl, tu)) ? (
                                                    <TickRangePortfolio
                                                      tickLower={tl}
                                                      tickUpper={tu}
                                                      currentTick={ct}
                                                      tickSpacing={ts}
                                                      poolId={p?.poolId}
                                                      token0Symbol={p?.token0?.symbol}
                                                      token1Symbol={p?.token1?.symbol}
                                                      currentPrice={poolDataByPoolId[poolKey]?.price ? String(poolDataByPoolId[poolKey]?.price) : null}
                                                      bucketData={[]}
                                                      isLoading
                                                      bare
                                                    />
                                                  ) : (
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
                                                  )}
                                                </div>
                                                {(!inRange) && (
                                                  <div className="ml-2 shrink-0 flex items-center">
                                                    <TooltipProvider>
                                                      <Tooltip>
                                                        <TooltipTrigger asChild>
                                                          <OctagonX className="h-4 w-4 text-red-500 cursor-default" />
                                                        </TooltipTrigger>
                                                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">Out of range</TooltipContent>
                                                      </Tooltip>
                                                    </TooltipProvider>
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })()}
                                        </td>
                                        <td className="py-3 px-2 pr-3 align-middle text-right whitespace-nowrap">
                                          <span className="text-xs text-muted-foreground">{formatUSD(valueUSD)}</span>
                                        </td>
                                        <td className="py-3 px-1 align-middle text-center w-[44px] sticky right-0 z-10 bg-background group-hover:bg-muted/30 transition-colors" onClick={(e) => e.stopPropagation()}>
                                          <div className="relative">
                                            <DropdownMenu>
                                              <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                  <span className="sr-only">Open menu</span>
                                                  <EllipsisVertical className="h-4 w-4" />
                                                </Button>
                                              </DropdownMenuTrigger>
                                              <DropdownMenuContent align="end" sideOffset={2} className="border border-sidebar-border" style={{ backgroundColor: '#0f0f0f' }}>
                                              <DropdownMenuItem className="cursor-pointer" onClick={() => openAddLiquidity(p)}>Add Liquidity</DropdownMenuItem>
                                              <DropdownMenuItem className="cursor-pointer" onClick={() => openWithdraw(p)}>Withdraw</DropdownMenuItem>
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
                    ))}
                  </div>
                </div>
              )}

              {/* Old Positions removed */}

              {/* Activity */}
              {selectedSection === 'Activity' && (
                <div>
                  <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 overflow-hidden">
                    <div className="border-b border-sidebar-border/60 text-xs text-muted-foreground">
                      <div
                        className="grid gap-3 px-2 pl-6 pr-6 py-3"
                        style={{
                          gridTemplateColumns: isMobile
                            ? '88px minmax(0,1fr) minmax(0,2fr)'
                            : (viewportWidth <= 1200
                                ? '88px minmax(0,1fr) minmax(0,1.4fr) 90px 100px'
                                : '88px minmax(0,1fr) minmax(0,2fr) 120px 140px')
                        }}
                      >
                        <div className="tracking-wider font-mono font-bold uppercase">Type</div>
                        <div className="tracking-wider font-mono font-bold uppercase">Pool</div>
                        <div className="tracking-wider font-mono font-bold uppercase">Details</div>
                        {!isMobile && (
                          <div className="text-center tracking-wider font-mono font-bold uppercase">Time</div>
                        )}
                        {!isMobile && (
                          <div className="text-right tracking-wider font-mono font-bold uppercase">Txn</div>
                        )}
                    </div>
                  </div>
                     <div>
                    {filteredActivityItems.length === 0 && !isLoadingActivity ? (
                      <div className="text-sm text-muted-foreground px-2 py-6">No recent activity.</div>
                    ) : (
                      <div className="flex flex-col">
                         <div className="divide-y divide-sidebar-border/60">
                                                   {pagedFilteredActivityItems.map((it, idx) => (
                            <div
                              key={it.id || idx}
                              className="grid items-center gap-3 px-2 pl-6 pr-6 py-3 hover:bg-muted/10"
                              style={{
                                gridTemplateColumns: isMobile
                                  ? '88px minmax(0,1fr) minmax(0,2fr)'
                                  : (viewportWidth <= 1200
                                      ? '88px minmax(0,1fr) minmax(0,1.4fr) 90px 100px'
                                      : '88px minmax(0,1fr) minmax(0,2fr) 120px 140px')
                              }}
                              onClick={() => {
                                if (isMobile && it.tx) {
                                  window.open(`https://sepolia.basescan.org/tx/${it.tx}`, '_blank');
                                }
                              }}
                            >
                            {/* Type */}
                            <div className="min-w-0 text-left">
                              {it.type === 'Swap' ? (
                                <span
                                  className="px-1.5 py-0.5 text-xs font-normal rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-muted-foreground"
                                  style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                                >
                                  Swap
                                </span>
                              ) : (
                                <span className={`px-1.5 py-0.5 text-xs font-normal rounded-md border ${it.type === 'Add' ? 'text-green-500 border-green-500 bg-green-500/10' : 'text-red-500 border-red-500 bg-red-500/10'}`}>
                                  Liquidity
                                </span>
                                  )}
                                </div>
                            {/* Pool */}
                            <div className="text-sm text-foreground min-w-0 truncate">{it.poolSymbols}</div>
                            {/* Details */}
                            <div className="text-xs text-muted-foreground min-w-0 truncate"
                              style={{ maxWidth: viewportWidth <= 1200 ? 280 : undefined }}
                            >
                              {(() => {
                                if (it.type === 'Swap') {
                                  const sym0 = (it.poolSymbols || '').split('/')[0] || '';
                                  const sym1 = (it.poolSymbols || '').split('/')[1] || '';
                                  const d0 = getTokenCfg(sym0);
                                  const d1 = getTokenCfg(sym1);
                                  const dec0 = d0?.decimals ?? 18;
                                  const dec1 = d1?.decimals ?? 18;
                                  const isNeg0 = String(it.amount0 || '').startsWith('-');
                                  const isNeg1 = String(it.amount1 || '').startsWith('-');
                                  const amt0 = viemFormatUnits(BigInt(String(it.amount0 || '0').replace(/^-/, '')), dec0);
                                  const amt1 = viemFormatUnits(BigInt(String(it.amount1 || '0').replace(/^-/, '')), dec1);
                                  const negPart = isNeg0
                                    ? `${Number(amt0).toLocaleString('de-DE', { maximumFractionDigits: d0?.displayDecimals ?? 4 })} ${sym0}`
                                    : `${Number(amt1).toLocaleString('de-DE', { maximumFractionDigits: d1?.displayDecimals ?? 4 })} ${sym1}`;
                                  const posPart = isNeg0
                                    ? `${Number(amt1).toLocaleString('de-DE', { maximumFractionDigits: d1?.displayDecimals ?? 4 })} ${sym1}`
                                    : `${Number(amt0).toLocaleString('de-DE', { maximumFractionDigits: d0?.displayDecimals ?? 4 })} ${sym0}`;
                                  return (
                                    <span className="inline-flex items-center gap-1">
                                      <span>{negPart}</span>
                                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                      <span>{posPart}</span>
                                    </span>
                                  );
                                }
                                // For Add/Withdraw show token amounts as token0 + token1 (always positive)
                                const parts: string[] = [];
                                if (it.amount0 || it.amount1) {
                                  const sym0 = (it.poolSymbols || '').split('/')[0] || '';
                                  const sym1 = (it.poolSymbols || '').split('/')[1] || '';
                                  const d0 = getTokenCfg(sym0);
                                  const d1 = getTokenCfg(sym1);
                                  const dec0 = d0?.decimals ?? 18;
                                  const dec1 = d1?.decimals ?? 18;
                                  if (it.amount0) {
                                    const a0 = viemFormatUnits(BigInt(String(it.amount0 || '0').replace(/^-/, '')), dec0);
                                    parts.push(`${Number(a0).toLocaleString('de-DE', { maximumFractionDigits: d0?.displayDecimals ?? 4 })} ${sym0}`);
                                  }
                                  if (it.amount1) {
                                    const a1 = viemFormatUnits(BigInt(String(it.amount1 || '0').replace(/^-/, '')), dec1);
                                    parts.push(`${Number(a1).toLocaleString('de-DE', { maximumFractionDigits: d1?.displayDecimals ?? 4 })} ${sym1}`);
                                  }
                                  return parts.join(' + ');
                                }
                                if (it.tickLower || it.tickUpper) parts.push(`ticks ${it.tickLower} – ${it.tickUpper}`);
                                return parts.join(' · ');
                              })()}
                              </div>
                            {/* Time */}
                            {!isMobile && (
                            <div className="text-xs text-muted-foreground text-center">
                              {(() => {
                                const secs = Number(it.ts || 0);
                                if (!secs) return '';
                                const now = Math.floor(Date.now() / 1000);
                                const diff = Math.max(0, now - secs);
                                const y = Math.floor(diff / (365*24*3600));
                                const m = Math.floor((diff % (365*24*3600)) / (30*24*3600));
                                const d = Math.floor((diff % (30*24*3600)) / (24*3600));
                                const h = Math.floor((diff % (24*3600)) / 3600);
                                const min = Math.floor((diff % 3600) / 60);
                                const s = diff % 60;
                                let label = '';
                                if (y) label += `${y}y `;
                                if (m) label += `${m}m `;
                                if (d && !y) label += `${d}d `;
                                if (!y && !m) {
                                  if (h) label += `${h}h `;
                                  if (!h && min) label += `${min}m `;
                                  if (!h && !min && s) label += `${s}s `;
                                }
                                label = label.trim() + ' ago';
                                const full = new Date(secs * 1000).toLocaleString();
                                const fullNoComma = full.replace(/,\s*/g, ' ');
                                return (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="text-xs cursor-default">{label}</span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">{fullNoComma}</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                );
                              })()}
                            </div>
                            )}
                            {/* Txn */}
                            {!isMobile && (
                            <div className="text-xs text-muted-foreground text-right">
                              {it.tx ? (
                                <a href={`https://sepolia.basescan.org/tx/${it.tx}`} target="_blank" rel="noreferrer" className="hover:underline">
                                  {it.tx.slice(0, 10)}…
                                </a>
                              ) : (
                                <span className="opacity-60">—</span>
                              )}
                            </div>
                            )}
                          </div>
                        ))}
                        </div>
                      </div>
                    )}
                  </div>
                  </div>
                                     {filteredTotalActivityPages > 1 && (
                    <>
                      <div className="flex items-center justify-between px-4 py-3 text-xs text-muted-foreground">
                        <div>Page {activityPage + 1} / {filteredTotalActivityPages}</div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="px-2 py-1 rounded border border-sidebar-border hover:bg-muted/30"
                            onClick={() => setActivityPage((p) => Math.max(0, p - 1))}
                            disabled={activityPage === 0}
                          >Prev</button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded border border-sidebar-border hover:bg-muted/30"
                            onClick={() => setActivityPage((p) => Math.min(filteredTotalActivityPages - 1, p + 1))}
                            disabled={activityPage >= filteredTotalActivityPages - 1}
                          >Next</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* Balances as a tab when integrated (desktop/tablet only) */}
              {isIntegrateBalances && selectedSection === 'Balances' && (
                <div>
                  <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                    <div className="flex items-center justify-between pl-6 pr-6 py-3 border-b border-sidebar-border/60 text-xs text-muted-foreground">
                      <span className="tracking-wider font-mono font-bold">TOKEN</span>
                      <button type="button" className="group inline-flex items-center" onClick={() => setBalancesSortDir((d) => d === 'desc' ? 'asc' : 'desc')}>
                        <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">VALUE</span>
                        {renderSortIcon(balancesSortDir)}
                      </button>
                    </div>
                    <div className="p-0">
                      {isLoadingWalletBalances ? (
                        <BalancesListSkeleton />
                      ) : (walletBalances.length || 0) === 0 ? (
                        <div className="text-sm text-muted-foreground px-6 py-6">No token balances.</div>
                      ) : (
                        <div className="flex flex-col divide-y divide-sidebar-border/60">
                          {(() => {
                            const sorted = [...walletBalances].sort((a, b) => balancesSortDir === 'asc' ? a.usdValue - b.usdValue : b.usdValue - a.usdValue);
                            return sorted;
                          })().map((tb) => {
                            const tokenInfo = getToken(tb.symbol) as any;
                            const iconSrc = tokenInfo?.icon || '/placeholder.svg';
                            const ch = walletPriceChange24hPctMap?.[tb.symbol] ?? 0;
                            const deltaUsd = (() => {
                              const c = tb.usdValue || 0;
                              const denom = 1 + (isFinite(ch) ? ch : 0) / 100;
                              if (denom === 0) return 0;
                              return c - c / denom;
                            })();
                            const isUp = deltaUsd >= 0;
                            const amountDisplayDecimals = typeof tokenInfo?.displayDecimals === 'number' ? tokenInfo.displayDecimals : 4;
                            return (
                              <div key={tb.symbol} className="flex items-center justify-between h-[64px] pl-6 pr-6 group">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-6 h-6 rounded-full overflow-hidden bg-background flex-shrink-0">
                                    <Image src={iconSrc} alt={tb.symbol} width={24} height={24} className="w-full h-full object-cover" />
                                  </div>
                                  <div className="flex flex-col min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium truncate max-w-[140px]">{tb.symbol}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex flex-col items-end whitespace-nowrap pl-2 gap-1">
                                  <span className="text-sm text-foreground font-medium leading-none">{formatUSD(tb.usdValue)}</span>
                                  <div className="flex items-center gap-2 leading-none" style={{ marginTop: 2 }}>
                                    <span className="text-xs text-muted-foreground group-hover:hidden">
                                      {tb.balance.toLocaleString('de-DE', { minimumFractionDigits: amountDisplayDecimals, maximumFractionDigits: amountDisplayDecimals })}
                                    </span>
                                    <span className={`hidden group-hover:inline-flex items-center gap-1 text-xs ${isUp ? 'text-green-500' : 'text-red-500'}`}>
                                      {isUp ? (<ArrowUpRight className="h-3 w-3" />) : (<ArrowDownRight className="h-3 w-3" />)}
                                      {Math.abs(ch).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
          </div>

          {/* Right-side: Balances (desktop only) */}
           {!isIntegrateBalances && (
             <aside className="lg:flex-none" style={{ width: viewportWidth >= 1024 ? '450px' : '100%' }}>
            <div className="mb-2 flex items-center gap-2 justify-between">
              <button
                type="button"
                className="px-2 py-1 text-xs rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-foreground brightness-110"
                style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
              >
                Balances
              </button>
              {/* Claim Faucet button aligned to the right, styled like selector */}
              {(() => {
                // Use synced cached last claim ts to mirror sidebar behavior
                // -1 (unknown) should render a neutral disabled state (no active claim button)
                const last = faucetLastClaimTs < 0 ? -1 : Number(faucetLastClaimTs || 0);
                const now = Math.floor(Date.now() / 1000);
                // If we have onchain timestamp, prefer it for gating
                const onchainLast = faucetLastCalledOnchain ? Number(faucetLastCalledOnchain) : null;
                const effectiveLast = onchainLast && onchainLast > 0 ? onchainLast : (last >= 0 ? last : -1);
                const canClaim = isConnected && currentChainId === baseSepolia.id && effectiveLast >= 0 && (effectiveLast === 0 || now - effectiveLast >= 24 * 60 * 60);
                const handleClick = async () => {
                  if (!canClaim) {
                    toast.error('Can only claim once per day', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                    return;
                  }
                  try {
                    setIsFaucetBusy(true);
                    const res = await fetch('/api/misc/faucet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userAddress: accountAddress, chainId: baseSepolia.id }) });
                    const data = await res.json();
                    if (!res.ok) {
                      const msg = (data?.errorDetails || data?.message || '').toLowerCase();
                      if (msg.includes('once per day')) {
                        toast.error('Can only claim once per day', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                      } else {
                        toast.error(data?.errorDetails || data?.message || 'API Error', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                      }
                      setIsFaucetBusy(false);
                      return;
                    }
                    toast.info('Sending faucet transaction to wallet...');
                    // Prompt wallet just like sidebar
                    writeContract({
                      address: data.to as `0x${string}`,
                      abi: faucetAbi,
                      functionName: 'faucet',
                      args: [],
                      chainId: data.chainId,
                    }, {
                      onSuccess: (hash) => {
                        setFaucetHash(hash);
                        // Refresh onchain timestamp after sending
                        setTimeout(() => { try { refetchFaucetOnchain?.(); } catch {} }, 1000);
                      }
                    } as any);
                  } catch (e: any) {
                    toast.error(`Error during faucet action: ${e?.message || 'Unknown error'}`);
                    setIsFaucetBusy(false);
                  }
                };
                // Disable only when processing/confirming, like sidebar
                const disabled = Boolean(isFaucetBusy || isFaucetConfirming);
                const className = canClaim
                  ? `px-2 py-1 text-xs rounded-md border border-sidebar-primary bg-[#3d271b] text-sidebar-primary transition-colors ${disabled ? 'opacity-70 cursor-not-allowed' : 'hover:bg-[#4a2f22]'}`
                  : `px-2 py-1 text-xs rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-muted-foreground transition-colors ${disabled || last < 0 ? 'opacity-70 cursor-not-allowed' : 'hover:bg-muted/60'}`;
                const style = canClaim ? undefined : { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } as React.CSSProperties;
                return (
                  <button type="button" onClick={handleClick} className={className} style={style} disabled={disabled || last < 0}>
                    {disabled ? 'Processing…' : (last < 0 ? '—' : 'Claim Faucet')}
                  </button>
                );
              })()}
            </div>
            <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
              <div className="flex items-center justify-between pl-6 pr-6 py-3 border-b border-sidebar-border/60 text-xs text-muted-foreground">
                <span className="tracking-wider font-mono font-bold">TOKEN</span>
                <button type="button" className="group inline-flex items-center" onClick={() => setBalancesSortDir((d) => d === 'desc' ? 'asc' : 'desc')}>
                  <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">VALUE</span>
                  {renderSortIcon(balancesSortDir)}
                </button>
              </div>
               <div className="p-0">
                 {isLoadingWalletBalances ? (
                   <BalancesListSkeleton />
                 ) : (walletBalances.length || 0) === 0 ? (
                   <div className="text-sm text-muted-foreground px-6 py-6">No token balances.</div>
                 ) : (
                  <div className="flex flex-col divide-y divide-sidebar-border/60">
                    {(() => {
                      const sorted = [...walletBalances].sort((a, b) => balancesSortDir === 'asc' ? a.usdValue - b.usdValue : b.usdValue - a.usdValue);
                      return sorted;
                    })().map((tb) => {
                      const tokenInfo = getToken(tb.symbol) as any;
                      const iconSrc = tokenInfo?.icon || '/placeholder.svg';
                      const ch = walletPriceChange24hPctMap?.[tb.symbol] ?? 0;
                      const deltaUsd = (() => {
                        const c = tb.usdValue || 0;
                        const denom = 1 + (isFinite(ch) ? ch : 0) / 100;
                        if (denom === 0) return 0;
                        return c - c / denom;
                      })();
                      const isUp = deltaUsd >= 0;
                      const amountDisplayDecimals = typeof tokenInfo?.displayDecimals === 'number' ? tokenInfo.displayDecimals : 4;
                      return (
                        <div key={tb.symbol} className="flex items-center justify-between h-[64px] pl-6 pr-6 group">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-full overflow-hidden bg-background flex-shrink-0">
                              <Image src={iconSrc} alt={tb.symbol} width={24} height={24} className="w-full h-full object-cover" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate max-w-[140px]">{tb.symbol}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end whitespace-nowrap pl-2 gap-1">
                            {/* Top line: current USD (always visible) */}
                            <span className="text-sm text-foreground font-medium leading-none">{formatUSD(tb.usdValue)}</span>
                            {/* Second line: default shows token amount; on hover shows PnL % (no $ PnL) */}
                            <div className="flex items-center gap-2 leading-none" style={{ marginTop: 2 }}>
                              <span className="text-xs text-muted-foreground group-hover:hidden">
                                {tb.balance.toLocaleString('de-DE', { minimumFractionDigits: amountDisplayDecimals, maximumFractionDigits: amountDisplayDecimals })}
                              </span>
                              <span className={`hidden group-hover:inline-flex items-center gap-1 text-xs ${isUp ? 'text-green-500' : 'text-red-500'}`}>
                                {isUp ? (<ArrowUpRight className="h-3 w-3" />) : (<ArrowDownRight className="h-3 w-3" />)}
                                {Math.abs(ch).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </aside>
          )}
        </div>
        {/* no third state below 1100px */}
      </div>
        {/* Add Liquidity Modal */}
        <Dialog open={showIncreaseModal} onOpenChange={setShowIncreaseModal}>
          <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-lg border border-border shadow-lg [&>button]:hidden" style={{ backgroundColor: 'var(--modal-background)' }}>
            {positionToModify && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Current Position</span>
                  {!positionToModify.isInRange && (
                    <div className="inline-flex items-center border px-2.5 py-0.5 text-xs bg-[#3d271b] text-sidebar-primary border-sidebar-primary rounded-md">
                      Out of Range
                    </div>
                  )}
                </div>
                <div className="p-3 border border-dashed rounded-md bg-muted/10 space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Image src={getTokenIconSrc(positionToModify.token0.symbol)} alt={positionToModify.token0.symbol} width={20} height={20} className="rounded-full" />
                      <span className="text-sm font-medium">{positionToModify.token0.symbol}</span>
                    </div>
                    <span className="text-sm font-medium">{formatTokenDisplayAmount(positionToModify.token0.amount)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Image src={getTokenIconSrc(positionToModify.token1.symbol)} alt={positionToModify.token1.symbol} width={20} height={20} className="rounded-full" />
                      <span className="text-sm font-medium">{positionToModify.token1.symbol}</span>
                    </div>
                    <span className="text-sm font-medium">{formatTokenDisplayAmount(positionToModify.token1.amount)}</span>
                  </div>
                </div>

                {/* Percentage Slider (Add Liquidity) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={increasePercentage}
                      onChange={(e) => handleIncreasePercentageChange(parseInt(e.target.value))}
                      className="flex-1 h-2 rounded-lg appearance-none cursor-pointer slider focus:outline-none focus:ring-0 focus:ring-offset-0"
                      style={{
                        background:
                          increasePercentage > 0
                            ? `linear-gradient(to right, #f45502 0%, #f45502 ${increasePercentage}%, rgb(41 41 41 / 0.3) ${increasePercentage}%, rgb(41 41 41 / 0.3) 100%)`
                            : 'rgb(41 41 41 / 0.3)'
                      }}
                    />
                    <span className="text-sm text-muted-foreground min-w-[3rem] text-right">{increasePercentage}%</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="increase-amount0" className="text-sm font-medium">Add</Label>
                      <Button variant="ghost" className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" onClick={() => {
                        const bal = token0BalanceData?.formatted || '0';
                        setIncreaseAmount0(bal);
                        setIncreaseActiveInputSide('amount0');
                        if (parseFloat(bal) > 0) calculateIncreaseAmount(bal, 'amount0', positionToModify);
                      }} disabled={isIncreasingLiquidity || isIncreaseCalculating}>
                        Balance: {displayToken0Balance} {positionToModify.token0.symbol}
                      </Button>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                          <Image src={getTokenIconSrc(positionToModify.token0.symbol)} alt={positionToModify.token0.symbol} width={20} height={20} className="rounded-full" />
                          <span className="text-sm font-medium">{positionToModify.token0.symbol}</span>
                        </div>
                        <div className="flex-1">
                          <Input id="increase-amount0" placeholder="0.0" value={increaseAmount0} onChange={(e) => {
                            const v = e.target.value;
                            handleIncreaseAmountChange(v, 'amount0');
                            if (v && parseFloat(v) > 0) calculateIncreaseAmount(v, 'amount0', positionToModify); else setIncreaseAmount1('');
                          }} disabled={isIncreaseCalculating && increaseActiveInputSide === 'amount1'} className="border-0 bg-transparent text-right text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto" />
                        </div>
                      </div>
                    </div>
                    {isIncreaseCalculating && increaseActiveInputSide === 'amount0' && (<div className="text-xs text-muted-foreground mt-1">Calculating...</div>)}
                  </div>

                  <div className="flex justify-center items-center my-2">
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
                      <PlusIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="increase-amount1" className="text-sm font-medium">Add</Label>
                      <Button variant="ghost" className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" onClick={() => {
                        const bal = token1BalanceData?.formatted || '0';
                        setIncreaseAmount1(bal);
                        setIncreaseActiveInputSide('amount1');
                        if (parseFloat(bal) > 0) calculateIncreaseAmount(bal, 'amount1', positionToModify);
                      }} disabled={isIncreasingLiquidity || isIncreaseCalculating}>
                        Balance: {displayToken1Balance} {positionToModify.token1.symbol}
                      </Button>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                          <Image src={getTokenIconSrc(positionToModify.token1.symbol)} alt={positionToModify.token1.symbol} width={20} height={20} className="rounded-full" />
                          <span className="text-sm font-medium">{positionToModify.token1.symbol}</span>
                        </div>
                        <div className="flex-1">
                          <Input id="increase-amount1" placeholder="0.0" value={increaseAmount1} onChange={(e) => {
                            const v = e.target.value;
                            handleIncreaseAmountChange(v, 'amount1');
                            if (v && parseFloat(v) > 0) calculateIncreaseAmount(v, 'amount1', positionToModify); else setIncreaseAmount0('');
                          }} disabled={isIncreaseCalculating && increaseActiveInputSide === 'amount0'} className="border-0 bg-transparent text-right text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto" />
                        </div>
                      </div>
                    </div>
                    {isIncreaseCalculating && increaseActiveInputSide === 'amount1' && (<div className="text-xs text-muted-foreground mt-1">Calculating...</div>)}
                  </div>
                </div>
              </div>
            )}
            <DialogFooter className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50" onClick={() => { setShowIncreaseModal(false); }} disabled={isIncreasingLiquidity} style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
                Cancel
              </Button>
              <Button className={isIncreasingLiquidity || isIncreaseCalculating ? "relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75" : "text-sidebar-primary border border-sidebar-primary bg-[#3d271b] hover:bg-[#3d271b]/90"} onClick={() => {
                if (!positionToModify || (!increaseAmount0 && !increaseAmount1)) { toast.error('Please enter at least one amount to add'); return; }
                const data: IncreasePositionData = {
                  tokenId: positionToModify.positionId,
                  token0Symbol: positionToModify.token0.symbol as TokenSymbol,
                  token1Symbol: positionToModify.token1.symbol as TokenSymbol,
                  additionalAmount0: increaseAmount0 || '0',
                  additionalAmount1: increaseAmount1 || '0',
                  poolId: positionToModify.poolId,
                  tickLower: positionToModify.tickLower,
                  tickUpper: positionToModify.tickUpper,
                };
                increaseLiquidity(data);
                setShowIncreaseModal(false);
              }} disabled={isIncreasingLiquidity || isIncreaseCalculating || ((!increaseAmount0 || parseFloat(increaseAmount0) <= 0) && (!increaseAmount1 || parseFloat(increaseAmount1) <= 0))} style={(isIncreasingLiquidity || isIncreaseCalculating) ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
                {isIncreasingLiquidity ? (<><RefreshCwIcon className="mr-2 h-4 w-4 animate-spin" /><span className="animate-pulse">Adding...</span></>) : ('Add Liquidity')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Withdraw Modal */}
        <Dialog open={showWithdrawModal} onOpenChange={setShowWithdrawModal}>
          <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-lg border border-border shadow-lg [&>button]:hidden" style={{ backgroundColor: 'var(--modal-background)' }}>
            {positionToWithdraw && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Current Position</span>
                  {!positionToWithdraw.isInRange && (
                    <div className="inline-flex items-center border px-2.5 py-0.5 text-xs bg-[#3d271b] text-sidebar-primary border-sidebar-primary rounded-md">
                      Out of Range
                    </div>
                  )}
                </div>
                <div className="p-3 border border-dashed rounded-md bg-muted/10 space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Image src={getTokenIconSrc(positionToWithdraw.token0.symbol)} alt={positionToWithdraw.token0.symbol} width={20} height={20} className="rounded-full" />
                      <span className="text-sm font-medium">{positionToWithdraw.token0.symbol}</span>
                    </div>
                    <span className="text-sm font-medium">{formatTokenDisplayAmount(positionToWithdraw.token0.amount)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Image src={getTokenIconSrc(positionToWithdraw.token1.symbol)} alt={positionToWithdraw.token1.symbol} width={20} height={20} className="rounded-full" />
                      <span className="text-sm font-medium">{positionToWithdraw.token1.symbol}</span>
                    </div>
                    <span className="text-sm font-medium">{formatTokenDisplayAmount(positionToWithdraw.token1.amount)}</span>
                  </div>
                </div>

                {/* Percentage Slider (Withdraw) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={withdrawPercentage}
                      onChange={(e) => handleWithdrawPercentageChange(parseInt(e.target.value))}
                      className="flex-1 h-2 rounded-lg appearance-none cursor-pointer slider focus:outline-none focus:ring-0 focus:ring-offset-0"
                      style={{
                        background:
                          withdrawPercentage > 0
                            ? `linear-gradient(to right, #f45502 0%, #f45502 ${withdrawPercentage}%, rgb(41 41 41 / 0.3) ${withdrawPercentage}%, rgb(41 41 41 / 0.3) 100%)`
                            : 'rgb(41 41 41 / 0.3)'
                      }}
                    />
                    <span className="text-sm text-muted-foreground min-w-[3rem] text-right">{withdrawPercentage}%</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="withdraw-amount0" className="text-sm font-medium">Withdraw</Label>
                      <Button variant="ghost" className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" onClick={() => {
                        const max0 = positionToWithdraw.token0.amount;
                        const max1 = positionToWithdraw.token1.amount;
                        setWithdrawAmount0(max0);
                        setWithdrawAmount1(max1);
                        setWithdrawActiveInputSide('amount0');
                      }} disabled={isDecreasingLiquidity}>
                        Balance: {formatTokenDisplayAmount(positionToWithdraw.token0.amount)}
                      </Button>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                          <Image src={getTokenIconSrc(positionToWithdraw.token0.symbol)} alt={positionToWithdraw.token0.symbol} width={20} height={20} className="rounded-full" />
                          <span className="text-sm font-medium">{positionToWithdraw.token0.symbol}</span>
                        </div>
                        <div className="flex-1">
                          <Input id="withdraw-amount0" placeholder="0.0" value={withdrawAmount0} onChange={(e) => {
                            const v = e.target.value;
                            const max = parseFloat(positionToWithdraw.token0.amount);
                            if (parseFloat(v) > max) { handleWithdrawAmountChange(String(max), 'amount0'); return; }
                            handleWithdrawAmountChange(v, 'amount0');
                            if (v && parseFloat(v) > 0) calculateWithdrawAmount(v, 'amount0', positionToWithdraw); else setWithdrawAmount1('');
                          }} disabled={isWithdrawCalculating && withdrawActiveInputSide === 'amount1'} className="border-0 bg-transparent text-right text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto" />
                        </div>
                      </div>
                    </div>
                    {isWithdrawCalculating && withdrawActiveInputSide === 'amount0' && (<div className="text-xs text-muted-foreground mt-1">Calculating...</div>)}
                  </div>

                  <div className="flex justify-center items-center my-2">
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
                      <PlusIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label htmlFor="withdraw-amount1" className="text-sm font-medium">Withdraw</Label>
                      <Button variant="ghost" className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" onClick={() => {
                        const max0 = positionToWithdraw.token0.amount;
                        const max1 = positionToWithdraw.token1.amount;
                        setWithdrawAmount0(max0);
                        setWithdrawAmount1(max1);
                        setWithdrawActiveInputSide('amount1');
                      }} disabled={isDecreasingLiquidity}>
                        Balance: {formatTokenDisplayAmount(positionToWithdraw.token1.amount)}
                      </Button>
                    </div>
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                          <Image src={getTokenIconSrc(positionToWithdraw.token1.symbol)} alt={positionToWithdraw.token1.symbol} width={20} height={20} className="rounded-full" />
                          <span className="text-sm font-medium">{positionToWithdraw.token1.symbol}</span>
                        </div>
                        <div className="flex-1">
                          <Input id="withdraw-amount1" placeholder="0.0" value={withdrawAmount1} onChange={(e) => {
                            const v = e.target.value;
                            const max = parseFloat(positionToWithdraw.token1.amount);
                            if (parseFloat(v) > max) { handleWithdrawAmountChange(String(max), 'amount1'); return; }
                            handleWithdrawAmountChange(v, 'amount1');
                            if (v && parseFloat(v) > 0) calculateWithdrawAmount(v, 'amount1', positionToWithdraw); else setWithdrawAmount0('');
                          }} disabled={isWithdrawCalculating && withdrawActiveInputSide === 'amount0'} className="border-0 bg-transparent text-right text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto" />
                        </div>
                      </div>
                    </div>
                    {isWithdrawCalculating && withdrawActiveInputSide === 'amount1' && (<div className="text-xs text-muted-foreground mt-1">Calculating...</div>)}
                  </div>
                </div>
              </div>
            )}
            <DialogFooter className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50" onClick={() => { setShowWithdrawModal(false); }} disabled={isDecreasingLiquidity} style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
                Cancel
              </Button>
              <Button className="text-sidebar-primary border border-sidebar-primary bg-[#3d271b] hover:bg-[#3d271b]/90" onClick={() => {
                if (!positionToWithdraw || (!withdrawAmount0 && !withdrawAmount1)) { toast.error('Please enter at least one amount to withdraw'); return; }
                const data: DecreasePositionData = {
                  tokenId: positionToWithdraw.positionId,
                  token0Symbol: positionToWithdraw.token0.symbol as TokenSymbol,
                  token1Symbol: positionToWithdraw.token1.symbol as TokenSymbol,
                  decreaseAmount0: withdrawAmount0 || '0',
                  decreaseAmount1: withdrawAmount1 || '0',
                  isFullBurn: false,
                  poolId: positionToWithdraw.poolId,
                  tickLower: positionToWithdraw.tickLower,
                  tickUpper: positionToWithdraw.tickUpper,
                };
                decreaseLiquidity(data, 0);
                setShowWithdrawModal(false);
              }} disabled={isDecreasingLiquidity || ((!withdrawAmount0 || parseFloat(withdrawAmount0) <= 0) && (!withdrawAmount1 || parseFloat(withdrawAmount1) <= 0))}>
                Withdraw
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
          const showTip = (() => {
            if (s.pct < SMALL_SEGMENT_THRESHOLD) return true;
            // also show hover label if name would be hidden
            const segWidth = (segmentPixelWidths[i] || 0);
            const estChar = 7;
            const name = String(s.label || '');
            const estNameWidth = name.length * estChar;
            const estPctWidth = (`${pctRounded}%`).length * estChar;
            const minGap = 6;
            const required = estPctWidth + minGap + estNameWidth;
            return segWidth < required;
          })();
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
          // Re-add popup only for cases where label isn't shown (small or hidden)
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
      <div className="relative mt-0 text-xs" style={{ height: '14px', width: `${Math.max(0, Math.round(availableWidth))}px`, overflow: 'visible' }}>
        {(() => {
          let hideNamesFromIndex: number | null = null;
          // Disable cascade-right behavior; do not hide following percentages
          const hoveredNeedsCascade = false;
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
            // No cascade-right; never hide following percentages
            const hideFollowingPct = false;
            // If hovered and the name cannot fit, hide the inline percent for subsequent segments and do NOT force show the name for the hovered segment
            // This preserves a clear single hover focus without crowding
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
            ) : `${pctRounded}% ${segment.label}`;
            
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
            // For wide (inline) tick visual: show tooltip when name is hidden or for REST
            if (layout !== 'block' && (isRest || nameHiddenInline)) {
              return (
                <Tooltip key={`hover-zone-wrap-${segmentIndex}`} open={hoverIdx === segmentIndex}>
                  <TooltipTrigger asChild>{zone}</TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs" style={{ pointerEvents: 'none' }}>
                    {content}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return zone;
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
                      // Show name only if it fits; do not force it on hover. Keep selected behavior.
                      if (isSelected) showName = true;
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
                // Wide inline: force show name on hover/selected and let it overflow
                if (isHovered || isSelected) showName = true;
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
                        maxWidth: (isHovered || isSelected) ? undefined : `${Math.max(0, availableLabelWidth - estPctWidth - minGap)}px`,
                        overflow: (isHovered || isSelected) ? 'visible' : 'hidden',
                        textOverflow: (isHovered || isSelected) ? 'clip' : 'ellipsis',
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

