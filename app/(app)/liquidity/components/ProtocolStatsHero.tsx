"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import type { ProtocolStats } from "../hooks/useProtocolStats";
import announcements from "@/config/announcements.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUSD(value: number): string {
  if (!isFinite(value)) return "$0.00";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const ROTATION_MS = 5000;

// ---------------------------------------------------------------------------
// Stat item
// ---------------------------------------------------------------------------

function StatItem({
  label,
  value,
  isLoading,
}: {
  label: string;
  value: string;
  isLoading: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <span className="text-lg font-semibold">
        {isLoading ? (
          <span className="inline-block h-[1em] w-20 bg-muted/60 rounded animate-pulse align-middle" />
        ) : (
          value
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TVL Sparkline (fetches from /api/protocol/tvl-history)
// ---------------------------------------------------------------------------

interface TvlPoint {
  timestamp: number;
  tvlUsd: number;
}

function TvlSparkline() {
  const { data: points } = useQuery<TvlPoint[]>({
    queryKey: ["protocol-tvl-history"],
    queryFn: async () => {
      const res = await fetch("/api/protocol/tvl-history");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const W = 180;
  const H = 40;
  const PAD = 2;

  const { pathD, coords, min, max } = useMemo(() => {
    if (!points || points.length < 2) return { pathD: null, coords: [], min: 0, max: 0 };

    const values = points.map((p) => p.tvlUsd);
    const mn = Math.min(...values);
    const mx = Math.max(...values);
    const range = mx - mn || 1;

    const c: { x: number; y: number }[] = [];
    const d = values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * W;
        const y = PAD + ((mx - v) / range) * (H - PAD * 2);
        c.push({ x, y });
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    return { pathD: d, coords: c, min: mn, max: mx };
  }, [points]);

  const hoveredPoint = hoveredIndex !== null && points ? points[hoveredIndex] : null;
  const hoveredCoord = hoveredIndex !== null ? coords[hoveredIndex] : null;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!points || points.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    const idx = Math.round(pct * (points.length - 1));
    setHoveredIndex(Math.max(0, Math.min(idx, points.length - 1)));
  };

  if (!pathD) return null;

  return (
    <div className="relative w-full h-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-full"
        fill="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <path
          d={pathD}
          stroke="#9B9B9B"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {hoveredCoord && (
          <>
            <line
              x1={hoveredCoord.x}
              y1={0}
              x2={hoveredCoord.x}
              y2={H}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="0.5"
            />
            <circle
              cx={hoveredCoord.x}
              cy={hoveredCoord.y}
              r="2"
              fill="#fff"
              stroke="#9B9B9B"
              strokeWidth="1"
            />
          </>
        )}
      </svg>
      {hoveredPoint && (
        <div
          className="absolute -top-6 pointer-events-none z-10"
          style={{
            left: `${((hoveredIndex ?? 0) / ((points?.length ?? 1) - 1)) * 100}%`,
            transform: "translateX(-50%)",
          }}
        >
          <div className="flex items-center rounded-md bg-popover border border-sidebar-border px-1.5 h-5 shadow-sm whitespace-nowrap">
            <span className="text-[10px] text-muted-foreground mr-1.5">
              {new Date(hoveredPoint.timestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
            <span className="text-[10px] font-medium text-foreground">
              {formatUSD(hoveredPoint.tvlUsd)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Card (left)
// ---------------------------------------------------------------------------

function StatsCard({ stats }: { stats: ProtocolStats }) {
  return (
    <div className="order-2 xl:order-1 flex flex-1 flex-col justify-between gap-y-4 rounded-lg bg-muted/50 surface-depth p-5 md:p-6">
      <div className="flex flex-col gap-y-1">
        <h2 className="text-xl font-semibold text-foreground">Custom Pools</h2>
        <p className="text-sm text-muted-foreground">
          Explore and manage your liquidity positions.
        </p>
      </div>

      <div className="flex items-center gap-6 md:gap-8">
        <StatItem
          label="Total Deposits"
          value={formatUSD(stats.currentTvl)}
          isLoading={stats.isLoading}
        />
        <StatItem
          label="Volume (24h)"
          value={formatUSD(stats.volume24h)}
          isLoading={stats.isLoading}
        />
        <StatItem
          label="User Revenue"
          value={stats.userRevenueAllTime > 0 ? formatUSD(stats.userRevenueAllTime) : "---"}
          isLoading={stats.isLoading}
        />

        {/* Mini TVL history sparkline — inline with stats, desktop only */}
        <div className="hidden lg:flex ml-auto w-[180px] h-10 flex-shrink-0">
          <TvlSparkline />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ring progress indicator (CSS transition disabled at 0 to prevent rewind)
// ---------------------------------------------------------------------------

function ProgressRing({
  progress,
  size = 12,
  strokeWidth = 1.5,
}: {
  progress: number; // 0-1
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <svg
      width={size}
      height={size}
      className="block"
      style={{ transform: "rotate(-90deg)" }}
    >
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={strokeWidth}
      />
      {/* Fill — no transition when resetting to 0 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{
          transition: progress === 0 ? "none" : "stroke-dashoffset 100ms linear",
        }}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Announcements Card (right) — auto-rotating image carousel
// ---------------------------------------------------------------------------

function AnnouncementsCard() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const elapsed = useRef(0);

  const count = announcements.length;

  useEffect(() => {
    if (count <= 1) return;

    elapsed.current = 0;
    const TICK = 50;

    const interval = setInterval(() => {
      elapsed.current += TICK;
      if (elapsed.current >= ROTATION_MS) {
        elapsed.current = 0;
        setActiveIndex((prev) => (prev + 1) % count);
        setProgress(0);
      } else {
        setProgress(elapsed.current / ROTATION_MS);
      }
    }, TICK);

    return () => clearInterval(interval);
  }, [count]);

  const current = announcements[activeIndex];
  if (!current) return null;

  return (
    <div className="order-1 xl:order-2 flex flex-1 flex-col rounded-lg overflow-hidden relative">
      {announcements.map((ann, i) => (
        <Link
          key={i}
          href={ann.link}
          {...((ann as any).external !== false ? { target: "_blank" } : {})}
          className={`${i === activeIndex ? "block" : "hidden"} w-full h-full`}
        >
          <Image
            src={ann.image}
            alt="Announcement"
            width={1500}
            height={500}
            quality={90}
            className="w-full h-full object-cover rounded-lg"
            priority={i === 0}
          />
        </Link>
      ))}

      {count > 1 && (
        <div className="absolute top-2.5 right-2.5 z-10">
          <ProgressRing progress={progress} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProtocolStatsHero (exported)
// ---------------------------------------------------------------------------

interface ProtocolStatsHeroProps {
  stats: ProtocolStats;
}

export function ProtocolStatsHero({ stats }: ProtocolStatsHeroProps) {
  return (
    <div className="flex w-full flex-col gap-3 md:gap-3 xl:flex-row">
      {/* On mobile/tablet: ANN first, stats second (via CSS order). On xl+: stats left, ANN right */}
      <StatsCard stats={stats} />
      <AnnouncementsCard />
    </div>
  );
}
