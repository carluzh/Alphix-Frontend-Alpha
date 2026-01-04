"use client";

import React, { useMemo, useCallback } from "react";
import Image from "next/image";
import { formatUnits as viemFormatUnits } from "viem";
import { getAllPools, getToken } from "@/lib/pools-config";
import { formatUSD } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { PositionCardCompact } from "@/components/liquidity/PositionCardCompact";
import { calculateRealizedApr } from "@/lib/apr";
import { Percent } from "@uniswap/sdk-core";
import { cn } from "@/lib/utils";
import { ActivePositionsSkeleton } from "./skeletons";
import type { OverviewData } from "../hooks";
import { parseSubgraphPosition, type SubgraphPosition, type PositionInfo } from "@/lib/uniswap/liquidity";
import { useNetwork } from "@/lib/network-context";

interface PositionsSectionProps {
  groupedByPool: Array<{
    poolId: string;
    items: any[];
    totalUSD: number;
  }>;
  activePositions: any[];
  overviewData: OverviewData;
  aprByPoolId: Record<string, string>;
  batchFeesData: Array<{ positionId: string; amount0: string; amount1: string }> | undefined;
  tokenDefinitions: Record<string, { decimals: number; address?: string }>;
  expandedPools: Record<string, boolean>;
  togglePoolExpanded: (poolKey: string) => void;
  isConnected: boolean;
  showSkeleton: boolean;
  isPositionsStale: boolean;
  isNarrowScreen: boolean;
  viewMode: 'folder' | 'list';
  readiness: { core: boolean; prices: boolean; apr: boolean };
  isLoadingPoolStates: boolean;
  getUsdPriceForSymbol: (symbol: string | undefined) => number;
  onPositionClick: (position: any) => void;
  onVisitPool: (position: any) => void;
}

