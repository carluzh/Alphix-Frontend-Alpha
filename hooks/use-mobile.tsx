"use client"

import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const checkDevice = () => {
      let viewportWidth = window.innerWidth

      // Use visualViewport for more accurate mobile detection (handles mobile keyboards)
      if (window.visualViewport && window.visualViewport.width > 0) {
        viewportWidth = window.visualViewport.width
      }

      setIsMobile(viewportWidth < MOBILE_BREAKPOINT)
    }

    // Initial check
    checkDevice()

    // Listen to window resize via matchMedia (efficient)
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    mql.addEventListener("change", checkDevice)

    // Also listen to window resize for other dimension changes
    window.addEventListener("resize", checkDevice)

    // Listen to visualViewport changes (mobile keyboard, browser chrome)
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", checkDevice)
    }

    return () => {
      mql.removeEventListener("change", checkDevice)
      window.removeEventListener("resize", checkDevice)
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", checkDevice)
      }
    }
  }, [])

  return !!isMobile
}
