"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { getLatestVersion } from "@/lib/version-log";

export function UpdatesNotification({ forceShow = false }: { forceShow?: boolean }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  
  // Get latest version info
  const latestVersion = getLatestVersion();

  useEffect(() => {
    console.log('UpdatesNotification useEffect - forceShow:', forceShow); // Debug log
    if (typeof window !== 'undefined') {
      // Check if this specific update version has been shown before
      const currentVersion = latestVersion.version;
      const versionShownKey = `updates_${currentVersion.replace('.', '_')}_shown`;
      const wasVersionShown = document.cookie.includes(`${versionShownKey}=true`);
      console.log('Version shown:', wasVersionShown); // Debug log

      // Check if first login was shown (beta notification)
      const firstLoginShown = document.cookie.includes('first_login_shown=true');
      console.log('First login shown:', firstLoginShown); // Debug log

      // Force show if requested (from sidebar beta badge click) - ignore previous show status
      if (forceShow) {
        console.log('Force showing updates notification!'); // Debug log
        setIsVisible(true);
        return;
      }

      // Check if user came from login (for immediate show)
      let fromLogin = false;
      try {
        const flag = sessionStorage.getItem('came_from_login_updates');
        fromLogin = flag === '1' || flag === 'true';
      } catch {}

      if (fromLogin && firstLoginShown && !wasVersionShown) {
        // Show immediately if coming from login, beta was already shown, and this version not shown
        setIsVisible(true);
        try { sessionStorage.removeItem('came_from_login_updates'); } catch {}
        return;
      }

      if (!wasVersionShown && firstLoginShown) {
        // Show with delay if this version hasn't been shown and beta was already shown
        const timer = setTimeout(() => {
          setIsVisible(true);
        }, 2400);
        return () => clearTimeout(timer);
      }
    }
  }, [forceShow]);

  const handleDismiss = () => {
    setIsVisible(false);
    setIsDismissed(true);
    if (typeof window !== 'undefined') {
      // Set version-specific cookie (lifetime)
      const currentVersion = latestVersion.version;
      const versionShownKey = `updates_${currentVersion.replace('.', '_')}_shown`;
      document.cookie = `${versionShownKey}=true; path=/; max-age=31536000`; // 1 year lifetime
    }
  };

  if (!isVisible || isDismissed) return null;

  return (
    <AnimatePresence>
      {(isVisible && !isDismissed) && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          className="fixed bottom-4 right-4 z-40 max-w-sm w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="rounded-lg border border-[#2a2a2a] overflow-hidden bg-[var(--modal-background)]">
            <div className="flex items-center justify-between px-3 py-1 border-b border-[#2a2a2a]">
              <span className="text-xs tracking-wider font-mono font-bold text-sidebar-primary">{latestVersion.title}</span>
              <Button
                variant="ghost"
                className="group -my-1 -me-1 size-8 p-0 hover:bg-transparent"
                aria-label="Close notification"
                onClick={handleDismiss}
              >
                <X size={16} strokeWidth={2} className="opacity-100" />
              </Button>
            </div>
            <div className="p-4 text-foreground">
              {latestVersion.bulletPoints.map((point, index) => (
                <p key={index} className={`text-sm ${index < latestVersion.bulletPoints.length - 1 ? 'mb-2' : ''}`}>
                  • {point}
                </p>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


