"use client";

/**
 * IncreaseLiquidityModal - Modal wrapper for add liquidity flow
 *
 * Single-step modal that wraps the form in context providers.
 * The form handles input, execution, and success states internally.
 *
 * @see interface/apps/web/src/pages/IncreaseLiquidity/IncreaseLiquidityModal.tsx
 */

import React from "react";
import { IconXmark } from "nucleo-micro-bold-essential";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import { IncreaseLiquidityContextProvider } from "./IncreaseLiquidityContext";
import { IncreaseLiquidityTxContextProvider } from "./IncreaseLiquidityTxContext";
import { IncreaseLiquidityForm } from "./IncreaseLiquidityForm";

interface IncreaseLiquidityModalProps {
  position: ProcessedPosition;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * Main modal component - wraps form in providers
 */
export function IncreaseLiquidityModal({
  position,
  isOpen,
  onClose,
  onSuccess,
}: IncreaseLiquidityModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      {/* Custom overlay to prevent layout shift */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <DialogContent
        className="sm:max-w-[440px] bg-container border-sidebar-border p-0 gap-0 [&>button]:hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Header: Title + Close X - matches ReviewExecuteModal pattern */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-base font-medium text-muted-foreground">
            Add Liquidity
          </span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-white transition-colors"
          >
            <IconXmark className="w-5 h-5" />
          </button>
        </div>

        {/* Form content */}
        <div className="px-4 pb-4">
          <IncreaseLiquidityContextProvider position={position}>
            <IncreaseLiquidityTxContextProvider>
              <IncreaseLiquidityForm onClose={onClose} onSuccess={onSuccess} />
            </IncreaseLiquidityTxContextProvider>
          </IncreaseLiquidityContextProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default IncreaseLiquidityModal;
