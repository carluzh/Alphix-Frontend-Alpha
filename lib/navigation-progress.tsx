"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";

interface NavigationProgressContextValue {
  isNavigating: boolean;
  startNavigation: (targetPath: string) => void;
}

const NavigationProgressContext = createContext<NavigationProgressContextValue | null>(null);
const MIN_DISPLAY_MS = 300;

export function NavigationProgressProvider({ children }: { children: ReactNode }) {
  const [isNavigating, setIsNavigating] = useState(false);
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number>(0);
  const pathname = usePathname();

  useEffect(() => {
    if (!targetPath) return;
    if (pathname === targetPath || pathname?.startsWith(targetPath + "/")) {
      const remaining = Math.max(0, MIN_DISPLAY_MS - (Date.now() - startTime));
      const timeout = setTimeout(() => {
        setIsNavigating(false);
        setTargetPath(null);
      }, remaining);
      return () => clearTimeout(timeout);
    }
  }, [pathname, targetPath, startTime]);

  useEffect(() => {
    if (!isNavigating) return;
    const timeout = setTimeout(() => {
      setIsNavigating(false);
      setTargetPath(null);
    }, 10000);
    return () => clearTimeout(timeout);
  }, [isNavigating]);

  const startNavigation = useCallback((path: string) => {
    setTargetPath(path);
    setStartTime(Date.now());
    setIsNavigating(true);
  }, []);

  return (
    <NavigationProgressContext.Provider value={{ isNavigating, startNavigation }}>
      {children}
    </NavigationProgressContext.Provider>
  );
}

export function useNavigationProgress() {
  const context = useContext(NavigationProgressContext);
  if (!context) {
    throw new Error("useNavigationProgress must be used within NavigationProgressProvider");
  }
  return context;
}

export function NavigationProgressBar() {
  const { isNavigating } = useNavigationProgress();

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '3px',
        zIndex: 99999,
        pointerEvents: 'none',
        opacity: isNavigating ? 1 : 0,
        transition: 'opacity 150ms',
      }}
    >
      <div
        style={{
          height: '100%',
          width: isNavigating ? '70%' : '0%',
          backgroundColor: '#f94706',
          transition: 'width 300ms ease-out',
        }}
      />
    </div>
  );
}
