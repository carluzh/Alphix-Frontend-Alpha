export type MarketingAnnouncement = {
  id: string
  kind: "marketing"
  title?: string
  description?: string
  href?: string
  ctaLabel?: string
  image?: string
  imageClassName?: string
  bgColor?: string
  logoSrc?: string
  enabled?: boolean
  /**
   * Optional active window, YYYY-MM-DD (interpreted as UTC midnight)
   */
  startAt?: string
  endAt?: string
  /**
   * Higher = shown first
   */
  priority?: number
}

export type Announcement = MarketingAnnouncement

export function shouldForceShowAnnouncements(): boolean {
  // Always show announcements during local dev / preview iterations unless explicitly disabled.
  // NODE_ENV is inlined by Next on the client; NEXT_PUBLIC_FORCE_ANNOUNCEMENTS allows overriding in any env.
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_FORCE_ANNOUNCEMENTS === "1"
}

function parseUtcDateMaybe(date: string | undefined): number | null {
  if (!date) return null
  const ts = new Date(`${date}T00:00:00Z`).getTime()
  return Number.isNaN(ts) ? null : ts
}

export function isAnnouncementActive(a: Announcement, nowMs = Date.now()): boolean {
  const start = parseUtcDateMaybe(a.startAt)
  const end = parseUtcDateMaybe(a.endAt)
  if (start !== null && nowMs < start) return false
  if (end !== null && nowMs > end) return false
  return true
}

/**
 * Add future ads / announcements here.
 * Keep this as data-only so it can later be swapped for remote config without refactoring the UI.
 */
export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "marketing-twitter",
    kind: "marketing",
    title: "Follow us on X",
    description: "To see all our product updates, release notes, and mainnet announcements.",
    href: "https://x.com/AlphixFi",
    ctaLabel: "Follow",
    image: "/ann/Twitter.png",
    enabled: true,
    startAt: "2025-12-01",
    endAt: "2026-02-01",
    priority: 100,
  },
  {
    id: "marketing-sherlock",
    kind: "marketing",
    title: "Audit in Progress",
    description:
      "The final steps before launch. Unified Pools. Soon on Base.",
    href: undefined,
    ctaLabel: undefined,
    image: "/ann/Sherlock.png",
    imageClassName: "translate-x-[5%]",
    bgColor: "#18131d",
    logoSrc: "/ann/sherlock.svg",
    enabled: true,
    startAt: "2025-12-01",
    endAt: "2026-02-01",
    priority: 80,
  },
]
