"use client";

import { memo, PropsWithChildren } from "react";
import { cn } from "@/lib/utils";

interface TableSectionHeaderProps {
  title: string;
  subtitle: string;
  loading?: boolean;
}

/**
 * TableSectionHeader - matches Uniswap's TableSectionHeader exactly
 *
 * Layout:
 * - Outer Flex: gap="$gap16" (16px)
 * - Inner Flex: gap="$gap4" (4px)
 * - Title: variant="subheading1" color="$neutral1"
 * - Subtitle: variant="body3" color="$neutral2" with loading state
 */
export const TableSectionHeader = memo(function TableSectionHeader({
  title,
  subtitle,
  loading,
  children,
}: PropsWithChildren<TableSectionHeaderProps>) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {/* Title: subheading1 = text-base font-semibold */}
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {/* Subtitle: body3 = text-sm, neutral2 = muted-foreground */}
        <span
          className={cn(
            "text-sm text-muted-foreground",
            loading && "animate-pulse"
          )}
        >
          {subtitle}
        </span>
      </div>
      {children}
    </div>
  );
});

export default TableSectionHeader;
