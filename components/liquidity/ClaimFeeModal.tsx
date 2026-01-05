"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { IconXmark } from 'nucleo-micro-bold-essential';
import { Button } from '@/components/ui/button';
import { getToken } from '@/lib/pools-config';
import { useDecreaseLiquidity } from '@/lib/liquidity/hooks';
import { getExplorerTxUrl } from '@/lib/wagmiConfig';
import { cn } from '@/lib/utils';
import { formatUSD } from '@/lib/format';
import { useIsMobile } from '@/hooks/use-mobile';
import { type PositionInfo } from '@/lib/uniswap/liquidity';

/**
 * Extract token data from PositionInfo SDK objects
 */
function getTokenDataFromPosition(position: PositionInfo) {
  const currency0 = position.currency0Amount.currency;
  const currency1 = position.currency1Amount.currency;
  const token0Symbol = currency0.symbol ?? 'TOKEN0';
  const token1Symbol = currency1.symbol ?? 'TOKEN1';
  return { token0Symbol, token1Symbol };
}

interface ClaimFeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: PositionInfo;
  /** Fee amount for token 0 (display formatted) */
  feeAmount0: number;
  /** Fee amount for token 1 (display formatted) */
  feeAmount1: number;
  /** USD value of fee 0 */
  fee0USD: number;
  /** USD value of fee 1 */
  fee1USD: number;
  /** Callback when fees are successfully collected */
  onFeesCollected?: (positionId: string) => void;
  /** Optional callback to refresh position data */
  onRefreshPosition?: () => void;
}

/**
 * Dedicated modal for collecting fees from a liquidity position
 * Following Uniswap's ClaimFeeModal pattern
 */
