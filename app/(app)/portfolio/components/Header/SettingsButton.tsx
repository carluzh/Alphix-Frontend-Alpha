"use client";

/**
 * SettingsButton - Settings icon button that routes to settings page
 *
 * Based on Uniswap's AuthenticatedHeader pattern.
 * Currently routes to /settings, but will be refactored to open
 * a sliding settings panel within the Portfolio page.
 */

import { memo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Settings } from "@/components/Icons";

interface SettingsButtonProps {
  size?: number;
  className?: string;
}

export const SettingsButton = memo(function SettingsButton({
  size = 24,
  className,
}: SettingsButtonProps) {
  const router = useRouter();

  const handleClick = useCallback(() => {
    router.push("/settings");
  }, [router]);

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex items-center justify-center",
        "rounded-full",
        "transition-colors duration-200",
        "hover:bg-muted",
        "p-1.5",
        className
      )}
      aria-label="Settings"
    >
      <Settings
        width={size}
        height={size}
        className="text-muted-foreground"
      />
    </button>
  );
});

export default SettingsButton;
