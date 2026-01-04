"use client";

import { PropsWithChildren } from "react";
import { OverviewLayout } from "./components/OverviewLayout";

/**
 * Overview Layout
 *
 * Wraps all overview routes with the shared layout including:
 * - Header with address display
 * - URL-based tab navigation
 * - Connect wallet banner for disconnected users
 */
export default function Layout({ children }: PropsWithChildren) {
  return <OverviewLayout>{children}</OverviewLayout>;
}
