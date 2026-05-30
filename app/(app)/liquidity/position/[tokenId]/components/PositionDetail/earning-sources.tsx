"use client";

import Image from "next/image";
import { PointsIcon } from "@/components/PointsIcons";

// ─── Earning on cards (same as pool detail sidebar) ───────────────────────────

const EARNING_SOURCE_CONFIG: Record<'aave', {
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
};

function EarningOnCard({ source, apr }: { source: 'aave'; apr?: number }) {
  const cfg = EARNING_SOURCE_CONFIG[source];
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 surface-depth p-3">
      <Image src={cfg.logo} alt={cfg.name} width={18} height={18} />
      <span className="text-sm text-muted-foreground flex-1">Earning on {cfg.name}</span>
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

export function EarningSourcesSection({
  yieldSources = [],
  aprBySource,
}: {
  yieldSources?: Array<'aave'>;
  aprBySource?: Record<'aave', number>;
}) {
  return (
    <div className="flex flex-col gap-2">
      {yieldSources.map((source) => (
        <EarningOnCard key={source} source={source} apr={aprBySource?.[source]} />
      ))}
      {/* Re-add <EarningPointsCard /> on next season. */}
    </div>
  );
}
