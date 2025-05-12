"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RefreshCw, X } from "lucide-react";

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
    <div className="fixed bottom-4 right-4 z-50">
      <Alert
        className="min-w-[400px]"
        layout="complex"
        isNotification
        size="lg"
        action={
          <Button
            variant="ghost"
            className="group -my-1.5 -me-2 size-8 p-0 hover:bg-transparent"
            aria-label="Close notification"
            onClick={handleDismiss}
          >
            <X
              size={16}
              strokeWidth={2}
              className="opacity-60 transition-opacity group-hover:opacity-100"
            />
          </Button>
        }
      >
        <div className="flex gap-3">
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border"
            aria-hidden="true"
          >
            <RefreshCw className="opacity-60" size={16} strokeWidth={2} />
          </div>
          <div className="flex grow flex-col gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Private Alpha is now live!</p>
              <p className="text-sm text-muted-foreground">
                This experimental version is for testing Uniswap v4 transactions and routing features.
              </p>
            </div>
          </div>
        </div>
      </Alert>
    </div>
  );
} 