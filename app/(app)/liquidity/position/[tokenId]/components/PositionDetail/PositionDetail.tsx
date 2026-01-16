"use client";

import { memo, useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Plus, Minus } from "lucide-react";
import { PointsIcon } from "@/components/PointsIcons";
import { DenominationToggle } from "@/components/liquidity/DenominationToggle";
import { CurrencyAmount, Price, Currency } from "@uniswap/sdk-core";
import { Position as V4Position } from "@uniswap/v4-sdk";
import { Button } from "@/components/ui/button";
import { cn, getTokenIcon, getTokenColor } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatNumber } from "@/lib/format";
import type { PoolConfig } from "@/lib/pools-config";
import type { LPType, ChartDuration, PositionInfo, PoolStateData } from "../../hooks";
import dynamic from "next/dynamic";
import { usePositionFeeChartData, type ChartPeriod } from "../../hooks";
import type { TimePeriod } from "../PriceChartSection";

const PriceChartSection = dynamic(() => import("../PriceChartSection").then(mod => mod.PriceChartSection), { ssr: false });
const YieldChartSection = dynamic(() => import("../YieldChartSection").then(mod => mod.YieldChartSection), { ssr: false });
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import { IncreaseLiquidityModal } from "@/components/liquidity/increase/IncreaseLiquidityModal";
import { DecreaseLiquidityModal } from "@/components/liquidity/decrease/DecreaseLiquidityModal";
import { CollectFeesModal } from "@/components/liquidity/collect/CollectFeesModal";

// ============================================================================
// Types
// ============================================================================

export interface PositionDetailProps {
  tokenId: string;
  // Position data
  position: V4Position | null;
  positionInfo: PositionInfo | null;
  isLoading: boolean;
  error: Error | null;
  // Pool data
  poolConfig: PoolConfig | null;
  poolState: PoolStateData | null;
  // Token amounts
  currency0Amount: CurrencyAmount<Currency> | null;
  currency1Amount: CurrencyAmount<Currency> | null;
  // USD values
  fiatValue0: number | null;
  fiatValue1: number | null;
  totalPositionValue: number | null;
  // Fees
  fee0Amount: CurrencyAmount<Currency> | null;
  fee1Amount: CurrencyAmount<Currency> | null;
  fiatFeeValue0: number | null;
  fiatFeeValue1: number | null;
  totalFeesValue: number | null;
  // Price info
  currentPrice: Price<Currency, Currency> | null;
  priceInverted: boolean;
  setPriceInverted: (inverted: boolean) => void;
  // Range display
  minPrice: string;
  maxPrice: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  isFullRange: boolean;
  isInRange: boolean;
  // APR data
  poolApr: number | null;
  aaveApr: number | null;
  totalApr: number | null;
  // LP Type
  lpType: LPType;
  // Chart
  chartDuration: ChartDuration;
  setChartDuration: (duration: ChartDuration) => void;
  chartData: { time: number; value: number }[];
  isLoadingChart: boolean;
  // Denomination
  effectiveDenominationBase: boolean;
  handleDenominationToggle: () => void;
  // Ownership
  isOwner: boolean;
  // Actions
  refetch: () => void;
}

// ============================================================================
// Sub-Components
// ============================================================================

function SectionContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "p-5 bg-container border border-sidebar-border rounded-lg flex flex-col gap-4",
      "w-full",
      className
    )}>
      {children}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-3 sm:p-6 w-full max-w-[1200px] mx-auto animate-pulse">
      <div className="h-8 w-48 bg-muted/40 rounded" />
      <div className="flex flex-col min-[1200px]:flex-row gap-10">
        <div className="flex-1 flex flex-col gap-6 max-w-[720px]">
          <div className="h-12 bg-muted/40 rounded" />
          <div className="h-[380px] bg-muted/20 rounded-lg" />
          <div className="h-24 bg-muted/40 rounded-lg" />
        </div>
        <div className="flex flex-col gap-5 w-full min-[1200px]:w-[380px]">
          <div className="h-48 bg-muted/40 rounded-lg" />
          <div className="h-48 bg-muted/40 rounded-lg" />
          <div className="h-36 bg-muted/40 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function StatusIndicator({ isInRange }: { isInRange: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn(
        "w-2 h-2 rounded-full",
        isInRange ? "bg-green-500" : "bg-red-500"
      )} />
      <span className={cn(
        "text-sm",
        isInRange ? "text-green-500" : "text-red-500"
      )}>
        {isInRange ? "In Range" : "Out of Range"}
      </span>
    </div>
  );
}

