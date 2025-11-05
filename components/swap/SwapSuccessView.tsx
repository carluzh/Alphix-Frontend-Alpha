"use client";

import React from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import {
  ChevronRightIcon,
  WalletIcon,
  CircleCheck
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAccount } from "wagmi";
import { useEffect } from "react";
import { invalidateAfterTx } from "@/lib/invalidation";
import { useQueryClient } from '@tanstack/react-query';
import { getAllPools, getPoolSubgraphId } from "@/lib/pools-config";
import { baseSepolia } from "@/lib/wagmiConfig";
import { Token, SwapTxInfo } from './swap-interface'; // Assuming types are exported

interface SwapSuccessViewProps {
  displayFromToken: Token;
  displayToToken: Token;
  calculatedValues: {
    fromTokenAmount: string;
    fromTokenValue: string;
    toTokenAmount: string;
    toTokenValue: string;
    fees: Array<{ name: string; value: string; type: string }>;
    slippage: string;
  };
  swapTxInfo: SwapTxInfo | null;
  handleChangeButton: () => void;
  formatTokenAmountDisplay: (amount: string, token: Token) => string; // Updated to use Token objects
}

export function SwapSuccessView({ 
  displayFromToken,
  displayToToken,
  calculatedValues,
  swapTxInfo,
  handleChangeButton,
  formatTokenAmountDisplay
}: SwapSuccessViewProps) {
  const { address: accountAddress } = useAccount();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!accountAddress) return;

    (async () => {
      try {
        const pools = getAllPools?.() || [];
        const symA = (swapTxInfo?.fromSymbol || displayFromToken.symbol || '').toUpperCase();
        const symB = (swapTxInfo?.toSymbol || displayToToken.symbol || '').toUpperCase();
        const match = pools.find((p: any) => {
          const a = String(p?.currency0?.symbol || '').toUpperCase();
          const b = String(p?.currency1?.symbol || '').toUpperCase();
          return (a === symA && b === symB) || (a === symB && b === symA);
        });

        if (match) {
          const routeId = String(match.id || `${match.currency0?.symbol}-${match.currency1?.symbol}`).toLowerCase();
          const subgraphId = (getPoolSubgraphId(routeId) || match.subgraphId || match.id || '').toLowerCase();

          if (routeId && subgraphId) {
            try { localStorage.setItem(`recentSwap:${routeId}`, String(Date.now())); } catch {}

            await invalidateAfterTx(queryClient, {
              owner: accountAddress,
              poolId: subgraphId,
              reason: 'swap'
            });
          }
        }

        const touched = (swapTxInfo as any)?.touchedPools as Array<{ poolId: string; subgraphId?: string } | undefined> | undefined;
        if (Array.isArray(touched) && touched.length) {
          for (const tp of touched) {
            if (!tp) continue;
            const pid = String(tp.poolId || '').toLowerCase();
            const sg = String(tp.subgraphId || getPoolSubgraphId(pid) || pid).toLowerCase();
            if (!pid || !sg) continue;

            try { localStorage.setItem(`recentSwap:${pid}`, String(Date.now())); } catch {}

            await invalidateAfterTx(queryClient, {
              owner: accountAddress,
              poolId: sg,
              reason: 'swap'
            });
          }
        }

        // Deterministic Volume backoff: wait until 24h Volume changes, then warm server cache
        try {
          const delays = [0, 2000, 5000, 10000];
          // Build target set of pools (single-hop fallback + any multi-hop provided)
          const targets: Array<{ poolId: string; subId: string }> = [];
          const singleRouteId = (match && (String(match.id || `${match.currency0?.symbol}-${match.currency1?.symbol}`).toLowerCase())) || '';
          const singleSub = (singleRouteId && (getPoolSubgraphId(singleRouteId) || match?.subgraphId || match?.id || '')).toLowerCase();
          if (singleRouteId && singleSub) targets.push({ poolId: singleRouteId, subId: singleSub });
          if (Array.isArray(touched)) {
            for (const tp of touched) {
              if (!tp?.poolId) continue;
              const pid = String(tp.poolId).toLowerCase();
              const sg = String(tp.subgraphId || getPoolSubgraphId(pid) || pid).toLowerCase();
              if (pid && sg && !targets.some(t => t.subId === sg)) targets.push({ poolId: pid, subId: sg });
            }
          }
          if (targets.length) {
            const getBatch = async () => {
              // DISABLED: Causing duplicate API calls
              // const r = await fetch(`/api/liquidity/get-pools-batch?bust=${Date.now()}&noStore=1`);
              // if (!r.ok) return null;
              // return r.json();
              return null; // Disabled to prevent duplicate calls
            };
            const readVolumes = (json: any) => {
              const byId = new Map<string, number>();
              const pools = Array.isArray(json?.pools) ? json.pools : [];
              for (const t of targets) {
                const m = pools.find((p: any) => String(p?.poolId || '').toLowerCase() === t.subId);
                byId.set(t.subId, Number(m?.volume24hUSD || 0));
              }
              return byId;
            };
            const baseJson = await getBatch();
            if (baseJson) {
              const baseMap = readVolumes(baseJson);
              for (let i = 0; i < delays.length; i++) {
                if (i > 0) await new Promise(r => setTimeout(r, delays[i]));
                // nudge server to recompute; it debounces internally
                try { fetch('/api/internal/revalidate-pools', { method: 'POST' } as any); } catch {}
                const nextJson = await getBatch();
                if (!nextJson) continue;
                const nextMap = readVolumes(nextJson);
                let changed = false;
                for (const [k, v] of nextMap.entries()) {
                  if (v !== (baseMap.get(k) ?? 0)) { changed = true; break; }
                }
                if (changed) {
                  // Warm the cache now that data changed
                  try { await fetch('/api/internal/revalidate-pools', { method: 'POST' } as any); } catch {}
                  break;
                }
              }
            }
          }
        } catch {}
      } catch {}
    })();
  }, [accountAddress, swapTxInfo?.hash]);
  return (
    <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <div 
        className="mb-6 flex items-center justify-between rounded-lg border border-primary p-4 hover:bg-muted/30 transition-colors cursor-pointer" 
        onClick={handleChangeButton}
      >
        <div className="flex items-center gap-3">
          <Image src={displayFromToken.icon} alt={displayFromToken.symbol} width={32} height={32} className="rounded-full"/>
          <div className="text-left flex flex-col">
            <div className="font-medium flex items-baseline">
              {(swapTxInfo?.fromAmount ? formatTokenAmountDisplay(swapTxInfo.fromAmount, displayFromToken) : "0") === "< 0.001" ? (
                <span className="text-xs text-muted-foreground">{swapTxInfo?.fromAmount ? formatTokenAmountDisplay(swapTxInfo.fromAmount, displayFromToken) : "0"}</span>
              ) : (
                <span className="text-sm">{swapTxInfo?.fromAmount ? formatTokenAmountDisplay(swapTxInfo.fromAmount, displayFromToken) : "0"}</span>
              )}
              <span className="ml-1 text-xs text-muted-foreground">{swapTxInfo?.fromSymbol || displayFromToken.symbol}</span>
            </div>
            <div className="text-xs text-muted-foreground">{calculatedValues.fromTokenValue}</div>
          </div>
        </div>
        <ChevronRightIcon className="h-4 w-4 text-muted-foreground mx-2" />
        <div className="flex items-center gap-3">
          <div className="text-right flex flex-col">
            <div className="font-medium flex items-baseline">
              {(swapTxInfo?.toAmount ? formatTokenAmountDisplay(swapTxInfo.toAmount, displayToToken) : "0") === "< 0.001" ? (
                <span className="text-xs text-muted-foreground">{swapTxInfo?.toAmount ? formatTokenAmountDisplay(swapTxInfo.toAmount, displayToToken) : "0"}</span>
              ) : (
                <span className="text-sm">{swapTxInfo?.toAmount ? formatTokenAmountDisplay(swapTxInfo.toAmount, displayToToken) : "0"}</span>
              )}
              <span className="ml-1 text-xs text-muted-foreground">{swapTxInfo?.toSymbol || displayToToken.symbol}</span>
            </div>
            <div className="text-xs text-muted-foreground">{calculatedValues.toTokenValue}</div>
          </div>
          <Image src={displayToToken.icon} alt={displayToToken.symbol} width={32} height={32} className="rounded-full"/>
        </div>
      </div>
      <div className="my-8 flex flex-col items-center justify-center">
        <motion.div
          className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-button border border-primary overflow-hidden"
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          style={{
            backgroundImage: 'url(/pattern_wide.svg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
        >
          <CircleCheck className="h-8 w-8 text-sidebar-primary" />
        </motion.div>
        <div className="text-center">
          <h3 className="text-lg font-medium">Swapped</h3>
          <p className="text-muted-foreground mt-1">{swapTxInfo?.fromSymbol || displayFromToken.symbol} for {swapTxInfo?.toSymbol || displayToToken.symbol}</p>
        </div>
      </div>
      <div className="mb-2 flex items-center justify-center">
        <Button
          variant="link"
          className="text-xs font-normal text-muted-foreground hover:text-muted-foreground/80"
          onClick={() => window.open(swapTxInfo?.explorerUrl || `https://base-sepolia.blockscout.com/`, "_blank")}
        >
          View on Explorer
        </Button>
      </div>
      <Button
        variant="outline"
        className="w-full relative border border-primary bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 text-white/75"
        onClick={handleChangeButton}
        style={{ backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
      >
        Swap again
      </Button>
    </motion.div>
  );
} 