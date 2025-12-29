"use client";

/**
 * IncreaseLiquidityModal - Thin modal wrapper following Uniswap pattern
 *
 * This modal is ~60 lines because it only:
 * 1. Wraps content in context providers
 * 2. Switches between Input and Review steps
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
import {
  IncreaseLiquidityContextProvider,
  useIncreaseLiquidityContext,
  IncreaseLiquidityStep,
} from "./IncreaseLiquidityContext";
import { IncreaseLiquidityTxContextProvider } from "./IncreaseLiquidityTxContext";
import { IncreaseLiquidityForm } from "./IncreaseLiquidityForm";
import { IncreaseLiquidityReview } from "./IncreaseLiquidityReview";

interface IncreaseLiquidityModalProps {
  position: ProcessedPosition;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * Inner modal content - switches between steps
 */
function IncreaseLiquidityModalInner({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { step } = useIncreaseLiquidityContext();

  switch (step) {
    case IncreaseLiquidityStep.Input:
      return <IncreaseLiquidityForm />;
    case IncreaseLiquidityStep.Review:
      return <IncreaseLiquidityReview onClose={onClose} onSuccess={onSuccess} />;
    default:
      return <IncreaseLiquidityForm />;
  }
}

/**
 * Main modal component - wraps everything in providers
 */
export function IncreaseLiquidityModal({
  position,
  isOpen,
  onClose,
  onSuccess,
}: IncreaseLiquidityModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px] bg-container border-sidebar-border">
        <DialogHeader>
          <DialogTitle>Add Liquidity</DialogTitle>
        </DialogHeader>

        <IncreaseLiquidityContextProvider position={position}>
          <IncreaseLiquidityTxContextProvider>
            <IncreaseLiquidityModalInner onClose={onClose} onSuccess={onSuccess} />
          </IncreaseLiquidityTxContextProvider>
        </IncreaseLiquidityContextProvider>
      </DialogContent>
    </Dialog>
  );
}

export default IncreaseLiquidityModal;
