"use client";

import { ThemeProvider } from "@/components/theme-provider";
import { NetworkProvider } from "@/lib/network-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NetworkProvider>
      <ThemeProvider>
        {children}
      </ThemeProvider>
    </NetworkProvider>
  );
} 