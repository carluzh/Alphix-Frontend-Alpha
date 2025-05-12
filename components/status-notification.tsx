"use client";

import { useEffect } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { X, InfoIcon } from "lucide-react";
import Image from "next/image";

interface StatusNotificationProps {
  isVisible: boolean;
  title: string;
  description: string;
  variant: 'success' | 'warning' | 'info';
  onDismiss: () => void;
  duration?: number; // Optional auto-dismiss duration in ms
  actionButton?: { // Optional action button
    text: string;
    onClick: () => void;
  };
}

export function StatusNotification({
  isVisible,
  title,
  description,
  variant,
  onDismiss,
  duration,
  actionButton,
}: StatusNotificationProps) {
  useEffect(() => {
    if (isVisible && duration) {
      const timer = setTimeout(() => {
        onDismiss();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isVisible, duration, onDismiss]);

  if (!isVisible) {
    return null;
  }

  let iconContent;
  let iconColorClass = "text-muted-foreground"; // Default for InfoIcon or if SVGs don't take color

  if (variant === 'success') {
    iconContent = <Image src="/success.svg" alt="Success" width={28} height={28} className="opacity-80" />;
  } else if (variant === 'warning') {
    iconContent = <Image src="/warning.svg" alt="Warning" width={28} height={28} className="opacity-80" />;
  } else { // info
    iconContent = <InfoIcon className={`${iconColorClass} opacity-80`} size={28} strokeWidth={2.5} />;
  }

  let alertBorderColorClass = "border-border";
  if (variant === 'success') {
    alertBorderColorClass = "border-[#6ed246]";
  } else if (variant === 'warning') {
    alertBorderColorClass = "border-[#e94c4c]";
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Alert
        className={`min-w-[400px] ${alertBorderColorClass}`}
        layout="complex"
        isNotification
        size="lg"
        action={
          <Button
            variant="ghost"
            className="group -my-1.5 -me-2 size-8 p-0 hover:bg-transparent"
            aria-label="Close notification"
            onClick={onDismiss}
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
            className="flex size-9 shrink-0 items-center justify-center rounded-full"
            aria-hidden="true"
          >
            {iconContent}
          </div>
          <div className="flex grow flex-col gap-2">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{title}</p>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            {actionButton && (
              <div className="flex gap-2">
                <Button size="sm" onClick={actionButton.onClick}>{actionButton.text}</Button>
              </div>
            )}
          </div>
        </div>
      </Alert>
    </div>
  );
}