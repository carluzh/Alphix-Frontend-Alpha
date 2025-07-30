"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { GridPatternCard, GridPatternCardBody } from "@/components/ui/card-with-grid-ellipsis-pattern";

export function BetaNotification() {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Check if notification was dismissed previously
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const wasDismissed = localStorage.getItem("beta_notification_dismissed") === "true";
      if (!wasDismissed) {
        // Show notification after delay
        const timer = setTimeout(() => {
          setIsVisible(true);
        }, 2000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  // Handle dismissing the notification
  const handleDismiss = () => {
    setIsVisible(false);
    setIsDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem("beta_notification_dismissed", "true");
    }
  };

  if (!isVisible || isDismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
      <GridPatternCard className="relative p-0">
        <Button
          variant="ghost"
          className="group absolute top-2 right-2 p-1 h-auto rounded-md hover:bg-background/80 z-10"
          aria-label="Close notification"
          onClick={handleDismiss}
        >
          <X
            size={16}
            strokeWidth={2}
            className="text-muted-foreground transition-colors group-hover:text-foreground"
          />
        </Button>
        <GridPatternCardBody className="p-4">
          <h3 className="text-md font-semibold mb-1 text-foreground">
            Private Alpha is now live!
          </h3>
          <p className="text-sm text-foreground/70">
            Please be aware this is an experimental version of the Alphix interface for testing the Alphix Hook v0 on Base Sepolia.
          </p>
        </GridPatternCardBody>
      </GridPatternCard>
    </div>
  );
} 