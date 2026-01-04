"use client";

import { memo } from "react";

/**
 * Separator component - matches Uniswap's Separator
 * Simple horizontal line divider
 */
export const Separator = memo(function Separator() {
  return <div className="w-full h-px bg-sidebar-border" />;
});

export default Separator;
