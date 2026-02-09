export const COOKIE_CONSENT_KEY = 'alphix:cookie-consent'

export interface CookieConsentPreferences {
  analytics: boolean
  functional: boolean
  timestamp: number
}

/** Cookie max age: 12 months in seconds */
export const COOKIE_CONSENT_MAX_AGE = 365 * 24 * 60 * 60

export function getCookieConsent(): CookieConsentPreferences | null {
  if (typeof document === 'undefined') return null
  try {
    const match = document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${COOKIE_CONSENT_KEY}=`))
    if (!match) return null
    return JSON.parse(decodeURIComponent(match.split('=')[1]))
  } catch {
    return null
  }
}

export function setCookieConsent(prefs: Omit<CookieConsentPreferences, 'timestamp'>): void {
  if (typeof document === 'undefined') return
  const value: CookieConsentPreferences = { ...prefs, timestamp: Date.now() }
  document.cookie = `${COOKIE_CONSENT_KEY}=${encodeURIComponent(JSON.stringify(value))};path=/;max-age=${COOKIE_CONSENT_MAX_AGE};SameSite=Lax`
}

export function hasConsentCookie(): boolean {
  return getCookieConsent() !== null
}
