"use client";

import { memo, useState, useCallback, useEffect } from "react";
import { useAccount, useEnsName, useEnsAvatar } from "wagmi";
import { mainnet } from "wagmi/chains";
import { cn } from "@/lib/utils";
import { IconClone2, IconCheck } from "nucleo-micro-bold-essential";
import { DeterministicAvatar } from "@/lib/icons/avatar";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Fallback wallet icons for connectors without native icons
 * Based on interface/apps/web/src/components/Web3Provider/constants.ts
 */
const WALLET_ICONS: Record<string, string> = {
  "io.metamask": "/wallets/metamask-icon.svg",
  metaMask: "/wallets/metamask-icon.svg",
  metamask: "/wallets/metamask-icon.svg",
  walletConnect: "/wallets/walletconnect-icon.svg",
  coinbaseWallet: "/wallets/coinbase-icon.svg",
  coinbaseWalletSDK: "/wallets/coinbase-icon.svg",
  phantom: "/wallets/phantom-icon.png",
};

/**
 * Get wallet icon URL - prefer connector's native icon, fallback to mapping
 */
function getWalletIconUrl(
  connectorIcon?: string,
  connectorId?: string,
  connectorName?: string
): string | null {
  if (connectorIcon) return connectorIcon;
  if (connectorId && WALLET_ICONS[connectorId]) return WALLET_ICONS[connectorId];
  if (connectorName) {
    const nameLower = connectorName.toLowerCase();
    if (nameLower.includes("metamask")) return WALLET_ICONS["metamask"];
    if (nameLower.includes("walletconnect")) return WALLET_ICONS["walletConnect"];
    if (nameLower.includes("coinbase")) return WALLET_ICONS["coinbaseWallet"];
    if (nameLower.includes("phantom")) return WALLET_ICONS["phantom"];
  }
  return null;
}

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
  isCompact: isCompactProp,
}: AddressDisplayProps) {
  const { address, isConnected, connector } = useAccount();
  const [isCopied, setIsCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isMobile = useIsMobile();

  // Mobile uses a middle-ground size (not full 48px, not tiny 24px)
  const isCompact = !isMobile && isCompactProp;

  // Get wallet icon for the badge
  const walletIconUrl = getWalletIconUrl(
    connector?.icon,
    connector?.id,
    connector?.name
  );

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

  // Mobile: 32px, Compact: 24px, Full: 48px
  const iconSize = isMobile ? 32 : isCompact ? 24 : 48;
  const displayName = ensName || `${address.slice(0, 6)}...${address.slice(-4)}`;
  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

  // Mini wallet icon size - based on Uniswap's StatusIcon pattern (16px default)
  const miniIconSize = isMobile ? 14 : isCompact ? 12 : 16;

  return (
    <div className="flex flex-row items-center gap-3">
      {/* Avatar/Icon container - relative for badge positioning */}
      <div className="relative">
        {/* Avatar - Square with rounded corners */}
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

        {/* Mini wallet icon badge - bottom right, circle */}
        {walletIconUrl && (
          <div
            className="absolute flex items-center justify-center bg-background rounded-full overflow-hidden"
            style={{
              width: miniIconSize,
              height: miniIconSize,
              bottom: -(miniIconSize / 4),
              right: -(miniIconSize / 4),
              outline: "2px solid var(--background)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={walletIconUrl}
              alt={connector?.name || "Wallet"}
              className="w-full h-full object-cover rounded-full"
              style={{ width: miniIconSize, height: miniIconSize }}
            />
          </div>
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
              isMobile ? "text-base" : isCompact ? "text-sm" : "text-xl"
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
                isMobile ? "text-base" : isCompact ? "text-sm" : "text-xl",
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
              <IconClone2
                width={12}
                height={12}
                className={cn(
                  "absolute inset-0 text-muted-foreground transition-all duration-200",
                  isCopied
                    ? "opacity-0 translate-y-1"
                    : "opacity-100 translate-y-0"
                )}
              />
              <IconCheck
                width={12}
                height={12}
                className={cn(
                  "absolute inset-0 text-green-500 transition-all duration-200",
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
                "text-xs sm:text-sm text-muted-foreground transition-opacity duration-200",
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
              <IconClone2
                width={12}
                height={12}
                className={cn(
                  "absolute inset-0 text-muted-foreground transition-all duration-200",
                  isCopied
                    ? "opacity-0 translate-y-1"
                    : "opacity-100 translate-y-0"
                )}
              />
              <IconCheck
                width={12}
                height={12}
                className={cn(
                  "absolute inset-0 text-green-500 transition-all duration-200",
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
