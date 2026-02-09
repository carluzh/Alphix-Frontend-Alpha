'use client'

import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { useCookieConsent } from '@/hooks/useCookieConsent'

export function ConditionalAnalytics() {
  const { preferences } = useCookieConsent()

  if (!preferences?.analytics) return null

  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  )
}
