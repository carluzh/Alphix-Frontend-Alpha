"use client";

/**
 * DecreaseLiquidityModal - Modal wrapper for withdraw liquidity flow
 *
 * Single-step modal that wraps the form in context providers.
 * The form handles input, execution, and success states internally.
 *
 * @see components/liquidity/decrease/DecreaseLiquidityForm.tsx
 */

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import { DecreaseLiquidityContextProvider } from "./DecreaseLiquidityContext";
import { DecreaseLiquidityTxContextProvider } from "./DecreaseLiquidityTxContext";
import { DecreaseLiquidityForm } from "./DecreaseLiquidityForm";

interface DecreaseLiquidityModalProps {
  position: ProcessedPosition;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * Main modal component - wraps form in providers
 */
export function DecreaseLiquidityModal({
  position,
  isOpen,
  onClose,
  onSuccess,
}: DecreaseLiquidityModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
          className="sm:max-w-[440px] bg-container border-sidebar-border"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
        <DialogHeader>
          <DialogTitle className="text-base font-medium text-muted-foreground">Withdraw Liquidity</DialogTitle>
        </DialogHeader>

        <DecreaseLiquidityContextProvider position={position}>
          <DecreaseLiquidityTxContextProvider>
            <DecreaseLiquidityForm onClose={onClose} onSuccess={onSuccess} />
          </DecreaseLiquidityTxContextProvider>
        </DecreaseLiquidityContextProvider>
      </DialogContent>
    </Dialog>
  );
}

export default DecreaseLiquidityModal;
