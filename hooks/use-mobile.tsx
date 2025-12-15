"use client"

import * as React from "react"

const MOBILE_BREAKPOINT = 900

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)

    const handleChange = () => setIsMobile(mql.matches)

    // Initial check
    handleChange()

    // Only update when crossing the breakpoint (avoid rerenders on every resize pixel)
    mql.addEventListener("change", handleChange)

    return () => {
      mql.removeEventListener("change", handleChange)
    }
  }, [])

  return !!isMobile
}
