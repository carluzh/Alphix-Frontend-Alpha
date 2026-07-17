"use client";

import Image from "next/image";

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
