"use client";

import { PropsWithChildren } from "react";
import { PortfolioLayout } from "./components/PortfolioLayout";

/**
 * Portfolio Layout
 *
 * Wraps all portfolio routes with the shared layout including:
 * - Header with address display
 * - URL-based tab navigation
 * - Connect wallet banner for disconnected users
 */
export default function Layout({ children }: PropsWithChildren) {
  return <PortfolioLayout>{children}</PortfolioLayout>;
}
