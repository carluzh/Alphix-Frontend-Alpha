"use client";

import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { getLatestVersion } from "@/lib/version-log";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export function UpdatesNotification({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  // Get latest version info
  const latestVersion = getLatestVersion();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          className="fixed bottom-4 right-4 z-40 max-w-md w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="rounded-lg border border-[#2a2a2a] overflow-hidden bg-[var(--modal-background)] max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#2a2a2a]">
              <div className="flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220.8 220.8" className="h-3 w-3 mr-1">
                  <defs>
                    <style>{`.cls-1{fill:var(--sidebar-primary);}`}</style>
                  </defs>
                  <g id="Layer_2" data-name="Layer 2">
                    <g id="Layer_1-2" data-name="Layer 1">
                      <g id="Layer_2-2" data-name="Layer 2">
                        <g id="Layer_1-2-2" data-name="Layer 1-2">
                          <path className="cls-1" d="M110.4,0A110.4,110.4,0,1,0,220.8,110.4h0A110.49,110.49,0,0,0,110.4,0ZM26,110.4A84.49,84.49,0,0,1,97.4,27V193.8A84.49,84.49,0,0,1,26,110.4Zm97.4,83.4V27a84.41,84.41,0,0,1,0,166.8Z"/>
                        </g>
                      </g>
                    </g>
                  </g>
                </svg>
                <span className="text-xs tracking-wider font-mono font-bold text-sidebar-primary">Beta Update {latestVersion.version}</span>
                <span className="text-xs tracking-wider font-mono font-bold text-muted-foreground">- What's New</span>
              </div>
              <Button
                variant="ghost"
                className="group -my-1 -me-1 size-8 p-0 hover:bg-transparent"
                aria-label="Close notification"
                onClick={() => onClose?.()}
              >
                <X size={16} strokeWidth={2} className="opacity-100" />
              </Button>
            </div>
            <div className="overflow-y-auto flex-1 p-3 text-foreground scrollbar-thin scrollbar-thumb-[#2a2a2a] scrollbar-track-transparent">
              {/* TLDR Section - Always Visible */}
              <div className="mb-4 pb-3 border-b border-sidebar-border">
                <h4 className="text-xs font-semibold text-white mb-2.5 font-mono">TLDR</h4>
                <ul className="flex flex-col gap-2">
                  <li className="flex items-start text-xs">
                    <span className="text-sidebar-primary mr-2 mt-0.5">•</span>
                    <span className="text-white">Position Management Overhaul</span>
                  </li>
                  <li className="flex items-start text-xs">
                    <span className="text-sidebar-primary mr-2 mt-0.5">•</span>
                    <span className="text-white">Real-Time APY Tracking</span>
                  </li>
                  <li className="flex items-start text-xs">
                    <span className="text-sidebar-primary mr-2 mt-0.5">•</span>
                    <span className="text-white">Interactive Range Selection</span>
                  </li>
                </ul>
              </div>

              <Accordion type="multiple" className="w-full space-y-0" defaultValue={[]}>
                {/* New Features */}
                {latestVersion.newFeatures.length > 0 && (
                  <AccordionItem value="features" className="border-sidebar-border">
                    <AccordionTrigger className="text-white hover:no-underline text-xs font-semibold py-2 font-mono">
                      New Features ({latestVersion.newFeatures.length})
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground text-xs pt-1 pb-3">
                      <ul className="flex flex-col gap-2">
                        {latestVersion.newFeatures.map((feature, index) => {
                          const [title, ...descParts] = feature.split(' - ');
                          const description = descParts.join(' - ');
                          return (
                            <li key={index} className="flex items-start">
                              <span className="text-sidebar-primary mr-2">•</span>
                              <span>
                                <strong className="text-white">{title}</strong>
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
                {latestVersion.improvements.length > 0 && (
                  <AccordionItem value="improvements" className="border-sidebar-border">
                    <AccordionTrigger className="text-white hover:no-underline text-xs font-semibold py-2 font-mono">
                      Improvements ({latestVersion.improvements.length})
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground text-xs pt-1 pb-3">
                      <ul className="flex flex-col gap-2">
                        {latestVersion.improvements.map((improvement, index) => {
                          const [title, ...descParts] = improvement.split(' - ');
                          const description = descParts.join(' - ');
                          return (
                            <li key={index} className="flex items-start">
                              <span className="text-sidebar-primary mr-2">•</span>
                              <span>
                                <strong className="text-white">{title}</strong>
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
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


