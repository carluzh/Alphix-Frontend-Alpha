"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { getToken as getTokenConfig } from "@/lib/pools-config";

/**
 * Minimal position type for TokenStack - only needs token symbols
 */
interface TokenStackPosition {
  token0: { symbol: string };
  token1: { symbol: string };
}

interface TokenStackProps {
  position: TokenStackPosition;
}

export function TokenStack({ position }: TokenStackProps) {

  const getTokenIcon = (positionToken: { symbol?: string; address?: string }) => {
    if (!positionToken?.symbol) return "/placeholder-logo.svg";
    const tokenConfig = getTokenConfig(positionToken.symbol);
    if (tokenConfig?.icon) {
      return tokenConfig.icon;
    }
    return "/placeholder-logo.svg";
  };

  const iconSize = 32;
  const overlap = 12; // Fixed 12px overlap (second image at left-5 = 20px, meaning 12px overlap from 32px)
  const step = iconSize - overlap;
  
  const tokens = [
    {
      symbol: position.token0.symbol || "Token 0",
      icon: getTokenIcon(position.token0),
    },
    {
      symbol: position.token1.symbol || "Token 1",
      icon: getTokenIcon(position.token1),
    },
  ];

  const baseWidth = iconSize + step;

  return (
    <motion.div
      className="relative flex-shrink-0"
      style={{ height: iconSize, width: baseWidth }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      {tokens.map((token, index) => {
        const leftPos = index * step;
        
        return (
          <div
            key={token.symbol}
            className="absolute top-0"
            style={{
              zIndex: index + 1,
              left: `${leftPos}px`,
            }}
          >
            <Image
              src={token.icon}
              alt={token.symbol}
              width={iconSize}
              height={iconSize}
              className="rounded-full bg-background"
            />
          </div>
        );
      })}
    </motion.div>
  );
}
