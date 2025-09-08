"use client";

import { useState } from "react";
import { AppSidebar } from "./app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { BetaNotification } from "./beta-notification";
import { UpdatesNotification } from "./updates-notification";
// import { MobileMenuButton } from "./MobileMenuButton"; // Keep this commented
import { MobileHeader } from "./MobileHeader"; // Import MobileHeader
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";

interface AppLayoutProps {
  children: React.ReactNode;
}

// Define the expected mobile header height for padding. Corresponds to h-14 in MobileHeader.tsx (3.5rem or 56px)
const MOBILE_HEADER_PADDING_CLASS = "pt-14";

export function AppLayout({ children }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const [showUpdatesNotification, setShowUpdatesNotification] = useState(false);

  const handleBetaClick = () => {
    console.log('handleBetaClick called!'); // Debug log
    // Only trigger if not already showing
    if (!showUpdatesNotification) {
      console.log('Setting showUpdatesNotification to true'); // Debug log
      setShowUpdatesNotification(true);
      // Reset after a short delay to allow re-triggering if needed
      setTimeout(() => {
        console.log('Resetting showUpdatesNotification to false'); // Debug log
        setShowUpdatesNotification(false);
      }, 100);
    }
  };

  return (
    <SidebarProvider>
              <AppSidebar variant="floating" onBetaClick={handleBetaClick} />
      <MobileHeader />
      <SidebarInset
        className={isMobile === true ? MOBILE_HEADER_PADDING_CLASS : ""}
      >
        <div className="flex flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </SidebarInset>
      <BetaNotification />
      <UpdatesNotification forceShow={showUpdatesNotification} />
    </SidebarProvider>
  );
} 