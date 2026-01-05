"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { IconXmark, IconArrowRight } from "nucleo-micro-bold-essential"
import { useAccount } from "wagmi"
import { ANNOUNCEMENTS, isAnnouncementActive, type Announcement } from "@/lib/announcements"
import Image from "next/image"
import { cn } from "@/lib/utils"

const CYCLE_MS = 10000
const DISMISS_UNTIL_PREFIX = "alphix:announcement:dismissedUntil:"
const DISMISS_MS = 24 * 60 * 60 * 1000
const ANN_CARD_STYLE = `
@keyframes annFill {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
.ann-card:hover .ann-progress { animation-play-state: paused; }
`

function hexWithAlpha(hex: string, alphaHex: string) {
  const h = hex.trim()
  if (!/^#([0-9a-fA-F]{6})$/.test(h)) return hex
  return `${h}${alphaHex}`
}

function getDismissUntilKey(address: string) {
  return `${DISMISS_UNTIL_PREFIX}${address.toLowerCase()}`
}

function getDismissedUntilMs(address: string): number {
  try {
    const raw = window.localStorage.getItem(getDismissUntilKey(address)) || "0"
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

export function AnnouncementCard() {
  const { isConnected, address } = useAccount()
  const [mounted, setMounted] = useState(false)
  const [index, setIndex] = useState(0)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [visibilityTick, setVisibilityTick] = useState(0)

  useEffect(() => {
    setMounted(true)
  }, [])

  const announcements = useMemo(() => {
    if (!mounted) return null
    if (!isConnected || !address) return []

    const until = getDismissedUntilMs(address)
    if (Date.now() < until) return []

    const active = ANNOUNCEMENTS.filter((a) => a.enabled !== false)
      .filter((a) => isAnnouncementActive(a))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

    return active
  }, [mounted, isConnected, address, visibilityTick])

  useEffect(() => {
    if (!announcements || announcements.length === 0) return
    if (index >= announcements.length) setIndex(0)
  }, [announcements, index])

  useEffect(() => {
    // Always run this hook (avoid hook-order bugs). Emit visible/height when mounted.
    if (!mounted) return
    if (!announcements || announcements.length === 0 || !cardRef.current) {
      try {
        window.dispatchEvent(new CustomEvent("alphix:announcement:layout", { detail: { visible: false, height: 0 } }))
      } catch {}
      return
    }
    const el = cardRef.current
    const emit = () => {
      const h = el.getBoundingClientRect().height
      try {
        window.dispatchEvent(new CustomEvent("alphix:announcement:layout", { detail: { visible: true, height: h } }))
      } catch {}
    }
    emit()
    const ro = new ResizeObserver(() => emit())
    ro.observe(el)
    window.addEventListener("resize", emit)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", emit)
    }
  }, [mounted, announcements, index])

  if (!announcements || announcements.length === 0) return null

  const announcement = announcements[index]!
  const href = announcement.href ?? ""
  const isExternal = href.startsWith("http")

  const ui = {
    contentWidth: "w-3/5 pr-2",
    title: "text-sm font-semibold",
    desc: "text-xs sm:text-sm leading-relaxed",
    ctaWrap: "mt-2 px-4 py-2 gap-2",
    ctaText: "text-sm font-semibold",
    ctaIcon: "h-5 w-5",
  }

  const closeAll = () => {
    if (!address) return
    try {
      window.localStorage.setItem(getDismissUntilKey(address), String(Date.now() + DISMISS_MS))
    } catch {}
    try {
      window.dispatchEvent(new Event("alphix:announcement:visibility"))
    } catch {}
    setVisibilityTick((x) => x + 1)
  }

  const CardInner = (
    <>
      <style>{ANN_CARD_STYLE}</style>

      {/* Keep images mounted across rotations to avoid reload flashes */}
      {announcements.some((a) => Boolean(a.image)) &&
        announcements.map((a) => {
          if (!a.image) return null
          const isActive = a.id === announcement.id
          return (
            <div
              key={a.id}
              className={cn(
                "absolute inset-0 z-0 transition-opacity duration-150",
                isActive ? "opacity-100" : "opacity-0"
              )}
            >
              <Image
                src={a.image}
                alt={a.title ?? "Announcement"}
                fill
                sizes="(max-width: 640px) 100vw, 420px"
                className={cn("object-cover", a.imageClassName)}
                unoptimized
              />
            </div>
          )
        })}

      {/* readability veil (keep it light so the image doesn't look like "empty space") */}
      {announcement.image && (
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `linear-gradient(90deg, ${
              announcement.bgColor ? hexWithAlpha(announcement.bgColor, "B3") : "rgba(0,0,0,0.30)"
            } 0%, ${
              announcement.bgColor ? hexWithAlpha(announcement.bgColor, "66") : "rgba(0,0,0,0.14)"
            } 55%, ${
              announcement.bgColor ? hexWithAlpha(announcement.bgColor, "14") : "rgba(0,0,0,0.04)"
            } 100%)`,
          }}
        />
      )}

      {/* subtle sheen (disable when bgColor is specified so exact colors like #18131d match) */}
      {!announcement.bgColor && (
        <div className="absolute inset-0 pointer-events-none z-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.06)_0%,transparent_60%)] opacity-80" />
      )}

      <div className="absolute right-3 top-3 sm:right-4 sm:top-4 min-[1700px]:right-5 min-[1700px]:top-5 z-20">
        <button
          type="button"
          className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-150 relative h-7 w-7 rounded-full grid place-items-center bg-black/35 hover:bg-black/55 text-white"
          aria-label="Close announcements"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            closeAll()
          }}
        >
          <IconXmark className="h-4 w-4" />
        </button>
      </div>

      <div className={cn("relative z-10 flex flex-col gap-1.5", ui.contentWidth)}>
        {announcement.logoSrc && (
          <Image
            src={announcement.logoSrc}
            alt=""
            width={120}
            height={16}
            className="mb-2 opacity-90"
            unoptimized
          />
        )}
        {announcement.title && <h3 className={cn(ui.title, "text-foreground")}>{announcement.title}</h3>}

        {announcement.description && (
          <p className={cn(ui.desc, "text-muted-foreground whitespace-pre-line")}>{announcement.description}</p>
        )}

        {announcement.href && announcement.ctaLabel && (
          <div className={cn("hidden sm:flex items-center justify-center rounded-3xl w-fit bg-black/25", ui.ctaWrap)}>
            <span className={cn(ui.ctaText, "text-foreground")}>{announcement.ctaLabel}</span>
            <IconArrowRight className={cn(ui.ctaIcon, "text-foreground")} />
          </div>
        )}
      </div>

      {/* image + veil now live above at z-0 */}

      {/* Bottom progress bar */}
      {announcements.length > 1 && (
        <div className="absolute inset-x-0 bottom-0 h-[1.5px] bg-muted-foreground/10">
          <div
            key={announcement.id}
            className="ann-progress h-full bg-muted-foreground/25 origin-left will-change-transform"
            style={{
              transform: "scaleX(0)",
              animation: `annFill ${CYCLE_MS}ms linear forwards`,
            }}
            onAnimationEnd={() => {
              setIndex((i) => (i + 1) % announcements.length)
            }}
          />
        </div>
      )}
    </>
  )

  const className = cn(
    "group ann-card relative flex items-center overflow-hidden rounded-lg border border-sidebar-border/60 shadow-sm",
    "bg-white dark:bg-[#131313]",
    // Mobile only: keep it narrower than swap content.
    "w-full max-w-md mx-auto sm:max-w-none sm:mx-0 sm:w-[360px] min-[1700px]:w-[420px]",
    "p-4 sm:p-5 min-[1700px]:p-6 h-[150px] sm:h-[190px] min-[1700px]:h-[210px]"
  )

  const Card = (
    <div
      ref={cardRef}
      className="fixed bottom-3 left-0 right-0 px-3 sm:bottom-6 sm:left-auto sm:right-6 sm:px-0 z-40"
    >
      {announcement.href ? (
        isExternal ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={className}
            style={announcement.bgColor ? { backgroundColor: announcement.bgColor } : undefined}
          >
            {CardInner}
          </a>
        ) : (
          <Link
            href={href}
            className={className}
            style={announcement.bgColor ? { backgroundColor: announcement.bgColor } : undefined}
          >
            {CardInner}
          </Link>
        )
      ) : (
        <div className={className} style={announcement.bgColor ? { backgroundColor: announcement.bgColor } : undefined}>
          {CardInner}
        </div>
      )}
    </div>
  )

  // Portal to body so `position: fixed` is truly viewport-fixed (avoids transform/stacking-context issues).
  if (!mounted || typeof document === "undefined") return null
  return createPortal(Card, document.body)
}
