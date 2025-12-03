"use client";

import React, { useState, useMemo } from "react";
import { BadgeCheck, OctagonX } from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { getTokenDefinitions, TokenSymbol, getToken } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";
import { formatUnits } from "viem";
import { useDecreaseLiquidity } from "./useDecreaseLiquidity";

interface CollectFeesFormPanelProps {
  position: ProcessedPosition;
  prefetchedRaw0?: string | null;
  prefetchedRaw1?: string | null;
  onSuccess: () => void;
  getUsdPriceForSymbol: (symbol?: string) => number;
}

const getTokenIcon = (symbol?: string) => {
  if (!symbol) return "/placeholder-logo.svg";
  const tokenConfig = getToken(symbol);
  return tokenConfig?.icon || "/placeholder-logo.svg";
};

export function CollectFeesFormPanel({
  position,
  prefetchedRaw0,
  prefetchedRaw1,
  onSuccess,
  getUsdPriceForSymbol
}: CollectFeesFormPanelProps) {
  const [showSuccessView, setShowSuccessView] = useState(false);
  const { networkMode } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  const { claimFees, isLoading: isClaimingFees, hash: claimTxHash } = useDecreaseLiquidity({
    onFeesCollected: (info) => {
      setShowSuccessView(true);
      onSuccess();
    }
  });

  // Calculate fees
  const { feeAmount0, feeAmount1, feesUSD, hasZeroFees } = React.useMemo(() => {
    if (prefetchedRaw0 === null || prefetchedRaw1 === null) {
      return { feeAmount0: 0, feeAmount1: 0, feesUSD: 0, hasZeroFees: false };
    }

    try {
      const raw0 = prefetchedRaw0 || '0';
      const raw1 = prefetchedRaw1 || '0';

      const d0 = tokenDefinitions?.[position.token0.symbol as string]?.decimals ?? 18;
      const d1 = tokenDefinitions?.[position.token1.symbol as string]?.decimals ?? 18;

      const fee0 = parseFloat(formatUnits(BigInt(raw0), d0));
      const fee1 = parseFloat(formatUnits(BigInt(raw1), d1));

      const price0 = getUsdPriceForSymbol(position.token0.symbol);
      const price1 = getUsdPriceForSymbol(position.token1.symbol);

      const usdFees = (fee0 * price0) + (fee1 * price1);
      const hasZero = BigInt(raw0) <= 0n && BigInt(raw1) <= 0n;

      return {
        feeAmount0: fee0,
        feeAmount1: fee1,
        feesUSD: usdFees,
        hasZeroFees: hasZero
      };
    } catch {
      return { feeAmount0: 0, feeAmount1: 0, feesUSD: 0, hasZeroFees: true };
    }
  }, [prefetchedRaw0, prefetchedRaw1, position, getUsdPriceForSymbol]);

  const handleCollectFees = async () => {
    if (hasZeroFees) {
      return;
    }

    try {
      await claimFees(position.positionId);
    } catch (e) {
      console.error('[CollectFeesFormPanel] claimFees call threw', e);
    }
  };

  // Success view
  if (showSuccessView) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-6">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10">
          <BadgeCheck className="w-8 h-8 text-green-500" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">Fees Collected!</h3>
          <p className="text-sm text-muted-foreground">
            Your fees have been successfully claimed
          </p>
        </div>
        {claimTxHash && (
          <a
            href={getExplorerTxUrl(claimTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            View on Explorer
          </a>
        )}
      </div>
    );
  }

  // Overview view
  return (
    <div className="space-y-6">
      <h3 className="text-base font-semibold">Collect Fees</h3>

      {hasZeroFees ? (
        <div className="p-6 rounded-lg bg-muted/20 border border-sidebar-border text-center">
          <OctagonX className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No fees available to collect</p>
        </div>
      ) : (
        <>
          {/* Total Fees USD */}
          <div className="p-4 rounded-lg bg-muted/20 border border-sidebar-border">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Total Fees</div>
            <div className="text-2xl font-bold">
              {new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              }).format(feesUSD)}
            </div>
          </div>

          {/* Fee Breakdown */}
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Fee Breakdown</div>

            {/* Token 0 Fee */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/10 border border-sidebar-border/60">
              <div className="flex items-center gap-3">
                <Image
                  src={getTokenIcon(position.token0.symbol)}
                  alt={position.token0.symbol}
                  width={24}
                  height={24}
                  className="rounded-full"
                />
                <span className="text-sm font-medium">{position.token0.symbol}</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">
                  {feeAmount0 < 0.001 && feeAmount0 > 0
                    ? "< 0.001"
                    : feeAmount0.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 0 })
                  }
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  }).format(feeAmount0 * getUsdPriceForSymbol(position.token0.symbol))}
                </div>
              </div>
            </div>

            {/* Token 1 Fee */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/10 border border-sidebar-border/60">
              <div className="flex items-center gap-3">
                <Image
                  src={getTokenIcon(position.token1.symbol)}
                  alt={position.token1.symbol}
                  width={24}
                  height={24}
                  className="rounded-full"
                />
                <span className="text-sm font-medium">{position.token1.symbol}</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">
                  {feeAmount1 < 0.001 && feeAmount1 > 0
                    ? "< 0.001"
                    : feeAmount1.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 0 })
                  }
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  }).format(feeAmount1 * getUsdPriceForSymbol(position.token1.symbol))}
                </div>
              </div>
            </div>
          </div>

          {/* Collect Button */}
          <Button
            onClick={handleCollectFees}
            disabled={isClaimingFees}
            className={isClaimingFees ?
              "w-full relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75" :
              "w-full text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
            }
            style={isClaimingFees ?
              { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } :
              undefined
            }
          >
            <span className={isClaimingFees ? "animate-pulse" : ""}>
              Collect
            </span>
          </Button>
        </>
      )}
    </div>
  );
}
