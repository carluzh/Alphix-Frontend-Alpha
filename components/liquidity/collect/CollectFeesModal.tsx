"use client";

/**
 * CollectFeesModal - Thin wrapper around TransactionModal
 *
 * Provides review content (fee amounts, token pair display) and delegates
 * all execution logic to the unified TransactionModal + useCollectFeesFlow.
 */

import React, { useMemo } from "react";
import { cn, formatTokenDisplayAmount } from "@/lib/utils";
import { TokenImage } from "@/components/ui/token-image";
import { formatUSD } from "@/lib/format";
import { getTokenIcon } from "../liquidity-form-utils";
import { resolveTokenIcon } from "@/lib/pools-config";
import { useUSDCPriceRaw } from "@/lib/uniswap/hooks/useUSDCPrice";
import { Token } from "@uniswap/sdk-core";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import type { TokenSymbol } from "@/lib/pools-config";
import { getToken, getPoolBySlug } from "@/lib/pools-config";
import { chainIdForMode } from "@/lib/network-mode";

import { TransactionModal } from "@/components/transactions";
import { useCollectFeesFlow } from "@/lib/transactions/flows/useCollectFeesFlow";

// =============================================================================
// TYPES
// =============================================================================

interface CollectFeesModalProps {
  position: ProcessedPosition;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function CollectFeesModal({ position, isOpen, onClose, onSuccess }: CollectFeesModalProps) {
  const networkMode = position.networkMode;
  const chainId = networkMode ? chainIdForMode(networkMode) : undefined;

  // Token configs
  const token0Config = getToken(position.token0.symbol as TokenSymbol, networkMode);
  const token1Config = getToken(position.token1.symbol as TokenSymbol, networkMode);
  const token0Icon = resolveTokenIcon(position.token0.symbol);
  const token1Icon = resolveTokenIcon(position.token1.symbol);

  // USD prices
  const token0 = useMemo(() => {
    if (!token0Config || !chainId) return null;
    return new Token(chainId, token0Config.address, token0Config.decimals, token0Config.symbol);
  }, [token0Config, chainId]);

  const token1 = useMemo(() => {
    if (!token1Config || !chainId) return null;
    return new Token(chainId, token1Config.address, token1Config.decimals, token1Config.symbol);
  }, [token1Config, chainId]);

  const { price: token0USDPrice } = useUSDCPriceRaw(token0 ?? undefined);
  const { price: token1USDPrice } = useUSDCPriceRaw(token1 ?? undefined);

  // Fee calculations
  const fee0 = parseFloat(position.token0UncollectedFees || "0");
  const fee1 = parseFloat(position.token1UncollectedFees || "0");
  const usdFee0 = fee0 * (token0USDPrice || 0);
  const usdFee1 = fee1 * (token1USDPrice || 0);
  const totalFeesUSD = usdFee0 + usdFee1;
  const hasFees = fee0 > 0 || fee1 > 0;

  // Pool type
  const poolConfig = position.poolId ? getPoolBySlug(position.poolId, networkMode) : null;
  const isUnifiedYield = poolConfig?.rehypoRange !== undefined;

  // Flow definition
  const { generateSteps, executors, mapStepsToUI } = useCollectFeesFlow({
    positionId: position.positionId,
    networkMode,
    token0Symbol: position.token0.symbol,
    token1Symbol: position.token1.symbol,
    token0Icon: getTokenIcon(position.token0.symbol, networkMode),
    token1Icon: getTokenIcon(position.token1.symbol, networkMode),
  });

  return (
    <TransactionModal
      open={isOpen}
      onClose={onClose}
      title="Collect Fees"

      confirmText="Collect Fees"
      confirmDisabled={!hasFees}
      generateSteps={generateSteps}
      executors={executors}
      mapStepsToUI={mapStepsToUI}
      onSuccess={() => { onSuccess?.(); }}
    >
      {/* Token Pair Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-semibold text-white">
              {position.token0.symbol}
            </span>
            <span className="text-2xl font-semibold text-muted-foreground">/</span>
            <span className="text-2xl font-semibold text-white">
              {position.token1.symbol}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "w-2 h-2 rounded-full",
                  isUnifiedYield ? "bg-green-500" : (position.isInRange ? "bg-green-500" : "bg-red-500")
                )}
              />
              <span
                className={cn(
                  "text-xs font-medium",
                  isUnifiedYield ? "text-green-500" : (position.isInRange ? "text-green-500" : "text-red-500")
                )}
              >
                {isUnifiedYield ? "Earning" : (position.isInRange ? "In Range" : "Out of Range")}
              </span>
            </div>
            {position.poolId && (
              isUnifiedYield ? (
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  style={{ backgroundColor: "rgba(152, 150, 255, 0.10)", color: "#9896FF" }}
                >
                  Unified Yield
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted/40 text-muted-foreground">
                  Custom
                </span>
              )
            )}
          </div>
        </div>
        <div className="flex items-center -space-x-2">
          <TokenImage
            src={getTokenIcon(position.token0.symbol, networkMode)}
            alt=""
            size={36}
          />
          <TokenImage
            src={getTokenIcon(position.token1.symbol, networkMode)}
            alt=""
            size={36}
          />
        </div>
      </div>

      {/* Fee Amounts */}
      <div className="mt-5">
        <span className="text-sm text-muted-foreground mb-3 block">You Will Receive</span>
        <div className="flex flex-col gap-4">
          {fee0 > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-xl font-semibold text-white">
                  {formatTokenDisplayAmount(position.token0UncollectedFees || "0", position.token0.symbol as TokenSymbol)} {position.token0.symbol}
                </span>
                <span className="text-sm text-muted-foreground">{formatUSD(usdFee0)}</span>
              </div>
              <TokenImage
                src={getTokenIcon(position.token0.symbol, networkMode)}
                alt={position.token0.symbol}
                size={36}
              />
            </div>
          )}
          {fee1 > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-xl font-semibold text-white">
                  {formatTokenDisplayAmount(position.token1UncollectedFees || "0", position.token1.symbol as TokenSymbol)} {position.token1.symbol}
                </span>
                <span className="text-sm text-muted-foreground">{formatUSD(usdFee1)}</span>
              </div>
              <TokenImage
                src={getTokenIcon(position.token1.symbol, networkMode)}
                alt={position.token1.symbol}
                size={36}
              />
            </div>
          )}
        </div>

        {/* Total Value */}
        <div className="mt-4 pt-4 border-t border-sidebar-border/60 flex justify-between">
          <span className="text-sm text-muted-foreground">Total Value</span>
          <span className="font-medium">{formatUSD(totalFeesUSD)}</span>
        </div>
      </div>

      {/* No Fees Message */}
      {!hasFees && (
        <div className="mt-4">
          <div className="rounded-lg bg-muted/30 p-4 text-center">
            <p className="text-muted-foreground">No fees to collect</p>
          </div>
        </div>
      )}
    </TransactionModal>
  );
}

export default CollectFeesModal;
