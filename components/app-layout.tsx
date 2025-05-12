"use client";

import { AppSidebar } from "./app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { BetaNotification } from "./beta-notification";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <SidebarProvider>
      <AppSidebar variant="inset" />
      <SidebarInset>
        <div className="flex flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </SidebarInset>
      <BetaNotification />
    </SidebarProvider>
  );
} 