export function PositionsSection({
  groupedByPool,
  activePositions,
  overviewData,
  aprByPoolId,
  batchFeesData,
  tokenDefinitions,
  expandedPools,
  togglePoolExpanded,
  isConnected,
  showSkeleton,
  isPositionsStale,
  isNarrowScreen,
  viewMode,
  readiness,
  isLoadingPoolStates,
  getUsdPriceForSymbol,
  onPositionClick,
  onVisitPool,
}: PositionsSectionProps) {
  const { chainId } = useNetwork();

  // Convert all positions to PositionInfo using parseSubgraphPosition
  const positionInfoMap = useMemo(() => {
    const map = new Map<string, PositionInfo>();
    for (const pos of activePositions) {
      const subgraphPos: SubgraphPosition = {
        positionId: pos.positionId,
        owner: pos.owner || "",
        poolId: pos.poolId,
        token0: {
          address: pos.token0?.address || "",
          symbol: pos.token0?.symbol || "",
          amount: pos.token0?.amount || "0",
        },
        token1: {
          address: pos.token1?.address || "",
          symbol: pos.token1?.symbol || "",
          amount: pos.token1?.amount || "0",
        },
        tickLower: pos.tickLower ?? 0,
        tickUpper: pos.tickUpper ?? 0,
        liquidity: pos.liquidity || "0",
        isInRange: pos.isInRange ?? true,
        token0UncollectedFees: batchFeesData?.find(f => f.positionId === pos.positionId)?.amount0,
        token1UncollectedFees: batchFeesData?.find(f => f.positionId === pos.positionId)?.amount1,
        blockTimestamp: pos.blockTimestamp,
        lastTimestamp: pos.lastTimestamp,
      };

      const token0Decimals = tokenDefinitions?.[pos.token0?.symbol]?.decimals ?? 18;
      const token1Decimals = tokenDefinitions?.[pos.token1?.symbol]?.decimals ?? 18;

      const positionInfo = parseSubgraphPosition(subgraphPos, {
        chainId,
        token0Decimals,
        token1Decimals,
      });

      if (positionInfo) {
        map.set(pos.positionId, positionInfo);
      }
    }
    return map;
  }, [activePositions, chainId, tokenDefinitions, batchFeesData]);

  // Format APR for display
  const formatAprShort = useCallback((n: number): string => {
    if (!Number.isFinite(n)) return '—';
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K%`;
    if (n > 99.99) return `${Math.round(n)}%`;
    if (n > 9.99) return `${n.toFixed(1)}%`;
    return `${n.toFixed(2)}%`;
  }, []);

  // Calculate group APY
  const calculateGroupApy = useCallback((items: any[], poolKey: string) => {
    const aprStr = aprByPoolId[poolKey];
    const poolApr = typeof aprStr === 'string' && aprStr.endsWith('%') ? parseFloat(aprStr.replace('%', '')) : null;

    let weightedApy = 0;
    let groupTotalUsd = 0;

    for (const pos of items) {
      const s0 = pos?.token0?.symbol as string | undefined;
      const s1 = pos?.token1?.symbol as string | undefined;
      const a0 = parseFloat(pos?.token0?.amount || '0');
      const a1 = parseFloat(pos?.token1?.amount || '0');
      const p0 = (s0 && overviewData.priceMap[s0.toUpperCase()]) || (s0 && overviewData.priceMap[s0]) || 0;
      const p1 = (s1 && overviewData.priceMap[s1.toUpperCase()]) || (s1 && overviewData.priceMap[s1]) || 0;
      const posUsd = (isFinite(a0) ? a0 : 0) * p0 + (isFinite(a1) ? a1 : 0) * p1;
      if (posUsd <= 0) continue;

      const feeData = batchFeesData?.find(f => f.positionId === pos.positionId);
      let feesUSD = 0;
      if (feeData) {
        const d0 = (s0 ? tokenDefinitions?.[s0 as string]?.decimals : undefined) ?? 18;
        const d1 = (s1 ? tokenDefinitions?.[s1 as string]?.decimals : undefined) ?? 18;
        try {
          const f0 = parseFloat(viemFormatUnits(BigInt(feeData.amount0 || '0'), d0));
          const f1 = parseFloat(viemFormatUnits(BigInt(feeData.amount1 || '0'), d1));
          feesUSD = (isFinite(f0) ? f0 : 0) * p0 + (isFinite(f1) ? f1 : 0) * p1;
        } catch {}
      }

      const lastTs = pos.lastTimestamp || pos.blockTimestamp || 0;
      const nowTs = Math.floor(Date.now() / 1000);
      const durationDays = (nowTs - lastTs) / 86400;
      const fallbackAprPercent = poolApr !== null && isFinite(poolApr) ? new Percent(Math.round(poolApr * 100), 10000) : null;
      const { apr } = calculateRealizedApr(feesUSD, posUsd, durationDays, fallbackAprPercent);
      weightedApy += posUsd * (apr ? parseFloat(apr.toFixed(2)) : 0);
      groupTotalUsd += posUsd;
    }

    return groupTotalUsd > 0 ? weightedApy / groupTotalUsd : null;
  }, [aprByPoolId, overviewData.priceMap, batchFeesData, tokenDefinitions]);

  if (showSkeleton) {
    return <ActivePositionsSkeleton />;
  }

  if (!isConnected) {
    return (
      <div className="border border-dashed rounded-lg bg-muted/10 p-6 w-full flex items-center justify-center">
        <div className="w-48">
          <ConnectWalletButton />
        </div>
      </div>
    );
  }

  if (activePositions.length === 0) {
    return (
      <div className="border border-dashed rounded-lg bg-muted/10 p-6 w-full flex items-center justify-center">
        <div className="text-sm text-white/75">No active positions.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 lg:gap-4" key={`view-${viewMode}`}>
      {groupedByPool.map(({ poolId, items, totalUSD }) => {
        const poolKey = String(poolId).toLowerCase();
        const first = items[0];
        const isSinglePosition = items.length === 1;
        const isExpanded = !!expandedPools[poolKey];
        const token0Icon = getToken(first?.token0?.symbol || '')?.icon || '/placeholder.svg';
        const token1Icon = getToken(first?.token1?.symbol || '')?.icon || '/placeholder.svg';
        const uniqueKey = viewMode === 'list' ? `list-${first?.positionId}` : `folder-${poolKey}`;

        return (
          <React.Fragment key={uniqueKey}>
            {!isSinglePosition && (
              <div
                className="flex items-center justify-between px-4 py-3 rounded-lg border border-sidebar-border/60 bg-muted/30 hover:bg-muted/40 cursor-pointer"
                onClick={() => togglePoolExpanded(poolKey)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative" style={{ width: '3.5rem', height: '1.75rem' }}>
                    <div className="absolute top-1/2 -translate-y-1/2 left-0 rounded-full overflow-hidden bg-background z-10" style={{ width: 28, height: 28 }}>
                      <Image src={token0Icon} alt={first?.token0?.symbol || ''} width={28} height={28} className="w-full h-full object-cover" />
                    </div>
                    <div className="absolute top-1/2 -translate-y-1/2" style={{ left: '1rem', width: '1.75rem', height: '1.75rem' }}>
                      <div className="absolute inset-0 rounded-full overflow-hidden bg-background z-30">
                        <Image src={token1Icon} alt={first?.token1?.symbol || ''} width={28} height={28} className="w-full h-full object-cover" />
                      </div>
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-main z-20" style={{ width: 32, height: 32 }}></div>
                    </div>
                  </div>
                  <div className="truncate font-normal text-sm">{first?.token0?.symbol}/{first?.token1?.symbol}</div>
                  <TooltipProvider delayDuration={0}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="ml-1 w-5 h-5 flex items-center justify-center text-[10px] rounded bg-button text-muted-foreground cursor-default">
                          {items.length}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">Position Count</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex items-center gap-3">
                  <TooltipProvider delayDuration={0}>
                    {!isNarrowScreen && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="text-xs text-muted-foreground whitespace-nowrap cursor-default">{formatUSD(totalUSD)}</div>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">Total Value</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          {(() => {
                            const groupApy = calculateGroupApy(items, poolKey);
                            return groupApy !== null && groupApy > 0 ? (
                              <span className="h-5 px-2 flex items-center justify-center text-[10px] rounded bg-green-500/20 text-green-500 font-medium">{formatAprShort(groupApy)}</span>
                            ) : (
                              <span className="h-5 px-2 flex items-center justify-center text-[10px] rounded bg-muted/30 text-muted-foreground font-medium">0%</span>
                            );
                          })()}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">APY</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </div>
              </div>
            )}
            {(isSinglePosition || isExpanded) && (
              <div className={cn("flex flex-col gap-3 lg:gap-4", !isSinglePosition && "pl-4 border-l border-dashed border-sidebar-border/60 ml-4")}>
                {items.map((position) => {
                  const positionInfo = positionInfoMap.get(position.positionId);
                  if (!positionInfo) return null;

                  const poolCfgForCard = getAllPools().find(p => p.subgraphId?.toLowerCase() === position.poolId.toLowerCase());
                  const valueUSD = (() => {
                    const sym0 = position?.token0?.symbol as string | undefined;
                    const sym1 = position?.token1?.symbol as string | undefined;
                    const amt0 = parseFloat(position?.token0?.amount || '0');
                    const amt1 = parseFloat(position?.token1?.amount || '0');
                    const price0 = (sym0 && overviewData.priceMap[sym0]) || 0;
                    const price1 = (sym1 && overviewData.priceMap[sym1]) || 0;
                    const a0 = isFinite(amt0) ? amt0 : 0;
                    const a1 = isFinite(amt1) ? amt1 : 0;
                    const p0 = isFinite(price0) ? price0 : 0;
                    const p1 = isFinite(price1) ? price1 : 0;
                    return a0 * p0 + a1 * p1;
                  })();
                  return (
                    <PositionCardCompact
                      key={position.positionId}
                      position={positionInfo}
                      valueUSD={valueUSD}
                      onClick={() => onPositionClick(position)}
                      getUsdPriceForSymbol={getUsdPriceForSymbol}
                      poolType={poolCfgForCard?.type}
                      poolContext={{
                        currentPrice: null,
                        currentPoolTick: null,
                        poolAPR: (() => {
                          const aprStr = aprByPoolId[poolKey];
                          if (!aprStr || aprStr === 'N/A' || aprStr === 'Loading...') return 0;
                          const parsed = parseFloat(aprStr.replace('%', ''));
                          return isFinite(parsed) ? parsed : 0;
                        })(),
                        isLoadingPrices: !readiness.prices,
                        isLoadingPoolStates: isLoadingPoolStates,
                      }}
                      className={isPositionsStale ? 'cache-stale' : undefined}
                      showMenuButton={true}
                      onVisitPool={() => onVisitPool(position)}
                      blockTimestamp={position.blockTimestamp}
                      lastTimestamp={position.lastTimestamp}
                    />
                  );
                })}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default PositionsSection;
