"use client";

import React from "react";
import Image from "next/image";
import { getTokenIcon, formatCalculatedAmount } from "../liquidity-form-utils";

interface DetailRowProps {
  label: string;
  value: React.ReactNode;
  icon?: string;
}

function DetailRow({ label, value, icon }: DetailRowProps) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        {icon && <Image src={icon} alt="" width={16} height={16} className="rounded-full" />}
        <span className="text-sm font-medium">{value}</span>
      </div>
    </div>
  );
}

export interface LiquidityDetailRowsProps {
  token0Amount?: string;
  token0Symbol?: string;
  token1Amount?: string;
  token1Symbol?: string;
  token0USDValue?: number;
  token1USDValue?: number;
  networkCostUSD?: string;
  totalValueUSD?: number;
  showNetworkCost?: boolean;
  title?: string;
}

export function LiquidityDetailRows({
  token0Amount, token0Symbol, token1Amount, token1Symbol,
  token0USDValue, token1USDValue, networkCostUSD, totalValueUSD,
  showNetworkCost = true, title,
}: LiquidityDetailRowsProps) {
  const hasToken0 = token0Amount && parseFloat(token0Amount) > 0;
  const hasToken1 = token1Amount && parseFloat(token1Amount) > 0;
  if (!hasToken0 && !hasToken1 && !(showNetworkCost && networkCostUSD)) return null;

  return (
    <div className="rounded-lg border border-sidebar-border/60 bg-muted/10 p-4 space-y-1">
      {title && <div className="text-xs font-medium text-muted-foreground mb-2">{title}</div>}
      {hasToken0 && token0Symbol && (
        <DetailRow label={token0Symbol} value={<span>{parseFloat(token0Amount).toFixed(6)}{token0USDValue !== undefined && <span className="text-muted-foreground ml-2">({formatCalculatedAmount(token0USDValue)})</span>}</span>} icon={getTokenIcon(token0Symbol)} />
      )}
      {hasToken1 && token1Symbol && (
        <DetailRow label={token1Symbol} value={<span>{parseFloat(token1Amount).toFixed(6)}{token1USDValue !== undefined && <span className="text-muted-foreground ml-2">({formatCalculatedAmount(token1USDValue)})</span>}</span>} icon={getTokenIcon(token1Symbol)} />
      )}
      {showNetworkCost && networkCostUSD && <DetailRow label="Network Cost" value={`~$${networkCostUSD}`} />}
      {totalValueUSD !== undefined && totalValueUSD > 0 && (
        <><div className="border-t border-sidebar-border/40 my-2" /><DetailRow label="Total Value" value={formatCalculatedAmount(totalValueUSD)} /></>
      )}
    </div>
  );
}

export function LiquidityDetailRowsCompact({ token0Amount, token0Symbol, token1Amount, token1Symbol, token0USDPrice = 0, token1USDPrice = 0 }: {
  token0Amount?: string; token0Symbol?: string; token1Amount?: string; token1Symbol?: string; token0USDPrice?: number; token1USDPrice?: number;
}) {
  const amt0 = parseFloat(token0Amount || "0");
  const amt1 = parseFloat(token1Amount || "0");
  const totalUSD = amt0 * token0USDPrice + amt1 * token1USDPrice;

  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-4">
        {amt0 > 0 && token0Symbol && <div className="flex items-center gap-1.5"><Image src={getTokenIcon(token0Symbol)} alt="" width={16} height={16} className="rounded-full" /><span>{amt0.toFixed(4)} {token0Symbol}</span></div>}
        {amt1 > 0 && token1Symbol && <div className="flex items-center gap-1.5"><Image src={getTokenIcon(token1Symbol)} alt="" width={16} height={16} className="rounded-full" /><span>{amt1.toFixed(4)} {token1Symbol}</span></div>}
      </div>
      {totalUSD > 0 && <span className="text-muted-foreground">{formatCalculatedAmount(totalUSD)}</span>}
    </div>
  );
}
