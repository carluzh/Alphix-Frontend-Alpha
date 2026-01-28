'use client';

/**
 * Generic High Risk Confirmation Modal
 *
 * A modular modal for any high-severity warning that requires user acknowledgment.
 * Supports multiple warnings with pagination (multi-step wizard).
 * Supports: Price Impact, Slippage, Price Deviation, and custom warnings.
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { IconTriangleWarningFilled } from 'nucleo-micro-bold-essential';

export interface WarningDetail {
  label: string;
  value: string;
  isHighlighted?: boolean;
  showDivider?: boolean;
}

export interface WarningPage {
  title: string;
  description: string;
  details?: WarningDetail[];
  learnMoreUrl?: string;
}

export interface HighRiskConfirmModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed (cancel) */
  onClose: () => void;
  /** Callback when user confirms and proceeds (after all pages acknowledged) */
  onConfirm: () => void;
  /** Array of warning pages - supports multiple warnings */
  warnings: WarningPage[];
  /** Text for the acknowledgment checkbox */
  checkboxText?: string;
  /** Text for the final confirm button */
  confirmText?: string;
}

export function HighRiskConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  warnings,
  checkboxText = 'I understand the risks and want to proceed',
  confirmText = 'Proceed',
}: HighRiskConfirmModalProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);

  const totalPages = warnings.length;
  const isLastPage = currentPage === totalPages - 1;
  const currentWarning = warnings[currentPage];

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentPage(0);
      setAcknowledged(false);
    }
  }, [isOpen]);

  // Reset acknowledgment when page changes
  useEffect(() => {
    setAcknowledged(false);
  }, [currentPage]);

  const handleNext = () => {
    if (isLastPage) {
      onConfirm();
    } else {
      setCurrentPage(prev => prev + 1);
    }
  };

  if (!currentWarning) return null;

  // Button text with pagination info
  const nextButtonText = isLastPage
    ? confirmText
    : totalPages > 1
      ? `Next (${currentPage + 1}/${totalPages})`
      : confirmText;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      {/* Overlay to handle clicks outside */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <DialogContent className="sm:max-w-md p-0">
        {/* Consistent padding all around */}
        <div className="flex flex-col gap-3 p-6">
          {/* Icon with squared background container */}
          <div
            className="flex items-center justify-center p-3 rounded-lg self-start"
            style={{ backgroundColor: 'rgba(255, 89, 60, 0.12)' }}
          >
            <IconTriangleWarningFilled className="w-6 h-6 text-red-500" />
          </div>

          {/* Title - left aligned */}
          <DialogHeader className="space-y-0 text-left">
            <DialogTitle className="text-lg">
              {currentWarning.title}
            </DialogTitle>
          </DialogHeader>

          {/* Description - left aligned */}
          <DialogDescription className="text-sm text-muted-foreground">
            {currentWarning.description}
          </DialogDescription>

          {/* Learn More link - own line, only text is clickable */}
          {currentWarning.learnMoreUrl && (
            <div>
              <a
                href={currentWarning.learnMoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors"
              >
                Learn more
              </a>
            </div>
          )}

          {/* Details Section */}
          {currentWarning.details && currentWarning.details.length > 0 && (
            <div className="w-full">
              <div className="flex flex-col gap-2 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                {currentWarning.details.map((detail, index) => (
                  <div
                    key={index}
                    className={cn(
                      'flex justify-between text-sm',
                      detail.showDivider && 'pt-2 border-t border-red-500/20'
                    )}
                  >
                    <span className="text-muted-foreground">{detail.label}</span>
                    <span
                      className={cn(
                        'font-medium',
                        detail.isHighlighted ? 'text-red-500' : 'text-white'
                      )}
                    >
                      {detail.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Acknowledgment Checkbox - white when checked, no hover bg */}
          <label className="flex items-center gap-3 cursor-pointer py-2">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
              className="data-[state=checked]:bg-white data-[state=checked]:border-white data-[state=checked]:text-black"
            />
            <span className="text-sm text-muted-foreground">
              {checkboxText}
            </span>
          </label>

          {/* Buttons */}
          <div className="flex gap-3">
            {/* Cancel - styled like Disconnect button */}
            <Button
              onClick={onClose}
              className="flex-1 border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] hover:bg-accent hover:brightness-110 hover:border-white/30 text-white/75 transition-all duration-200 overflow-hidden"
              style={{ backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
            >
              Cancel
            </Button>
            {/* Next/Proceed - red when acknowledged, callout-style bg when not */}
            <Button
              onClick={handleNext}
              disabled={!acknowledged}
              className={cn(
                'flex-1 transition-all duration-200',
                acknowledged
                  ? 'bg-red-500 hover:bg-red-600 text-white border-red-500'
                  : 'bg-red-500/5 border border-red-500/20 text-white/50 cursor-not-allowed'
              )}
            >
              {nextButtonText}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Helper functions to create warning configs for common warning types

export interface PriceImpactWarningData {
  priceImpact: number;
}

export interface SlippageWarningData {
  slippage: number;
}

export interface PriceDeviationWarningData {
  poolPrice: number | null;
  marketPrice: number | null;
  deviationPercent: number;
  direction: 'above' | 'below';
  token0Symbol: string;
  token1Symbol: string;
}

export function createPriceImpactWarning(data: PriceImpactWarningData): WarningPage {
  return {
    title: 'Very High Price Impact',
    description: 'This trade will significantly move the market price. You may receive much less than expected due to low liquidity.',
    details: [
      { label: 'Price Impact', value: `${data.priceImpact.toFixed(2)}%`, isHighlighted: true },
    ],
    learnMoreUrl: 'https://support.uniswap.org/hc/en-us/articles/8671539602317-What-is-Price-Impact',
  };
}

export function createSlippageWarning(data: SlippageWarningData): WarningPage {
  return {
    title: 'Very High Slippage',
    description: 'Your trade may be vulnerable to frontrunning and sandwich attacks with this slippage tolerance.',
    details: [
      { label: 'Slippage Tolerance', value: `${data.slippage.toFixed(2)}%`, isHighlighted: true },
    ],
    learnMoreUrl: 'https://support.uniswap.org/hc/en-us/articles/8643879653261-What-is-slippage',
  };
}

export function createPriceDeviationWarning(data: PriceDeviationWarningData): WarningPage {
  const formatPrice = (price: number | null): string => {
    if (price === null) return '-';
    if (price >= 1000) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  };

  const directionWord = data.direction === 'above' ? 'higher' : 'lower';

  return {
    title: 'Significant Price Deviation',
    description: 'The pool price differs significantly from the market price.',
    details: [
      {
        label: 'Market Price',
        value: `1 ${data.token0Symbol} = ${formatPrice(data.marketPrice)} ${data.token1Symbol}`,
      },
      {
        label: 'Pool Price',
        value: `1 ${data.token0Symbol} = ${formatPrice(data.poolPrice)} ${data.token1Symbol}`,
        isHighlighted: true,
      },
      {
        label: 'Deviation',
        value: `${data.deviationPercent.toFixed(1)}% ${directionWord}`,
        isHighlighted: true,
        showDivider: true,
      },
    ],
  };
}

export default HighRiskConfirmModal;
