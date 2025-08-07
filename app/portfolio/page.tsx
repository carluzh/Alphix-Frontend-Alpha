"use client";

import { AppLayout } from "@/components/app-layout";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";
import { toast } from "sonner";
import { getToken, TokenSymbol } from "@/lib/pools-config";
import { shortenAddress } from "@/lib/utils";

type PriceApiResponse = {
  BTC: number;
  USDC: number;
  ETH: number;
  USDT: number;
  timestamp: number;
};

function getUnderlyingBaseSymbol(tokenSymbol: string): keyof PriceApiResponse | null {
  if (!tokenSymbol) return null;
  const sym = tokenSymbol.toUpperCase();
  if (sym === "BTC" || sym.includes("BTC")) return "BTC";
  if (sym === "ETH" || sym.includes("ETH")) return "ETH";
  if (sym === "USDC" || sym.includes("USDC")) return "USDC";
  if (sym === "USDT" || sym.includes("USDT")) return "USDT";
  return null;
}

function formatUSD(num: number | undefined) {
  if (!num || !isFinite(num)) return "$0";
  if (num < 0.01) return "$0";
  if (num < 1000) return `$${num.toFixed(2)}`;
  return `$${num.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export default function PortfolioPage() {
  const { address, isConnected } = useAccount();
  const [positions, setPositions] = useState<ProcessedPosition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [prices, setPrices] = useState<PriceApiResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setPositions([]);
      return;
    }

    setIsLoading(true);

    // Fetch both positions and prices in parallel
    Promise.all([
      fetch(`/api/liquidity/get-positions?ownerAddress=${address}`).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
      fetch(`/api/prices/get-token-prices`).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    ])
      .then(([pos, priceData]: [ProcessedPosition[], PriceApiResponse]) => {
        setPositions(Array.isArray(pos) ? pos : []);
        setPrices(priceData);
        setLastUpdated(priceData?.timestamp || Date.now());
      })
      .catch((err) => {
        console.error("Portfolio load error:", err);
        toast.error("Failed loading portfolio", { description: (err as Error)?.message || "Unknown error" });
      })
      .finally(() => setIsLoading(false));
  }, [address, isConnected]);

  // Aggregate holdings per token symbol
  const holdingsByToken = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of positions) {
      const t0 = p.token0.symbol || "";
      const t1 = p.token1.symbol || "";
      const a0 = parseFloat(p.token0.amount || "0");
      const a1 = parseFloat(p.token1.amount || "0");
      if (!isNaN(a0)) map.set(t0, (map.get(t0) || 0) + a0);
      if (!isNaN(a1)) map.set(t1, (map.get(t1) || 0) + a1);
    }
    return map;
  }, [positions]);

  // Compute USD value per token and total
  const allocationData = useMemo(() => {
    const data: { token: string; usd: number }[] = [];
    let total = 0;
    holdingsByToken.forEach((amount, symbol) => {
      const base = getUnderlyingBaseSymbol(symbol);
      const price = base && prices ? prices[base] : 0;
      const usd = (isFinite(amount) ? amount : 0) * (isFinite(price) ? price : 0);
      if (usd > 0) data.push({ token: symbol, usd });
      total += usd;
    });

    // Sort descending by value
    data.sort((a, b) => b.usd - a.usd);
    return { data, total };
  }, [holdingsByToken, prices]);

  const chartConfig: ChartConfig = useMemo(() => {
    const cfg: ChartConfig = {};
    for (const row of allocationData.data) {
      // Give each token a deterministic color using CSS var fallback palette
      cfg[row.token] = { label: row.token, color: "#404040" };
    }
    return cfg;
  }, [allocationData.data]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col p-3 sm:p-6 sm:px-10">
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">Portfolio</h1>
              <p className="text-sm text-muted-foreground">
                {address ? `Wallet: ${shortenAddress(address)}` : "Connect a wallet to view your positions"}
              </p>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-6 mb-6">
          <div className="rounded-lg bg-muted/30 p-4 hover:outline hover:outline-1 hover:outline-muted transition-colors">
            <div className="text-sm text-muted-foreground mb-1">Total Value</div>
            <div className="text-lg font-medium">{formatUSD(allocationData.total)}</div>
          </div>
          <div className="rounded-lg bg-muted/30 p-4 hover:outline hover:outline-1 hover:outline-muted transition-colors">
            <div className="text-sm text-muted-foreground mb-1">Positions</div>
            <div className="text-lg font-medium">{isLoading ? "Loading..." : positions.length}</div>
          </div>
          <div className="rounded-lg bg-muted/30 p-4 hover:outline hover:outline-1 hover:outline-muted transition-colors hidden xl:block">
            <div className="text-sm text-muted-foreground mb-1">Prices Updated</div>
            <div className="text-lg font-medium">{lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "—"}</div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-3 lg:gap-6 min-w-0">
          {/* Left: Allocation Chart */}
          <div className="flex-1 min-w-0">
            <div className="rounded-lg bg-muted/30 p-4 hover:outline hover:outline-1 hover:outline-muted transition-colors h-full min-h-[300px]">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-medium">Allocation by Asset</h3>
              </div>
              <div className="min-h-[260px]">
                <ChartContainer config={chartConfig} className="aspect-auto w-full h-[260px]">
                  {allocationData.data.length > 0 ? (
                    <BarChart
                      accessibilityLayer
                      data={allocationData.data}
                      margin={{ left: 25, right: 25, top: 20, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="token"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tickFormatter={(v) => formatUSD(v as number)}
                      />
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            indicator="line"
                            className="!bg-[#0f0f0f] !text-card-foreground border border-sidebar-border shadow-lg rounded-lg"
                            formatter={(value, name, item) => {
                              return (
                                <div className="flex gap-2">
                                  <div className="grid gap-1 flex-1">
                                    <div className="flex justify-between leading-none items-center gap-4">
                                      <span className="text-muted-foreground">{item?.payload?.token}</span>
                                      <span className="font-mono font-medium tabular-nums text-foreground">
                                        {formatUSD(typeof value === "number" ? value : Number(value))}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                          />
                        }
                      />
                      <Bar dataKey="usd" fill="#404040" />
                    </BarChart>
                  ) : (
                    <div className="flex justify-center items-center h-full text-muted-foreground">{isLoading ? "Loading..." : "No holdings found."}</div>
                  )}
                </ChartContainer>
              </div>
            </div>
          </div>

          {/* Right: Positions List */}
          <div className="w-full lg:w-[450px] flex-shrink-0 min-w-0">
            <div className="w-full rounded-lg bg-muted/30 p-3 sm:p-4 hover:outline hover:outline-1 hover:outline-muted transition-colors">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-medium">Your Positions</h3>
              </div>
              {isLoading ? (
                <div className="rounded-lg bg-muted/30 p-4 h-20 animate-pulse" />
              ) : positions.length === 0 ? (
                <div className="border border-dashed rounded-lg bg-muted/10 p-8 flex items-center justify-center">
                  <div className="text-sm font-medium text-white/75">No Positions</div>
                </div>
              ) : (
                <div className="grid gap-3">
                  {positions.map((p) => {
                    const icon0 = getToken(p.token0.symbol as TokenSymbol)?.icon || "/placeholder-logo.svg";
                    const icon1 = getToken(p.token1.symbol as TokenSymbol)?.icon || "/placeholder-logo.svg";

                    const base0 = getUnderlyingBaseSymbol(p.token0.symbol);
                    const base1 = getUnderlyingBaseSymbol(p.token1.symbol);
                    const price0 = base0 && prices ? prices[base0] : 0;
                    const price1 = base1 && prices ? prices[base1] : 0;
                    const usd0 = (parseFloat(p.token0.amount || "0") || 0) * (price0 || 0);
                    const usd1 = (parseFloat(p.token1.amount || "0") || 0) * (price1 || 0);
                    const positionUsd = usd0 + usd1;

                    return (
                      <div key={p.positionId} className="rounded-lg bg-muted/30 p-3 hover:outline hover:outline-1 hover:outline-muted transition-colors">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="relative w-12 h-6">
                              <div className="absolute top-0 left-0 w-6 h-6 rounded-full overflow-hidden bg-background z-10">
                                <Image src={icon0} alt={p.token0.symbol} width={24} height={24} className="w-full h-full object-cover" />
                              </div>
                              <div className="absolute top-0 left-4 w-6 h-6 rounded-full overflow-hidden bg-background z-30">
                                <Image src={icon1} alt={p.token1.symbol} width={24} height={24} className="w-full h-full object-cover" />
                              </div>
                              <div className="absolute top-[-1px] left-[18px] w-7 h-7 rounded-full bg-[#0f0f0f] z-20" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">{p.token0.symbol} / {p.token1.symbol}</div>
                              <div className="text-xs text-muted-foreground">{formatUSD(positionUsd)}</div>
                            </div>
                          </div>
                          <div className="hidden sm:flex items-center gap-2">
                            <a href={`/liquidity/${p.poolId}`} className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-xs font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30" style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: '200%', backgroundPosition: 'center' }}>
                              View Pool
                            </a>
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
      </div>
    </AppLayout>
  );
}