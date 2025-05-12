"use client"

import { useEffect, useRef } from "react"

export function SiteHeader() {
  const announcementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = announcementRef.current
    if (!element) return

    // Check if content is wider than container
    const isOverflowing = element.scrollWidth > element.clientWidth

    if (isOverflowing) {
      // Add animation class only if content overflows
      element.classList.add("animate-scroll")
    }
  }, [])

  return (
    <header className="group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 flex h-12 shrink-0 items-center justify-between border-b transition-[width,height] ease-linear px-4 lg:px-6">
      <div className="flex items-center gap-1 lg:gap-2">
        <h1 className="text-base font-medium">Swap</h1>
      </div>

      <div
        ref={announcementRef}
        className="max-w-[300px] overflow-hidden whitespace-nowrap font-mono text-xs text-muted-foreground"
        style={{ fontFamily: "Consolas, monospace" }}
      >
        //Public Beta
      </div>
    </header>
  )
}

