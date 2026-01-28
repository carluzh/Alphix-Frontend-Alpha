'use client';

/**
 * Price Deviation Confirmation Modal
 *
 * Modal that appears when price deviation exceeds 10% (high severity).
 * Requires user acknowledgment before proceeding with swap/liquidity action.
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { IconTriangleWarningFilled } from 'nucleo-micro-bold-essential';
import type { PriceDeviationResult } from '@/hooks/usePriceDeviation';

interface PriceDeviationConfirmModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed (cancel) */
  onClose: () => void;
  /** Callback when user confirms and proceeds */
  onConfirm: () => void;
  /** Price deviation data */
  deviation: PriceDeviationResult;
  /** Token0 symbol for display */
  token0Symbol: string;
  /** Token1 symbol for display */
  token1Symbol: string;
  /** Action type for context in messaging */
  action: 'swap' | 'liquidity';
}

export function PriceDeviationConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  deviation,
  token0Symbol,
  token1Symbol,
  action,
}: PriceDeviationConfirmModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset acknowledgment when modal opens
  useEffect(() => {
    if (isOpen) {
      setAcknowledged(false);
    }
  }, [isOpen]);

  const percentStr = deviation.absoluteDeviation?.toFixed(1) ?? '0';
  const directionWord = deviation.direction === 'above' ? 'higher' : 'lower';

  // Format prices for display
  const formatPrice = (price: number | null): string => {
    if (price === null) return '-';
    if (price >= 1000) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  };

  const actionWord = action === 'swap' ? 'swap' : 'add liquidity';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-3">
          {/* Warning Icon */}
          <div className="flex justify-center">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-500/10">
              <IconTriangleWarningFilled className="w-6 h-6 text-red-500" />
            </div>
          </div>

          <DialogTitle className="text-center text-lg">
            Significant Price Deviation Detected
          </DialogTitle>

          <DialogDescription className="text-center">
            The pool price is {percentStr}% {directionWord} than the current market price.
            This may result in unfavorable execution.
          </DialogDescription>
        </DialogHeader>

        {/* Price Comparison */}
        <div className="space-y-3 py-2">
          <div className="flex flex-col gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Market Price</span>
              <span className="text-white font-medium">
                1 {token0Symbol} = {formatPrice(deviation.marketPrice)} {token1Symbol}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Pool Price</span>
              <span className="font-medium text-red-400">
                1 {token0Symbol} = {formatPrice(deviation.poolPrice)} {token1Symbol}
              </span>
            </div>
            <div className="flex justify-between text-sm pt-1 border-t border-red-500/20">
              <span className="text-muted-foreground">Deviation</span>
              <span className="text-red-500 font-medium">
                {percentStr}% {directionWord}
              </span>
            </div>
          </div>

          {/* Warning message */}
          <p className="text-xs text-muted-foreground text-center">
            {action === 'swap'
              ? 'You may receive significantly less tokens than expected at current market rates.'
              : 'Your liquidity position may be immediately out of range or suffer impermanent loss.'}
          </p>
        </div>

        {/* Acknowledgment Checkbox */}
        <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-white/5 transition-colors">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(checked) => setAcknowledged(checked === true)}
          />
          <span className="text-sm text-muted-foreground">
            I understand the risks and want to proceed anyway
          </span>
        </label>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={!acknowledged}
            className={cn(
              'flex-1',
              acknowledged
                ? 'bg-red-500 hover:bg-red-600 text-white border-red-500'
                : 'opacity-50'
            )}
          >
            Proceed with {actionWord}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PriceDeviationConfirmModal;