function UnifiedYieldBadge() {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border border-transparent hover:border-[#9896FF]/50 transition-colors"
      style={{ backgroundColor: "rgba(152, 150, 255, 0.10)", color: "#9896FF" }}
    >
      Unified Yield
    </span>
  );
}

function DualBar({
  percent0,
  percent1,
  token0Symbol,
  token1Symbol,
  hoveredToken,
  onHover,
}: {
  percent0: number;
  percent1: number;
  token0Symbol?: string;
  token1Symbol?: string;
  hoveredToken: 0 | 1 | null;
  onHover: (token: 0 | 1 | null) => void;
}) {
  const color0 = getTokenColor(token0Symbol);
  const color1 = getTokenColor(token1Symbol);

  return (
    <div className="flex h-2 w-full gap-1">
      <div
        className="h-full rounded-full transition-all duration-200 cursor-pointer"
        style={{
          width: `${percent0}%`,
          backgroundColor: color0,
          opacity: hoveredToken === 1 ? 0.3 : 1,
        }}
        onMouseEnter={() => onHover(0)}
        onMouseLeave={() => onHover(null)}
      />
      <div
        className="h-full rounded-full transition-all duration-200 cursor-pointer"
        style={{
          width: `${percent1}%`,
          backgroundColor: color1,
          opacity: hoveredToken === 0 ? 0.3 : 1,
        }}
        onMouseEnter={() => onHover(1)}
        onMouseLeave={() => onHover(null)}
      />
    </div>
  );
}

function TokenRow({
  symbol,
  amount,
  isHovered,
  isMuted,
  onHover,
}: {
  symbol: string;
  amount: string;
  isHovered: boolean;
  isMuted: boolean;
  onHover: (hovered: boolean) => void;
}) {
  const iconUrl = getTokenIcon(symbol);

  return (
    <div
      className={cn(
        "flex items-center justify-between px-3 py-2.5 -mx-3 rounded-md transition-all cursor-pointer",
        isHovered ? "bg-muted/50" : "hover:bg-muted/40",
        isMuted && "opacity-40"
      )}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="flex items-center gap-2.5">
        <Image
          src={iconUrl}
          alt={symbol}
          width={24}
          height={24}
          className="rounded-full bg-background"
        />
        <span className="text-sm font-medium">{symbol}</span>
      </div>
      <span className="text-sm tabular-nums">
        {formatNumber(parseFloat(amount), { max: 6 })}
      </span>
    </div>
  );
}


// ============================================================================
// Section Components
// ============================================================================

