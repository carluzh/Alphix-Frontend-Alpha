"use client";

import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { ReactSVG } from "react-svg";
import { useTheme } from "next-themes";

const HEADER_HEIGHT = "h-14";

export function MobileHeader() {
  const { toggleSidebar } = useSidebar();
  const isMobile = useIsMobile();
  const { resolvedTheme } = useTheme();

  if (!isMobile) {
    return null;
  }

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 flex items-center ${HEADER_HEIGHT} border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 px-4 shadow-sm md:hidden`}
    >
      <div className="flex-1 flex justify-start">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
        >
          <Menu className="h-6 w-6" />
        </Button>
      </div>

      <div className="flex-1 flex justify-center">
        <ReactSVG 
          src="/Logo Icon.svg" 
          className="h-6 w-6"
          beforeInjection={(svg) => {
            const paths = svg.querySelectorAll('path');
            paths.forEach(path => {
              path.setAttribute('fill', resolvedTheme === 'dark' ? 'white' : 'black');
            });
          }}
        />
      </div>

      <div className="flex-1"></div>
    </header>
  );
}

export function getMobileHeaderHeightClass() {
  return HEADER_HEIGHT;
}
