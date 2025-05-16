"use client";

import { AppSidebar } from "./app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { BetaNotification } from "./beta-notification";
// import { MobileMenuButton } from "./MobileMenuButton"; // Keep this commented
import { MobileHeader } from "./MobileHeader"; // Import MobileHeader
import { useIsMobile } from "@/hooks/use-mobile";

interface AppLayoutProps {
  children: React.ReactNode;
}

// Define the expected mobile header height for padding. Corresponds to h-14 in MobileHeader.tsx (3.5rem or 56px)
const MOBILE_HEADER_PADDING_CLASS = "pt-14";

export function AppLayout({ children }: AppLayoutProps) {
  const isMobile = useIsMobile();

  return (
    <SidebarProvider>
      <AppSidebar variant="inset" />
      <MobileHeader />
      <SidebarInset
        className={isMobile ? MOBILE_HEADER_PADDING_CLASS : ""}
      >
        <div className="flex flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </SidebarInset>
      <BetaNotification />
    </SidebarProvider>
  );
} 