function PositionHeader({
  poolConfig,
  lpType,
  isInRange,
  isOwner,
  hasFees,
  onAddLiquidity,
  onRemoveLiquidity,
  onCollectFees,
}: {
  poolConfig: PoolConfig;
  lpType: LPType;
  isInRange: boolean;
  isOwner: boolean;
  hasFees: boolean;
  onAddLiquidity: () => void;
  onRemoveLiquidity: () => void;
  onCollectFees: () => void;
}) {
  const router = useRouter();
  const token0Icon = getTokenIcon(poolConfig.currency0.symbol);
  const token1Icon = getTokenIcon(poolConfig.currency1.symbol);

  return (
    <div className="flex flex-col gap-4">
      {/* Back Link */}
      <button
        onClick={() => router.push("/overview")}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="text-sm">Back to Overview</span>
      </button>

      {/* Title Row with Actions - spans full width */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {/* Left side - title */}
        <div className="flex items-center gap-3">
          {/* Token Pair Icons */}
          <div className="flex -space-x-3">
            <Image
              src={token0Icon}
              alt={poolConfig.currency0.symbol}
              width={40}
              height={40}
              className="rounded-full bg-background border-2 border-background"
            />
            <Image
              src={token1Icon}
              alt={poolConfig.currency1.symbol}
              width={40}
              height={40}
              className="rounded-full bg-background border-2 border-background"
            />
          </div>

          {/* Token Pair Name and Status */}
          <div className="flex flex-col gap-1">
            <Link
              href={`/liquidity/${poolConfig.id}`}
              className="text-2xl font-semibold hover:text-muted-foreground transition-colors"
            >
              {poolConfig.currency0.symbol} / {poolConfig.currency1.symbol}
            </Link>
            <div className="flex items-center gap-2">
              <StatusIndicator isInRange={isInRange} />
              {lpType === "rehypo" && <UnifiedYieldBadge />}
            </div>
          </div>
        </div>

        {/* Right side - Action Buttons */}
        {isOwner && (
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            {/* Add Liquidity - Pattern style */}
            <button
              onClick={onAddLiquidity}
              className="group relative rounded-md border border-sidebar-border bg-button h-9 px-4 text-sm font-medium text-foreground hover:bg-accent hover:brightness-110 hover:border-white/30 transition-all overflow-hidden"
            >
              <span
                className="absolute inset-0 transition-opacity duration-200 group-hover:opacity-0"
                style={{ backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
              />
              <span className="relative z-10">Add liquidity</span>
            </button>
            {/* Remove Liquidity - Same pattern style */}
            <button
              onClick={onRemoveLiquidity}
              className="group relative rounded-md border border-sidebar-border bg-button h-9 px-4 text-sm font-medium text-foreground hover:bg-accent hover:brightness-110 hover:border-white/30 transition-all overflow-hidden"
            >
              <span
                className="absolute inset-0 transition-opacity duration-200 group-hover:opacity-0"
                style={{ backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
              />
              <span className="relative z-10">Remove liquidity</span>
            </button>
            {/* Collect Fees - Only visible if there are fees */}
            {hasFees && (
              <Button
                onClick={onCollectFees}
                size="sm"
                className="h-9 px-4 font-medium bg-button-primary border border-sidebar-primary text-sidebar-primary hover-button-primary"
              >
                Collect fees
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PriceRangeSection({
  minPrice,
  maxPrice,
  tokenASymbol,
  tokenBSymbol,
  isFullRange,
  currentPrice,
  priceInverted,
}: {
  minPrice: string;
  maxPrice: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  isFullRange: boolean;
  currentPrice: Price<Currency, Currency> | null;
  priceInverted: boolean;
}) {
  const priceLabel = `${tokenASymbol} per ${tokenBSymbol}`;

  return (
    <div className="flex flex-col gap-4 p-4 bg-container border border-sidebar-border rounded-lg">
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center">
          <div className="text-xs text-muted-foreground mb-1">Min Price</div>
          <div className="font-semibold text-sm">{isFullRange ? "0" : minPrice}</div>
          <div className="text-xs text-muted-foreground">{priceLabel}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-muted-foreground mb-1">Current Price</div>
          <div className="font-semibold text-sm">
            {currentPrice
              ? priceInverted
                ? currentPrice.invert().toSignificant(6)
                : currentPrice.toSignificant(6)
              : "-"}
          </div>
          <div className="text-xs text-muted-foreground">{priceLabel}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-muted-foreground mb-1">Max Price</div>
          <div className="font-semibold text-sm">{isFullRange ? "∞" : maxPrice}</div>
          <div className="text-xs text-muted-foreground">{priceLabel}</div>
        </div>
      </div>
    </div>
  );
}

function PositionValueSection({
  currency0Amount,
  currency1Amount,
  fiatValue0,
  fiatValue1,
  totalPositionValue,
  token0Symbol,
  token1Symbol,
}: {
  currency0Amount: CurrencyAmount<Currency> | null;
  currency1Amount: CurrencyAmount<Currency> | null;
  fiatValue0: number | null;
  fiatValue1: number | null;
  totalPositionValue: number | null;
  token0Symbol: string;
  token1Symbol: string;
}) {
  const [hoveredToken, setHoveredToken] = useState<0 | 1 | null>(null);

  const percent0 = useMemo(() => {
    if (fiatValue0 === null || fiatValue1 === null || totalPositionValue === null || totalPositionValue === 0) return 50;
    return (fiatValue0 / totalPositionValue) * 100;
  }, [fiatValue0, fiatValue1, totalPositionValue]);

  const percent1 = 100 - percent0;

  // Display value: show hovered token's value or total
  const displayValue = useMemo(() => {
    if (hoveredToken === 0 && fiatValue0 !== null) return fiatValue0;
    if (hoveredToken === 1 && fiatValue1 !== null) return fiatValue1;
    return totalPositionValue;
  }, [hoveredToken, fiatValue0, fiatValue1, totalPositionValue]);

  return (
    <SectionContainer>
      <div className="flex flex-col gap-2">
        <span className="text-sm text-muted-foreground">Position Value</span>
        <span className="text-3xl font-semibold tabular-nums transition-all">
          {displayValue !== null ? `$${formatNumber(displayValue, { max: 2 })}` : "-"}
        </span>
      </div>

      {totalPositionValue !== null && totalPositionValue > 0 && (
        <>
          <DualBar
            percent0={percent0}
            percent1={percent1}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
            hoveredToken={hoveredToken}
            onHover={setHoveredToken}
          />

          <div className="flex flex-col gap-0.5 -mb-3">
            {currency0Amount && (
              <TokenRow
                symbol={token0Symbol}
                amount={currency0Amount.toExact()}
                isHovered={hoveredToken === 0}
                isMuted={hoveredToken === 1}
                onHover={(h) => setHoveredToken(h ? 0 : null)}
              />
            )}
            {currency1Amount && (
              <TokenRow
                symbol={token1Symbol}
                amount={currency1Amount.toExact()}
                isHovered={hoveredToken === 1}
                isMuted={hoveredToken === 0}
                onHover={(h) => setHoveredToken(h ? 1 : null)}
              />
            )}
          </div>
        </>
      )}
    </SectionContainer>
  );
}

function EarningsSection({
  fee0Amount,
  fee1Amount,
  fiatFeeValue0,
  fiatFeeValue1,
  totalFeesValue,
  token0Symbol,
  token1Symbol,
}: {
  fee0Amount: CurrencyAmount<Currency> | null;
  fee1Amount: CurrencyAmount<Currency> | null;
  fiatFeeValue0: number | null;
  fiatFeeValue1: number | null;
  totalFeesValue: number | null;
  token0Symbol: string;
  token1Symbol: string;
}) {
  const [hoveredToken, setHoveredToken] = useState<0 | 1 | null>(null);

  const percent0 = useMemo(() => {
    if (fiatFeeValue0 === null || fiatFeeValue1 === null || totalFeesValue === null || totalFeesValue === 0) return 50;
    return (fiatFeeValue0 / totalFeesValue) * 100;
  }, [fiatFeeValue0, fiatFeeValue1, totalFeesValue]);

  const percent1 = 100 - percent0;

  // Display value: show hovered token's value or total
  const displayValue = useMemo(() => {
    if (hoveredToken === 0 && fiatFeeValue0 !== null) return fiatFeeValue0;
    if (hoveredToken === 1 && fiatFeeValue1 !== null) return fiatFeeValue1;
    return totalFeesValue;
  }, [hoveredToken, fiatFeeValue0, fiatFeeValue1, totalFeesValue]);

  return (
    <SectionContainer>
      <div className="flex flex-col gap-2">
        <span className="text-sm text-muted-foreground">Uncollected Fees</span>
        <span className="text-3xl font-semibold tabular-nums transition-all">
          {displayValue !== null ? `$${formatNumber(displayValue, { max: 2 })}` : "-"}
        </span>
      </div>

      {totalFeesValue !== null && totalFeesValue > 0 && (
        <>
          <DualBar
            percent0={percent0}
            percent1={percent1}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
            hoveredToken={hoveredToken}
            onHover={setHoveredToken}
          />

          <div className="flex flex-col gap-0.5 -mb-3">
            {fee0Amount && (
              <TokenRow
                symbol={token0Symbol}
                amount={fee0Amount.toExact()}
                isHovered={hoveredToken === 0}
                isMuted={hoveredToken === 1}
                onHover={(h) => setHoveredToken(h ? 0 : null)}
              />
            )}
            {fee1Amount && (
              <TokenRow
                symbol={token1Symbol}
                amount={fee1Amount.toExact()}
                isHovered={hoveredToken === 1}
                isMuted={hoveredToken === 0}
                onHover={(h) => setHoveredToken(h ? 1 : null)}
              />
            )}
          </div>
        </>
      )}
    </SectionContainer>
  );
}

/**
 * Yield info callout content
 */
const YIELD_INFO: Record<string, { title: string; description: React.ReactNode }> = {
  swap: {
    title: "Swap APR",
    description: "Earned from trading fees when swaps occur through your position's price range. The APR varies based on trading volume and your position's concentration.",
  },
  unified: {
    title: "Unified Yield",
    description: "Additional yield earned by lending idle liquidity. When your liquidity isn't being used for swaps, it generates lending interest automatically.",
  },
  points: {
    title: "Points",
    description: (
      <>
        This position earns points continuously while providing liquidity. Points are distributed every Thursday at 02:00 UTC.{" "}
        <Link href="/points" className="underline hover:text-foreground transition-colors">
          Visit the Points page
        </Link>{" "}
        for more details.
      </>
    ),
  },
};

/**
 * Yield Breakdown Section
 * Matches pool page style - table with hover rows
 * Clickable rows show info callout
 */
function APRSection({
  poolApr,
  aaveApr,
  totalApr,
  lpType,
  pointsEarned = 220,
}: {
  poolApr: number | null;
  aaveApr: number | null;
  totalApr: number | null;
  lpType: LPType;
  pointsEarned?: number;
}) {
  const [selectedInfo, setSelectedInfo] = useState<"swap" | "unified" | "points" | null>(null);

  const handleRowClick = (row: "swap" | "unified" | "points") => {
    setSelectedInfo(selectedInfo === row ? null : row);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-sidebar-border/60 p-4 pb-2">
      <h4 className="text-sm font-semibold text-foreground">Yield Breakdown</h4>
      <div className="flex flex-col -mx-2">
        {/* Swap APR - Clickable */}
        <div
          className={cn(
            "flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer",
            selectedInfo === "swap" && "bg-muted/40"
          )}
          onClick={() => handleRowClick("swap")}
        >
          <span className="text-xs text-muted-foreground">Swap APR</span>
          <span className="text-xs font-mono text-foreground">
            {poolApr !== null ? `${formatNumber(poolApr, { max: 2 })}%` : "-"}
          </span>
        </div>

        {/* Unified Yield - Standard style like other rows */}
        {lpType === "rehypo" && (
          <div
            className={cn(
              "flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer",
              selectedInfo === "unified" && "bg-muted/40"
            )}
            onClick={() => handleRowClick("unified")}
          >
            <span className="text-xs text-muted-foreground">Unified Yield</span>
            <span className="text-xs font-mono text-foreground">
              {aaveApr !== null ? `${formatNumber(aaveApr, { max: 2 })}%` : "-"}
            </span>
          </div>
        )}

        {/* Points - + left muted, Icon+Points right white */}
        <div
          className={cn(
            "flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer",
            selectedInfo === "points" && "bg-muted/40"
          )}
          onClick={() => handleRowClick("points")}
        >
          <span className="text-xs text-muted-foreground">+</span>
          <span className="flex items-center gap-1.5">
            <PointsIcon className="w-3.5 h-3.5 text-foreground" />
            <span className="text-xs font-mono text-foreground">Points</span>
          </span>
        </div>

        {/* Divider */}
        <div className="border-t border-sidebar-border/40 mx-2 my-1" />

        {/* Total APR - Standard hover */}
        <div className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors">
          <span className="text-xs font-medium text-foreground">Total APR</span>
          <span className="text-xs font-mono font-medium text-foreground">
            {totalApr !== null ? `~${formatNumber(totalApr, { max: 2 })}%` : "-"}
          </span>
        </div>
      </div>

      {/* Info Callout - appears when a row is clicked */}
      {selectedInfo && (
        <div className="flex items-start gap-2 p-3 mt-1 rounded-lg bg-muted/30 border border-sidebar-border/40">
          <svg
            className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-foreground">
              {YIELD_INFO[selectedInfo].title}
            </span>
            <span className="text-xs text-muted-foreground leading-relaxed">
              {YIELD_INFO[selectedInfo].description}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export const PositionDetail = memo(function PositionDetail({
  tokenId,
  position,
  positionInfo,
  isLoading,
  error,
  poolConfig,
  poolState,
  currency0Amount,
  currency1Amount,
  fiatValue0,
  fiatValue1,
  totalPositionValue,
  fee0Amount,
  fee1Amount,
  fiatFeeValue0,
  fiatFeeValue1,
  totalFeesValue,
  currentPrice,
  priceInverted,
  setPriceInverted,
  minPrice,
  maxPrice,
  tokenASymbol,
  tokenBSymbol,
  isFullRange,
  isInRange,
  poolApr,
  aaveApr,
  totalApr,
  lpType,
  chartDuration,
  setChartDuration,
  chartData,
  isLoadingChart,
  effectiveDenominationBase,
  handleDenominationToggle,
  isOwner,
  refetch,
}: PositionDetailProps) {
  const isMobile = useIsMobile();
  const router = useRouter();

  // Window width for responsive chart
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    if (typeof window !== "undefined") {
      setWindowWidth(window.innerWidth);
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, []);

  // Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false);
  const [chartTab, setChartTab] = useState<"price" | "yield">("price");
  const [feeChartPeriod, setFeeChartPeriod] = useState<ChartPeriod>("1W");

  // Fee chart data - pass current uncollected fees for "live now" point
  // Include token symbols and lpType for Aave historical rate fetching (rehypo positions)
  const {
    data: feeChartData,
    isLoading: isLoadingFeeChart,
    refetch: refetchFeeChart,
  } = usePositionFeeChartData({
    positionId: tokenId,
    period: feeChartPeriod,
    currentFeesUsd: totalFeesValue ?? undefined,
    enabled: chartTab === "yield" && !!tokenId,
    token0Symbol: poolConfig?.currency0?.symbol,
    token1Symbol: poolConfig?.currency1?.symbol,
    isRehypo: lpType === "rehypo",
  });

  // Convert position data to ProcessedPosition format for modals
  const processedPosition: ProcessedPosition | null = useMemo(() => {
    if (!position || !poolConfig || !positionInfo) return null;
    return {
      positionId: tokenId,
      owner: positionInfo.owner,
      poolId: poolConfig.id,
      token0: {
        address: poolConfig.currency0.address,
        symbol: poolConfig.currency0.symbol,
        amount: currency0Amount?.toExact() || "0",
        rawAmount: currency0Amount?.quotient.toString() || "0",
      },
      token1: {
        address: poolConfig.currency1.address,
        symbol: poolConfig.currency1.symbol,
        amount: currency1Amount?.toExact() || "0",
        rawAmount: currency1Amount?.quotient.toString() || "0",
      },
      tickLower: positionInfo.tickLower,
      tickUpper: positionInfo.tickUpper,
      liquidityRaw: positionInfo.liquidity.toString(),
      ageSeconds: 0, // Not critical for modals
      blockTimestamp: 0,
      lastTimestamp: 0,
      isInRange,
      token0UncollectedFees: fee0Amount?.toExact() || "0",
      token1UncollectedFees: fee1Amount?.toExact() || "0",
    };
  }, [position, poolConfig, positionInfo, tokenId, currency0Amount, currency1Amount, isInRange, fee0Amount, fee1Amount]);

  // Modal handlers
  const handleOpenAddModal = useCallback(() => setIsAddModalOpen(true), []);
  const handleCloseAddModal = useCallback(() => setIsAddModalOpen(false), []);
  const handleOpenRemoveModal = useCallback(() => setIsRemoveModalOpen(true), []);
  const handleCloseRemoveModal = useCallback(() => setIsRemoveModalOpen(false), []);
  const handleOpenCollectModal = useCallback(() => setIsCollectModalOpen(true), []);
  const handleCloseCollectModal = useCallback(() => setIsCollectModalOpen(false), []);

  // Handle modal success - refetch position data
  const handleModalSuccess = useCallback(() => {
    refetch();
    refetchFeeChart();
  }, [refetch, refetchFeeChart]);

  // Loading state
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-muted-foreground">Failed to load position</p>
        <Button variant="outline" onClick={() => refetch()}>
          Try Again
        </Button>
      </div>
    );
  }

  // Not found state
  if (!position || !poolConfig) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <h2 className="text-2xl font-semibold">Position not found</h2>
        <p className="text-muted-foreground text-center max-w-md">
          This position may have been closed or doesn't exist.
        </p>
        <Button onClick={() => router.push("/overview")}>
          Back to Positions
        </Button>
      </div>
    );
  }

  const token0Symbol = poolConfig.currency0.symbol;
  const token1Symbol = poolConfig.currency1.symbol;

  const hasFees = totalFeesValue !== null && totalFeesValue > 0;

  return (
    <div className="flex flex-col gap-6 p-3 sm:p-6 overflow-x-hidden w-full max-w-[1200px] mx-auto pb-20 sm:pb-6">
      {/* Header with Action Buttons */}
      <PositionHeader
        poolConfig={poolConfig}
        lpType={lpType}
        isInRange={isInRange}
        isOwner={isOwner}
        hasFees={hasFees}
        onAddLiquidity={handleOpenAddModal}
        onRemoveLiquidity={handleOpenRemoveModal}
        onCollectFees={handleOpenCollectModal}
      />

      {/* Two-column layout - matches PoolDetail pattern */}
      <div className="flex flex-col min-[1200px]:flex-row gap-10">
        {/* Left Column: Chart & Price Range */}
        <div className="flex-1 flex flex-col gap-6 min-w-0">
          {/* Chart Tabs + Denomination Toggle */}
          <div className="flex flex-row items-center justify-between">
            <div className="flex flex-row items-center gap-1">
              <button
                onClick={() => setChartTab("price")}
                className={cn(
                  "h-7 px-2.5 text-xs rounded-md transition-colors duration-150 cursor-pointer select-none",
                  chartTab === "price"
                    ? "bg-muted/50 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                Price
              </button>
              <button
                onClick={() => setChartTab("yield")}
                className={cn(
                  "h-7 px-2.5 text-xs rounded-md transition-colors duration-150 cursor-pointer select-none",
                  chartTab === "yield"
                    ? "bg-muted/50 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                Yield
              </button>
            </div>

            {/* Denomination Toggle */}
            <DenominationToggle
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
              activeBase={priceInverted ? token1Symbol : token0Symbol}
              onToggle={(symbol) => {
                const shouldInvert = symbol === token1Symbol;
                if (shouldInvert !== priceInverted) {
                  setPriceInverted(shouldInvert);
                }
              }}
            />
          </div>

          {/* Price Chart - no background container */}
          {chartTab === "price" ? (
            <PriceChartSection
              chartData={chartData}
              isLoading={isLoadingChart}
              windowWidth={windowWidth}
              currentPrice={currentPrice ? parseFloat(currentPrice.toSignificant(8)) : undefined}
              minRangePrice={!isFullRange && minPrice ? parseFloat(minPrice) : undefined}
              maxRangePrice={!isFullRange && maxPrice ? parseFloat(maxPrice) : undefined}
              priceInverted={priceInverted}
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
              timePeriod={chartDuration as TimePeriod}
              onTimePeriodChange={(period) => setChartDuration(period as ChartDuration)}
            />
          ) : (
            <YieldChartSection
              chartData={feeChartData ?? []}
              isLoading={isLoadingFeeChart}
              windowWidth={windowWidth}
              currentFees={totalFeesValue ?? undefined}
              timePeriod={feeChartPeriod}
              onTimePeriodChange={(period) => setFeeChartPeriod(period)}
            />
          )}

          {/* Price Range */}
          <PriceRangeSection
            minPrice={minPrice}
            maxPrice={maxPrice}
            tokenASymbol={tokenASymbol}
            tokenBSymbol={tokenBSymbol}
            isFullRange={isFullRange}
            currentPrice={currentPrice}
            priceInverted={priceInverted}
          />
        </div>

        {/* Right Column: Position Info - 380px matches Overview/PoolDetail */}
        <div className="flex flex-col gap-4 w-full min-[1200px]:w-[380px] flex-shrink-0">
          {/* Uncollected Fees - Show first when > 0 */}
          {hasFees && (
            <EarningsSection
              fee0Amount={fee0Amount}
              fee1Amount={fee1Amount}
              fiatFeeValue0={fiatFeeValue0}
              fiatFeeValue1={fiatFeeValue1}
              totalFeesValue={totalFeesValue}
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
            />
          )}

          {/* Position Value */}
          <PositionValueSection
            currency0Amount={currency0Amount}
            currency1Amount={currency1Amount}
            fiatValue0={fiatValue0}
            fiatValue1={fiatValue1}
            totalPositionValue={totalPositionValue}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
          />

          {/* APR */}
          <APRSection
            poolApr={poolApr}
            aaveApr={aaveApr}
            totalApr={totalApr}
            lpType={lpType}
          />
        </div>
      </div>

      {/* Mobile Fixed Action Buttons - Only show Collect fees if there are fees */}
      {isMobile && isOwner && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-sm border-t border-sidebar-border z-40 sm:hidden">
          <div className="flex gap-2">
            {hasFees && (
              <Button onClick={handleOpenCollectModal} className="flex-1 h-12 font-semibold bg-button-primary border border-sidebar-primary text-sidebar-primary hover-button-primary">
                Collect fees
              </Button>
            )}
            <Button onClick={handleOpenAddModal} variant="outline" className={cn("h-12 px-4 font-medium border-sidebar-border", !hasFees && "flex-1")}>
              <Plus className="h-4 w-4" />
              {!hasFees && <span className="ml-2">Add</span>}
            </Button>
            <Button onClick={handleOpenRemoveModal} variant="outline" className={cn("h-12 px-4 font-medium border-sidebar-border", !hasFees && "flex-1")}>
              <Minus className="h-4 w-4" />
              {!hasFees && <span className="ml-2">Remove</span>}
            </Button>
          </div>
        </div>
      )}

      {/* Modals */}
      {processedPosition && (
        <>
          <IncreaseLiquidityModal
            position={processedPosition}
            isOpen={isAddModalOpen}
            onClose={handleCloseAddModal}
            onSuccess={handleModalSuccess}
          />
          <DecreaseLiquidityModal
            position={processedPosition}
            isOpen={isRemoveModalOpen}
            onClose={handleCloseRemoveModal}
            onSuccess={handleModalSuccess}
          />
          <CollectFeesModal
            position={processedPosition}
            isOpen={isCollectModalOpen}
            onClose={handleCloseCollectModal}
            onSuccess={handleModalSuccess}
          />
        </>
      )}
    </div>
  );
});

export default PositionDetail;
