"use client";

import { memo, useState, useCallback, useEffect } from "react";
import Image from "next/image";
import { cn, shortenAddress, getTokenIcon, getTokenColor } from "@/lib/utils";
import { IconClone2, IconCheck, IconPlus, IconMinus } from "nucleo-micro-bold-essential";
import { PointsIcon } from "@/components/PointsIcons/PointsIcon";
import type { PoolConfig } from "../../hooks";

/** Local number formatter matching the position detail formatNumber API */
function formatNumber(
  value: number,
  opts?: { min?: number; max?: number }
): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: opts?.min ?? 0,
    maximumFractionDigits: opts?.max ?? 2,
  }).format(value);
}
import type { NetworkMode } from "@/lib/network-mode";

// ─── Copyable Row ─────────────────────────────────────────────────────────────

function CopyableRow({
  label,
  value,
  displayValue,
}: {
  label: string;
  value: string;
  displayValue?: string;
}) {
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => setIsCopied(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [isCopied]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setIsCopied(true);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [value]);

  return (
    <div
      className="group flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer"
      onClick={handleCopy}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center">
        <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground transition-colors">
          {displayValue || shortenAddress(value)}
        </span>
        <div className="relative w-0 group-hover:w-3.5 h-3.5 ml-0 group-hover:ml-1.5 overflow-hidden transition-all duration-200">
          <IconClone2
            width={14}
            height={14}
            className={cn(
              "absolute inset-0 text-muted-foreground transition-all duration-200",
              isCopied ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"
            )}
          />
          <IconCheck
            width={14}
            height={14}
            className={cn(
              "absolute inset-0 text-green-500 transition-all duration-200",
              isCopied ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
            )}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Pool Balance (same visual as Position Value in position detail) ──────────

function DualBar({
  percent0,
  percent1,
  token0Symbol,
  token1Symbol,
  hoveredToken,
  onHover,
  networkMode,
}: {
  percent0: number;
  percent1: number;
  token0Symbol?: string;
  token1Symbol?: string;
  hoveredToken: 0 | 1 | null;
  onHover: (token: 0 | 1 | null) => void;
  networkMode: NetworkMode;
}) {
  const color0 = getTokenColor(token0Symbol, networkMode);
  const color1 = getTokenColor(token1Symbol, networkMode);

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

function BalanceTokenRow({
  symbol,
  fiatValue,
  isHovered,
  isMuted,
  onHover,
  networkMode,
}: {
  symbol: string;
  fiatValue: number;
  isHovered: boolean;
  isMuted: boolean;
  onHover: (hovered: boolean) => void;
  networkMode: NetworkMode;
}) {
  const iconUrl = getTokenIcon(symbol, networkMode);

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
        ${formatNumber(fiatValue, { max: 2 })}
      </span>
    </div>
  );
}

function PoolBalanceSection({
  poolConfig,
  tvlUsd,
  tvlToken0Usd,
  tvlToken1Usd,
  networkMode,
}: {
  poolConfig: PoolConfig;
  tvlUsd?: number;
  tvlToken0Usd?: number;
  tvlToken1Usd?: number;
  networkMode: NetworkMode;
}) {
  const token0 = poolConfig.tokens[0];
  const token1 = poolConfig.tokens[1];
  const total = tvlUsd ?? 0;
  const fiat0 = tvlToken0Usd ?? 0;
  const fiat1 = tvlToken1Usd ?? 0;

  const [hoveredToken, setHoveredToken] = useState<0 | 1 | null>(null);

  const percent0 = total > 0 ? (fiat0 / total) * 100 : 0;
  const percent1 = total > 0 ? (fiat1 / total) * 100 : 0;

  return (
    <div className="p-5 bg-container border border-sidebar-border rounded-lg flex flex-col gap-4 w-full">
      <h4 className="text-sm font-semibold text-foreground">Pool Balance</h4>

      {total > 0 && (
        <>
          <DualBar
            percent0={percent0}
            percent1={percent1}
            token0Symbol={token0?.symbol}
            token1Symbol={token1?.symbol}
            hoveredToken={hoveredToken}
            onHover={setHoveredToken}
            networkMode={networkMode}
          />

          <div className="flex flex-col gap-0.5 -mb-3">
            {token0 && (
              <BalanceTokenRow
                symbol={token0.symbol}
                fiatValue={fiat0}
                isHovered={hoveredToken === 0}
                isMuted={hoveredToken === 1}
                onHover={(h) => setHoveredToken(h ? 0 : null)}
                networkMode={networkMode}
              />
            )}
            {token1 && (
              <BalanceTokenRow
                symbol={token1.symbol}
                fiatValue={fiat1}
                isHovered={hoveredToken === 1}
                isMuted={hoveredToken === 0}
                onHover={(h) => setHoveredToken(h ? 1 : null)}
                networkMode={networkMode}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Earning on cards ─────────────────────────────────────────────────────────

const EARNING_SOURCE_CONFIG: Record<'aave' | 'spark', {
  name: string;
  logo: string;
  pillBg: string;
  pillText: string;
}> = {
  aave: {
    name: 'Aave',
    logo: '/aave/Logomark-light.png',
    pillBg: 'rgba(152, 150, 255, 0.25)',
    pillText: '#BDBBFF',
  },
  spark: {
    name: 'Spark',
    logo: '/spark/Spark-Logomark-RGB.svg',
    pillBg: 'rgba(250, 67, 189, 0.2)',
    pillText: '#FA7BD4',
  },
};

function EarningOnCard({ source, apr }: { source: 'aave' | 'spark'; apr?: number }) {
  const cfg = EARNING_SOURCE_CONFIG[source];

  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 surface-depth p-3">
      <Image src={cfg.logo} alt={cfg.name} width={18} height={18} />
      <span className="text-sm text-muted-foreground flex-1">
        Earning on {cfg.name}
      </span>
      {apr !== undefined && apr > 0 && (
        <span
          className="px-2.5 py-0.5 rounded-md text-xs font-semibold font-mono"
          style={{ backgroundColor: cfg.pillBg, color: cfg.pillText }}
        >
          {apr.toFixed(2)}%
        </span>
      )}
    </div>
  );
}

function EarningPointsCard() {
  return (
    <div className="relative flex items-center gap-2.5 rounded-lg bg-muted/30 border border-sidebar-border/60 p-3 overflow-hidden">
      <div
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          backgroundImage: `url(/patterns/button-default.svg)`,
          backgroundSize: '200px',
        }}
      />
      <PointsIcon className="w-[18px] h-[18px] text-muted-foreground relative z-10" />
      <span className="text-sm text-muted-foreground flex-1 relative z-10">Earning Points</span>
      <span
        className="px-2.5 py-0.5 rounded-md text-xs font-semibold font-mono relative z-10"
        style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)', color: 'rgba(255, 255, 255, 0.7)' }}
      >
        Active
      </span>
    </div>
  );
}

// ─── Contracts ────────────────────────────────────────────────────────────────

function ContractsSection({ poolConfig }: { poolConfig: PoolConfig }) {
  const token0 = poolConfig.tokens[0];
  const token1 = poolConfig.tokens[1];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-sidebar-border/60 p-4 pb-2">
      <h4 className="text-sm font-semibold text-foreground">Contracts</h4>
      <div className="flex flex-col -mx-2">
        {token0 && (
          <CopyableRow label={token0.symbol} value={token0.address} />
        )}
        {token1 && (
          <CopyableRow label={token1.symbol} value={token1.address} />
        )}
        {poolConfig.hooks && (
          <CopyableRow label="Lending Vault" value={poolConfig.hooks} />
        )}
      </div>
    </div>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

function FAQItem({
  question,
  answer,
  isOpen,
  onToggle,
}: {
  question: string;
  answer: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="transition-colors">
      <button
        onClick={onToggle}
        className="group flex w-full cursor-pointer items-center gap-3 py-2.5 text-left"
      >
        <div className="flex-1">
          <h3 className="text-sm text-foreground">{question}</h3>
        </div>
        <div className="shrink-0">
          {isOpen ? (
            <IconMinus className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <IconPlus className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </button>
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="pb-3">
            <p className="text-muted-foreground leading-relaxed text-xs">
              {answer}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const poolFaqItems: { question: string; answer: React.ReactNode }[] = [
  {
    question: "What does a Pool do?",
    answer:
      "A pool holds two tokens and allows traders to swap between them. When you deposit, you earn a share of the trading fees proportional to your liquidity.",
  },
  {
    question: "Where does yield come from?",
    answer:
      "Yield comes from two main sources: swap fees paid by traders using the pool and lending yield earned by lending out idle liquidity (rehypothecation). Both streams are combined into a single Unified Yield.",
  },
  {
    question: "How do dynamic fees work?",
    answer:
      "Dynamic fees adjust in real-time based on the pool's Volume/TVL ratio. When trading activity is high, fees increase to capture more value for LPs. When activity is low, fees decrease to attract more volume.",
  },
  {
    question: "What are the risks?",
    answer:
      "All DeFi protocols carry inherent risks, including impermanent loss, smart contract risk, and lending protocol risk. At Alphix, security is non-negotiable — we maintain the highest standards of safety through rigorous audits and continuous monitoring.",
  },
];

function PoolFAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-base font-semibold text-foreground mb-1">FAQ</h3>
      {poolFaqItems.map((item, i) => (
        <FAQItem
          key={i}
          question={item.question}
          answer={item.answer}
          isOpen={openIndex === i}
          onToggle={() => setOpenIndex(openIndex === i ? null : i)}
        />
      ))}
    </div>
  );
}

// ─── Main Sidebar ─────────────────────────────────────────────────────────────

interface PoolDetailSidebarProps {
  poolConfig: PoolConfig;
  poolApr?: number;
  aaveApr?: number;
  aprBySource?: Record<'aave' | 'spark', number>;
  tvlUsd?: number;
  tvlToken0Usd?: number;
  tvlToken1Usd?: number;
  networkMode: NetworkMode;
  yieldSources?: Array<'aave' | 'spark'>;
}

/**
 * PoolDetailSidebar
 *
 * Pool Balance → Earning on → Points → Contracts → FAQ
 */
export const PoolDetailSidebar = memo(function PoolDetailSidebar({
  poolConfig,
  poolApr,
  aaveApr,
  aprBySource,
  tvlUsd,
  tvlToken0Usd,
  tvlToken1Usd,
  networkMode,
  yieldSources,
}: PoolDetailSidebarProps) {
  const effectiveYieldSources = yieldSources ?? poolConfig.yieldSources ?? ['aave'];

  return (
    <div className="flex flex-col gap-6">
      {/* Pool Details */}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-foreground">
          Pool Details
        </h3>
        <div className="flex flex-col gap-3">
          {/* Earning on sources */}
          {effectiveYieldSources.map((source) => (
            <EarningOnCard
              key={source}
              source={source}
              apr={aprBySource?.[source]}
            />
          ))}

          {/* Earning Points */}
          <EarningPointsCard />

          {/* Pool Balance */}
          <PoolBalanceSection poolConfig={poolConfig} tvlUsd={tvlUsd} tvlToken0Usd={tvlToken0Usd} tvlToken1Usd={tvlToken1Usd} networkMode={networkMode} />

          <ContractsSection poolConfig={poolConfig} />
        </div>
      </div>

      {/* FAQ */}
      <PoolFAQSection />
    </div>
  );
});

export default PoolDetailSidebar;
