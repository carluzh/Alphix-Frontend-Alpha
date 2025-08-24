"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getToken as getTokenConfig } from "@/lib/pools-config";

// This type might need to be moved to a shared types file later.
type ProcessedPosition = {
  positionId: string;
  owner: string;
  poolId: string;
  token0: {
    address: string;
    symbol: string;
    amount: string;
    usdValue?: number;
  };
  token1: {
    address: string;
    symbol: string;
    amount: string;
    usdValue?: number;
  };
  tickLower: number;
  tickUpper: number;
  isInRange: boolean;
  ageSeconds: number;
  blockTimestamp: number;
};


interface TokenStackProps {
  position: ProcessedPosition;
}

export function TokenStack({ position }: TokenStackProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const getTokenIcon = (positionToken: { symbol?: string; address?: string }) => {
    if (!positionToken?.symbol) return "/placeholder-logo.svg";
    const tokenConfig = getTokenConfig(positionToken.symbol);
    if (tokenConfig?.icon) {
      return tokenConfig.icon;
    }
    return "/placeholder-logo.svg";
  };

  const iconSize = 24;
  const overlap = 0.3 * iconSize;
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
          <motion.div
            key={token.symbol}
            className="absolute top-0"
            style={{
              zIndex: index + 1,
              left: `${leftPos}px`,
            }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            onHoverStart={() => setHoveredIndex(index)}
            onHoverEnd={() => setHoveredIndex(null)}
          >
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <motion.div
                    className="relative cursor-pointer"
                    whileHover={{ scale: 1.08 }}
                    style={{
                      padding: `${iconSize * 0.1}px`,
                      margin: `-${iconSize * 0.1}px`,
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  >
                    <Image
                      src={token.icon}
                      alt={token.symbol}
                      width={iconSize}
                      height={iconSize}
                      className="rounded-full bg-background"
                    />
                  </motion.div>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  sideOffset={6}
                  className="px-2 py-1 text-xs"
                >
                  {token.symbol}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
