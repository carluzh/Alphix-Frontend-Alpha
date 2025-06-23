"use client";

import { cn } from "@/lib/utils";
import { SquareDot, Coins, Scale } from "lucide-react";

interface DisplayCardProps {
  className?: string;
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  date?: string;
  iconClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  dateClassName?: string;
}

function DisplayCard({
  className,
  icon = <SquareDot className="size-4 text-orange-300" />,
  title = "Featured",
  description = "Discover amazing content",
  date = "Just now",
  iconClassName = "text-orange-500",
  titleClassName = "text-orange-500",
  descriptionClassName = "text-white/80",
  dateClassName = "text-white/40",
}: DisplayCardProps) {
  return (
    <div
      className={cn(
        "group relative flex h-28 w-[18rem] -skew-y-[8deg] select-none flex-col justify-between rounded-xl border-2 bg-black/40 backdrop-blur-sm px-3 py-2 transition-all duration-700 after:absolute after:-right-1 after:top-[-5%] after:h-[110%] after:w-[16rem] after:bg-gradient-to-l after:from-black after:to-transparent after:content-[''] hover:border-white/20 hover:bg-black/60 [&>*]:flex [&>*]:items-center [&>*]:gap-2",
        className
      )}
      style={{ background: 'rgba(10, 9, 8, 0.4)' }}
    >
      <div>
        <span className="relative inline-block rounded-full bg-orange-800/20 p-1">
          {icon}
        </span>
        <p className={cn("text-sm font-medium group-hover:text-orange-600 transition-colors duration-300", titleClassName)} style={{ fontFamily: 'Inter, sans-serif' }}>{title}</p>
      </div>
      <p className={cn("whitespace-nowrap text-sm group-hover:opacity-100 transition-opacity duration-300", descriptionClassName)} style={{ fontFamily: 'Inter, sans-serif' }}>{description}</p>
      <p className={cn("text-xs group-hover:opacity-100 transition-opacity duration-300", dateClassName)} style={{ fontFamily: 'Inter, sans-serif' }}>{date}</p>
    </div>
  );
}

interface DisplayCardsProps {
  cards?: DisplayCardProps[];
}

export default function DisplayCards({ cards }: DisplayCardsProps) {
  const defaultCards = [
    {
      className: "[grid-area:stack] hover:-translate-y-8 before:absolute before:w-[100%] before:outline-1 before:rounded-xl before:outline-border before:h-[100%] before:content-[''] before:bg-blend-overlay before:bg-background/50 grayscale-[100%] hover:before:opacity-0 before:transition-opacity before:duration:700 hover:grayscale-0 before:left-0 before:top-0",
      icon: <Scale className="size-4 text-orange-300 opacity-40 group-hover:opacity-100 group-hover:text-orange-600 transition-all duration-300" />,
      title: "Liquidity Automation",
      description: "Concentrated Position Management",
      date: "Q3 2025",
      titleClassName: "text-white opacity-40 group-hover:opacity-100 transition-opacity duration-300",
      descriptionClassName: "text-white/80 opacity-40 group-hover:opacity-100 transition-opacity duration-300",
      dateClassName: "text-white/40 opacity-40 group-hover:opacity-100 transition-opacity duration-300",
    },
    {
      className: "[grid-area:stack] translate-x-12 translate-y-8 hover:-translate-y-1 before:absolute before:w-[100%] before:outline-1 before:rounded-xl before:outline-border before:h-[100%] before:content-[''] before:bg-blend-overlay before:bg-background/50 grayscale-[100%] hover:before:opacity-0 before:transition-opacity before:duration:700 hover:grayscale-0 before:left-0 before:top-0",
      icon: <Coins className="size-4 text-orange-300 opacity-60 group-hover:opacity-100 group-hover:text-orange-600 transition-all duration-300" />,
      title: "Rehypothecation",
      description: "Earning on Idle Capital",
      date: "Q3 2025",
      titleClassName: "text-white opacity-60 group-hover:opacity-100 transition-opacity duration-300",
      descriptionClassName: "text-white/80 opacity-60 group-hover:opacity-100 transition-opacity duration-300",
      dateClassName: "text-white/40 opacity-60 group-hover:opacity-100 transition-opacity duration-300",
    },
    {
      className: "[grid-area:stack] translate-x-24 translate-y-16 hover:translate-y-6",
      icon: <SquareDot className="size-4 text-orange-600 transition-colors duration-300" />,
      title: "Unified Pools",
      description: "Dynamic Fees Algorithm",
      date: "Live",
      titleClassName: "text-orange-600 opacity-100",
      descriptionClassName: "text-white/80 opacity-100",
      dateClassName: "text-white/40 opacity-100",
    },
  ];

  const displayCards = cards || defaultCards;

  return (
    <div className="grid [grid-template-areas:'stack'] place-items-center opacity-100 animate-in fade-in-0 duration-700">
      {displayCards.map((cardProps, index) => (
        <DisplayCard key={index} {...cardProps} />
      ))}
    </div>
  );
} 