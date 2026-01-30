"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "./app-sidebar";
import { SidebarInset } from "@/components/ui/sidebar";
import { UpdatesNotification } from "./updates-notification";
import { AnnouncementCard } from "./announcement-card";
import { MobileHeader } from "./MobileHeader";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { useAccount } from "wagmi";
import { ANNOUNCEMENTS, isAnnouncementActive } from "@/lib/announcements";
import { NavigationProgressBar } from "@/lib/navigation-progress";
import { useToSAcceptance } from "@/hooks/useToSAcceptance";
import { ToSAcceptanceModal } from "@/components/ui/ToSAcceptanceModal";

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

// Define the expected mobile header height for padding. Corresponds to h-14 in MobileHeader.tsx (3.5rem or 56px)
const MOBILE_HEADER_PADDING_CLASS = "pt-14";

export function AppLayout({ children }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const { isConnected, address } = useAccount();
  const { showModal: showToS, onConfirm: onToSConfirm, isSigningMessage } = useToSAcceptance();
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
      <AppSidebar variant="inset" onBetaClick={handleBetaClick} />
      <MobileHeader />
      <SidebarInset
        className={isMobile === true ? MOBILE_HEADER_PADDING_CLASS : ""}
      >
        <NavigationProgressBar />
        <div className="flex flex-1 flex-col">
          {children}
        </div>
      </SidebarInset>
      <AnnouncementCard />
      <UpdatesNotification
        open={showUpdatesNotification}
        onClose={() => setShowUpdatesNotification(false)}
        stackAboveAnnouncement={hasActiveAnnouncement}
        edgeOffsetPx={edgeOffsetPx}
        stackOffsetPx={edgeOffsetPx + announcementHeight + (edgeOffsetPx >= 24 ? 12 : 8)}
      />
      {!showUpdatesNotification && !hasActiveAnnouncement && <VersionBadge />}
      <ToSAcceptanceModal
        isOpen={showToS}
        onConfirm={onToSConfirm}
        isSigningMessage={isSigningMessage}
      />
    </>
  );
} 