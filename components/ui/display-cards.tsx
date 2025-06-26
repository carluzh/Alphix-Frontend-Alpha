"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { SquareDot, Coins, Scale } from "lucide-react";
import type { LucideProps } from "lucide-react";

interface DisplayCardProps {
  className?: string;
  icon?: React.ReactElement<LucideProps>;
  title?: string;
  description?: string;
  date?: string;
  isActive?: boolean;
}

function DisplayCard({
  className,
  icon,
  title,
  description,
  date,
  isActive,
}: DisplayCardProps) {
  const containerClasses = cn(
    "before:absolute before:w-[100%] before:outline-1 before:rounded-xl before:outline-border before:h-[100%] before:content-[''] before:bg-blend-overlay before:bg-background/50 before:transition-opacity before:duration-700 before:left-0 before:top-0",
    isActive ? "grayscale-0 before:opacity-0 border-white/20" : "grayscale-[100%] before:opacity-100 border-white/10"
  );
  const iconClasses = cn(
    "size-4 transition-all duration-300",
    isActive ? "text-orange-600 opacity-100" : "text-orange-300 opacity-40"
  );
  const titleClasses = cn(
    "text-sm font-medium transition-all duration-300",
    isActive ? "text-orange-600 opacity-100" : "text-white opacity-40"
  );
  const descriptionClasses = cn(
    "whitespace-nowrap text-sm text-white/80 transition-opacity duration-300",
    isActive ? "opacity-100" : "opacity-40"
  );
  const dateClasses = cn(
    "text-xs text-white/40 transition-opacity duration-300",
    isActive ? "opacity-100" : "opacity-40"
  );

  const finalIcon = React.isValidElement(icon)
    ? React.cloneElement(icon, { className: iconClasses })
    : icon;

  return (
    <div
      className={cn(
        "relative flex h-28 w-[18rem] -skew-y-[8deg] select-none flex-col justify-between rounded-xl border-2 bg-black/40 px-3 py-2 transition-all duration-700 backdrop-blur-sm [&>*]:flex [&>*]:items-center [&>*]:gap-2",
        "after:absolute after:-right-1 after:top-[-5%] after:h-[110%] after:w-[6rem] after:bg-gradient-to-l after:from-[#0a0908] after:to-transparent after:content-['']",
        containerClasses,
        className
      )}
      style={{ background: 'rgba(10, 9, 8, 0.4)' }}
    >
      <div>
        <span className="relative inline-block rounded-full bg-orange-800/20 p-1">
          {finalIcon}
        </span>
        <p className={titleClasses} style={{ fontFamily: 'Inter, sans-serif' }}>{title}</p>
      </div>
      <p className={descriptionClasses} style={{ fontFamily: 'Inter, sans-serif' }}>{description}</p>
      <p className={dateClasses} style={{ fontFamily: 'Inter, sans-serif' }}>{date}</p>
    </div>
  );
}

interface DisplayCardsProps {
  cards?: DisplayCardProps[];
}

export default function DisplayCards({ cards }: DisplayCardsProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const cardData = [
    {
      icon: <Scale />,
      title: "Liquidity Automation",
      description: "Concentrated Position Management",
      date: "Q3 2025",
    },
    {
      icon: <Coins />,
      title: "Rehypothecation",
      description: "Earning on Idle Capital",
      date: "Q3 2025",
    },
    {
      icon: <SquareDot />,
      title: "Unified Pools",
      description: "Dynamic Fees Algorithm",
      date: "Live",
    },
  ];

  const cardTransforms = [
    "[grid-area:stack] hover:-translate-y-8",
    "[grid-area:stack] translate-x-12 translate-y-8 hover:-translate-y-1",
    "[grid-area:stack] translate-x-24 translate-y-16 hover:translate-y-6",
  ];

  return (
    <div className="grid [grid-template-areas:'stack'] place-items-center opacity-100 animate-in fade-in-0 duration-700">
      {cardData.map((card, index) => {
        const isActive = hoveredIndex === index || (hoveredIndex === null && index === 2);
        return (
          <div
            key={index}
            onMouseEnter={() => setHoveredIndex(index)}
            onMouseLeave={() => setHoveredIndex(null)}
            className={cn("transition-all duration-700", cardTransforms[index])}
          >
            <DisplayCard
              {...card}
              isActive={isActive}
            />
          </div>
        );
      })}
    </div>
  );
} 