"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { VERSION_LOG } from "@/lib/version-log";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export function UpdatesNotification({
  open = false,
  onClose,
  stackAboveAnnouncement = false,
  stackOffsetPx,
  edgeOffsetPx,
}: {
  open?: boolean;
  onClose?: () => void;
  stackAboveAnnouncement?: boolean;
  stackOffsetPx?: number;
  edgeOffsetPx?: number;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) setActiveIndex(0);
  }, [open]);

  const current = VERSION_LOG[activeIndex];
  const hasPrevious = Boolean(VERSION_LOG[activeIndex + 1]);
  const isPatch = (current?.title || "").toLowerCase().startsWith("patch");
  const hasDetails = (current?.newFeatures?.length || 0) > 0 || (current?.improvements?.length || 0) > 0;

  const handleClose = () => {
    onClose?.();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          className="fixed right-3 sm:right-6 z-40 max-w-md w-full"
          style={{
            bottom: stackAboveAnnouncement
              ? stackOffsetPx ?? undefined
              : edgeOffsetPx ?? undefined,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="rounded-lg border border-[#2a2a2a] overflow-hidden bg-[var(--modal-background)] max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#2a2a2a]">
              <div className="flex items-center gap-1">
                <span
                  className={`text-sm font-medium ${isPatch ? "text-foreground" : "text-sidebar-primary"}`}
                >
                  {current?.title}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {hasPrevious && (
                  <Button
                    variant="ghost"
                    className="h-8 px-2 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-muted-foreground hover:underline underline-offset-4"
                    onClick={() => setActiveIndex((i) => Math.min(i + 1, VERSION_LOG.length - 1))}
                  >
                    See Previous
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="group -my-1 -me-1 size-8 p-0 hover:bg-transparent"
                  aria-label="Close notification"
                  onClick={handleClose}
                >
                  <X size={16} strokeWidth={2} className="opacity-100" />
                </Button>
              </div>
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={current?.version ?? activeIndex}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.14 }}
                className="overflow-y-auto flex-1 p-3 text-foreground scrollbar-thin scrollbar-thumb-[#2a2a2a] scrollbar-track-transparent"
              >
                {/* TLDR */}
                {current?.tldr && current.tldr.length > 0 && (
                  <div className={`mb-4 ${hasDetails ? "pb-3 border-b border-sidebar-border" : ""}`}>
                    <h4 className="text-xs font-medium text-foreground mb-2">TLDR</h4>
                    <ul className="flex flex-col gap-2">
                      {current.tldr.map((item, index) => {
                        const [title, ...descParts] = item.split(" - ");
                        const description = descParts.join(" - ");
                        return (
                          <li key={index} className="flex items-start text-xs">
                            <span className="text-sidebar-primary mr-2 mt-0.5">•</span>
                            <span className="text-foreground">
                              <span className="font-medium">{title}</span>
                              {description && <span className="text-muted-foreground"> - {description}</span>}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {hasDetails && (
                  <Accordion type="multiple" className="w-full space-y-0 [&>*:last-child]:border-b-0" defaultValue={[]}>
                  {/* New Features */}
                  {(current?.newFeatures?.length ?? 0) > 0 && (
                    <AccordionItem value="features" className="border-sidebar-border">
                      <AccordionTrigger className="text-foreground hover:no-underline text-xs font-medium py-2">
                        New Features ({current?.newFeatures?.length ?? 0})
                      </AccordionTrigger>
                      <AccordionContent className="text-muted-foreground text-xs pt-1 pb-3">
                        <ul className="flex flex-col gap-2">
                          {current?.newFeatures?.map((feature, index) => {
                            const [title, ...descParts] = feature.split(" - ");
                            const description = descParts.join(" - ");
                            return (
                              <li key={index} className="flex items-start">
                                <span className="text-sidebar-primary mr-2">•</span>
                                <span>
                                  <span className="text-foreground font-medium">{title}</span>
                                  {description && <span className="text-muted-foreground"> - {description}</span>}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {/* Improvements */}
                  {(current?.improvements?.length ?? 0) > 0 && (
                    <AccordionItem value="improvements" className="border-sidebar-border">
                      <AccordionTrigger className="text-foreground hover:no-underline text-xs font-medium py-2">
                        Improvements ({current?.improvements?.length ?? 0})
                      </AccordionTrigger>
                      <AccordionContent className="text-muted-foreground text-xs pt-1 pb-3">
                        <ul className="flex flex-col gap-2">
                          {current?.improvements?.map((improvement, index) => {
                            const [title, ...descParts] = improvement.split(" - ");
                            const description = descParts.join(" - ");
                            return (
                              <li key={index} className="flex items-start">
                                <span className="text-sidebar-primary mr-2">•</span>
                                <span>
                                  <span className="text-foreground font-medium">{title}</span>
                                  {description && <span className="text-muted-foreground"> - {description}</span>}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  )}
                  </Accordion>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


