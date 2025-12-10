"use client";

import { useState } from "react";
import { AppSidebar } from "./app-sidebar";
import { SidebarInset } from "@/components/ui/sidebar";
import { UpdatesNotification } from "./updates-notification";
// import { MobileMenuButton } from "./MobileMenuButton"; // Keep this commented
import { MobileHeader } from "./MobileHeader"; // Import MobileHeader
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";

function VersionBadge() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';
  const commit = process.env.NEXT_PUBLIC_GIT_COMMIT || 'dev';

  return (
    <div className="fixed bottom-4 right-5 z-40 text-xs text-muted-foreground/50 font-mono select-none pointer-events-none">
      v{version}<span className="opacity-60">+{commit}</span>
    </div>
  );
}

interface AppLayoutProps {
  children: React.ReactNode;
}

// Define the expected mobile header height for padding. Corresponds to h-14 in MobileHeader.tsx (3.5rem or 56px)
const MOBILE_HEADER_PADDING_CLASS = "pt-14";

export function AppLayout({ children }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const [showUpdatesNotification, setShowUpdatesNotification] = useState(false);

  const handleBetaClick = () => {
    setShowUpdatesNotification(v => !v);
  };

  return (
    <>
      <AppSidebar variant="inset" onBetaClick={handleBetaClick} />
      <MobileHeader />
      <SidebarInset
        className={isMobile === true ? MOBILE_HEADER_PADDING_CLASS : ""}
      >
        <div className="flex flex-1 flex-col">
          {children}
        </div>
      </SidebarInset>
      <UpdatesNotification open={showUpdatesNotification} onClose={() => setShowUpdatesNotification(false)} />
      <VersionBadge />
    </>
  );
} 