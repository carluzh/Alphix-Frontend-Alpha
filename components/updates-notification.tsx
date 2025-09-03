"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export function UpdatesNotification() {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      let fromLogin = false;
      try {
        const flag = sessionStorage.getItem('came_from_login_updates');
        fromLogin = flag === '1' || flag === 'true';
      } catch {}

      // Avoid overlapping with beta notification if it's showing
      const betaShowing = typeof window !== 'undefined' && sessionStorage.getItem('beta_notification_showing') === '1';

      if (fromLogin && !betaShowing) {
        setIsVisible(true);
        try { sessionStorage.removeItem('came_from_login_updates'); } catch {}
        return;
      }

      const wasDismissed = localStorage.getItem("updates_notification_dismissed") === "true";
      if (!wasDismissed && !betaShowing) {
        const timer = setTimeout(() => {
          setIsVisible(true);
        }, 2400);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    setIsDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem("updates_notification_dismissed", "true");
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
          className="fixed bottom-20 right-4 z-50 max-w-sm w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="rounded-lg border border-[#2a2a2a] overflow-hidden bg-[var(--modal-background)]">
            <div className="flex items-center justify-between px-3 py-1 border-b border-[#2a2a2a]">
              <span className="text-xs tracking-wider font-mono font-bold text-sidebar-primary">NEW UPDATES</span>
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
              <p className="text-sm mb-2">• Improved swap routing for lower slippage.</p>
              <p className="text-sm mb-2">• Dynamic fee tuning deployed for volatile pools.</p>
              <p className="text-sm mb-2">• UI polish and several bug fixes.</p>
              <p className="text-sm">• Check the changelog for full details.</p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


