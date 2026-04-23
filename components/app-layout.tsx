"use client";

import { AppSidebar } from "./app-sidebar";
import { SidebarInset } from "@/components/ui/sidebar";
import { MobileNavBar } from "./MobileNavBar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAccount } from "wagmi";
import { NavigationProgressBar } from "@/lib/navigation-progress";
import { useToSAcceptance } from "@/hooks/useToSAcceptance";
import { ToSAcceptanceModal } from "@/components/ui/ToSAcceptanceModal";
import { CookieBanner } from "@/components/ui/CookieBanner";
import { LegacyPoolNotice } from "@/components/LegacyPoolNotice";
import { Loader2 } from "lucide-react";

function VersionBadge() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';
  const commit = process.env.NEXT_PUBLIC_GIT_COMMIT || 'dev';

  return (
    <div className="fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-10 text-xs text-muted-foreground/50 font-mono select-none pointer-events-none hidden sm:block">
      v{version} <span className="opacity-60">+{commit}</span>
    </div>
  );
}

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const { isConnected } = useAccount();
  const { showModal: showToS, onConfirm: onToSConfirm, isSigningMessage, isSendingToBackend, resolved: tosResolved } = useToSAcceptance();

  return (
    <>
      {/* Desktop: Sidebar, Mobile: Top Nav Bar */}
      {!isMobile && <AppSidebar variant="inset" />}
      <SidebarInset>
        <MobileNavBar />
        <NavigationProgressBar />
        <div className="flex flex-1 flex-col min-w-0">
          {children}
        </div>
        <VersionBadge />

        {/* TOS overlay - shown on top of content */}
        {isConnected && !tosResolved && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {isConnected && tosResolved && showToS && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <ToSAcceptanceModal
              onConfirm={onToSConfirm}
              isSigningMessage={isSigningMessage}
              isSendingToBackend={isSendingToBackend}
            />
          </div>
        )}

        {/* Cookie banner - only show after TOS is resolved and accepted */}
        {(!isConnected || (tosResolved && !showToS)) && <CookieBanner />}

        {/* Legacy pool notice — shown to wallets still LP'd in sunset pools */}
        {isConnected && tosResolved && !showToS && <LegacyPoolNotice />}
      </SidebarInset>
    </>
  );
} 