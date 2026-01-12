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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
          className="sm:max-w-[440px] bg-container border-sidebar-border"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
        <DialogHeader>
          <DialogTitle className="text-base font-medium text-muted-foreground">Add Liquidity</DialogTitle>
        </DialogHeader>

        <IncreaseLiquidityContextProvider position={position}>
          <IncreaseLiquidityTxContextProvider>
            <IncreaseLiquidityForm onClose={onClose} onSuccess={onSuccess} />
          </IncreaseLiquidityTxContextProvider>
        </IncreaseLiquidityContextProvider>
      </DialogContent>
    </Dialog>
  );
}

export default IncreaseLiquidityModal;
