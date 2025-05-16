"use client";

import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768; // Standard tablet breakpoint

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkDevice = () => {
      const windowWidth = window.innerWidth;
      let viewportWidthToUse = windowWidth;

      if (window.visualViewport && window.visualViewport.width > 0) {
        viewportWidthToUse = window.visualViewport.width;
      }
      
      const newIsMobile = viewportWidthToUse < MOBILE_BREAKPOINT;
      // console.log( // Keep this commented out for potential future debugging, or remove fully
      //   `[useIsMobile hook] checkDevice called. ` +
      //   `window.innerWidth: ${windowWidth}, ` +
      //   `visualViewport.width: ${window.visualViewport ? window.visualViewport.width : 'N/A'}, ` +
      //   `Using width: ${viewportWidthToUse} for check, ` +
      //   `newIsMobile: ${newIsMobile}`
      // );
      setIsMobile(newIsMobile);
    };

    checkDevice();

    window.addEventListener('resize', checkDevice);
    let visualViewportListener: (() => void) | null = null;
    if (window.visualViewport) {
      visualViewportListener = checkDevice;
      window.visualViewport.addEventListener('resize', visualViewportListener);
      // console.log("[useIsMobile hook] Added visualViewport resize listener."); // Keep or remove
    }

    return () => {
      // console.log("[useIsMobile hook] Cleaning up listeners."); // Keep or remove
      window.removeEventListener('resize', checkDevice);
      if (window.visualViewport && visualViewportListener) {
        window.visualViewport.removeEventListener('resize', visualViewportListener);
        // console.log("[useIsMobile hook] Removed visualViewport resize listener."); // Keep or remove
      }
    };
  }, []);

  return isMobile;
} 