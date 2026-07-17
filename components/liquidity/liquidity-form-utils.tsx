/**
 * Shared utilities for liquidity form components (Add & Remove)
 * Consolidates common logic to reduce duplication and improve maintainability
 */

import React from "react";
import { formatUSD } from "@/lib/format";
export { getTokenIcon } from "@/lib/utils";

/**
 * Format calculated USD amounts with max 9 decimals and ellipsis for overflow
 * Used for displaying USD values below input fields
 */
export const formatCalculatedAmount = (value: number): React.ReactNode => {
  if (!Number.isFinite(value) || value <= 0) return formatUSD(0);

  const formatted = formatUSD(value);

  const match = formatted.match(/\$([0-9,]+\.?[0-9]*)/);
  if (!match) return formatted;

  const [, numericPart] = match;
  const [integerPart, decimalPart] = numericPart.split('.');

  if (!decimalPart || decimalPart.length <= 9) {
    return formatted;
  }

  const truncatedDecimal = decimalPart.substring(0, 9);
  const truncatedFormatted = `$${integerPart}.${truncatedDecimal}`;

  return (
    <span>
      {truncatedFormatted}
      <span className="text-muted-foreground">...</span>
    </span>
  );
};

/**
 * Standard percentage options for buttons
 */
export const PERCENTAGE_OPTIONS = [25, 50, 75, 100] as const;
