"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigationProgress } from "@/lib/navigation-progress";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Home", href: "/overview" },
  { label: "Liquidity", href: "/liquidity" },
  { label: "Swap", href: "/swap" },
  { label: "Points", href: "/points" },
];

export function MobileNavBar() {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { startNavigation } = useNavigationProgress();

  // Only render on mobile
  if (!isMobile) {
    return null;
  }

  const handleNavClick = (e: React.MouseEvent, href: string) => {
    e.preventDefault();
    startNavigation(href);
    startTransition(() => {
      router.push(href);
    });
  };

  const isActive = (href: string) => {
    return pathname === href || pathname?.startsWith(`${href}/`);
  };

  return (
    <div className="sticky top-0 left-0 z-50 flex w-[100vw] max-w-[100vw] flex-col items-center py-4 px-4 min-[900px]:hidden bg-background">
      <nav className="flex w-full items-center justify-between gap-3 rounded-lg bg-surface border border-sidebar-border/60 p-2">
        <div className="flex items-center gap-5">
          <Link href="/" className="flex items-center justify-center ml-1">
            <Image
              src="/logos/alphix-icon-white.svg"
              alt="Alphix"
              width={28}
              height={28}
              className="h-6 w-7"
              unoptimized
            />
          </Link>
          <div className="flex items-center gap-5">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={(e) => handleNavClick(e, item.href)}
                className={cn(
                  "text-sm font-semibold transition-colors whitespace-nowrap",
                  isActive(item.href)
                    ? "bg-[#2a2a2a] text-white px-4 py-1.5 rounded-md"
                    : "text-muted-foreground hover:text-white"
                )}
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
      </nav>
    </div>
  );
}
