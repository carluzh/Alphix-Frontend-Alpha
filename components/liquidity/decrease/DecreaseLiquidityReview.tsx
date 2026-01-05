"use client";

import React, { useEffect } from "react";
import { ExternalLink as ExternalLinkIcon, ChevronLeftIcon } from "lucide-react";
import { IconBadgeCheck2 } from "nucleo-micro-bold-essential";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import { formatUSD } from "@/lib/format";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { getTokenIcon } from "../liquidity-form-utils";
import { LiquidityDetailRows } from "../shared/LiquidityDetailRows";
import { useDecreaseLiquidityContext, DecreaseLiquidityStep } from "./DecreaseLiquidityContext";
import { useDecreaseLiquidityTxContext } from "./DecreaseLiquidityTxContext";
import type { TokenSymbol } from "@/lib/pools-config";

interface DecreaseLiquidityReviewProps {
  onClose: () => void;
  onSuccess?: () => void;
}

export function DecreaseLiquidityReview({ onClose, onSuccess }: DecreaseLiquidityReviewProps) {
  const { setStep, decreaseLiquidityState, derivedDecreaseInfo } = useDecreaseLiquidityContext();
  const { isWorking, error, isSuccess, txHash, token0USDPrice, token1USDPrice, executeWithdraw, getWithdrawButtonText } = useDecreaseLiquidityTxContext();

  const { position } = decreaseLiquidityState;
  const { withdrawAmount0, withdrawAmount1 } = derivedDecreaseInfo;

  const amount0 = parseFloat(withdrawAmount0 || "0");
  const amount1 = parseFloat(withdrawAmount1 || "0");
  const usdValue0 = amount0 * token0USDPrice;
  const usdValue1 = amount1 * token1USDPrice;

  useEffect(() => {
    if (isSuccess && onSuccess) {
      onSuccess();
    }
  }, [isSuccess, onSuccess]);

  const handleBack = () => {
    if (!isWorking) {
      setStep(DecreaseLiquidityStep.Input);
    }
  };

  const handleDone = () => {
    onSuccess?.();
    onClose();
  };

  if (isSuccess) {
    return (
      <div className="space-y-4">
        <div className="text-center py-4">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
            <IconBadgeCheck2 className="h-6 w-6 text-green-500" />
          </div>
          <h3 className="text-lg font-medium">Liquidity Withdrawn!</h3>
          {txHash && (
            <a href={getExplorerTxUrl(txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline mt-1">
              View on Explorer
              <ExternalLinkIcon className="h-3 w-3" />
            </a>
          )}
        </div>

        <div className="rounded-lg border border-primary p-4 bg-muted/30">
          <div className="flex items-center justify-between">
            {amount0 > 0 && (
              <div className="flex items-center gap-2">
                <Image src={getTokenIcon(position.token0.symbol)} alt="" width={28} height={28} className="rounded-full" />
                <div>
                  <div className="font-medium text-sm">{formatTokenDisplayAmount(amount0.toString(), position.token0.symbol as TokenSymbol)} {position.token0.symbol}</div>
                  <div className="text-xs text-muted-foreground">{formatUSD(usdValue0)}</div>
                </div>
              </div>
            )}
            {amount0 > 0 && amount1 > 0 && <span className="text-muted-foreground">+</span>}
            {amount1 > 0 && (
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <div className="font-medium text-sm">{formatTokenDisplayAmount(amount1.toString(), position.token1.symbol as TokenSymbol)} {position.token1.symbol}</div>
                  <div className="text-xs text-muted-foreground">{formatUSD(usdValue1)}</div>
                </div>
                <Image src={getTokenIcon(position.token1.symbol)} alt="" width={28} height={28} className="rounded-full" />
              </div>
            )}
          </div>
        </div>

        <Button onClick={handleDone} className="w-full text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90">
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ChevronLeftIcon className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-white transition-colors" onClick={handleBack} />
        <span className="text-sm font-medium">You Will Receive</span>
      </div>

      <div className="rounded-lg bg-container p-4 border border-sidebar-border/60">
        <div className="space-y-4">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="text-xl font-medium">{formatTokenDisplayAmount(withdrawAmount0 || "0", position.token0.symbol as TokenSymbol)}</div>
                <span className="text-sm text-muted-foreground">{position.token0.symbol}</span>
              </div>
              <div className="text-xs text-muted-foreground">{formatUSD(usdValue0)}</div>
            </div>
            <Image src={getTokenIcon(position.token0.symbol)} alt={position.token0.symbol} width={40} height={40} className="rounded-full" />
          </div>

          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="text-xl font-medium">{formatTokenDisplayAmount(withdrawAmount1 || "0", position.token1.symbol as TokenSymbol)}</div>
                <span className="text-sm text-muted-foreground">{position.token1.symbol}</span>
              </div>
              <div className="text-xs text-muted-foreground">{formatUSD(usdValue1)}</div>
            </div>
            <Image src={getTokenIcon(position.token1.symbol)} alt={position.token1.symbol} width={40} height={40} className="rounded-full" />
          </div>
        </div>
      </div>

      <LiquidityDetailRows
        token0Amount={withdrawAmount0}
        token0Symbol={position.token0.symbol}
        token1Amount={withdrawAmount1}
        token1Symbol={position.token1.symbol}
        token0USDValue={usdValue0}
        token1USDValue={usdValue1}
        showNetworkCost={false}
        title="Withdrawing"
      />

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={isWorking}
          className="relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50"
          style={{ backgroundImage: "url(/pattern.svg)", backgroundSize: "cover", backgroundPosition: "center" }}
        >
          Back
        </Button>

        <Button
          onClick={executeWithdraw}
          disabled={isWorking}
          className={cn("text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90", isWorking && "opacity-80")}
        >
          <span className={isWorking ? "animate-pulse" : ""}>{isWorking ? "Processing..." : getWithdrawButtonText()}</span>
        </Button>
      </div>
    </div>
  );
}
