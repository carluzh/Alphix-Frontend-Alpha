"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "./app-sidebar";
import { SidebarInset } from "@/components/ui/sidebar";
import { UpdatesNotification } from "./updates-notification";
import { AnnouncementCard } from "./announcement-card";
import { MobileNavBar } from "./MobileNavBar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAccount } from "wagmi";
import { ANNOUNCEMENTS, isAnnouncementActive } from "@/lib/announcements";
import { NavigationProgressBar } from "@/lib/navigation-progress";
import { useToSAcceptance } from "@/hooks/useToSAcceptance";
import { ToSAcceptanceModal } from "@/components/ui/ToSAcceptanceModal";
import { CookieBanner } from "@/components/ui/CookieBanner";
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
  const { isConnected, address } = useAccount();
  const { showModal: showToS, onConfirm: onToSConfirm, isSigningMessage, isSendingToBackend, resolved: tosResolved } = useToSAcceptance();
  const [showUpdatesNotification, setShowUpdatesNotification] = useState(false);
  const [hasActiveAnnouncement, setHasActiveAnnouncement] = useState(false);
  const [announcementHeight, setAnnouncementHeight] = useState<number>(0);
  const [edgeOffsetPx, setEdgeOffsetPx] = useState<number>(12);

  const handleBetaClick = () => {
    setShowUpdatesNotification(v => !v);
  };

  useEffect(() => {
    const compute = () => {
      if (!isConnected || !address) {
        setHasActiveAnnouncement(false);
        return;
      }

      let suppressed = false;
      try {
        const untilRaw = window.localStorage.getItem(`alphix:announcement:dismissedUntil:${address.toLowerCase()}`) || "0";
        const until = Number(untilRaw);
        suppressed = Number.isFinite(until) && Date.now() < until;
      } catch {}

      if (suppressed) {
        setHasActiveAnnouncement(false);
        return;
      }

      const active = ANNOUNCEMENTS.filter((a) => a.enabled !== false).some((a) => isAnnouncementActive(a));
      setHasActiveAnnouncement(active);
    };

    compute();
    const onVisibility = () => compute();
    const onLayout = (e: Event) => {
      const ce = e as CustomEvent<{ visible: boolean; height: number }>;
      if (ce?.detail?.visible === true && typeof ce.detail.height === "number") {
        setAnnouncementHeight(ce.detail.height);
      }
    };
    const onResize = () => {
      setEdgeOffsetPx(window.innerWidth >= 640 ? 24 : 12);
    };

    onResize();
    window.addEventListener("alphix:announcement:visibility", onVisibility as EventListener);
    window.addEventListener("alphix:announcement:layout", onLayout as EventListener);
    window.addEventListener("storage", onVisibility);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("alphix:announcement:visibility", onVisibility as EventListener);
      window.removeEventListener("alphix:announcement:layout", onLayout as EventListener);
      window.removeEventListener("storage", onVisibility);
      window.removeEventListener("resize", onResize);
    };
  }, [isConnected, address]);

  return (
    <>
      {/* Desktop: Sidebar, Mobile: Top Nav Bar */}
      {!isMobile && <AppSidebar variant="inset" onBetaClick={handleBetaClick} />}
      <SidebarInset>
        <MobileNavBar />
        <NavigationProgressBar />
        <div className="flex flex-1 flex-col min-w-0">
          {children}
        </div>
        <AnnouncementCard />
        <UpdatesNotification
          open={showUpdatesNotification}
          onClose={() => setShowUpdatesNotification(false)}
          stackAboveAnnouncement={hasActiveAnnouncement}
          edgeOffsetPx={edgeOffsetPx}
          stackOffsetPx={edgeOffsetPx + announcementHeight + (edgeOffsetPx >= 24 ? 12 : 8)}
        />
        {!showUpdatesNotification && !hasActiveAnnouncement && <VersionBadge />}

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
      </SidebarInset>
    </>
  );
} 