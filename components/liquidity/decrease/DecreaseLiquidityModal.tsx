"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import { DecreaseLiquidityContextProvider, useDecreaseLiquidityContext, DecreaseLiquidityStep } from "./DecreaseLiquidityContext";
import { DecreaseLiquidityTxContextProvider } from "./DecreaseLiquidityTxContext";
import { DecreaseLiquidityForm } from "./DecreaseLiquidityForm";
import { DecreaseLiquidityReview } from "./DecreaseLiquidityReview";

interface DecreaseLiquidityModalProps {
  position: ProcessedPosition;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

function DecreaseLiquidityModalInner({ onClose, onSuccess }: { onClose: () => void; onSuccess?: () => void }) {
  const { step } = useDecreaseLiquidityContext();

  switch (step) {
    case DecreaseLiquidityStep.Input:
      return <DecreaseLiquidityForm />;
    case DecreaseLiquidityStep.Review:
      return <DecreaseLiquidityReview onClose={onClose} onSuccess={onSuccess} />;
    default:
      return <DecreaseLiquidityForm />;
  }
}

export function DecreaseLiquidityModal({ position, isOpen, onClose, onSuccess }: DecreaseLiquidityModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px] bg-container border-sidebar-border">
        <DialogHeader>
          <DialogTitle>Withdraw Liquidity</DialogTitle>
        </DialogHeader>

        <DecreaseLiquidityContextProvider position={position}>
          <DecreaseLiquidityTxContextProvider>
            <DecreaseLiquidityModalInner onClose={onClose} onSuccess={onSuccess} />
          </DecreaseLiquidityTxContextProvider>
        </DecreaseLiquidityContextProvider>
      </DialogContent>
    </Dialog>
  );
}

export default DecreaseLiquidityModal;
