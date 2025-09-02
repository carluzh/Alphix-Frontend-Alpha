"use client";

import React from "react";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { TOKEN_DEFINITIONS } from "@/lib/pools-config";
import { loadUncollectedFees } from "@/lib/client-cache";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

interface FeesCellProps {
  positionId: string;
  sym0: string;
  sym1: string;
  price0: number;
  price1: number;
  refreshKey?: number;
  prefetchedRaw0?: string | null;
  prefetchedRaw1?: string | null;
}

export function FeesCell({
  positionId,
  sym0,
  sym1,
  price0,
  price1,
  refreshKey = 0,
  prefetchedRaw0,
  prefetchedRaw1,
}: FeesCellProps) {
  const { address: accountAddress } = useAccount();
  const [raw0, setRaw0] = React.useState<string | null>(null);
  const [raw1, setRaw1] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [priceOverrides, setPriceOverrides] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        // If parent provided prefetched values, use them and skip fetching
        if (typeof prefetchedRaw0 === 'string' && typeof prefetchedRaw1 === 'string') {
          if (!cancelled) {
            setRaw0(prefetchedRaw0);
            setRaw1(prefetchedRaw1);
            setLoading(false);
            setLastError(null);
          }
          return;
        }
        setLoading(true);
        setLastError(null);
        const data = await loadUncollectedFees(positionId, 60 * 1000);
        if (!cancelled && data) {
          setRaw0(data.amount0 ?? null);
          setRaw1(data.amount1 ?? null);
        }
        if (!cancelled && !data) {
          setLastError("unknown");
        }
      } catch (e: any) {
        if (!cancelled) setLastError(String(e?.message || "request failed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [positionId, refreshKey, prefetchedRaw0, prefetchedRaw1]);

  // Lazy price fallback: if a price is missing/zero, try fetching shared server prices once
  React.useEffect(() => {
    let cancelled = false;
    const needs0 = !(Number.isFinite(price0) && price0 > 0);
    const needs1 = !(Number.isFinite(price1) && price1 > 0);
    if (!needs0 && !needs1) return;
    (async () => {
      try {
        const res = await fetch('/api/prices/get-token-prices');
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json || typeof json !== 'object') return;
        setPriceOverrides(json as Record<string, number>);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [price0, price1]);

  const fmtUsd = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return "$0";
    if (n < 0.01) return "< $0.01";
    return `$${n.toLocaleString("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })}`;
  };

  const formatTokenAmount = (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return "0";
    if (amount < 0.001) return "< 0.001";
    return amount.toLocaleString("en-US", {
      maximumFractionDigits: 6,
      minimumFractionDigits: 0,
    });
  };

  if (loading)
    return (
      <span className="inline-block h-3 w-12 rounded bg-muted/40 animate-pulse align-middle" />
    );
  if (raw0 === null || raw1 === null)
    return (
      <span
        className="text-muted-foreground"
        title={lastError ? `Fees unavailable: ${lastError}` : undefined}
      >
        N/A
      </span>
    );

  const d0 = TOKEN_DEFINITIONS?.[sym0 as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;
  const d1 = TOKEN_DEFINITIONS?.[sym1 as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;
  let amt0 = 0;
  let amt1 = 0;
  try {
    amt0 = parseFloat(formatUnits(BigInt(raw0), d0));
  } catch {}
  try {
    amt1 = parseFloat(formatUnits(BigInt(raw1), d1));
  } catch {}
  const sym0U = (sym0 || '').toUpperCase();
  const sym1U = (sym1 || '').toUpperCase();
  const stable = (s: string) => s.includes('USDC') || s.includes('USDT');
  const effPrice0 = (Number.isFinite(price0) && price0 > 0)
    ? price0
    : (priceOverrides[sym0U] ?? (stable(sym0U) ? 1 : 0));
  const effPrice1 = (Number.isFinite(price1) && price1 > 0)
    ? price1
    : (priceOverrides[sym1U] ?? (stable(sym1U) ? 1 : 0));
  const usd = amt0 * (effPrice0 || 0) + amt1 * (effPrice1 || 0);

  // Debug logging for all positions
  console.log(`[FeesCell DEBUG] Position ${positionId}: ${sym0}=${amt0} * $${effPrice0} + ${sym1}=${amt1} * $${effPrice1} = $${usd.toFixed(4)}`);

  // If there are no raw amounts, show plain text without hover
  if (BigInt(raw0) <= 0n && BigInt(raw1) <= 0n) {
    return (
      <span className="whitespace-nowrap text-muted-foreground">
        $0
      </span>
    );
  }

  // There are some fees; ensure UI never shows "$0". If USD unknown or tiny, show "< $0.01".
  const showLessThanMin = !Number.isFinite(usd) || usd < 0.01;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <span className="whitespace-nowrap cursor-default hover:text-foreground transition-colors">
          {showLessThanMin ? "< $0.01" : fmtUsd(usd)}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-48 p-2 border border-sidebar-border bg-[#0f0f0f] text-xs shadow-lg rounded-lg"
      >
        <div className="grid gap-1">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{sym0}</span>
            <span className="font-mono tabular-nums">
              {formatTokenAmount(amt0)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{sym1}</span>
            <span className="font-mono tabular-nums">
              {formatTokenAmount(amt1)}
            </span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
