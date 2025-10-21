"use client";

import React, { useState, useEffect, ReactNode } from "react";
import { createPortal } from "react-dom";

interface NestedModalManagerProps {
  isOpen: boolean;
  onClose: () => void;
  primaryModal: ReactNode;
  secondaryModal?: ReactNode;
  secondaryModalOpen?: boolean;
}

/**
 * Nested Modal Manager
 *
 * Handles side-by-side modal layout on desktop and stacked layout on mobile.
 * - Desktop: Shows primary modal on left, secondary modal on right (if open)
 * - Mobile: Stacks modals vertically
 *
 * Closing behavior:
 * - Clicking backdrop closes all modals
 * - Closing secondary modal returns to primary modal
 * - Closing primary modal closes everything
 */
export function NestedModalManager({
  isOpen,
  onClose,
  primaryModal,
  secondaryModal,
  secondaryModalOpen = false
}: NestedModalManagerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted || !isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      {/* Desktop: Side by side */}
      <div className="hidden lg:flex items-start gap-4 max-h-[90vh] max-w-[95vw]">
        {/* Primary Modal */}
        <div
          className={`transition-all duration-200 ${
            secondaryModalOpen ? 'opacity-70 blur-[2px]' : 'opacity-100'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {primaryModal}
        </div>

        {/* Secondary Modal */}
        {secondaryModalOpen && secondaryModal && (
          <div onClick={(e) => e.stopPropagation()}>
            {secondaryModal}
          </div>
        )}
      </div>

      {/* Mobile: Stacked */}
      <div className="lg:hidden flex flex-col items-center gap-4 max-h-[90vh] max-w-[95vw] overflow-y-auto w-full px-4">
        {/* If secondary is open, show it on top; otherwise show primary */}
        {secondaryModalOpen && secondaryModal ? (
          <div className="w-full" onClick={(e) => e.stopPropagation()}>
            {secondaryModal}
          </div>
        ) : (
          <div className="w-full" onClick={(e) => e.stopPropagation()}>
            {primaryModal}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/**
 * Hook to manage nested modal state
 *
 * Usage:
 * ```
 * const modal = useNestedModal();
 *
 * // Open primary modal
 * modal.openPrimary();
 *
 * // Open secondary modal (while primary is open)
 * modal.openSecondary();
 *
 * // Close secondary (returns to primary)
 * modal.closeSecondary();
 *
 * // Close all
 * modal.closeAll();
 * ```
 */
export function useNestedModal() {
  const [isPrimaryOpen, setIsPrimaryOpen] = useState(false);
  const [isSecondaryOpen, setIsSecondaryOpen] = useState(false);

  const openPrimary = () => {
    setIsPrimaryOpen(true);
    setIsSecondaryOpen(false);
  };

  const openSecondary = () => {
    setIsSecondaryOpen(true);
  };

  const closeSecondary = () => {
    setIsSecondaryOpen(false);
  };

  const closePrimary = () => {
    setIsPrimaryOpen(false);
    setIsSecondaryOpen(false);
  };

  const closeAll = () => {
    setIsPrimaryOpen(false);
    setIsSecondaryOpen(false);
  };

  return {
    isPrimaryOpen,
    isSecondaryOpen,
    openPrimary,
    openSecondary,
    closeSecondary,
    closePrimary,
    closeAll,
    isAnyOpen: isPrimaryOpen || isSecondaryOpen
  };
}
