"use client";

/**
 * DisconnectButton - Wallet disconnect button
 *
 * Based on interface/apps/web/src/components/AccountDrawer/DisconnectButton.tsx
 * Simplified for Alphix using wagmi's disconnect hook.
 */

import { memo, useCallback } from "react";
import { useDisconnect } from "wagmi";
import { cn } from "@/lib/utils";
import { Power } from "@/components/Icons";

interface DisconnectButtonProps {
  className?: string;
  size?: number;
}

export const DisconnectButton = memo(function DisconnectButton({
  className,
  size = 24,
}: DisconnectButtonProps) {
  const { disconnect } = useDisconnect();

  const handleDisconnect = useCallback(() => {
    disconnect();
  }, [disconnect]);

  return (
    <button
      onClick={handleDisconnect}
      className={cn(
        "flex items-center justify-center",
        "rounded-full",
        "transition-colors duration-200",
        "hover:bg-muted",
        "p-1.5",
        className
      )}
      aria-label="Disconnect wallet"
    >
      <Power
        width={size}
        height={size}
        className="text-muted-foreground"
      />
    </button>
  );
});

export default DisconnectButton;
