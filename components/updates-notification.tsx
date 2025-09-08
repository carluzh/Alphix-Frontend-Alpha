"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { getLatestVersion } from "@/lib/version-log";

export function UpdatesNotification({ forceShow = false }: { forceShow?: boolean }) {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isToggled, setIsToggled] = useState(false);
  
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

      // Check if this is the second login (updates notification)
      const secondLoginShownKey = `second_login_${currentVersion.replace('.', '_')}_shown`;
      const wasSecondLoginShown = document.cookie.includes(`${secondLoginShownKey}=true`);
      console.log('Second login shown:', wasSecondLoginShown); // Debug log

      // Force show if requested (from sidebar beta badge click) - toggle behavior
      if (forceShow) {
        console.log('Force showing updates notification!'); // Debug log
        setIsToggled(true);
        setIsVisible(!isVisible); // Toggle visibility
        return;
      }

      // Check if user came from login (for immediate show)
      let fromLogin = false;
      try {
        const flag = sessionStorage.getItem('came_from_login_updates');
        fromLogin = flag === '1' || flag === 'true';
      } catch {}

      // Only show if not toggled and conditions are met
      if (!isToggled) {
        // Only show if:
        // 1. Coming from login
        // 2. Beta notification was already shown (first login completed)
        // 3. This version's updates notification hasn't been shown yet
        // 4. This version's second login hasn't been shown yet
        if (fromLogin && firstLoginShown && !wasVersionShown && !wasSecondLoginShown) {
          // Show immediately if coming from login, beta was already shown, and this version not shown
          setIsVisible(true);
          try { sessionStorage.removeItem('came_from_login_updates'); } catch {}
          return;
        }

        // Fallback: Show with delay if conditions are met
        if (!wasVersionShown && firstLoginShown && !wasSecondLoginShown) {
          // Show with delay if this version hasn't been shown and beta was already shown
          const timer = setTimeout(() => {
            setIsVisible(true);
          }, 2400);
          return () => clearTimeout(timer);
        }
      }
    }
  }, [forceShow]);

  const handleDismiss = () => {
    setIsVisible(false);
    setIsDismissed(true);
    if (typeof window !== 'undefined') {
      // Only set cookies if this wasn't a toggle (i.e., it was dismissed normally)
      if (!isToggled) {
        // Set version-specific cookie (lifetime)
        const currentVersion = latestVersion.version;
        const versionShownKey = `updates_${currentVersion.replace('.', '_')}_shown`;
        const secondLoginShownKey = `second_login_${currentVersion.replace('.', '_')}_shown`;
        
        // Set both cookies to prevent showing again
        document.cookie = `${versionShownKey}=true; path=/; max-age=31536000`; // 1 year lifetime
        document.cookie = `${secondLoginShownKey}=true; path=/; max-age=31536000`; // 1 year lifetime
      }
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


