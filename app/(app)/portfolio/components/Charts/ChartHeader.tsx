"use client";

import { UTCTimestamp } from "lightweight-charts";
import { ReactElement, ReactNode } from "react";

// Format USD
function formatUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// Format date/time for header - "Month Day, Year, Time AM/PM" (e.g., "Apr 1, 2025, 2:00 AM")
function formatHeaderDate(time: UTCTimestamp): string {
  const date = new Date(time * 1000);
  const monthDay = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const year = date.getFullYear();
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${monthDay}, ${year}, ${timeStr}`;
}

interface HeaderValueDisplayProps {
  /** The number to be formatted and displayed, or the ReactElement to be displayed */
  value?: number | ReactElement;
}

function HeaderValueDisplay({ value }: HeaderValueDisplayProps) {
  if (typeof value !== "number" && typeof value !== "undefined") {
    return <>{value}</>;
  }

  return (
    <span className="text-3xl font-semibold text-foreground truncate">
      {value !== undefined ? formatUSD(value) : "$0.00"}
    </span>
  );
}

interface HeaderTimeDisplayProps {
  time?: UTCTimestamp;
  /** Optional string to display when time is undefined */
  timePlaceholder?: string;
}

function HeaderTimeDisplay({ time, timePlaceholder }: HeaderTimeDisplayProps) {
  return (
    <span className="text-xs text-muted-foreground flex items-center">
      {time ? formatHeaderDate(time) : timePlaceholder}
    </span>
  );
}

interface ChartHeaderProps extends HeaderValueDisplayProps, HeaderTimeDisplayProps {
  additionalFields?: ReactNode;
}

export function ChartHeader({
  value,
  time,
  timePlaceholder,
  additionalFields,
}: ChartHeaderProps) {
  return (
    <div
      className="flex flex-row absolute w-full gap-2 items-start z-10"
      id="chart-header"
    >
      <div
        className="flex flex-col gap-1 p-3 pointer-events-none bg-background rounded-xl"
      >
        <HeaderValueDisplay value={value} />
        <div className="flex flex-row gap-2 truncate items-center">
          {additionalFields}
          <HeaderTimeDisplay time={time} timePlaceholder={timePlaceholder} />
        </div>
      </div>
    </div>
  );
}