export function ClaimFeeModal({
  isOpen,
  onClose,
  position,
  feeAmount0,
  feeAmount1,
  fee0USD,
  fee1USD,
  onFeesCollected,
  onRefreshPosition,
}: ClaimFeeModalProps) {
  const [mounted, setMounted] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const isMobile = useIsMobile();

  // Extract token data from PositionInfo
  const { token0Symbol, token1Symbol } = useMemo(() => getTokenDataFromPosition(position), [position]);
  const positionId = position.tokenId;

  // Use the existing claimFees hook
  const {
    claimFees,
    isLoading: isCollecting,
    isSuccess,
    hash: txHash,
    reset: resetCollect,
  } = useDecreaseLiquidity({
    onFeesCollected: (info) => {
      setShowSuccess(true);
      if (positionId) onFeesCollected?.(positionId);
      onRefreshPosition?.();
    },
  });

  // Get token logos
  const token0Logo = getToken(token0Symbol)?.icon || '/placeholder-logo.svg';
  const token1Logo = getToken(token1Symbol)?.icon || '/placeholder-logo.svg';

  // Calculate total fees
  const totalFeesUSD = fee0USD + fee1USD;

  // Format fee amounts for display
  const formatFeeAmount = (amount: number): string => {
    if (amount === 0) return '0';
    if (amount > 0 && amount < 0.0001) return '< 0.0001';
    if (Math.abs(amount) < 0.000001) return '0';
    return amount.toLocaleString('en-US', { maximumFractionDigits: 6, minimumFractionDigits: 0 });
  };

  const displayFee0 = formatFeeAmount(feeAmount0);
  const displayFee1 = formatFeeAmount(feeAmount1);

  // Handle collect button click
  const handleCollect = useCallback(async () => {
    if (!positionId) return;
    try {
      await claimFees(positionId);
    } catch (e) {
      console.error('[ClaimFeeModal] claimFees failed:', e);
    }
  }, [claimFees, positionId]);

  // Handle modal close
  const handleClose = useCallback(() => {
    if (showSuccess) {
      setShowSuccess(false);
      resetCollect();
    }
    onClose();
  }, [showSuccess, resetCollect, onClose]);

  // Mount effect
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Reset success state when modal opens
  useEffect(() => {
    if (isOpen) {
      setShowSuccess(false);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // Lock body scroll on mobile
  useEffect(() => {
    if (!isOpen || !isMobile) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, isMobile]);

  if (!mounted || !isOpen) {
    return null;
  }

  // Check if there are fees to collect
  const hasNoFees = feeAmount0 <= 0 && feeAmount1 <= 0;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[9999] flex backdrop-blur-md cursor-default",
        isMobile ? 'items-end' : 'items-center justify-center'
      )}
      style={{
        pointerEvents: 'auto',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isCollecting) {
          handleClose();
        }
      }}
    >
      <div
        className={cn(
          "relative rounded-lg border border-solid shadow-2xl flex flex-col cursor-default",
          isMobile ? 'w-full rounded-b-none' : ''
        )}
        style={{
          width: isMobile ? '100%' : '420px',
          maxWidth: isMobile ? '100%' : '95vw',
          backgroundColor: 'var(--modal-background)',
          borderColor: 'var(--border-primary)',
          borderRadius: isMobile ? '16px 16px 0 0' : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-lg bg-muted/10 border-0 transition-colors flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border/60">
            <h2 className="text-sm font-medium">Collect Fees</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              disabled={isCollecting}
              className="h-6 w-6 -mr-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {showSuccess ? (
              /* Success View */
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-500/20">
                  <IconBadgeCheck2 className="h-6 w-6 text-green-500" />
                </div>
                <div className="text-center">
                  <h3 className="text-lg font-medium mb-1">Fees Collected!</h3>
                  <p className="text-sm text-muted-foreground">
                    Your fees have been sent to your wallet
                  </p>
                </div>

                {/* Transaction link */}
                {txHash && (
                  <a
                    href={getExplorerTxUrl(txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    View transaction
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}

                <Button
                  onClick={handleClose}
                  className="w-full mt-2 text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
                >
                  Done
                </Button>
              </div>
            ) : (
              /* Default View */
              <>
                {/* Pool Info */}
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex items-center -space-x-2">
                    <div className="relative w-8 h-8 rounded-full overflow-hidden border-2 border-background z-10">
                      <Image
                        src={token0Logo}
                        alt={token0Symbol}
                        width={32}
                        height={32}
                      />
                    </div>
                    <div className="relative w-8 h-8 rounded-full overflow-hidden border-2 border-background">
                      <Image
                        src={token1Logo}
                        alt={token1Symbol}
                        width={32}
                        height={32}
                      />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium">
                      {token0Symbol} / {token1Symbol}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Position #{positionId?.slice(-6) ?? ''}
                    </p>
                  </div>
                </div>

                {/* Fee Amounts */}
                <div className="rounded-lg border border-sidebar-border/60 bg-muted/20 p-4 space-y-3">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
                    Uncollected Fees
                  </div>

                  {/* Token 0 Fee */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="relative w-6 h-6 rounded-full overflow-hidden">
                        <Image
                          src={token0Logo}
                          alt={token0Symbol}
                          width={24}
                          height={24}
                        />
                      </div>
                      <span className="text-sm font-medium">{token0Symbol}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">{displayFee0}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatUSD(fee0USD)}
                      </div>
                    </div>
                  </div>

                  {/* Token 1 Fee */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="relative w-6 h-6 rounded-full overflow-hidden">
                        <Image
                          src={token1Logo}
                          alt={token1Symbol}
                          width={24}
                          height={24}
                        />
                      </div>
                      <span className="text-sm font-medium">{token1Symbol}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">{displayFee1}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatUSD(fee1USD)}
                      </div>
                    </div>
                  </div>

                  {/* Total */}
                  <div className="pt-2 border-t border-sidebar-border/40">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Total Value</span>
                      <span className="text-sm font-medium">
                        {formatUSD(totalFeesUSD)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Collect Button */}
                <Button
                  onClick={handleCollect}
                  disabled={isCollecting || hasNoFees}
                  className={cn(
                    "w-full",
                    hasNoFees
                      ? "relative border border-sidebar-border bg-button px-3 text-sm font-medium text-white/50 cursor-not-allowed"
                      : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
                  )}
                  style={hasNoFees ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                >
                  <span className={isCollecting ? "animate-pulse" : ""}>
                    {isCollecting ? 'Collecting...' : hasNoFees ? 'No Fees to Collect' : 'Collect Fees'}
                  </span>
                </Button>

                {/* Info Text */}
                <p className="text-xs text-muted-foreground text-center">
                  Collecting fees does not affect your liquidity position
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
