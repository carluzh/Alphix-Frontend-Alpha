"use client";

import { memo } from "react";
import { useAccount } from "wagmi";
import { cn } from "@/lib/utils";
import { AddressDisplay } from "./AddressDisplay";
import { SettingsButton } from "./SettingsButton";
import { DisconnectButton } from "./DisconnectButton";
import { useShouldHeaderBeCompact } from "../../hooks/useShouldHeaderBeCompact";

interface PortfolioHeaderProps {
  scrollY?: number;
}

/**
 * PortfolioHeader - Portfolio page header with address display and wallet controls
 *
 * Layout:
 * - Left: Address display (avatar with wallet icon badge + ENS/address)
 * - Right: Settings button + Disconnect button
 *
 * Based on Uniswap's AuthenticatedHeader pattern:
 * interface/apps/web/src/components/AccountDrawer/AuthenticatedHeader.tsx
 */
export const PortfolioHeader = memo(function PortfolioHeader({
  scrollY,
}: PortfolioHeaderProps) {
  const { isConnected } = useAccount();
  const isCompact = useShouldHeaderBeCompact(scrollY);

  // Don't render empty header when disconnected
  if (!isConnected) {
    return null;
  }

  const iconSize = isCompact ? 20 : 24;

  return (
    <div
      className={cn(
        // Background and positioning
        "bg-background",
        // Flex layout - row with items at each end
        "flex flex-row items-center justify-between",
        // Gap matches page padding (24px desktop / 12px mobile)
        "gap-3 sm:gap-6"
      )}
    >
      {/* Left: Address Display */}
      <AddressDisplay isCompact={isCompact} />

      {/* Right: Settings + Disconnect */}
      <div className="flex flex-row items-center gap-1">
        <SettingsButton size={iconSize} />
        <DisconnectButton size={iconSize} />
      </div>
    </div>
  );
});

export default PortfolioHeader;
