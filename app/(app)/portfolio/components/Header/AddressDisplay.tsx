"use client";

import { memo, useState, useCallback, useEffect } from "react";
import { useAccount, useEnsName, useEnsAvatar } from "wagmi";
import { mainnet } from "wagmi/chains";
import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { DeterministicAvatar } from "@/lib/avatar";

interface AddressDisplayProps {
  isCompact: boolean;
}

/**
 * AddressDisplay - Portfolio header address display
 *
 * Features:
 * - Square avatar with rounded corners and grey gradient
 * - Deterministic appearance per wallet address
 * - ENS name/avatar support (mainnet)
 * - Click to copy with checkmark animation
 */
export const AddressDisplay = memo(function AddressDisplay({
  isCompact,
}: AddressDisplayProps) {
  const { address, isConnected } = useAccount();
  const [isCopied, setIsCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // ENS resolution (mainnet only)
  const { data: ensName } = useEnsName({
    address: address,
    chainId: mainnet.id,
  });

  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ?? undefined,
    chainId: mainnet.id,
  });

  // Reset copied state after timeout
  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => setIsCopied(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [isCopied]);

  // Copy address to clipboard
  const handleCopy = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setIsCopied(true);
    } catch (err) {
      console.error("Failed to copy address:", err);
    }
  }, [address]);

  if (!isConnected || !address) {
    return null;
  }

  const iconSize = isCompact ? 24 : 48;
  const displayName = ensName || `${address.slice(0, 6)}...${address.slice(-4)}`;
  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <div className="flex flex-row items-center gap-3">
      {/* Avatar/Icon - Square with rounded corners */}
      <div
        className={cn(
          "rounded-lg overflow-hidden flex items-center justify-center",
          "transition-all duration-200 ease-in-out"
        )}
        style={{ width: iconSize, height: iconSize }}
      >
        {ensAvatar ? (
          <img
            src={ensAvatar}
            alt={displayName}
            className="w-full h-full object-cover rounded-lg"
          />
        ) : (
          <DeterministicAvatar address={address} size={iconSize} />
        )}
      </div>

      {/* Name/Address display - matches liquidity page text styling */}
      <div className="flex flex-col">
        {/* Primary: ENS name (static) or shortened address with copy */}
        {ensName ? (
          // ENS name - styled like "Liquidity Pools" heading
          <span
            className={cn(
              "font-semibold text-foreground",
              isCompact ? "text-sm" : "text-xl"
            )}
          >
            {ensName}
          </span>
        ) : (
          // No ENS - address with inline copy, styled like heading
          <div
            className="flex items-center gap-1.5 cursor-pointer"
            onClick={handleCopy}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <span
              className={cn(
                "font-semibold transition-opacity duration-200",
                isCompact ? "text-sm" : "text-xl",
                isHovered ? "opacity-80" : "opacity-100"
              )}
            >
              {shortAddress}
            </span>
            <div
              className={cn(
                "relative w-3 h-3 transition-opacity duration-200",
                isHovered || isCopied ? "opacity-100" : "opacity-0"
              )}
            >
              <Copy
                className={cn(
                  "absolute inset-0 h-3 w-3 text-muted-foreground transition-all duration-200",
                  isCopied
                    ? "opacity-0 translate-y-1"
                    : "opacity-100 translate-y-0"
                )}
              />
              <Check
                className={cn(
                  "absolute inset-0 h-3 w-3 text-green-500 transition-all duration-200",
                  isCopied
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 -translate-y-1"
                )}
              />
            </div>
          </div>
        )}

        {/* Secondary: Address with copy - styled like "Explore and manage..." subtext */}
        {ensName && !isCompact && (
          <div
            className="flex items-center gap-1 cursor-pointer"
            onClick={handleCopy}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <span
              className={cn(
                "text-sm text-muted-foreground transition-opacity duration-200",
                isHovered ? "opacity-80" : "opacity-100"
              )}
            >
              {shortAddress}
            </span>
            <div
              className={cn(
                "relative w-3 h-3 transition-opacity duration-200",
                isHovered || isCopied ? "opacity-100" : "opacity-0"
              )}
            >
              <Copy
                className={cn(
                  "absolute inset-0 h-3 w-3 text-muted-foreground transition-all duration-200",
                  isCopied
                    ? "opacity-0 translate-y-1"
                    : "opacity-100 translate-y-0"
                )}
              />
              <Check
                className={cn(
                  "absolute inset-0 h-3 w-3 text-green-500 transition-all duration-200",
                  isCopied
                    ? "opacity-100 translate-y-0"
                    : "opacity-0 -translate-y-1"
                )}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default AddressDisplay;
