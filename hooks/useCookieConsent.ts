'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  getCookieConsent,
  setCookieConsent,
  type CookieConsentPreferences,
} from '@/lib/cookie-consent'

export interface UseCookieConsentReturn {
  /** Current preferences (null if not yet decided) */
  preferences: CookieConsentPreferences | null
  /** Whether the banner should be shown */
  showBanner: boolean
  /** Accept all cookie categories */
  acceptAll: () => void
  /** Accept only strictly necessary cookies */
  acceptNecessaryOnly: () => void
}

export function useCookieConsent(): UseCookieConsentReturn {
  const [preferences, setPreferences] = useState<CookieConsentPreferences | null>(null)
  const [showBanner, setShowBanner] = useState(false)

  useEffect(() => {
    const existing = getCookieConsent()
    if (existing) {
      setPreferences(existing)
      setShowBanner(false)
    } else {
      setShowBanner(true)
    }
  }, [])

  const acceptAll = useCallback(() => {
    setCookieConsent({ analytics: true, functional: true })
    setPreferences(getCookieConsent())
    setShowBanner(false)
  }, [])

  const acceptNecessaryOnly = useCallback(() => {
    setCookieConsent({ analytics: false, functional: false })
    setPreferences(getCookieConsent())
    setShowBanner(false)
  }, [])

  return { preferences, showBanner, acceptAll, acceptNecessaryOnly }
}
